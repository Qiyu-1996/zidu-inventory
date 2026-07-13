-- ZIDU v33: 管理员可为任意销售订单直接批准“未收款，请发货”。
-- 销售发起仍进入 PENDING，必须由管理员审核；管理员发起直接 APPROVED。
-- 依赖：migration_v31_unpaid_shipping_approval.sql。可重复运行。

CREATE OR REPLACE FUNCTION public.request_unpaid_shipping(
  p_order_id INTEGER,
  p_sales_id INTEGER,
  p_reason TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_reason TEXT := trim(coalesce(p_reason, ''));
  v_request_status TEXT;
  v_order_status TEXT;
BEGIN
  SELECT * INTO v_actor
  FROM public.users
  WHERE id = p_sales_id
    AND role IN ('SALES', 'ADMIN')
    AND status = 'active';
  IF v_actor.id IS NULL THEN
    RETURN json_build_object('error', '只有在职销售或管理员可执行此操作');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RETURN json_build_object('error', '订单不存在'); END IF;
  IF v_actor.role = 'SALES' AND v_order.sales_id IS DISTINCT FROM v_actor.id THEN
    RETURN json_build_object('error', '销售只能申请自己的订单');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.customers
    WHERE id = v_order.customer_id AND type IN ('展会', '线下')
  ) THEN RETURN json_build_object('error', '现场交付订单无需申请发货'); END IF;
  IF v_order.payment_status = 'PAID' THEN RETURN json_build_object('error', '该订单已收款，无需申请'); END IF;
  IF v_order.status NOT IN ('DRAFT', 'SUBMITTED', 'CONFIRMED', 'PREPARING') THEN
    RETURN json_build_object('error', '当前订单状态不能设置未收款发货');
  END IF;
  IF v_order.unpaid_shipping_status = 'PENDING' THEN RETURN json_build_object('error', '申请正在等待管理员审核'); END IF;
  IF v_order.unpaid_shipping_status = 'APPROVED' THEN RETURN json_build_object('error', '该订单已批准未收款发货'); END IF;
  IF char_length(v_reason) < 2 THEN RETURN json_build_object('error', '请填写原因'); END IF;

  v_request_status := CASE WHEN v_actor.role = 'ADMIN' THEN 'APPROVED' ELSE 'PENDING' END;
  v_order_status := CASE
    WHEN v_actor.role = 'ADMIN' AND v_order.status IN ('DRAFT', 'SUBMITTED') THEN 'CONFIRMED'
    ELSE v_order.status
  END;

  UPDATE public.orders
  SET unpaid_shipping_status = v_request_status,
      unpaid_shipping_reason = left(v_reason, 500),
      unpaid_shipping_requested_by = v_actor.id,
      unpaid_shipping_requested_at = now(),
      unpaid_shipping_reviewed_by = CASE WHEN v_actor.role = 'ADMIN' THEN v_actor.id ELSE NULL END,
      unpaid_shipping_reviewed_at = CASE WHEN v_actor.role = 'ADMIN' THEN now() ELSE NULL END,
      unpaid_shipping_review_note = CASE WHEN v_actor.role = 'ADMIN' THEN '管理员直接批准' ELSE '' END,
      status = v_order_status
  WHERE id = p_order_id;

  INSERT INTO public.order_logs(order_id, time, user_name, action)
  VALUES (
    p_order_id,
    to_char(now(), 'YYYY-MM-DD HH24:MI'),
    v_actor.name,
    CASE
      WHEN v_actor.role = 'ADMIN' THEN '管理员直接批准未收款发货：' || left(v_reason, 200)
      ELSE '申请未收款发货：' || left(v_reason, 200)
    END
  );

  RETURN json_build_object(
    'success', true,
    'status', v_order_status,
    'unpaid_shipping_status', v_request_status,
    'unpaid_shipping_reason', left(v_reason, 500),
    'unpaid_shipping_requested_by', v_actor.id,
    'unpaid_shipping_requested_at', now(),
    'unpaid_shipping_reviewed_by', CASE WHEN v_actor.role = 'ADMIN' THEN v_actor.id ELSE NULL END,
    'unpaid_shipping_reviewed_at', CASE WHEN v_actor.role = 'ADMIN' THEN now() ELSE NULL END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.request_unpaid_shipping(INTEGER, INTEGER, TEXT) TO anon, authenticated;

SELECT to_regprocedure('public.request_unpaid_shipping(integer,integer,text)') IS NOT NULL
  AS admin_unpaid_shipping_ready;
