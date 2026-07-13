-- ============================================================
-- ZIDU v21: 修复批次删除外键错误 + 原子删除 + 误扣库存回滚
-- 依赖：migration_v19_mass_inventory.sql
-- ============================================================

-- 1) 自动回滚「批次仍存在，但旧代码已写入删除扣减」的失败操作。
--    以日志备注作唯一识别，并在备注追加标记，确保本迁移可重复执行。
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT a.id AS adjustment_id, a.spec_id, a.product_id,
           a.quantity, a.quantity_kg, b.batch_no, p.inventory_mode
    FROM public.stock_adjustments a
    JOIN public.product_batches b
      ON a.note = '删除批次 ' || b.batch_no
    JOIN public.products p ON p.id = a.product_id
    WHERE a.type = 'OUT'
      AND a.reason = 'OTHER'
      AND a.note NOT LIKE '%[删除失败已回滚]%'
  LOOP
    IF r.inventory_mode = 'MASS' THEN
      UPDATE public.products
         SET base_stock_kg = base_stock_kg + coalesce(r.quantity_kg, 0)
       WHERE id = r.product_id;
      PERFORM public.zidu_sync_mass_spec_stock(r.product_id);
    ELSE
      UPDATE public.product_specs
         SET stock = stock + r.quantity
       WHERE id = r.spec_id;
    END IF;
    UPDATE public.stock_adjustments
       SET note = note || ' [删除失败已回滚]'
     WHERE id = r.adjustment_id;
  END LOOP;
END $$;

-- 2) 删除批次时保留库存流水，但解除其 batch_id，避免历史审计丢失。
ALTER TABLE public.stock_adjustments
  DROP CONSTRAINT IF EXISTS stock_adjustments_batch_id_fkey;
ALTER TABLE public.stock_adjustments
  ADD CONSTRAINT stock_adjustments_batch_id_fkey
  FOREIGN KEY (batch_id) REFERENCES public.product_batches(id) ON DELETE SET NULL;

