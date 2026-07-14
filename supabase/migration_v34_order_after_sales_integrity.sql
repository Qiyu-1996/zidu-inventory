-- ZIDU v34: 订单、取消、删除与售后财务一致性保护。
-- 依赖：migration_v19_mass_inventory.sql、migration_v27_payment_methods.sql、
--       migration_v31_unpaid_shipping_approval.sql、migration_v32_no_backorder_atomic_orders.sql。
-- 可重复运行；不会删除或改写已有订单。

-- 同一订单同一时间只允许一张待处理售后单。使用事务锁，
-- 避免两个终端同时提交时产生重复退款或重复入库。
CREATE OR REPLACE FUNCTION public.zidu_guard_single_open_after_sale()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('WAREHOUSE_PENDING', 'FINANCE_PENDING') THEN
    PERFORM pg_advisory_xact_lock(34034, NEW.order_id);
    IF EXISTS (
      SELECT 1
      FROM public.after_sales a
      WHERE a.order_id = NEW.order_id
        AND a.status IN ('WAREHOUSE_PENDING', 'FINANCE_PENDING')
        AND a.id IS DISTINCT FROM NEW.id
    ) THEN
      RAISE EXCEPTION '该订单已有待处理售后，请先完成当前售后';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zidu_single_open_after_sale ON public.after_sales;
CREATE TRIGGER trg_zidu_single_open_after_sale
BEFORE INSERT OR UPDATE OF order_id, status ON public.after_sales
FOR EACH ROW EXECUTE FUNCTION public.zidu_guard_single_open_after_sale();

