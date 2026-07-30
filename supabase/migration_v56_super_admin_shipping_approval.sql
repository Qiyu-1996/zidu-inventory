-- ZIDU 未收款发货审批：管理员和超级管理员均可审批。
-- 同时改为从 Supabase Auth 会话识别操作人，不再信任前端传入的用户 ID。

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.zidu_require_actor(text[])') IS NULL
     OR to_regprocedure('public.request_unpaid_shipping(integer,integer,text)') IS NULL
     OR to_regprocedure('public.review_unpaid_shipping(integer,integer,boolean,text)') IS NULL THEN
    RAISE EXCEPTION '请先完成 migration_v31、migration_v33 和 migration_v43';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_unpaid_shipping(
  p_order_id INTEGER,
  p_sales_id INTEGER,
  p_reason TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_reason TEXT := trim(coalesce(p_reason, ''));
  v_request_status TEXT;
  v_order_status TEXT;
  v_is_admin BOOLEAN;
BEGIN
  SELECT * INTO v_actor
  FROM public.zidu_require_actor(ARRAY['ADMIN', 'SALES']);

  IF p_sales_id IS DISTINCT FROM v_actor.id THEN
    RETURN json_build_object('error', '登录账号与操作人不匹配');
  END IF;
  v_is_admin := v_actor.role IN ('ADMIN', 'SUPER_ADMIN');

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RETURN json_build_object('error', '订单不存在'); END IF;
  IF NOT v_is_admin AND v_order.sales_id IS DISTINCT FROM v_actor.id THEN
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

  v_request_status := CASE WHEN v_is_admin THEN 'APPROVED' ELSE 'PENDING' END;
  v_order_status := CASE
    WHEN v_is_admin AND v_order.status IN ('DRAFT', 'SUBMITTED') THEN 'CONFIRMED'
    ELSE v_order.status
  END;

  UPDATE public.orders
  SET unpaid_shipping_status = v_request_status,
      unpaid_shipping_reason = left(v_reason, 500),
      unpaid_shipping_requested_by = v_actor.id,
      unpaid_shipping_requested_at = now(),
      unpaid_shipping_reviewed_by = CASE WHEN v_is_admin THEN v_actor.id ELSE NULL END,
      unpaid_shipping_reviewed_at = CASE WHEN v_is_admin THEN now() ELSE NULL END,
      unpaid_shipping_review_note = CASE WHEN v_is_admin THEN '管理员直接批准' ELSE '' END,
      status = v_order_status
  WHERE id = p_order_id;

  INSERT INTO public.order_logs(order_id, time, user_name, action)
  VALUES (
    p_order_id,
    to_char(now(), 'YYYY-MM-DD HH24:MI'),
    v_actor.name,
    CASE
      WHEN v_is_admin THEN '管理员直接批准未收款发货：' || left(v_reason, 200)
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
    'unpaid_shipping_reviewed_by', CASE WHEN v_is_admin THEN v_actor.id ELSE NULL END,
    'unpaid_shipping_reviewed_at', CASE WHEN v_is_admin THEN now() ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.review_unpaid_shipping(
  p_order_id INTEGER,
  p_admin_id INTEGER,
  p_approved BOOLEAN,
  p_note TEXT DEFAULT ''
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_review_status TEXT;
  v_order_status TEXT;
  v_note TEXT := trim(coalesce(p_note, ''));
BEGIN
  SELECT * INTO v_admin
  FROM public.zidu_require_actor(ARRAY['ADMIN']);

  IF p_admin_id IS DISTINCT FROM v_admin.id THEN
    RETURN json_build_object('error', '登录账号与审批人不匹配');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RETURN json_build_object('error', '订单不存在'); END IF;
  IF v_order.payment_status = 'PAID' THEN RETURN json_build_object('error', '该订单已收款，无需审核'); END IF;
  IF v_order.unpaid_shipping_status <> 'PENDING' THEN RETURN json_build_object('error', '该申请已处理或不存在'); END IF;
  IF NOT p_approved AND char_length(v_note) < 2 THEN RETURN json_build_object('error', '驳回时请填写原因'); END IF;

  v_review_status := CASE WHEN p_approved THEN 'APPROVED' ELSE 'REJECTED' END;
  v_order_status := CASE
    WHEN p_approved AND v_order.status IN ('DRAFT', 'SUBMITTED') THEN 'CONFIRMED'
    ELSE v_order.status
  END;

  UPDATE public.orders
  SET unpaid_shipping_status = v_review_status,
      unpaid_shipping_reviewed_by = v_admin.id,
      unpaid_shipping_reviewed_at = now(),
      unpaid_shipping_review_note = left(v_note, 500),
      status = v_order_status
  WHERE id = p_order_id;

  INSERT INTO public.order_logs(order_id, time, user_name, action)
  VALUES (
    p_order_id,
    to_char(now(), 'YYYY-MM-DD HH24:MI'),
    v_admin.name,
    CASE WHEN p_approved THEN '批准未收款发货' ELSE '驳回未收款发货：' || left(v_note, 200) END
  );

  RETURN json_build_object(
    'success', true,
    'status', v_order_status,
    'unpaid_shipping_status', v_review_status,
    'unpaid_shipping_reason', v_order.unpaid_shipping_reason,
    'unpaid_shipping_requested_by', v_order.unpaid_shipping_requested_by,
    'unpaid_shipping_requested_at', v_order.unpaid_shipping_requested_at,
    'unpaid_shipping_reviewed_by', v_admin.id,
    'unpaid_shipping_reviewed_at', now(),
    'unpaid_shipping_review_note', left(v_note, 500)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.request_unpaid_shipping(INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_unpaid_shipping(INTEGER, INTEGER, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_unpaid_shipping(INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_unpaid_shipping(INTEGER, INTEGER, BOOLEAN, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

SELECT
  position(
    'zidu_require_actor' IN pg_get_functiondef(
      'public.review_unpaid_shipping(integer,integer,boolean,text)'::regprocedure
    )
  ) > 0 AS secure_shipping_review_ready,
  NOT has_function_privilege(
    'anon', 'public.review_unpaid_shipping(integer,integer,boolean,text)', 'EXECUTE'
  ) AS anon_shipping_review_blocked,
  has_function_privilege(
    'authenticated', 'public.review_unpaid_shipping(integer,integer,boolean,text)', 'EXECUTE'
  ) AS authenticated_shipping_review_ready;
