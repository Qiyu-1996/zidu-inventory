-- ZIDU v35: 批次库存先进先出（FIFO）与库存全景核对。
-- 依赖：migration_v19_mass_inventory.sql、migration_v21_batch_delete_and_kg_receiving.sql。
-- 建议在 v34 成功后运行。本迁移不重置现有库存或批次。

CREATE TABLE IF NOT EXISTS public.batch_stock_movements (
  id BIGSERIAL PRIMARY KEY,
  batch_id INTEGER REFERENCES public.product_batches(id) ON DELETE SET NULL,
  batch_no TEXT NOT NULL DEFAULT '',
  product_id INTEGER REFERENCES public.products(id) ON DELETE SET NULL,
  spec_id INTEGER REFERENCES public.product_specs(id) ON DELETE SET NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('FIFO_OUT', 'UNBATCHED_OUT', 'BATCH_DELETE')),
  quantity NUMERIC(14,6) NOT NULL CHECK (quantity >= 0),
  before_qty NUMERIC(14,6),
  after_qty NUMERIC(14,6),
  unit TEXT NOT NULL CHECK (unit IN ('KG', 'SPEC')),
  transaction_id BIGINT DEFAULT txid_current(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_batch_movements_batch
  ON public.batch_stock_movements(batch_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_movements_product
  ON public.batch_stock_movements(product_id, spec_id, created_at DESC);

ALTER TABLE public.batch_stock_movements ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'batch_stock_movements'
      AND policyname = 'Allow all on batch_stock_movements'
  ) THEN
    CREATE POLICY "Allow all on batch_stock_movements"
      ON public.batch_stock_movements FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- 从系统总库存中先识别历史无批次库存，再消耗有效批次。
-- 有效批次严格按入库日期、保质期、批次 id 从早到晚扣减；过期批次不会出库。
CREATE OR REPLACE FUNCTION public.zidu_fifo_consume_batches(
  p_product_id INTEGER,
  p_spec_id INTEGER,
  p_quantity NUMERIC,
  p_unit TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_total_before NUMERIC(14,6);
  v_all_batch_total NUMERIC(14,6);
  v_unbatched NUMERIC(14,6);
  v_unbatched_take NUMERIC(14,6);
  v_remaining NUMERIC(14,6) := round(coalesce(p_quantity, 0), 6);
  v_take NUMERIC(14,6);
  v_batch public.product_batches%ROWTYPE;
  v_batch_count INTEGER := 0;
BEGIN
  IF v_remaining <= 0 THEN
    RETURN jsonb_build_object('batchCount', 0, 'unbatchedQuantity', 0, 'batchQuantity', 0);
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF v_product.id IS NULL THEN RAISE EXCEPTION '产品不存在'; END IF;

  IF v_product.inventory_mode = 'MASS' THEN
    v_total_before := coalesce(v_product.base_stock_kg, 0);
    SELECT coalesce(sum(remaining_qty), 0) INTO v_all_batch_total
    FROM public.product_batches
    WHERE product_id = p_product_id AND remaining_qty > 0;
  ELSE
    SELECT coalesce(stock, 0) INTO v_total_before
    FROM public.product_specs WHERE id = p_spec_id FOR UPDATE;
    SELECT coalesce(sum(remaining_qty), 0) INTO v_all_batch_total
    FROM public.product_batches
    WHERE spec_id = p_spec_id AND remaining_qty > 0;
  END IF;

  IF v_remaining > v_total_before + 0.000001 THEN RAISE EXCEPTION '库存不足'; END IF;

  v_unbatched := greatest(v_total_before - v_all_batch_total, 0);
  v_unbatched_take := least(v_remaining, v_unbatched);
  IF v_unbatched_take > 0 THEN
    INSERT INTO public.batch_stock_movements(
      batch_id, batch_no, product_id, spec_id, movement_type,
      quantity, before_qty, after_qty, unit
    ) VALUES (
      NULL, '历史/无批次库存', p_product_id, p_spec_id, 'UNBATCHED_OUT',
      v_unbatched_take, v_unbatched, v_unbatched - v_unbatched_take, upper(p_unit)
    );
    v_remaining := v_remaining - v_unbatched_take;
  END IF;

  FOR v_batch IN
    SELECT *
    FROM public.product_batches
    WHERE remaining_qty > 0
      AND (expiry_date IS NULL OR expiry_date >= current_date)
      AND CASE
        WHEN v_product.inventory_mode = 'MASS' THEN product_id = p_product_id
        ELSE spec_id = p_spec_id
      END
    ORDER BY received_date ASC, expiry_date ASC NULLS LAST, id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0.000001;
    v_take := least(v_remaining, v_batch.remaining_qty);
    UPDATE public.product_batches
    SET remaining_qty = round(remaining_qty - v_take, 6)
    WHERE id = v_batch.id;

    INSERT INTO public.batch_stock_movements(
      batch_id, batch_no, product_id, spec_id, movement_type,
      quantity, before_qty, after_qty, unit
    ) VALUES (
      v_batch.id, v_batch.batch_no, p_product_id, p_spec_id, 'FIFO_OUT',
      v_take, v_batch.remaining_qty, v_batch.remaining_qty - v_take, upper(p_unit)
    );
    v_remaining := v_remaining - v_take;
    v_batch_count := v_batch_count + 1;
  END LOOP;

  IF v_remaining > 0.000001 THEN
    RAISE EXCEPTION '可用批次库存不足；存在的过期批次不能自动销售，请先盘点处理';
  END IF;

  RETURN jsonb_build_object(
    'batchCount', v_batch_count,
    'unbatchedQuantity', v_unbatched_take,
    'batchQuantity', round(p_quantity - v_unbatched_take, 6)
  );
END;
$$;

-- 覆盖统一库存调整入口：任何销售出库、损耗出库或向下盘点都会自动走 FIFO。
CREATE OR REPLACE FUNCTION public.zidu_adjust_inventory(
  p_spec_id INTEGER,
  p_type TEXT,
  p_quantity NUMERIC,
  p_quantity_unit TEXT DEFAULT 'SPEC'
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.product_specs%ROWTYPE;
  p public.products%ROWTYPE;
  factor NUMERIC;
  before_units NUMERIC;
  after_units NUMERIC;
  before_kg NUMERIC;
  after_kg NUMERIC;
  delta_kg NUMERIC;
  outbound_base NUMERIC := 0;
  fifo_result JSONB := '{}'::JSONB;
BEGIN
  IF p_type NOT IN ('IN', 'OUT', 'CORRECTION') OR p_quantity < 0 THEN
    RAISE EXCEPTION '无效的库存调整参数';
  END IF;
  SELECT * INTO s FROM public.product_specs WHERE id = p_spec_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION '规格不存在'; END IF;
  SELECT * INTO p FROM public.products WHERE id = s.product_id FOR UPDATE;
  before_units := s.stock;

  IF p.inventory_mode = 'MASS' THEN
    factor := CASE WHEN upper(p_quantity_unit) = 'KG' THEN 1
      ELSE public.zidu_spec_mass_kg(s.spec, p.density_g_ml) END;
    IF factor IS NULL THEN RAISE EXCEPTION '规格 % 无法换算为 kg', s.spec; END IF;
    before_kg := p.base_stock_kg;
    IF p_type = 'CORRECTION' THEN
      after_kg := CASE WHEN upper(p_quantity_unit) = 'KG' THEN p_quantity ELSE p_quantity * factor END;
      outbound_base := greatest(before_kg - after_kg, 0);
    ELSE
      delta_kg := p_quantity * factor * CASE WHEN p_type = 'IN' THEN 1 ELSE -1 END;
      IF before_kg + delta_kg < 0 THEN RAISE EXCEPTION '库存不足'; END IF;
      after_kg := before_kg + delta_kg;
      IF p_type = 'OUT' THEN outbound_base := abs(delta_kg); END IF;
    END IF;

    IF outbound_base > 0 THEN
      fifo_result := public.zidu_fifo_consume_batches(p.id, s.id, outbound_base, 'KG');
    END IF;
    UPDATE public.products SET base_stock_kg = after_kg WHERE id = p.id;
    PERFORM public.zidu_sync_mass_spec_stock(p.id);
    SELECT stock INTO after_units FROM public.product_specs WHERE id = p_spec_id;
  ELSE
    before_kg := NULL;
    after_kg := NULL;
    IF upper(p_quantity_unit) = 'KG' THEN RAISE EXCEPTION '独立 SKU 库存不能按 kg 调整'; END IF;
    IF p_type = 'CORRECTION' THEN
      after_units := p_quantity;
      outbound_base := greatest(before_units - after_units, 0);
    ELSIF p_type = 'IN' THEN
      after_units := before_units + p_quantity;
    ELSE
      IF before_units < p_quantity THEN RAISE EXCEPTION '库存不足'; END IF;
      after_units := before_units - p_quantity;
      outbound_base := p_quantity;
    END IF;

    IF outbound_base > 0 THEN
      fifo_result := public.zidu_fifo_consume_batches(p.id, s.id, outbound_base, 'SPEC');
    END IF;
    PERFORM set_config('zidu.syncing_mass_stock', 'on', true);
    UPDATE public.product_specs SET stock = after_units WHERE id = p_spec_id;
    PERFORM set_config('zidu.syncing_mass_stock', 'off', true);
  END IF;

  RETURN (
    jsonb_build_object(
      'before', before_units, 'after', after_units,
      'beforeKg', before_kg, 'afterKg', after_kg,
      'quantityKg', CASE WHEN p.inventory_mode = 'MASS' THEN abs(after_kg - before_kg) ELSE NULL END
    ) || jsonb_build_object('fifo', fifo_result)
  )::JSON;
END;
$$;

-- 删除指定批次时只扣该批次对应的系统总库存，不再触发 FIFO 消耗其他批次。
CREATE OR REPLACE FUNCTION public.zidu_delete_inventory_batch(
  p_batch_id INTEGER,
  p_operator_name TEXT DEFAULT ''
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.product_batches%ROWTYPE;
  p public.products%ROWTYPE;
  s public.product_specs%ROWTYPE;
  before_units NUMERIC;
  after_units NUMERIC;
  before_kg NUMERIC;
  after_kg NUMERIC;
  unit_name TEXT;
BEGIN
  SELECT * INTO b FROM public.product_batches WHERE id = p_batch_id;
  IF b.id IS NULL THEN RETURN json_build_object('error', '批次不存在或已经删除'); END IF;

  SELECT * INTO s FROM public.product_specs WHERE id = b.spec_id FOR UPDATE;
  SELECT * INTO p FROM public.products WHERE id = b.product_id FOR UPDATE;
  SELECT * INTO b FROM public.product_batches WHERE id = p_batch_id FOR UPDATE;
  IF b.id IS NULL THEN RETURN json_build_object('error', '批次已被其他操作处理'); END IF;

  before_units := s.stock;
  IF p.inventory_mode = 'MASS' THEN
    unit_name := 'KG';
    before_kg := coalesce(p.base_stock_kg, 0);
    IF before_kg < b.remaining_qty THEN RAISE EXCEPTION '系统重量库存小于该批次余量，请先盘点核对'; END IF;
    after_kg := before_kg - b.remaining_qty;
    UPDATE public.products SET base_stock_kg = after_kg WHERE id = p.id;
    PERFORM public.zidu_sync_mass_spec_stock(p.id);
    SELECT stock INTO after_units FROM public.product_specs WHERE id = s.id;
  ELSE
    unit_name := 'SPEC';
    before_kg := NULL;
    after_kg := NULL;
    IF before_units < b.remaining_qty THEN RAISE EXCEPTION '系统规格库存小于该批次余量，请先盘点核对'; END IF;
    after_units := before_units - b.remaining_qty;
    PERFORM set_config('zidu.syncing_mass_stock', 'on', true);
    UPDATE public.product_specs SET stock = after_units WHERE id = s.id;
    PERFORM set_config('zidu.syncing_mass_stock', 'off', true);
  END IF;

  INSERT INTO public.batch_stock_movements(
    batch_id, batch_no, product_id, spec_id, movement_type,
    quantity, before_qty, after_qty, unit
  ) VALUES (
    b.id, b.batch_no, b.product_id, b.spec_id, 'BATCH_DELETE',
    b.remaining_qty, b.remaining_qty, 0, unit_name
  );

  INSERT INTO public.stock_adjustments(
    spec_id, product_id, type, reason, quantity,
    before_stock, after_stock, quantity_kg, before_stock_kg, after_stock_kg,
    operator_name, note, batch_id
  ) VALUES (
    b.spec_id, b.product_id, 'OUT', 'OTHER', b.remaining_qty,
    before_units, after_units,
    CASE WHEN unit_name = 'KG' THEN b.remaining_qty ELSE NULL END,
    before_kg, after_kg,
    coalesce(p_operator_name, ''), '删除批次 ' || b.batch_no, b.id
  );

  DELETE FROM public.product_batches WHERE id = b.id;
  RETURN json_build_object('success', true, 'productId', b.product_id, 'specId', b.spec_id);
END;
$$;

REVOKE ALL ON FUNCTION public.zidu_fifo_consume_batches(INTEGER, INTEGER, NUMERIC, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.zidu_adjust_inventory(INTEGER, TEXT, NUMERIC, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_delete_inventory_batch(INTEGER, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT
  to_regclass('public.batch_stock_movements') IS NOT NULL AS movement_log_ready,
  to_regprocedure('public.zidu_fifo_consume_batches(integer,integer,numeric,text)') IS NOT NULL AS fifo_ready,
  to_regprocedure('public.zidu_adjust_inventory(integer,text,numeric,text)') IS NOT NULL AS inventory_ready,
  to_regprocedure('public.zidu_delete_inventory_batch(integer,text)') IS NOT NULL AS batch_delete_ready;
