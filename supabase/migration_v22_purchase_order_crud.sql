-- ============================================================
-- ZIDU v22: 采购单完整新增 / 编辑 / 删除 / 按kg收货
-- 依赖：migration_v19、migration_v21
-- ============================================================

ALTER TABLE public.purchase_order_items
  ALTER COLUMN quantity TYPE NUMERIC(14,6) USING quantity::NUMERIC,
  ALTER COLUMN received_qty TYPE NUMERIC(14,6) USING received_qty::NUMERIC;

CREATE OR REPLACE FUNCTION public.zidu_create_purchase_order(
  p_po_no TEXT,
  p_supplier TEXT,
  p_notes TEXT,
  p_created_by_name TEXT,
  p_items JSONB
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  po public.purchase_orders%ROWTYPE;
  item JSONB;
  total_amount NUMERIC := 0;
  qty NUMERIC;
  cost NUMERIC;
BEGIN
  IF trim(coalesce(p_supplier, '')) = '' THEN RETURN json_build_object('error', '请填写供应商'); END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RETURN json_build_object('error', '请添加采购明细'); END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    qty := coalesce((item->>'quantity')::NUMERIC, 0);
    cost := coalesce((item->>'unitCost')::NUMERIC, 0);
    IF coalesce((item->>'productId')::INTEGER, 0) <= 0 OR coalesce((item->>'specId')::INTEGER, 0) <= 0 OR qty <= 0 OR cost < 0 THEN
      RETURN json_build_object('error', '采购明细中的产品、规格、数量或单价不完整');
    END IF;
    total_amount := total_amount + qty * cost;
  END LOOP;

  INSERT INTO public.purchase_orders (po_no, supplier, status, total, notes, created_by_name)
  VALUES (trim(p_po_no), trim(p_supplier), 'DRAFT', round(total_amount, 2), coalesce(p_notes, ''), coalesce(p_created_by_name, ''))
  RETURNING * INTO po;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    qty := (item->>'quantity')::NUMERIC;
    cost := (item->>'unitCost')::NUMERIC;
    INSERT INTO public.purchase_order_items (
      po_id, product_id, spec_id, product_name, spec,
      quantity, received_qty, unit_cost, subtotal
    ) VALUES (
      po.id, (item->>'productId')::INTEGER, (item->>'specId')::INTEGER,
      item->>'productName', item->>'spec', qty, 0, cost, round(qty * cost, 2)
    );
  END LOOP;
  RETURN json_build_object('success', true, 'id', po.id);
EXCEPTION WHEN unique_violation THEN
  RETURN json_build_object('error', '采购单号重复，请重试');
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_update_purchase_order(
  p_po_id INTEGER,
  p_supplier TEXT,
  p_notes TEXT,
  p_items JSONB
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  po public.purchase_orders%ROWTYPE;
  item JSONB;
  total_amount NUMERIC := 0;
  qty NUMERIC;
  cost NUMERIC;
BEGIN
  SELECT * INTO po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF po.id IS NULL THEN RETURN json_build_object('error', '采购单不存在'); END IF;
  IF po.status NOT IN ('DRAFT', 'ORDERED') OR EXISTS (
    SELECT 1 FROM public.purchase_order_items WHERE po_id = po.id AND received_qty > 0
  ) THEN RETURN json_build_object('error', '已发生收货的采购单不能修改'); END IF;
  IF trim(coalesce(p_supplier, '')) = '' OR p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN json_build_object('error', '请填写供应商和采购明细');
  END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    qty := coalesce((item->>'quantity')::NUMERIC, 0);
    cost := coalesce((item->>'unitCost')::NUMERIC, 0);
    IF coalesce((item->>'productId')::INTEGER, 0) <= 0 OR coalesce((item->>'specId')::INTEGER, 0) <= 0 OR qty <= 0 OR cost < 0 THEN
      RETURN json_build_object('error', '采购明细不完整');
    END IF;
    total_amount := total_amount + qty * cost;
  END LOOP;
  UPDATE public.purchase_orders SET supplier = trim(p_supplier), notes = coalesce(p_notes, ''), total = round(total_amount, 2) WHERE id = po.id;
  DELETE FROM public.purchase_order_items WHERE po_id = po.id;
  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    qty := (item->>'quantity')::NUMERIC;
    cost := (item->>'unitCost')::NUMERIC;
    INSERT INTO public.purchase_order_items (po_id, product_id, spec_id, product_name, spec, quantity, received_qty, unit_cost, subtotal)
    VALUES (po.id, (item->>'productId')::INTEGER, (item->>'specId')::INTEGER, item->>'productName', item->>'spec', qty, 0, cost, round(qty * cost, 2));
  END LOOP;
  RETURN json_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_delete_purchase_order(p_po_id INTEGER)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE po public.purchase_orders%ROWTYPE;
BEGIN
  SELECT * INTO po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF po.id IS NULL THEN RETURN json_build_object('error', '采购单不存在或已删除'); END IF;
  IF EXISTS (SELECT 1 FROM public.purchase_order_items WHERE po_id = po.id AND received_qty > 0) THEN
    RETURN json_build_object('error', '该采购单已经收货，不能删除；请保留记录并通过库存调整纠正');
  END IF;
  DELETE FROM public.purchase_orders WHERE id = po.id;
  RETURN json_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_receive_purchase_order(
  p_po_id INTEGER,
  p_items JSONB,
  p_operator_name TEXT DEFAULT ''
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  po public.purchase_orders%ROWTYPE;
  req JSONB;
  line public.purchase_order_items%ROWTYPE;
  prod public.products%ROWTYPE;
  adjusted JSON;
  receive_qty NUMERIC;
  has_volume_spec BOOLEAN;
  all_received BOOLEAN;
  some_received BOOLEAN;
BEGIN
  SELECT * INTO po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF po.id IS NULL THEN RETURN json_build_object('error', '采购单不存在'); END IF;
  IF po.status = 'CANCELLED' THEN RETURN json_build_object('error', '已取消采购单不能收货'); END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN RETURN json_build_object('error', '请输入收货数量'); END IF;

  FOR req IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    receive_qty := coalesce((req->>'receiveQty')::NUMERIC, 0);
    SELECT * INTO line FROM public.purchase_order_items
     WHERE id = (req->>'itemId')::INTEGER AND po_id = po.id FOR UPDATE;
    IF line.id IS NULL OR receive_qty <= 0 OR line.received_qty + receive_qty > line.quantity THEN
      RETURN json_build_object('error', '收货数量超过采购单剩余数量');
    END IF;
    SELECT * INTO prod FROM public.products WHERE id = line.product_id FOR UPDATE;

    IF prod.channel = 'RAW' AND prod.inventory_mode <> 'MASS' THEN
      SELECT exists(
        SELECT 1 FROM public.product_specs x WHERE x.product_id = prod.id
          AND x.spec ~* '^[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*(ml|毫升|l|升)'
      ) INTO has_volume_spec;
      IF has_volume_spec AND coalesce((req->>'densityGml')::NUMERIC, 0) <= 0 THEN
        RETURN json_build_object('error', prod.name || ' 有 ml/L 规格，请填写密度后再收货');
      END IF;
      UPDATE public.products SET
        inventory_mode = 'MASS', base_stock_kg = 0,
        density_g_ml = nullif((req->>'densityGml')::NUMERIC, 0),
        density_temperature_c = coalesce((req->>'densityTemperatureC')::NUMERIC, 20),
        density_status = CASE WHEN coalesce((req->>'densityGml')::NUMERIC, 0) > 0 THEN 'REFERENCE' ELSE 'UNSET' END,
        density_source = CASE WHEN coalesce((req->>'densityGml')::NUMERIC, 0) > 0 THEN '采购收货时录入，待供应商/批次确认' ELSE '' END
      WHERE id = prod.id;
      prod.inventory_mode := 'MASS';
    END IF;

    adjusted := public.zidu_adjust_inventory(
      line.spec_id, 'IN', receive_qty,
      CASE WHEN prod.inventory_mode = 'MASS' OR prod.channel = 'RAW' THEN 'KG' ELSE 'SPEC' END
    );
    UPDATE public.purchase_order_items SET received_qty = received_qty + receive_qty WHERE id = line.id;
    INSERT INTO public.stock_adjustments (
      spec_id, product_id, type, reason, quantity, before_stock, after_stock,
      quantity_kg, before_stock_kg, after_stock_kg, note, operator_name
    ) VALUES (
      line.spec_id, line.product_id, 'IN', 'PURCHASE', receive_qty,
      (adjusted->>'before')::NUMERIC, (adjusted->>'after')::NUMERIC,
      nullif(adjusted->>'quantityKg', '')::NUMERIC,
      nullif(adjusted->>'beforeKg', '')::NUMERIC,
      nullif(adjusted->>'afterKg', '')::NUMERIC,
      '采购单 ' || po.po_no, coalesce(p_operator_name, '')
    );
  END LOOP;

  SELECT bool_and(received_qty >= quantity), bool_or(received_qty > 0)
    INTO all_received, some_received FROM public.purchase_order_items WHERE po_id = po.id;
  UPDATE public.purchase_orders SET status = CASE WHEN all_received THEN 'RECEIVED' WHEN some_received THEN 'PARTIAL_RECEIVED' ELSE 'ORDERED' END WHERE id = po.id;
  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.zidu_create_purchase_order(TEXT, TEXT, TEXT, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_update_purchase_order(INTEGER, TEXT, TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_delete_purchase_order(INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_receive_purchase_order(INTEGER, JSONB, TEXT) TO anon, authenticated;

SELECT po.id, po.po_no, po.status, count(i.id) AS item_count
FROM public.purchase_orders po LEFT JOIN public.purchase_order_items i ON i.po_id = po.id
GROUP BY po.id ORDER BY po.id DESC;