-- 取消订单与恢复库存在一个事务中完成。
CREATE OR REPLACE FUNCTION public.zidu_cancel_order(
  p_order_id INTEGER,
  p_operator_name TEXT DEFAULT '',
  p_time TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item RECORD;
  v_adjustment JSON;
  v_time TEXT := coalesce(nullif(trim(p_time), ''), to_char(now(), 'YYYY-MM-DD HH24:MI'));
BEGIN
  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF v_order.id IS NULL THEN RAISE EXCEPTION '订单不存在'; END IF;
  IF v_order.status = 'CANCELLED' THEN RETURN jsonb_build_object('success', true, 'alreadyCancelled', true); END IF;
  IF v_order.status NOT IN ('DRAFT', 'SUBMITTED', 'CONFIRMED', 'PREPARING') THEN
    RAISE EXCEPTION '当前订单状态不能取消，已发货订单请走售后流程';
  END IF;
  IF abs(coalesce(v_order.paid_amount, 0)) > 0.01
     OR EXISTS (SELECT 1 FROM public.payment_records WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION '订单已有收付款流水，请先通过售后完成退款，不能直接取消';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.after_sales
    WHERE order_id = p_order_id AND status IN ('WAREHOUSE_PENDING', 'FINANCE_PENDING')
  ) THEN
    RAISE EXCEPTION '订单有待处理售后，请先完成售后';
  END IF;

  PERFORM 1
  FROM public.product_specs
  WHERE id IN (SELECT spec_id FROM public.order_items WHERE order_id = p_order_id AND spec_id IS NOT NULL)
  ORDER BY id
  FOR UPDATE;

  PERFORM 1
  FROM public.products
  WHERE id IN (SELECT product_id FROM public.order_items WHERE order_id = p_order_id AND product_id IS NOT NULL)
  ORDER BY id
  FOR UPDATE;

  FOR v_item IN
    SELECT * FROM public.order_items
    WHERE order_id = p_order_id AND spec_id IS NOT NULL
    ORDER BY spec_id, id
  LOOP
    v_adjustment := public.zidu_adjust_inventory(v_item.spec_id, 'IN', v_item.quantity, 'SPEC');
    INSERT INTO public.stock_adjustments (
      spec_id, product_id, type, reason, quantity,
      before_stock, after_stock, quantity_kg, before_stock_kg, after_stock_kg,
      note, operator_name
    ) VALUES (
      v_item.spec_id, v_item.product_id, 'IN', 'CANCEL_RESTORE', v_item.quantity,
      (v_adjustment->>'before')::NUMERIC, (v_adjustment->>'after')::NUMERIC,
      nullif(v_adjustment->>'quantityKg', '')::NUMERIC,
      nullif(v_adjustment->>'beforeKg', '')::NUMERIC,
      nullif(v_adjustment->>'afterKg', '')::NUMERIC,
      '取消订单 ' || v_order.order_no, coalesce(p_operator_name, '')
    );
  END LOOP;

  UPDATE public.orders
  SET status = 'CANCELLED',
      unpaid_shipping_status = 'NONE',
      unpaid_shipping_reason = '',
      unpaid_shipping_requested_by = NULL,
      unpaid_shipping_requested_at = NULL,
      unpaid_shipping_reviewed_by = NULL,
      unpaid_shipping_reviewed_at = NULL,
      unpaid_shipping_review_note = ''
  WHERE id = p_order_id;

  INSERT INTO public.order_logs(order_id, time, user_name, action)
  VALUES (p_order_id, v_time, coalesce(p_operator_name, ''), '取消订单（库存已自动恢复）');

  RETURN jsonb_build_object('success', true, 'status', 'CANCELLED');
END;
$$;

-- 防止旧版网页/小程序绕过上面的原子取消函数。
CREATE OR REPLACE FUNCTION public.zidu_guard_direct_order_cancellation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'CANCELLED'
     AND OLD.status IS DISTINCT FROM 'CANCELLED'
     AND current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION '请通过订单取消功能操作';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zidu_guard_direct_order_cancellation ON public.orders;
CREATE TRIGGER trg_zidu_guard_direct_order_cancellation
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.zidu_guard_direct_order_cancellation();

-- 普通状态更新、日志与物流记录一次提交。取消订单必须走专用函数。
CREATE OR REPLACE FUNCTION public.zidu_update_order_status_atomic(
  p_order_id INTEGER,
  p_new_status TEXT,
  p_log JSONB DEFAULT '{}'::JSONB,
  p_shipment JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  IF p_new_status = 'CANCELLED' THEN RAISE EXCEPTION '取消订单请使用专用取消功能'; END IF;
  IF p_new_status NOT IN ('DRAFT', 'SUBMITTED', 'CONFIRMED', 'PREPARING', 'SHIPPED', 'DELIVERED', 'COMPLETED') THEN
    RAISE EXCEPTION '订单状态无效';
  END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION '订单不存在'; END IF;
  IF v_order.status = 'CANCELLED' THEN RAISE EXCEPTION '已取消订单不能更改状态'; END IF;

  UPDATE public.orders SET status = p_new_status WHERE id = p_order_id;

  IF coalesce(trim(p_log->>'action'), '') <> '' THEN
    INSERT INTO public.order_logs(order_id, time, user_name, action)
    VALUES (
      p_order_id,
      coalesce(nullif(p_log->>'time', ''), to_char(now(), 'YYYY-MM-DD HH24:MI')),
      coalesce(p_log->>'user', ''), p_log->>'action'
    );
  END IF;

  IF p_shipment IS NOT NULL AND jsonb_typeof(p_shipment) = 'object' THEN
    IF coalesce(trim(p_shipment->>'carrier'), '') = ''
       OR coalesce(trim(p_shipment->>'trackingNo'), '') = '' THEN
      RAISE EXCEPTION '快递公司和快递单号不能为空';
    END IF;
    INSERT INTO public.shipments(order_id, carrier, tracking_no, shipped_at, operator)
    VALUES (
      p_order_id, trim(p_shipment->>'carrier'), trim(p_shipment->>'trackingNo'),
      coalesce(nullif(p_shipment->>'shippedAt', '')::DATE, current_date),
      coalesce(p_shipment->>'operator', '')
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_new_status);
END;
$$;

-- 收款、价格调整、已收金额和付款状态一次提交。
CREATE OR REPLACE FUNCTION public.zidu_record_payment_atomic(
  p_order_id INTEGER,
  p_amount NUMERIC,
  p_method TEXT,
  p_note TEXT DEFAULT '',
  p_recorded_by TEXT DEFAULT '',
  p_price_adjustment NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_amount NUMERIC(12,2) := round(coalesce(p_amount, 0), 2);
  v_adjustment NUMERIC(12,2) := round(coalesce(p_price_adjustment, 0), 2);
  v_total NUMERIC(12,2);
  v_paid_before NUMERIC(12,2);
  v_paid NUMERIC(12,2);
  v_status TEXT;
  v_meta JSONB;
  v_adjustment_total NUMERIC(12,2);
  v_shipping NUMERIC(12,2);
  v_discount NUMERIC(12,2);
  v_order_status TEXT;
  v_customer_type TEXT;
BEGIN
  IF p_method NOT IN ('微信', '支付宝', '对公账户转账', '对私银行账户转账') THEN
    RAISE EXCEPTION '请选择有效的收款方式';
  END IF;
  IF v_amount <= 0 THEN RAISE EXCEPTION '收款金额必须大于0'; END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION '订单不存在'; END IF;
  IF v_order.status = 'CANCELLED' THEN RAISE EXCEPTION '已取消订单不能收款'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.after_sales
    WHERE order_id = p_order_id AND status IN ('WAREHOUSE_PENDING', 'FINANCE_PENDING')
  ) THEN RAISE EXCEPTION '订单有待处理售后，请完成后再记录收款'; END IF;

  v_total := round(coalesce(v_order.total, 0) + v_adjustment, 2);
  IF v_total < 0 THEN RAISE EXCEPTION '价格调整后订单金额不能为负数'; END IF;
  SELECT round(coalesce(sum(amount), 0), 2) INTO v_paid_before
  FROM public.payment_records WHERE order_id = p_order_id;
  IF v_amount > greatest(v_total - v_paid_before, 0) + 0.01 THEN
    RAISE EXCEPTION '收款金额不能大于调整后待收金额';
  END IF;

  INSERT INTO public.payment_records(order_id, amount, method, note, recorded_by)
  VALUES (p_order_id, v_amount, p_method, coalesce(p_note, ''), coalesce(p_recorded_by, ''));

  v_paid := round(v_paid_before + v_amount, 2);
  v_status := CASE
    WHEN v_total <= 0 THEN CASE WHEN v_paid > 0 THEN 'PAID' ELSE 'UNPAID' END
    WHEN v_paid >= v_total THEN 'PAID'
    WHEN v_paid > 0 THEN 'PARTIAL'
    ELSE 'UNPAID'
  END;
  v_order_status := v_order.status;
  IF v_status = 'PAID' AND v_order.status IN ('DRAFT', 'SUBMITTED') THEN
    SELECT type INTO v_customer_type FROM public.customers WHERE id = v_order.customer_id;
    v_order_status := CASE WHEN v_customer_type IN ('展会', '线下') THEN 'COMPLETED' ELSE 'CONFIRMED' END;
  END IF;
  v_meta := coalesce(v_order.channel_meta, '{}'::JSONB);
  v_adjustment_total := round(coalesce(nullif(v_meta->>'priceAdjustment', '')::NUMERIC, 0) + v_adjustment, 2);
  v_meta := jsonb_set(v_meta, '{priceAdjustment}', to_jsonb(v_adjustment_total), true);
  v_shipping := coalesce(
    nullif(v_meta->>'shippingFee', '')::NUMERIC,
    nullif(v_meta->>'freightFee', '')::NUMERIC,
    nullif(v_meta->>'shipping_fee', '')::NUMERIC,
    0
  );
  v_discount := round(greatest(coalesce(v_order.subtotal, 0) + v_shipping - v_total, 0), 2);

  UPDATE public.orders
  SET total = v_total,
      discount_amount = v_discount,
      paid_amount = v_paid,
      payment_status = v_status,
      status = v_order_status,
      channel_meta = v_meta
  WHERE id = p_order_id;

  INSERT INTO public.order_logs(order_id, time, user_name, action)
  VALUES (
    p_order_id, to_char(now(), 'YYYY-MM-DD HH24:MI'), coalesce(p_recorded_by, ''),
    '记录收款 ¥' || v_amount::TEXT || '（' || p_method || '）'
      || CASE WHEN v_adjustment <> 0 THEN '；价格调整 ' || CASE WHEN v_adjustment > 0 THEN '+' ELSE '' END || v_adjustment::TEXT ELSE '' END
      || CASE
        WHEN v_order_status = 'CONFIRMED' AND v_order.status <> 'CONFIRMED' THEN '；已自动确认订单'
        WHEN v_order_status = 'COMPLETED' AND v_order.status <> 'COMPLETED' THEN '；现场交付已完成'
        ELSE ''
      END
      || CASE WHEN coalesce(trim(p_note), '') <> '' THEN '；' || trim(p_note) ELSE '' END
  );

  RETURN jsonb_build_object(
    'success', true, 'totalPaid', v_paid, 'status', v_status,
    'orderStatus', v_order_status, 'total', v_total,
    'subtotal', v_order.subtotal, 'priceAdjustment', v_adjustment
  );
END;
$$;

-- 原子修改订单数量，同时调整库存、订单金额和付款状态。
CREATE OR REPLACE FUNCTION public.zidu_update_order_items_atomic(
  p_order_id INTEGER,
  p_changes JSONB,
  p_totals JSONB,
  p_log JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_change JSONB;
  v_item public.order_items%ROWTYPE;
  v_new_qty INTEGER;
  v_delta INTEGER;
  v_adjustment JSON;
  v_subtotal NUMERIC(12,2);
  v_total NUMERIC(12,2);
  v_discount NUMERIC(12,2);
  v_paid NUMERIC(12,2);
  v_payment_status TEXT;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION '订单不存在'; END IF;
  IF v_order.status = 'CANCELLED' THEN RAISE EXCEPTION '已取消订单不能修改'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.after_sales
    WHERE order_id = p_order_id AND status IN ('WAREHOUSE_PENDING', 'FINANCE_PENDING')
  ) THEN RAISE EXCEPTION '订单有待处理售后，完成后再修改'; END IF;

  PERFORM 1
  FROM public.product_specs
  WHERE id IN (
    SELECT DISTINCT nullif(c->>'specId', '')::INTEGER
    FROM jsonb_array_elements(coalesce(p_changes, '[]'::JSONB)) c
    WHERE nullif(c->>'specId', '') IS NOT NULL
  )
  ORDER BY id FOR UPDATE;

  PERFORM 1
  FROM public.products
  WHERE id IN (
    SELECT DISTINCT ps.product_id
    FROM public.product_specs ps
    WHERE ps.id IN (
      SELECT DISTINCT nullif(c->>'specId', '')::INTEGER
      FROM jsonb_array_elements(coalesce(p_changes, '[]'::JSONB)) c
      WHERE nullif(c->>'specId', '') IS NOT NULL
    )
  )
  ORDER BY id FOR UPDATE;

  FOR v_change IN SELECT value FROM jsonb_array_elements(coalesce(p_changes, '[]'::JSONB))
  LOOP
    SELECT * INTO v_item
    FROM public.order_items
    WHERE id = nullif(v_change->>'itemId', '')::INTEGER
      AND order_id = p_order_id
    FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION '订单商品不存在或已被修改'; END IF;

    v_new_qty := coalesce((v_change->>'newQty')::INTEGER, 0);
    IF v_new_qty < 0 THEN RAISE EXCEPTION '商品数量不能为负数'; END IF;
    v_delta := v_new_qty - v_item.quantity;

    IF v_item.spec_id IS NOT NULL AND v_delta <> 0 THEN
      v_adjustment := public.zidu_adjust_inventory(
        v_item.spec_id,
        CASE WHEN v_delta > 0 THEN 'OUT' ELSE 'IN' END,
        abs(v_delta),
        'SPEC'
      );
      INSERT INTO public.stock_adjustments (
        spec_id, product_id, type, reason, quantity,
        before_stock, after_stock, quantity_kg, before_stock_kg, after_stock_kg,
        note, operator_name
      ) VALUES (
        v_item.spec_id, v_item.product_id,
        CASE WHEN v_delta > 0 THEN 'OUT' ELSE 'IN' END,
        'ORDER', abs(v_delta),
        (v_adjustment->>'before')::NUMERIC, (v_adjustment->>'after')::NUMERIC,
        nullif(v_adjustment->>'quantityKg', '')::NUMERIC,
        nullif(v_adjustment->>'beforeKg', '')::NUMERIC,
        nullif(v_adjustment->>'afterKg', '')::NUMERIC,
        '管理员修改订单明细', coalesce(p_log->>'user', '')
      );
    END IF;

    IF v_new_qty = 0 THEN
      DELETE FROM public.order_items WHERE id = v_item.id;
    ELSIF v_delta <> 0 THEN
      UPDATE public.order_items
      SET quantity = v_new_qty,
          subtotal = round(v_new_qty * unit_price, 2)
      WHERE id = v_item.id;
    END IF;
  END LOOP;

  SELECT round(coalesce(sum(subtotal), 0), 2) INTO v_subtotal
  FROM public.order_items WHERE order_id = p_order_id;
  IF abs(v_subtotal - coalesce((p_totals->>'subtotal')::NUMERIC, v_subtotal)) > 0.01 THEN
    RAISE EXCEPTION '订单金额已变化，请刷新后重试';
  END IF;
  v_discount := round(greatest(coalesce((p_totals->>'discountAmount')::NUMERIC, 0), 0), 2);
  v_total := round(greatest(coalesce((p_totals->>'total')::NUMERIC, 0), 0), 2);

  SELECT round(coalesce(sum(amount), 0), 2) INTO v_paid
  FROM public.payment_records WHERE order_id = p_order_id;
  v_payment_status := CASE
    WHEN v_total <= 0 THEN CASE WHEN v_paid > 0 THEN 'PAID' ELSE 'UNPAID' END
    WHEN v_paid >= v_total THEN 'PAID'
    WHEN v_paid > 0 THEN 'PARTIAL'
    ELSE 'UNPAID'
  END;

  UPDATE public.orders
  SET subtotal = v_subtotal,
      discount_amount = v_discount,
      total = v_total,
      paid_amount = v_paid,
      payment_status = v_payment_status
  WHERE id = p_order_id;

  IF coalesce(trim(p_log->>'action'), '') <> '' THEN
    INSERT INTO public.order_logs(order_id, time, user_name, action)
    VALUES (
      p_order_id,
      coalesce(nullif(p_log->>'time', ''), to_char(now(), 'YYYY-MM-DD HH24:MI')),
      coalesce(p_log->>'user', ''), p_log->>'action'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'subtotal', v_subtotal, 'total', v_total,
    'paidAmount', v_paid, 'paymentStatus', v_payment_status
  );
END;
$$;

-- 发起售后：退货退款严格按原订单单价计算；仅退款使用手工金额。
CREATE OR REPLACE FUNCTION public.zidu_create_after_sale_atomic(
  p_order_id INTEGER,
  p_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_request JSONB;
  v_item public.order_items%ROWTYPE;
  v_items JSONB := '[]'::JSONB;
  v_qty INTEGER;
  v_requested NUMERIC(12,2) := 0;
  v_refund_only BOOLEAN := coalesce((p_payload->>'refundOnly')::BOOLEAN, false);
  v_full_return BOOLEAN := false;
  v_note TEXT := trim(coalesce(p_payload->>'note', ''));
  v_request_note TEXT;
  v_status TEXT;
  v_after_id INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(34034, p_order_id);
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION '订单不存在'; END IF;
  IF v_order.status = 'CANCELLED' THEN RAISE EXCEPTION '已取消订单不能发起售后'; END IF;
  IF coalesce(v_order.paid_amount, 0) <= 0 THEN RAISE EXCEPTION '待付款订单不能发起售后，请直接取消订单'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.after_sales
    WHERE order_id = p_order_id AND status IN ('WAREHOUSE_PENDING', 'FINANCE_PENDING')
  ) THEN RAISE EXCEPTION '该订单已有待处理售后'; END IF;

  IF v_refund_only THEN
    v_requested := round(coalesce((p_payload->>'requestedAmount')::NUMERIC, 0), 2);
    IF v_requested <= 0 THEN RAISE EXCEPTION '退款金额必须大于0'; END IF;
    v_request_note := '仅退款' || CASE WHEN v_note <> '' THEN '：' || v_note ELSE '' END;
    v_status := 'FINANCE_PENDING';
  ELSE
    FOR v_request IN SELECT value FROM jsonb_array_elements(coalesce(p_payload->'items', '[]'::JSONB))
    LOOP
      SELECT * INTO v_item
      FROM public.order_items
      WHERE id = nullif(v_request->>'itemId', '')::INTEGER
        AND order_id = p_order_id
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION '售后商品不存在或已变更'; END IF;
      v_qty := coalesce((v_request->>'quantity')::INTEGER, 0);
      IF v_qty <= 0 OR v_qty > v_item.quantity THEN
        RAISE EXCEPTION '% 退货数量超出可退数量', coalesce(v_item.product_name, '商品');
      END IF;
      v_items := v_items || jsonb_build_array(jsonb_build_object(
        'itemId', v_item.id,
        'productId', v_item.product_id,
        'specId', v_item.spec_id,
        'productName', coalesce(v_item.product_name, ''),
        'productCode', coalesce(v_item.product_code, ''),
        'spec', coalesce(v_item.spec, ''),
        'quantity', v_qty,
        'unitPrice', v_item.unit_price,
        'subtotal', round(v_qty * v_item.unit_price, 2)
      ));
      v_requested := v_requested + round(v_qty * v_item.unit_price, 2);
    END LOOP;
    IF jsonb_array_length(v_items) = 0 THEN RAISE EXCEPTION '请选择要退货的商品数量'; END IF;
    -- 所有剩余商品都按全量退回时，自动识别为整单退。
    -- 整单退以当前实收金额为准，可正确覆盖折扣、运费和部分收款。
    SELECT NOT EXISTS (
      SELECT 1
      FROM public.order_items oi
      WHERE oi.order_id = p_order_id
        AND coalesce((
          SELECT sum((selected->>'quantity')::INTEGER)
          FROM jsonb_array_elements(v_items) selected
          WHERE (selected->>'itemId')::INTEGER = oi.id
        ), 0) <> oi.quantity
    ) INTO v_full_return;
    v_requested := CASE
      WHEN v_full_return THEN round(coalesce(v_order.paid_amount, 0), 2)
      ELSE round(v_requested, 2)
    END;
    v_request_note := CASE WHEN v_full_return THEN '整单退' ELSE '' END
      || CASE WHEN v_note <> '' THEN CASE WHEN v_full_return THEN '：' ELSE '' END || v_note ELSE '' END;
    v_status := 'WAREHOUSE_PENDING';
  END IF;

  IF v_requested > coalesce(v_order.paid_amount, 0) + 0.01 THEN
    RAISE EXCEPTION '退款金额不能大于当前已收金额';
  END IF;

  INSERT INTO public.after_sales(
    order_id, type, status, items, requested_amount,
    request_note, created_by
  ) VALUES (
    p_order_id, 'RETURN_REFUND', v_status, v_items, v_requested,
    v_request_note, coalesce(p_payload->>'createdBy', '')
  ) RETURNING id INTO v_after_id;

  INSERT INTO public.order_logs(order_id, time, user_name, action)
  VALUES (
    p_order_id,
    coalesce(nullif(p_payload->>'time', ''), to_char(now(), 'YYYY-MM-DD HH24:MI')),
    coalesce(p_payload->>'createdBy', ''),
    '发起售后：' || CASE WHEN v_refund_only THEN '仅退款' WHEN v_full_return THEN '整单退' ELSE '退货退款' END
      || '；退款 ¥' || v_requested::TEXT
      || CASE WHEN v_note <> '' THEN '；' || v_note ELSE '' END
  );

  RETURN jsonb_build_object(
    'success', true, 'id', v_after_id, 'status', v_status,
    'requestedAmount', v_requested
  );
END;
$$;

-- 仓库处理与退货入库在一个事务内完成。
CREATE OR REPLACE FUNCTION public.zidu_process_after_sale_warehouse_atomic(
  p_after_sale_id INTEGER,
  p_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_after public.after_sales%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_item JSONB;
  v_adjustment JSON;
  v_restock BOOLEAN := coalesce((p_payload->>'restockReturned')::BOOLEAN, true);
  v_operator TEXT := coalesce(p_payload->>'operatorName', '');
  v_note TEXT := trim(coalesce(p_payload->>'note', ''));
BEGIN
  SELECT * INTO v_after FROM public.after_sales WHERE id = p_after_sale_id FOR UPDATE;
  IF v_after.id IS NULL THEN RAISE EXCEPTION '售后单不存在'; END IF;
  IF v_after.status <> 'WAREHOUSE_PENDING' THEN RAISE EXCEPTION '该售后单已被处理'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_after.order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION '原订单不存在'; END IF;

  PERFORM 1
  FROM public.product_specs
  WHERE id IN (
    SELECT DISTINCT nullif(i->>'specId', '')::INTEGER
    FROM jsonb_array_elements(v_after.items) i
    WHERE nullif(i->>'specId', '') IS NOT NULL
  ) ORDER BY id FOR UPDATE;

  PERFORM 1
  FROM public.products
  WHERE id IN (
    SELECT DISTINCT nullif(i->>'productId', '')::INTEGER
    FROM jsonb_array_elements(v_after.items) i
    WHERE nullif(i->>'productId', '') IS NOT NULL
  ) ORDER BY id FOR UPDATE;

  IF v_restock THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_after.items)
    LOOP
      IF nullif(v_item->>'specId', '') IS NOT NULL THEN
        v_adjustment := public.zidu_adjust_inventory(
          (v_item->>'specId')::INTEGER, 'IN', (v_item->>'quantity')::NUMERIC, 'SPEC'
        );
        INSERT INTO public.stock_adjustments(
          spec_id, product_id, type, reason, quantity,
          before_stock, after_stock, quantity_kg, before_stock_kg, after_stock_kg,
          note, operator_name
        ) VALUES (
          (v_item->>'specId')::INTEGER, nullif(v_item->>'productId', '')::INTEGER,
          'IN', 'RETURN', (v_item->>'quantity')::INTEGER,
          (v_adjustment->>'before')::NUMERIC, (v_adjustment->>'after')::NUMERIC,
          nullif(v_adjustment->>'quantityKg', '')::NUMERIC,
          nullif(v_adjustment->>'beforeKg', '')::NUMERIC,
          nullif(v_adjustment->>'afterKg', '')::NUMERIC,
          '售后退回 ' || v_order.order_no || ' ' || coalesce(v_item->>'productName', ''),
          v_operator
        );
      END IF;
    END LOOP;
  END IF;

  UPDATE public.after_sales
  SET status = 'FINANCE_PENDING',
      restock_returned = v_restock,
      deduct_replacement = false,
      warehouse_note = v_note,
      warehouse_by = v_operator,
      warehouse_at = now()
  WHERE id = p_after_sale_id;

  INSERT INTO public.order_logs(order_id, time, user_name, action)
  VALUES (
    v_after.order_id,
    coalesce(nullif(p_payload->>'time', ''), to_char(now(), 'YYYY-MM-DD HH24:MI')),
    v_operator,
    '仓库处理售后：' || CASE WHEN v_restock THEN '退回已入库' ELSE '退回不入库' END
      || CASE WHEN v_note <> '' THEN '；' || v_note ELSE '' END
  );

  RETURN jsonb_build_object('success', true, 'status', 'FINANCE_PENDING');
END;
$$;

-- 财务退款、订单金额修正、商品退货减量和付款状态一次完成。
CREATE OR REPLACE FUNCTION public.zidu_complete_after_sale_finance_atomic(
  p_after_sale_id INTEGER,
  p_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_after public.after_sales%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_item_json JSONB;
  v_order_item public.order_items%ROWTYPE;
  v_qty INTEGER;
  v_expected NUMERIC(12,2);
  v_amount NUMERIC(12,2);
  v_method TEXT := coalesce(p_payload->>'method', '');
  v_operator TEXT := coalesce(p_payload->>'operatorName', '');
  v_note TEXT := trim(coalesce(p_payload->>'note', ''));
  v_refund_only BOOLEAN;
  v_full_return BOOLEAN;
  v_subtotal NUMERIC(12,2);
  v_shipping NUMERIC(12,2);
  v_total NUMERIC(12,2);
  v_discount NUMERIC(12,2);
  v_paid NUMERIC(12,2);
  v_payment_status TEXT;
  v_item_count INTEGER;
BEGIN
  SELECT * INTO v_after FROM public.after_sales WHERE id = p_after_sale_id FOR UPDATE;
  IF v_after.id IS NULL THEN RAISE EXCEPTION '售后单不存在'; END IF;
  IF v_after.status <> 'FINANCE_PENDING' THEN RAISE EXCEPTION '该售后单已被处理'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = v_after.order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION '原订单不存在'; END IF;

  v_expected := round(coalesce(v_after.requested_amount, 0), 2);
  v_amount := round(coalesce((p_payload->>'amount')::NUMERIC, 0), 2);
  v_refund_only := coalesce(v_after.request_note, '') LIKE '仅退款%';
  v_full_return := coalesce(v_after.request_note, '') LIKE '整单退%';
  IF v_amount >= 0 THEN RAISE EXCEPTION '请记录负数退款金额'; END IF;
  IF abs(abs(v_amount) - v_expected) > 0.01 THEN RAISE EXCEPTION '退款金额必须等于售后申请金额'; END IF;
  IF abs(v_amount) > coalesce(v_order.paid_amount, 0) + 0.01 THEN
    RAISE EXCEPTION '退款金额不能大于当前已收金额';
  END IF;
  IF v_method NOT IN ('微信', '支付宝', '对公账户转账', '对私银行账户转账') THEN
    RAISE EXCEPTION '请选择有效的退款方式';
  END IF;

  IF NOT v_refund_only THEN
    FOR v_item_json IN SELECT value FROM jsonb_array_elements(v_after.items)
    LOOP
      SELECT * INTO v_order_item
      FROM public.order_items
      WHERE id = nullif(v_item_json->>'itemId', '')::INTEGER
        AND order_id = v_after.order_id
      FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION '退货商品已变更，请人工核对'; END IF;
      v_qty := coalesce((v_item_json->>'quantity')::INTEGER, 0);
      IF v_qty <= 0 OR v_qty > v_order_item.quantity THEN
        RAISE EXCEPTION '% 退货数量已超出订单剩余数量', coalesce(v_order_item.product_name, '商品');
      END IF;
      IF v_qty = v_order_item.quantity THEN
        DELETE FROM public.order_items WHERE id = v_order_item.id;
      ELSE
        UPDATE public.order_items
        SET quantity = quantity - v_qty,
            subtotal = round((quantity - v_qty) * unit_price, 2)
        WHERE id = v_order_item.id;
      END IF;
    END LOOP;
  END IF;

  SELECT round(coalesce(sum(subtotal), 0), 2), count(*)
  INTO v_subtotal, v_item_count
  FROM public.order_items WHERE order_id = v_after.order_id;

  v_shipping := CASE WHEN v_item_count = 0 THEN 0 ELSE coalesce(
    nullif(v_order.channel_meta->>'shippingFee', '')::NUMERIC,
    nullif(v_order.channel_meta->>'freightFee', '')::NUMERIC,
    nullif(v_order.channel_meta->>'shipping_fee', '')::NUMERIC,
    0
  ) END;
  v_total := CASE
    WHEN v_full_return OR v_item_count = 0 THEN 0
    ELSE round(greatest(coalesce(v_order.total, 0) - v_expected, 0), 2)
  END;
  v_discount := round(greatest(v_subtotal + v_shipping - v_total, 0), 2);

  INSERT INTO public.payment_records(order_id, amount, method, note, recorded_by)
  VALUES (
    v_after.order_id, v_amount, v_method,
    '退款：' || CASE WHEN v_note <> '' THEN v_note ELSE CASE WHEN v_refund_only THEN '仅退款' ELSE '退货退款' END END,
    v_operator
  );

  SELECT round(coalesce(sum(amount), 0), 2) INTO v_paid
  FROM public.payment_records WHERE order_id = v_after.order_id;
  IF v_paid < -0.01 THEN RAISE EXCEPTION '退款后已收金额不能为负数'; END IF;
  v_payment_status := CASE
    WHEN v_total <= 0 THEN CASE WHEN v_paid > 0 THEN 'PAID' ELSE 'UNPAID' END
    WHEN v_paid >= v_total THEN 'PAID'
    WHEN v_paid > 0 THEN 'PARTIAL'
    ELSE 'UNPAID'
  END;

  UPDATE public.orders
  SET subtotal = v_subtotal,
      discount_amount = v_discount,
      total = v_total,
      paid_amount = v_paid,
      payment_status = v_payment_status,
      status = CASE WHEN v_item_count = 0 THEN 'COMPLETED' ELSE status END
  WHERE id = v_after.order_id;

  UPDATE public.after_sales
  SET status = 'COMPLETED',
      finance_amount = v_amount,
      finance_method = v_method,
      finance_note = v_note,
      finance_by = v_operator,
      finance_at = now(),
      completed_at = now()
  WHERE id = p_after_sale_id;

  INSERT INTO public.order_logs(order_id, time, user_name, action)
  VALUES (
    v_after.order_id,
    coalesce(nullif(p_payload->>'time', ''), to_char(now(), 'YYYY-MM-DD HH24:MI')),
    v_operator,
    '财务完成退款 ¥' || v_expected::TEXT
      || CASE WHEN v_note <> '' THEN '；' || v_note ELSE '' END
  );

  RETURN jsonb_build_object(
    'success', true, 'total', v_total, 'paidAmount', v_paid,
    'paymentStatus', v_payment_status
  );
END;
$$;

-- 误建售后可在尚未发生仓库入库或财务退款前取消。
CREATE OR REPLACE FUNCTION public.zidu_cancel_after_sale(
  p_after_sale_id INTEGER,
  p_operator_name TEXT DEFAULT '',
  p_note TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_after public.after_sales%ROWTYPE;
  v_operator TEXT := coalesce(nullif(trim(p_operator_name), ''), '管理员');
  v_note TEXT := trim(coalesce(p_note, ''));
BEGIN
  SELECT * INTO v_after
  FROM public.after_sales
  WHERE id = p_after_sale_id
  FOR UPDATE;

  IF v_after.id IS NULL THEN RAISE EXCEPTION '售后工单不存在'; END IF;
  IF v_after.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('success', true, 'alreadyCancelled', true);
  END IF;
  IF v_after.status = 'COMPLETED' OR v_after.finance_at IS NOT NULL THEN
    RAISE EXCEPTION '该售后已完成财务处理，不能取消';
  END IF;
  IF v_after.warehouse_at IS NOT NULL THEN
    RAISE EXCEPTION '仓库已处理并变更库存，不能取消；请继续完成财务处理';
  END IF;
  IF v_after.status NOT IN ('WAREHOUSE_PENDING', 'FINANCE_PENDING') THEN
    RAISE EXCEPTION '当前售后状态不能取消';
  END IF;

  UPDATE public.after_sales
  SET status = 'CANCELLED',
      completed_at = now(),
      finance_note = CASE
        WHEN v_note <> '' THEN '管理员取消：' || v_note
        ELSE '管理员取消误建售后'
      END,
      finance_by = ''
  WHERE id = p_after_sale_id;

  INSERT INTO public.order_logs(order_id, time, user_name, action)
  VALUES (
    v_after.order_id,
    to_char(now(), 'YYYY-MM-DD HH24:MI'),
    v_operator,
    '取消售后工单 #' || v_after.id::TEXT
      || CASE WHEN v_note <> '' THEN '；' || v_note ELSE '' END
  );

  RETURN jsonb_build_object('success', true, 'status', 'CANCELLED');
END;
$$;

-- 有收付款或售后审计记录的订单不允许删除。保留订单并用退款流水冲销。
CREATE OR REPLACE FUNCTION public.zidu_guard_financial_order_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.payment_records WHERE order_id = OLD.id)
     OR EXISTS (SELECT 1 FROM public.after_sales WHERE order_id = OLD.id) THEN
    RAISE EXCEPTION '该订单已有收付款或售后记录，为保证财务准确不能删除';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_zidu_guard_financial_order_delete ON public.orders;
CREATE TRIGGER trg_zidu_guard_financial_order_delete
BEFORE DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.zidu_guard_financial_order_delete();

-- 只允许将无收付款、无售后记录的误下订单移入 30 天删除库。
CREATE OR REPLACE FUNCTION public.zidu_delete_order_atomic(
  p_order_id INTEGER,
  p_restore_stock BOOLEAN DEFAULT true,
  p_deleted_by TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item RECORD;
  v_adjustment JSON;
  v_restore BOOLEAN;
  v_order_json JSONB;
  v_items JSONB;
  v_logs JSONB;
  v_shipments JSONB;
  v_payments JSONB;
  v_after_sales JSONB;
  v_snapshot JSONB;
  v_deleted_id INTEGER;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION '订单不存在'; END IF;
  IF EXISTS (SELECT 1 FROM public.payment_records WHERE order_id = p_order_id)
     OR EXISTS (SELECT 1 FROM public.after_sales WHERE order_id = p_order_id) THEN
    RAISE EXCEPTION '该订单已有收付款或售后记录，请保留订单并通过售后冲销';
  END IF;

  v_restore := v_order.status <> 'CANCELLED';
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::JSONB)
  INTO v_items FROM public.order_items x WHERE x.order_id = p_order_id;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::JSONB)
  INTO v_logs FROM public.order_logs x WHERE x.order_id = p_order_id;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::JSONB)
  INTO v_shipments FROM public.shipments x WHERE x.order_id = p_order_id;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::JSONB)
  INTO v_payments FROM public.payment_records x WHERE x.order_id = p_order_id;
  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]'::JSONB)
  INTO v_after_sales FROM public.after_sales x WHERE x.order_id = p_order_id;

  v_order_json := to_jsonb(v_order) || jsonb_build_object(
    'customer', jsonb_build_object('name', coalesce((SELECT name FROM public.customers WHERE id = v_order.customer_id), '')),
    'items', v_items, 'logs', v_logs, 'shipment', v_shipments,
    'payments', v_payments, 'afterSales', v_after_sales
  );
  v_snapshot := jsonb_build_object(
    'order', v_order_json, 'items', v_items, 'logs', v_logs,
    'shipment', v_shipments, 'payments', v_payments, 'afterSales', v_after_sales
  );

  INSERT INTO public.deleted_orders(
    original_order_id, order_no, customer_id, customer_name, sales_id,
    status, payment_status, total, paid_amount, stock_restored,
    snapshot, deleted_by, expires_at
  ) VALUES (
    p_order_id, v_order.order_no, v_order.customer_id,
    coalesce((SELECT name FROM public.customers WHERE id = v_order.customer_id), ''),
    v_order.sales_id, v_order.status, coalesce(v_order.payment_status, 'UNPAID'),
    coalesce(v_order.total, 0), coalesce(v_order.paid_amount, 0), v_restore,
    v_snapshot, coalesce(p_deleted_by, ''), now() + interval '30 days'
  ) RETURNING id INTO v_deleted_id;

  IF v_restore THEN
    PERFORM 1
    FROM public.product_specs
    WHERE id IN (SELECT spec_id FROM public.order_items WHERE order_id = p_order_id AND spec_id IS NOT NULL)
    ORDER BY id FOR UPDATE;
    PERFORM 1
    FROM public.products
    WHERE id IN (SELECT product_id FROM public.order_items WHERE order_id = p_order_id AND product_id IS NOT NULL)
    ORDER BY id FOR UPDATE;

    FOR v_item IN
      SELECT * FROM public.order_items
      WHERE order_id = p_order_id AND spec_id IS NOT NULL
      ORDER BY spec_id, id
    LOOP
      v_adjustment := public.zidu_adjust_inventory(v_item.spec_id, 'IN', v_item.quantity, 'SPEC');
      INSERT INTO public.stock_adjustments(
        spec_id, product_id, type, reason, quantity,
        before_stock, after_stock, quantity_kg, before_stock_kg, after_stock_kg,
        note, operator_name
      ) VALUES (
        v_item.spec_id, v_item.product_id, 'IN', 'CANCEL_RESTORE', v_item.quantity,
        (v_adjustment->>'before')::NUMERIC, (v_adjustment->>'after')::NUMERIC,
        nullif(v_adjustment->>'quantityKg', '')::NUMERIC,
        nullif(v_adjustment->>'beforeKg', '')::NUMERIC,
        nullif(v_adjustment->>'afterKg', '')::NUMERIC,
        '删除误下订单 ' || v_order.order_no, coalesce(p_deleted_by, '')
      );
    END LOOP;
  END IF;

  DELETE FROM public.orders WHERE id = p_order_id;
  RETURN jsonb_build_object('success', true, 'deletedOrderId', v_deleted_id, 'stockRestored', v_restore);
