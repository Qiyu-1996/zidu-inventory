-- ZIDU 主业务链路子事务回滚测试。
-- 运行前：先成功执行 migration_v38_order_status_guard.sql。
-- 本脚本会临时走完下单、扣库存、收款、发货、完成、退货入库和退款。
-- 所有业务写入都发生在函数内部子事务，结束时主动回滚；只返回 8 行测试结果。

CREATE OR REPLACE FUNCTION public.zidu_run_core_flow_test()
RETURNS TABLE(step_no INTEGER, step TEXT, passed BOOLEAN, detail TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_spec public.product_specs%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_order_result JSONB;
  v_order_id INTEGER;
  v_order_no TEXT;
  v_order_item public.order_items%ROWTYPE;
  v_after_result JSONB;
  v_after_id INTEGER;
  v_requested NUMERIC(12,2);
  v_before_spec_stock NUMERIC;
  v_before_base_stock NUMERIC;
  v_after_spec_stock NUMERIC;
  v_after_base_stock NUMERIC;
  v_order public.orders%ROWTYPE;
  v_payment_sum NUMERIC;
  v_shipment_count INTEGER;
  v_after_status TEXT;
  v_results JSONB := '[]'::JSONB;
BEGIN
  BEGIN
  IF to_regprocedure('public.zidu_update_order_status_atomic(integer,text,jsonb,jsonb)') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_trigger
       WHERE tgrelid = 'public.orders'::regclass
         AND tgname = 'trg_zidu_guard_direct_order_status_update'
         AND NOT tgisinternal
     ) THEN
    RAISE EXCEPTION '缺少订单状态函数，请先运行 migration_v38';
  END IF;

  SELECT p.* INTO v_product
  FROM public.products p
  JOIN public.product_specs s ON s.product_id = p.id
  WHERE coalesce(s.stock, 0) >= 1
    AND coalesce(s.price, 0) > 0
    AND (p.inventory_mode <> 'MASS' OR coalesce(p.base_stock_kg, 0) > 0)
  ORDER BY CASE WHEN p.channel IN ('RAW', 'BOTH') THEN 0 ELSE 1 END, p.id
  LIMIT 1;
  IF v_product.id IS NULL THEN RAISE EXCEPTION '没有可用于测试的库存，请先录入至少 1 件库存'; END IF;

  SELECT * INTO v_spec
  FROM public.product_specs
  WHERE product_id = v_product.id AND stock >= 1 AND price > 0
  ORDER BY id
  LIMIT 1;

  SELECT * INTO v_customer
  FROM public.customers
  WHERE coalesce(type, '') NOT IN ('展会', '线下')
  ORDER BY id
  LIMIT 1;
  IF v_customer.id IS NULL THEN RAISE EXCEPTION '没有普通客户，无法测试标准发货链路'; END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE status = 'active' AND role IN ('ADMIN', 'SALES')
  ORDER BY CASE WHEN role = 'ADMIN' THEN 0 ELSE 1 END, id
  LIMIT 1;
  IF v_user.id IS NULL THEN RAISE EXCEPTION '没有在职管理员或销售'; END IF;

  v_before_spec_stock := v_spec.stock;
  v_before_base_stock := v_product.base_stock_kg;
  v_order_no := 'ZDR-' || to_char(current_date, 'YYMMDD')
    || '-CUS' || lpad((v_customer.id % 1000)::TEXT, 3, '0') || '-TST001';

  v_order_result := public.zidu_create_order_atomic(jsonb_build_object(
    'orderNo', v_order_no,
    'customerId', v_customer.id,
    'salesId', v_user.id,
    'status', 'SUBMITTED',
    'subtotal', v_spec.price,
    'discountPercent', 0,
    'discountAmount', 0,
    'total', v_spec.price,
    'notes', '主流程事务回滚测试',
    'businessType', '院线',
    'createdAt', current_date,
    'source', 'web_admin',
    'channelMeta', jsonb_build_object('productSource', 'RAW', 'shippingFee', 0),
    'items', jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'specId', v_spec.id,
      'productName', v_product.name,
      'productCode', v_product.code,
      'spec', v_spec.spec,
      'quantity', 1,
      'unitPrice', v_spec.price,
      'unitCost', v_spec.cost,
      'subtotal', v_spec.price
    )),
    'logs', jsonb_build_array(jsonb_build_object(
      'time', to_char(now(), 'YYYY-MM-DD HH24:MI'),
      'user', v_user.name,
      'action', '主流程事务回滚测试：创建订单'
    ))
  ));
  v_order_id := (v_order_result->>'id')::INTEGER;
  v_results := v_results || jsonb_build_array(jsonb_build_object(
    'step_no', 1, 'step', '销售下单并原子扣库存',
    'passed', v_order_id IS NOT NULL, 'detail', v_order_no
  ));

  PERFORM public.zidu_record_payment_atomic(
    v_order_id, v_spec.price, '微信', '事务回滚测试收款', v_user.name, 0
  );
  SELECT * INTO v_order FROM public.orders WHERE id = v_order_id;
  v_results := v_results || jsonb_build_array(jsonb_build_object(
    'step_no', 2, 'step', '记录收款并进入已确认',
    'passed', v_order.payment_status = 'PAID' AND v_order.status = 'CONFIRMED',
    'detail', v_order.payment_status || ' / ' || v_order.status
  ));

  PERFORM public.zidu_update_order_status_atomic(
    v_order_id,
    'SHIPPED',
    jsonb_build_object('time', to_char(now(), 'YYYY-MM-DD HH24:MI'), 'user', v_user.name, 'action', '事务回滚测试发货'),
    jsonb_build_object('carrier', '顺丰', 'trackingNo', 'TEST' || v_order_id::TEXT, 'shippedAt', current_date, 'operator', v_user.name)
  );
  SELECT count(*) INTO v_shipment_count FROM public.shipments WHERE order_id = v_order_id;
  SELECT * INTO v_order FROM public.orders WHERE id = v_order_id;
  v_results := v_results || jsonb_build_array(jsonb_build_object(
    'step_no', 3, 'step', '填写物流并发货',
    'passed', v_order.status = 'SHIPPED' AND v_shipment_count = 1,
    'detail', v_order.status || ' / 物流 ' || v_shipment_count::TEXT || ' 条'
  ));

  PERFORM public.zidu_update_order_status_atomic(
    v_order_id,
    'COMPLETED',
    jsonb_build_object('time', to_char(now(), 'YYYY-MM-DD HH24:MI'), 'user', v_user.name, 'action', '事务回滚测试完成订单'),
    NULL
  );
  SELECT * INTO v_order FROM public.orders WHERE id = v_order_id;
  v_results := v_results || jsonb_build_array(jsonb_build_object(
    'step_no', 4, 'step', '完成订单',
    'passed', v_order.status = 'COMPLETED', 'detail', v_order.status
  ));

  SELECT * INTO v_order_item FROM public.order_items WHERE order_id = v_order_id LIMIT 1;
  v_after_result := public.zidu_create_after_sale_atomic(v_order_id, jsonb_build_object(
    'items', jsonb_build_array(jsonb_build_object('itemId', v_order_item.id, 'quantity', 1)),
    'requestedAmount', v_spec.price,
    'note', '事务回滚测试整单退',
    'createdBy', v_user.name,
    'time', to_char(now(), 'YYYY-MM-DD HH24:MI')
  ));
  v_after_id := (v_after_result->>'id')::INTEGER;
  v_requested := (v_after_result->>'requestedAmount')::NUMERIC;
  v_results := v_results || jsonb_build_array(jsonb_build_object(
    'step_no', 5, 'step', '发起已收款订单售后',
    'passed', v_after_id IS NOT NULL AND v_requested = v_spec.price,
    'detail', '售后 #' || v_after_id::TEXT || ' / ¥' || v_requested::TEXT
  ));

  PERFORM public.zidu_process_after_sale_warehouse_atomic(v_after_id, jsonb_build_object(
    'restockReturned', true,
    'note', '验货合格，事务回滚测试入库',
    'operatorName', v_user.name,
    'time', to_char(now(), 'YYYY-MM-DD HH24:MI')
  ));
  SELECT status INTO v_after_status FROM public.after_sales WHERE id = v_after_id;
  v_results := v_results || jsonb_build_array(jsonb_build_object(
    'step_no', 6, 'step', '仓库验货并恢复库存',
    'passed', v_after_status = 'FINANCE_PENDING', 'detail', v_after_status
  ));

  PERFORM public.zidu_complete_after_sale_finance_atomic(v_after_id, jsonb_build_object(
    'amount', -v_requested,
    'method', '微信',
    'note', '事务回滚测试退款',
    'operatorName', v_user.name,
    'time', to_char(now(), 'YYYY-MM-DD HH24:MI')
  ));

  SELECT * INTO v_order FROM public.orders WHERE id = v_order_id;
  SELECT coalesce(sum(amount), 0) INTO v_payment_sum FROM public.payment_records WHERE order_id = v_order_id;
  SELECT status INTO v_after_status FROM public.after_sales WHERE id = v_after_id;
  SELECT stock INTO v_after_spec_stock FROM public.product_specs WHERE id = v_spec.id;
  SELECT base_stock_kg INTO v_after_base_stock FROM public.products WHERE id = v_product.id;
  v_results := v_results || jsonb_build_array(jsonb_build_object(
    'step_no', 7, 'step', '财务退款并完成售后',
    'passed', v_after_status = 'COMPLETED'
      AND abs(v_payment_sum) <= 0.01
      AND abs(coalesce(v_order.paid_amount, 0)) <= 0.01
      AND abs(coalesce(v_order.total, 0)) <= 0.01,
    'detail', v_after_status || ' / 收款净额 ¥' || round(v_payment_sum, 2)::TEXT
  ));
  v_results := v_results || jsonb_build_array(jsonb_build_object(
    'step_no', 8, 'step', '整条链路后库存回到测试前',
    'passed', abs(v_after_spec_stock - v_before_spec_stock) <= 0.000001
      AND (
        v_product.inventory_mode <> 'MASS'
        OR abs(coalesce(v_after_base_stock, 0) - coalesce(v_before_base_stock, 0)) <= 0.000001
      ),
    'detail', '规格 ' || v_before_spec_stock::TEXT || '→' || v_after_spec_stock::TEXT
      || CASE WHEN v_product.inventory_mode = 'MASS'
        THEN '；kg ' || v_before_base_stock::TEXT || '→' || v_after_base_stock::TEXT
        ELSE '' END
  ));

  -- 主动抛出专用异常，使上面所有订单、库存、物流和财务写入在子事务内回滚。
  RAISE EXCEPTION USING ERRCODE = 'ZD001', MESSAGE = 'ZIDU_CORE_FLOW_ROLLBACK';
  EXCEPTION WHEN SQLSTATE 'ZD001' THEN
    NULL;
  END;

  RETURN QUERY
  SELECT result.step_no, result.step, result.passed, result.detail
  FROM jsonb_to_recordset(v_results) AS result(
    step_no INTEGER, step TEXT, passed BOOLEAN, detail TEXT
  )
  ORDER BY result.step_no;
END;
$$;

REVOKE ALL ON FUNCTION public.zidu_run_core_flow_test() FROM PUBLIC;

SELECT * FROM public.zidu_run_core_flow_test();