-- 3) 批次库存扣减、日志和删除放进同一事务；任何一步失败都会整体回滚。
CREATE OR REPLACE FUNCTION public.zidu_delete_inventory_batch(
  p_batch_id INTEGER,
  p_operator_name TEXT DEFAULT ''
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b public.product_batches%ROWTYPE;
  p public.products%ROWTYPE;
  adjusted JSON;
BEGIN
  SELECT * INTO b FROM public.product_batches WHERE id = p_batch_id FOR UPDATE;
  IF b.id IS NULL THEN RETURN json_build_object('error', '批次不存在或已经删除'); END IF;
  SELECT * INTO p FROM public.products WHERE id = b.product_id FOR UPDATE;

  adjusted := public.zidu_adjust_inventory(
    b.spec_id,
    'OUT',
    b.remaining_qty,
    CASE WHEN p.inventory_mode = 'MASS' THEN 'KG' ELSE 'SPEC' END
  );

  INSERT INTO public.stock_adjustments (
    spec_id, product_id, type, reason, quantity,
    before_stock, after_stock, quantity_kg, before_stock_kg, after_stock_kg,
    operator_name, note, batch_id
  ) VALUES (
    b.spec_id, b.product_id, 'OUT', 'OTHER', b.remaining_qty,
    (adjusted->>'before')::NUMERIC, (adjusted->>'after')::NUMERIC,
    nullif(adjusted->>'quantityKg', '')::NUMERIC,
    nullif(adjusted->>'beforeKg', '')::NUMERIC,
    nullif(adjusted->>'afterKg', '')::NUMERIC,
    coalesce(p_operator_name, ''), '删除批次 ' || b.batch_no, b.id
  );

  DELETE FROM public.product_batches WHERE id = b.id;
  RETURN json_build_object('success', true, 'productId', b.product_id, 'specId', b.spec_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.zidu_delete_inventory_batch(INTEGER, TEXT) TO anon, authenticated;

-- 4) 原料首次启用重量库存、批次入库、库存增加与流水一次完成。
CREATE OR REPLACE FUNCTION public.zidu_create_inventory_batch(
  p_batch_no TEXT,
  p_product_id INTEGER,
  p_spec_id INTEGER,
  p_quantity NUMERIC,
  p_gcms_no TEXT DEFAULT NULL,
  p_received_date DATE DEFAULT CURRENT_DATE,
  p_expiry_date DATE DEFAULT NULL,
  p_unit_cost NUMERIC DEFAULT 0,
  p_supplier TEXT DEFAULT '',
  p_note TEXT DEFAULT '',
  p_operator_name TEXT DEFAULT '',
  p_density_g_ml NUMERIC DEFAULT NULL,
  p_density_temperature_c NUMERIC DEFAULT 20
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.products%ROWTYPE;
  s public.product_specs%ROWTYPE;
  b public.product_batches%ROWTYPE;
  adjusted JSON;
  has_volume_spec BOOLEAN;
  quantity_unit TEXT;
BEGIN
  IF trim(coalesce(p_batch_no, '')) = '' OR p_quantity <= 0 THEN
    RETURN json_build_object('error', '请填写批次号和正确的入库数量');
  END IF;
  SELECT * INTO p FROM public.products WHERE id = p_product_id FOR UPDATE;
  SELECT * INTO s FROM public.product_specs WHERE id = p_spec_id AND product_id = p_product_id FOR UPDATE;
  IF p.id IS NULL OR s.id IS NULL THEN RETURN json_build_object('error', '产品或规格不存在'); END IF;

  IF p.channel = 'RAW' AND p.inventory_mode <> 'MASS' THEN
    SELECT exists(
      SELECT 1 FROM public.product_specs x
      WHERE x.product_id = p.id AND x.spec ~* '^[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*(ml|毫升|l|升)'
    ) INTO has_volume_spec;
    IF has_volume_spec AND coalesce(p_density_g_ml, 0) <= 0 THEN
      RETURN json_build_object('error', '该原料有 ml/L 规格，请先填写密度');
    END IF;
    UPDATE public.products SET
      inventory_mode = 'MASS',
      base_stock_kg = 0,
      density_g_ml = CASE WHEN p_density_g_ml > 0 THEN p_density_g_ml ELSE NULL END,
      density_temperature_c = coalesce(p_density_temperature_c, 20),
      density_status = CASE WHEN p_density_g_ml > 0 THEN 'REFERENCE' ELSE 'UNSET' END,
      density_source = CASE WHEN p_density_g_ml > 0 THEN '首次按kg入库时录入，待供应商/批次确认' ELSE '' END
    WHERE id = p.id;
    p.inventory_mode := 'MASS';
  END IF;

  quantity_unit := CASE WHEN p.inventory_mode = 'MASS' OR p.channel = 'RAW' THEN 'KG' ELSE 'SPEC' END;
  INSERT INTO public.product_batches (
    batch_no, product_id, spec_id, gcms_no, received_date, expiry_date,
    initial_qty, remaining_qty, unit_cost, supplier, note
  ) VALUES (
    trim(p_batch_no), p_product_id, p_spec_id, nullif(trim(coalesce(p_gcms_no, '')), ''),
    coalesce(p_received_date, CURRENT_DATE), p_expiry_date,
    p_quantity, p_quantity, coalesce(p_unit_cost, 0), coalesce(p_supplier, ''), coalesce(p_note, '')
  ) RETURNING * INTO b;

  adjusted := public.zidu_adjust_inventory(p_spec_id, 'IN', p_quantity, quantity_unit);
  INSERT INTO public.stock_adjustments (
    spec_id, product_id, type, reason, quantity,
    before_stock, after_stock, quantity_kg, before_stock_kg, after_stock_kg,
    note, operator_name, batch_id
  ) VALUES (
    p_spec_id, p_product_id, 'IN', 'PURCHASE', p_quantity,
    (adjusted->>'before')::NUMERIC, (adjusted->>'after')::NUMERIC,
    nullif(adjusted->>'quantityKg', '')::NUMERIC,
    nullif(adjusted->>'beforeKg', '')::NUMERIC,
    nullif(adjusted->>'afterKg', '')::NUMERIC,
    '批次 ' || b.batch_no || CASE WHEN b.gcms_no IS NOT NULL THEN ' · GC-MS ' || b.gcms_no ELSE '' END,
    coalesce(p_operator_name, ''), b.id
  );

  RETURN to_json(b);
END;
$$;

GRANT EXECUTE ON FUNCTION public.zidu_create_inventory_batch(TEXT, INTEGER, INTEGER, NUMERIC, TEXT, DATE, DATE, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) TO anon, authenticated;

SELECT
  count(*) FILTER (WHERE a.note LIKE '%[删除失败已回滚]%') AS repaired_failed_deletions,
  count(*) FILTER (WHERE a.note = '删除批次 ' || coalesce(b.batch_no, '')) AS pending_delete_logs
FROM public.stock_adjustments a
LEFT JOIN public.product_batches b ON b.id = a.batch_id;