END;
$$;

REVOKE ALL ON FUNCTION public.zidu_cancel_order(INTEGER, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zidu_update_order_status_atomic(INTEGER, TEXT, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zidu_record_payment_atomic(INTEGER, NUMERIC, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zidu_update_order_items_atomic(INTEGER, JSONB, JSONB, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zidu_create_after_sale_atomic(INTEGER, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zidu_process_after_sale_warehouse_atomic(INTEGER, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zidu_complete_after_sale_finance_atomic(INTEGER, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zidu_cancel_after_sale(INTEGER, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zidu_delete_order_atomic(INTEGER, BOOLEAN, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.zidu_cancel_order(INTEGER, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_update_order_status_atomic(INTEGER, TEXT, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_record_payment_atomic(INTEGER, NUMERIC, TEXT, TEXT, TEXT, NUMERIC) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_update_order_items_atomic(INTEGER, JSONB, JSONB, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_create_after_sale_atomic(INTEGER, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_process_after_sale_warehouse_atomic(INTEGER, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_complete_after_sale_finance_atomic(INTEGER, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_cancel_after_sale(INTEGER, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_delete_order_atomic(INTEGER, BOOLEAN, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT
  to_regprocedure('public.zidu_cancel_order(integer,text,text)') IS NOT NULL AS cancel_ready,
  to_regprocedure('public.zidu_update_order_status_atomic(integer,text,jsonb,jsonb)') IS NOT NULL AS status_ready,
  to_regprocedure('public.zidu_record_payment_atomic(integer,numeric,text,text,text,numeric)') IS NOT NULL AS payment_ready,
  to_regprocedure('public.zidu_update_order_items_atomic(integer,jsonb,jsonb,jsonb)') IS NOT NULL AS edit_ready,
  to_regprocedure('public.zidu_create_after_sale_atomic(integer,jsonb)') IS NOT NULL AS after_sale_create_ready,
  to_regprocedure('public.zidu_process_after_sale_warehouse_atomic(integer,jsonb)') IS NOT NULL AS warehouse_ready,
  to_regprocedure('public.zidu_complete_after_sale_finance_atomic(integer,jsonb)') IS NOT NULL AS finance_ready,
  to_regprocedure('public.zidu_cancel_after_sale(integer,text,text)') IS NOT NULL AS after_sale_cancel_ready,
  to_regprocedure('public.zidu_delete_order_atomic(integer,boolean,text)') IS NOT NULL AS delete_ready;
