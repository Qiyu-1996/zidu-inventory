-- ZIDU v36: 指定批次出库。
-- 依赖：migration_v35_fifo_batch_inventory.sql。
-- 默认出库仍走 FIFO；本迁移只增加仓库需要指定批次时的例外入口。

ALTER TABLE public.batch_stock_movements
  DROP CONSTRAINT IF EXISTS batch_stock_movements_movement_type_check;

ALTER TABLE public.batch_stock_movements
  ADD CONSTRAINT batch_stock_movements_movement_type_check
  CHECK (movement_type IN ('FIFO_OUT', 'MANUAL_OUT', 'UNBATCHED_OUT', 'BATCH_DELETE'));

CREATE OR REPLACE FUNCTION public.zidu_adjust_inventory_from_batch(
  p_spec_id INTEGER,
  p_batch_id INTEGER,
  p_quantity NUMERIC,
  p_reason TEXT DEFAULT 'OTHER',
  p_note TEXT DEFAULT '',
  p_operator_name TEXT DEFAULT ''
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.product_specs%ROWTYPE;
  p public.products%ROWTYPE;
  b public.product_batches%ROWTYPE;
  before_units NUMERIC;
  after_units NUMERIC;
  before_kg NUMERIC;
  after_kg NUMERIC;
  unit_name TEXT;
  reason_name TEXT := upper(coalesce(p_reason, 'OTHER'));
BEGIN
  IF coalesce(p_quantity, 0) <= 0 THEN RAISE EXCEPTION '出库数量必须大于 0'; END IF;
  IF reason_name NOT IN ('DAMAGE', 'ORDER', 'OTHER') THEN RAISE EXCEPTION '指定批次出库原因无效'; END IF;

  SELECT * INTO s FROM public.product_specs WHERE id = p_spec_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION '规格不存在'; END IF;
  SELECT * INTO p FROM public.products WHERE id = s.product_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION '产品不存在'; END IF;
  SELECT * INTO b FROM public.product_batches WHERE id = p_batch_id FOR UPDATE;
  IF b.id IS NULL THEN RAISE EXCEPTION '批次不存在或已经删除'; END IF;

  IF p.inventory_mode = 'MASS' THEN
    IF b.product_id IS DISTINCT FROM p.id THEN RAISE EXCEPTION '所选批次不属于该原料'; END IF;
  ELSIF b.spec_id IS DISTINCT FROM s.id THEN
    RAISE EXCEPTION '所选批次不属于该产品规格';
  END IF;

  IF b.remaining_qty < p_quantity THEN
    RAISE EXCEPTION '批次 % 库存不足，当前剩余 %', b.batch_no, b.remaining_qty;
  END IF;
  IF b.expiry_date IS NOT NULL AND b.expiry_date < current_date AND reason_name <> 'DAMAGE' THEN
    RAISE EXCEPTION '批次 % 已过期，只能按损耗/报废出库', b.batch_no;
  END IF;

  before_units := coalesce(s.stock, 0);
  IF p.inventory_mode = 'MASS' THEN
    unit_name := 'KG';
    before_kg := coalesce(p.base_stock_kg, 0);
    IF before_kg < p_quantity THEN RAISE EXCEPTION '系统重量库存不足'; END IF;
    after_kg := round(before_kg - p_quantity, 6);
    UPDATE public.products SET base_stock_kg = after_kg WHERE id = p.id;
    PERFORM public.zidu_sync_mass_spec_stock(p.id);
    SELECT stock INTO after_units FROM public.product_specs WHERE id = s.id;
  ELSE
    unit_name := 'SPEC';
    before_kg := NULL;
    after_kg := NULL;
    IF before_units < p_quantity THEN RAISE EXCEPTION '系统规格库存不足'; END IF;
    after_units := round(before_units - p_quantity, 6);
    PERFORM set_config('zidu.syncing_mass_stock', 'on', true);
    UPDATE public.product_specs SET stock = after_units WHERE id = s.id;
    PERFORM set_config('zidu.syncing_mass_stock', 'off', true);
  END IF;

  UPDATE public.product_batches
  SET remaining_qty = round(remaining_qty - p_quantity, 6)
  WHERE id = b.id;

  INSERT INTO public.batch_stock_movements(
    batch_id, batch_no, product_id, spec_id, movement_type,
    quantity, before_qty, after_qty, unit
  ) VALUES (
    b.id, b.batch_no, p.id, s.id, 'MANUAL_OUT',
    p_quantity, b.remaining_qty, b.remaining_qty - p_quantity, unit_name
  );

  INSERT INTO public.stock_adjustments(
    spec_id, product_id, type, reason, quantity,
    before_stock, after_stock, quantity_kg, before_stock_kg, after_stock_kg,
    operator_name, note, batch_id
  ) VALUES (
    s.id, p.id, 'OUT', reason_name, p_quantity,
    before_units, after_units,
    CASE WHEN unit_name = 'KG' THEN p_quantity ELSE NULL END,
    before_kg, after_kg,
    coalesce(p_operator_name, ''),
    trim(concat('指定批次 ', b.batch_no, CASE WHEN coalesce(trim(p_note), '') <> '' THEN ' · ' || trim(p_note) ELSE '' END)),
    b.id
  );

  RETURN json_build_object(
    'success', true,
    'batchId', b.id,
    'batchNo', b.batch_no,
    'batchRemaining', round(b.remaining_qty - p_quantity, 6),
    'before', before_units,
    'after', after_units,
    'beforeKg', before_kg,
    'afterKg', after_kg,
    'quantityKg', CASE WHEN unit_name = 'KG' THEN p_quantity ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.zidu_adjust_inventory_from_batch(INTEGER, INTEGER, NUMERIC, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.zidu_adjust_inventory_from_batch(INTEGER, INTEGER, NUMERIC, TEXT, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT
  to_regprocedure('public.zidu_adjust_inventory_from_batch(integer,integer,numeric,text,text,text)') IS NOT NULL AS manual_batch_out_ready,
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.batch_stock_movements'::regclass
      AND conname = 'batch_stock_movements_movement_type_check'
  ) AS movement_type_ready;
