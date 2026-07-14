-- ZIDU v37: 采购工作台、软删除回收站、关闭剩余采购与收货撤销。
-- 依赖：migration_v25_purchase_receiving_batches.sql、migration_v36_manual_batch_outbound.sql。
-- 本迁移不会改动现有采购数量、批次余量或库存。

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS expected_date DATE,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS close_note TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS deleted_previous_status TEXT;

ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE public.purchase_orders
  ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('DRAFT', 'ORDERED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CANCELLED', 'CLOSED'));

CREATE INDEX IF NOT EXISTS idx_purchase_orders_deleted_at
  ON public.purchase_orders(deleted_at);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_expected_date
  ON public.purchase_orders(expected_date) WHERE deleted_at IS NULL;

ALTER TABLE public.product_batches
  ADD COLUMN IF NOT EXISTS receipt_reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS receipt_reversed_by TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS receipt_reverse_note TEXT DEFAULT '';

ALTER TABLE public.batch_stock_movements
  DROP CONSTRAINT IF EXISTS batch_stock_movements_movement_type_check;
ALTER TABLE public.batch_stock_movements
  ADD CONSTRAINT batch_stock_movements_movement_type_check
  CHECK (movement_type IN ('FIFO_OUT', 'MANUAL_OUT', 'UNBATCHED_OUT', 'BATCH_DELETE', 'RECEIPT_REVERSAL'));

-- 新版创建接口增加预计到货日期；旧接口保留给尚未更新的客户端。
CREATE OR REPLACE FUNCTION public.zidu_create_purchase_order_v2(
  p_po_no TEXT,
  p_supplier TEXT,
  p_notes TEXT,
  p_created_by_name TEXT,
  p_items JSONB,
  p_expected_date DATE DEFAULT NULL
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
    IF coalesce((item->>'productId')::INTEGER, 0) <= 0
       OR coalesce((item->>'specId')::INTEGER, 0) <= 0 OR qty <= 0 OR cost < 0 THEN
      RETURN json_build_object('error', '采购明细中的产品、规格、数量或单价不完整');
    END IF;
    total_amount := total_amount + qty * cost;
  END LOOP;

  INSERT INTO public.purchase_orders(
    po_no, supplier, status, total, notes, created_by_name, expected_date
  ) VALUES (
    trim(p_po_no), trim(p_supplier), 'DRAFT', round(total_amount, 2),
    coalesce(p_notes, ''), coalesce(p_created_by_name, ''), p_expected_date
  ) RETURNING * INTO po;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    qty := (item->>'quantity')::NUMERIC;
    cost := (item->>'unitCost')::NUMERIC;
    INSERT INTO public.purchase_order_items(
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

CREATE OR REPLACE FUNCTION public.zidu_update_purchase_order_v2(
  p_po_id INTEGER,
  p_supplier TEXT,
  p_notes TEXT,
  p_items JSONB,
  p_expected_date DATE DEFAULT NULL
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
  IF po.id IS NULL OR po.deleted_at IS NOT NULL THEN RETURN json_build_object('error', '采购单不存在'); END IF;
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
    IF coalesce((item->>'productId')::INTEGER, 0) <= 0
       OR coalesce((item->>'specId')::INTEGER, 0) <= 0 OR qty <= 0 OR cost < 0 THEN
      RETURN json_build_object('error', '采购明细不完整');
    END IF;
    total_amount := total_amount + qty * cost;
  END LOOP;

  UPDATE public.purchase_orders
  SET supplier = trim(p_supplier), notes = coalesce(p_notes, ''),
      total = round(total_amount, 2), expected_date = p_expected_date
  WHERE id = po.id;
  DELETE FROM public.purchase_order_items WHERE po_id = po.id;

  FOR item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    qty := (item->>'quantity')::NUMERIC;
    cost := (item->>'unitCost')::NUMERIC;
    INSERT INTO public.purchase_order_items(
      po_id, product_id, spec_id, product_name, spec,
      quantity, received_qty, unit_cost, subtotal
    ) VALUES (
      po.id, (item->>'productId')::INTEGER, (item->>'specId')::INTEGER,
      item->>'productName', item->>'spec', qty, 0, cost, round(qty * cost, 2)
    );
  END LOOP;
  RETURN json_build_object('success', true);
END;
$$;

-- 采购单只做软删除，且任何已收货数量都会阻止删除。
CREATE OR REPLACE FUNCTION public.zidu_delete_purchase_order(
  p_po_id INTEGER,
  p_operator_name TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE po public.purchase_orders%ROWTYPE;
BEGIN
  SELECT * INTO po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF po.id IS NULL THEN RETURN json_build_object('error', '采购单不存在'); END IF;
  IF po.deleted_at IS NOT NULL THEN RETURN json_build_object('success', true, 'alreadyDeleted', true); END IF;
  IF EXISTS (SELECT 1 FROM public.purchase_order_items WHERE po_id = po.id AND received_qty > 0) THEN
    RETURN json_build_object('error', '该采购单已经收货，不能删除；请先撤销未使用的收货批次');
  END IF;
  UPDATE public.purchase_orders
  SET deleted_at = now(), deleted_by = coalesce(p_operator_name, ''),
      deleted_previous_status = status, status = 'CANCELLED'
  WHERE id = po.id;
  RETURN json_build_object('success', true, 'deletedAt', now());
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_delete_purchase_order(p_po_id INTEGER)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.zidu_delete_purchase_order(p_po_id, '');
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_restore_deleted_purchase_order(
  p_po_id INTEGER,
  p_operator_name TEXT DEFAULT ''
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE po public.purchase_orders%ROWTYPE;
BEGIN
  SELECT * INTO po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF po.id IS NULL OR po.deleted_at IS NULL THEN RETURN json_build_object('error', '回收站中没有该采购单'); END IF;
  IF po.deleted_at < now() - interval '30 days' THEN RETURN json_build_object('error', '该采购单已超过 30 天恢复期限'); END IF;
  UPDATE public.purchase_orders
  SET status = CASE WHEN deleted_previous_status IN ('DRAFT', 'ORDERED', 'CANCELLED') THEN deleted_previous_status ELSE 'DRAFT' END,
      deleted_at = NULL, deleted_by = '', deleted_previous_status = NULL
  WHERE id = po.id;
  RETURN json_build_object('success', true, 'restoredBy', coalesce(p_operator_name, ''));
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_permanently_delete_purchase_order(p_po_id INTEGER)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE po public.purchase_orders%ROWTYPE;
BEGIN
  SELECT * INTO po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF po.id IS NULL OR po.deleted_at IS NULL THEN RETURN json_build_object('error', '只能彻底删除回收站中的采购单'); END IF;
  IF EXISTS (SELECT 1 FROM public.purchase_order_items WHERE po_id = po.id AND received_qty > 0) THEN
    RETURN json_build_object('error', '该采购单存在收货记录，不能彻底删除');
  END IF;
  DELETE FROM public.purchase_orders WHERE id = po.id;
  RETURN json_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_purge_expired_deleted_purchase_orders()
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE deleted_count INTEGER;
BEGIN
  DELETE FROM public.purchase_orders po
  WHERE po.deleted_at < now() - interval '30 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.purchase_order_items i
      WHERE i.po_id = po.id AND i.received_qty > 0
    );
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_update_purchase_order_status(
  p_po_id INTEGER,
  p_new_status TEXT,
  p_operator_name TEXT DEFAULT ''
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  po public.purchase_orders%ROWTYPE;
  has_receipts BOOLEAN;
BEGIN
  SELECT * INTO po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF po.id IS NULL OR po.deleted_at IS NOT NULL THEN RETURN json_build_object('error', '采购单不存在'); END IF;
  SELECT EXISTS(
    SELECT 1 FROM public.purchase_order_items WHERE po_id = po.id AND received_qty > 0
  ) INTO has_receipts;

  IF p_new_status = 'ORDERED' AND po.status = 'DRAFT' THEN
    UPDATE public.purchase_orders SET status = 'ORDERED' WHERE id = po.id;
  ELSIF p_new_status = 'CANCELLED' AND po.status IN ('DRAFT', 'ORDERED') AND NOT has_receipts THEN
    UPDATE public.purchase_orders
    SET status = 'CANCELLED', closed_at = now(), closed_by = coalesce(p_operator_name, ''), close_note = '取消采购'
    WHERE id = po.id;
  ELSE
    RETURN json_build_object('error', '当前状态不能执行该操作');
  END IF;
  RETURN json_build_object('success', true, 'status', p_new_status);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_close_purchase_order(
  p_po_id INTEGER,
  p_operator_name TEXT DEFAULT '',
  p_note TEXT DEFAULT ''
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  po public.purchase_orders%ROWTYPE;
  has_received BOOLEAN;
  has_remaining BOOLEAN;
BEGIN
  SELECT * INTO po FROM public.purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF po.id IS NULL OR po.deleted_at IS NOT NULL THEN RETURN json_build_object('error', '采购单不存在'); END IF;
  SELECT bool_or(received_qty > 0), bool_or(received_qty < quantity)
  INTO has_received, has_remaining
  FROM public.purchase_order_items WHERE po_id = po.id;
  IF po.status <> 'PARTIAL_RECEIVED' OR NOT coalesce(has_received, false) OR NOT coalesce(has_remaining, false) THEN
    RETURN json_build_object('error', '只有部分收货且仍有待收数量的采购单可以关闭剩余采购');
  END IF;
  UPDATE public.purchase_orders
  SET status = 'CLOSED', closed_at = now(), closed_by = coalesce(p_operator_name, ''),
      close_note = coalesce(nullif(trim(p_note), ''), '供应商不再交付剩余数量')
  WHERE id = po.id;
  RETURN json_build_object('success', true, 'status', 'CLOSED');
END;
$$;

-- 仅允许撤销仍完整留在库存中的采购批次，防止倒扣已销售或已消耗库存。
CREATE OR REPLACE FUNCTION public.zidu_reverse_purchase_receipt(
  p_batch_id INTEGER,
  p_operator_name TEXT DEFAULT '',
  p_note TEXT DEFAULT ''
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lookup_batch public.product_batches%ROWTYPE;
  b public.product_batches%ROWTYPE;
  po public.purchase_orders%ROWTYPE;
  line public.purchase_order_items%ROWTYPE;
  p public.products%ROWTYPE;
  s public.product_specs%ROWTYPE;
  before_units NUMERIC;
  after_units NUMERIC;
  before_kg NUMERIC;
  after_kg NUMERIC;
  other_batch_qty NUMERIC;
  all_received BOOLEAN;
  some_received BOOLEAN;
  next_status TEXT;
  unit_name TEXT;
BEGIN
  SELECT * INTO lookup_batch FROM public.product_batches WHERE id = p_batch_id;
  IF lookup_batch.id IS NULL OR lookup_batch.purchase_order_id IS NULL OR lookup_batch.purchase_order_item_id IS NULL THEN
    RETURN json_build_object('error', '该批次不是采购收货批次');
  END IF;

  SELECT * INTO po FROM public.purchase_orders WHERE id = lookup_batch.purchase_order_id FOR UPDATE;
  SELECT * INTO line FROM public.purchase_order_items WHERE id = lookup_batch.purchase_order_item_id FOR UPDATE;
  SELECT * INTO p FROM public.products WHERE id = lookup_batch.product_id FOR UPDATE;
  SELECT * INTO s FROM public.product_specs WHERE id = lookup_batch.spec_id FOR UPDATE;
  SELECT * INTO b FROM public.product_batches WHERE id = p_batch_id FOR UPDATE;

  IF po.id IS NULL OR line.id IS NULL OR p.id IS NULL OR s.id IS NULL OR b.id IS NULL THEN
    RETURN json_build_object('error', '采购、产品或批次关联不完整');
  END IF;
  IF b.receipt_reversed_at IS NOT NULL THEN RETURN json_build_object('error', '该次收货已经撤销'); END IF;
  IF abs(coalesce(b.remaining_qty, 0) - coalesce(b.initial_qty, 0)) > 0.000001 THEN
    RETURN json_build_object('error', '该批次已有出库或消耗，不能撤销整次收货');
  END IF;
  IF line.received_qty < b.initial_qty THEN RETURN json_build_object('error', '采购已收数量小于该批次数量，请先核对数据'); END IF;

  before_units := coalesce(s.stock, 0);
  IF p.inventory_mode = 'MASS' OR p.channel = 'RAW' THEN
    unit_name := 'KG';
    before_kg := coalesce(p.base_stock_kg, 0);
    IF before_kg < b.initial_qty THEN RAISE EXCEPTION '系统重量库存不足，无法撤销该次收货'; END IF;
    after_kg := round(before_kg - b.initial_qty, 6);
    SELECT coalesce(sum(remaining_qty), 0) INTO other_batch_qty
    FROM public.product_batches
    WHERE product_id = p.id AND id <> b.id AND remaining_qty > 0;
    IF after_kg + 0.000001 < other_batch_qty THEN
      RETURN json_build_object('error', '当前总库存低于其他有效批次余量，请先完成库存盘点，不能直接撤销收货');
    END IF;
    UPDATE public.products SET base_stock_kg = after_kg WHERE id = p.id;
    PERFORM public.zidu_sync_mass_spec_stock(p.id);
    SELECT stock INTO after_units FROM public.product_specs WHERE id = s.id;
  ELSE
    unit_name := 'SPEC';
    before_kg := NULL;
    after_kg := NULL;
    IF before_units < b.initial_qty THEN RAISE EXCEPTION '系统规格库存不足，无法撤销该次收货'; END IF;
    after_units := round(before_units - b.initial_qty, 6);
    SELECT coalesce(sum(remaining_qty), 0) INTO other_batch_qty
    FROM public.product_batches
    WHERE spec_id = s.id AND id <> b.id AND remaining_qty > 0;
    IF after_units + 0.000001 < other_batch_qty THEN
      RETURN json_build_object('error', '当前总库存低于其他有效批次余量，请先完成库存盘点，不能直接撤销收货');
    END IF;
    PERFORM set_config('zidu.syncing_mass_stock', 'on', true);
    UPDATE public.product_specs SET stock = after_units WHERE id = s.id;
    PERFORM set_config('zidu.syncing_mass_stock', 'off', true);
  END IF;

  UPDATE public.product_batches
  SET remaining_qty = 0, receipt_reversed_at = now(),
      receipt_reversed_by = coalesce(p_operator_name, ''),
      receipt_reverse_note = coalesce(p_note, '')
  WHERE id = b.id;
  UPDATE public.purchase_order_items
  SET received_qty = greatest(0, received_qty - b.initial_qty)
  WHERE id = line.id;

  SELECT bool_and(received_qty >= quantity), bool_or(received_qty > 0)
  INTO all_received, some_received
  FROM public.purchase_order_items WHERE po_id = po.id;
  next_status := CASE WHEN all_received THEN 'RECEIVED' WHEN some_received THEN 'PARTIAL_RECEIVED' ELSE 'ORDERED' END;
  UPDATE public.purchase_orders
  SET status = next_status, closed_at = NULL, closed_by = '', close_note = ''
  WHERE id = po.id;

  INSERT INTO public.batch_stock_movements(
    batch_id, batch_no, product_id, spec_id, movement_type,
    quantity, before_qty, after_qty, unit
  ) VALUES (
    b.id, b.batch_no, b.product_id, b.spec_id, 'RECEIPT_REVERSAL',
    b.initial_qty, b.remaining_qty, 0, unit_name
  );

  INSERT INTO public.stock_adjustments(
    spec_id, product_id, type, reason, quantity,
    before_stock, after_stock, quantity_kg, before_stock_kg, after_stock_kg,
    operator_name, note, batch_id
  ) VALUES (
    s.id, p.id, 'OUT', 'CORRECTION', b.initial_qty,
    before_units, after_units,
    CASE WHEN unit_name = 'KG' THEN b.initial_qty ELSE NULL END,
    before_kg, after_kg,
    coalesce(p_operator_name, ''),
    '撤销采购收货 ' || po.po_no || ' · 批次 ' || b.batch_no
      || CASE WHEN nullif(trim(coalesce(p_note, '')), '') IS NOT NULL THEN ' · ' || trim(p_note) ELSE '' END,
    b.id
  );

  RETURN json_build_object(
    'success', true, 'purchaseOrderId', po.id, 'batchId', b.id,
    'quantity', b.initial_qty, 'status', next_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.zidu_create_purchase_order_v2(TEXT, TEXT, TEXT, TEXT, JSONB, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zidu_update_purchase_order_v2(INTEGER, TEXT, TEXT, JSONB, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zidu_delete_purchase_order(INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zidu_restore_deleted_purchase_order(INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zidu_permanently_delete_purchase_order(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zidu_purge_expired_deleted_purchase_orders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zidu_update_purchase_order_status(INTEGER, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zidu_close_purchase_order(INTEGER, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zidu_reverse_purchase_receipt(INTEGER, TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.zidu_create_purchase_order_v2(TEXT, TEXT, TEXT, TEXT, JSONB, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_update_purchase_order_v2(INTEGER, TEXT, TEXT, JSONB, DATE) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_delete_purchase_order(INTEGER, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_restore_deleted_purchase_order(INTEGER, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_permanently_delete_purchase_order(INTEGER) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_purge_expired_deleted_purchase_orders() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_update_purchase_order_status(INTEGER, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_close_purchase_order(INTEGER, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_reverse_purchase_receipt(INTEGER, TEXT, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT
  to_regprocedure('public.zidu_create_purchase_order_v2(text,text,text,text,jsonb,date)') IS NOT NULL AS create_v2_ready,
  to_regprocedure('public.zidu_delete_purchase_order(integer,text)') IS NOT NULL AS soft_delete_ready,
  to_regprocedure('public.zidu_restore_deleted_purchase_order(integer,text)') IS NOT NULL AS restore_ready,
  to_regprocedure('public.zidu_close_purchase_order(integer,text,text)') IS NOT NULL AS close_ready,
  to_regprocedure('public.zidu_reverse_purchase_receipt(integer,text,text)') IS NOT NULL AS reverse_receipt_ready;
