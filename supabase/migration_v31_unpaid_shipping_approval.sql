-- ============================================================
-- ZIDU v31: 未收款发货例外审批
--
-- 正常订单仍然必须收款后发货。特殊情况下：
-- 1. 订单所属销售填写原因并发起申请；
-- 2. 管理员批准或驳回；
-- 3. 只有已收款或已批准的订单才能进入已发货。
-- ============================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS unpaid_shipping_status TEXT NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS unpaid_shipping_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS unpaid_shipping_requested_by INTEGER,
  ADD COLUMN IF NOT EXISTS unpaid_shipping_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unpaid_shipping_reviewed_by INTEGER,
  ADD COLUMN IF NOT EXISTS unpaid_shipping_reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unpaid_shipping_review_note TEXT NOT NULL DEFAULT '';

UPDATE public.orders
SET unpaid_shipping_status = 'NONE'
WHERE unpaid_shipping_status IS NULL
   OR unpaid_shipping_status NOT IN ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_unpaid_shipping_status_check'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_unpaid_shipping_status_check
      CHECK (unpaid_shipping_status IN ('NONE', 'PENDING', 'APPROVED', 'REJECTED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_orders_unpaid_shipping_review
  ON public.orders(unpaid_shipping_status, created_at DESC)
  WHERE unpaid_shipping_status IN ('PENDING', 'APPROVED');

COMMENT ON COLUMN public.orders.unpaid_shipping_status IS '未收款发货审批：NONE/PENDING/APPROVED/REJECTED';
COMMENT ON COLUMN public.orders.unpaid_shipping_reason IS '销售申请未收款发货的原因';
COMMENT ON COLUMN public.orders.unpaid_shipping_review_note IS '管理员审核说明';

CREATE OR REPLACE FUNCTION public.request_unpaid_shipping(
  p_order_id INTEGER,
  p_sales_id INTEGER,
  p_reason TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_reason TEXT := trim(coalesce(p_reason, ''));
BEGIN
  SELECT * INTO v_user
  FROM public.users
  WHERE id = p_sales_id AND role = 'SALES' AND status = 'active';
  IF v_user.id IS NULL THEN RETURN json_build_object('error', '只有在职销售可发起申请'); END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RETURN json_build_object('error', '订单不存在'); END IF;
  IF v_order.sales_id IS DISTINCT FROM p_sales_id THEN RETURN json_build_object('error', '只能申请自己的订单'); END IF;
  IF EXISTS (
    SELECT 1 FROM public.customers
    WHERE id = v_order.customer_id AND type IN ('展会', '线下')
  ) THEN RETURN json_build_object('error', '现场交付订单无需申请发货'); END IF;
  IF v_order.payment_status = 'PAID' THEN RETURN json_build_object('error', '该订单已收款，无需申请'); END IF;
  IF v_order.status NOT IN ('DRAFT', 'SUBMITTED', 'CONFIRMED', 'PREPARING') THEN
    RETURN json_build_object('error', '当前订单状态不能申请未收款发货');
  END IF;
  IF v_order.unpaid_shipping_status = 'PENDING' THEN RETURN json_build_object('error', '申请正在等待管理员审核'); END IF;
  IF v_order.unpaid_shipping_status = 'APPROVED' THEN RETURN json_build_object('error', '该订单已批准未收款发货'); END IF;
  IF char_length(v_reason) < 2 THEN RETURN json_build_object('error', '请填写申请原因'); END IF;

  UPDATE public.orders
  SET unpaid_shipping_status = 'PENDING',
      unpaid_shipping_reason = left(v_reason, 500),
      unpaid_shipping_requested_by = p_sales_id,
      unpaid_shipping_requested_at = now(),
      unpaid_shipping_reviewed_by = NULL,
      unpaid_shipping_reviewed_at = NULL,
      unpaid_shipping_review_note = ''
  WHERE id = p_order_id;

  INSERT INTO public.order_logs(order_id, time, user_name, action)
  VALUES (p_order_id, to_char(now(), 'YYYY-MM-DD HH24:MI'), v_user.name, '申请未收款发货：' || left(v_reason, 200));

  RETURN json_build_object(
    'success', true,
    'unpaid_shipping_status', 'PENDING',
    'unpaid_shipping_reason', left(v_reason, 500),
    'unpaid_shipping_requested_by', p_sales_id,
    'unpaid_shipping_requested_at', now()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.review_unpaid_shipping(
  p_order_id INTEGER,
  p_admin_id INTEGER,
  p_approved BOOLEAN,
  p_note TEXT DEFAULT ''
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_order public.orders%ROWTYPE;
  v_review_status TEXT;
  v_order_status TEXT;
  v_note TEXT := trim(coalesce(p_note, ''));
BEGIN
  SELECT * INTO v_admin
  FROM public.users
  WHERE id = p_admin_id AND role = 'ADMIN' AND status = 'active';
  IF v_admin.id IS NULL THEN RETURN json_build_object('error', '只有管理员可审核'); END IF;

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
      unpaid_shipping_reviewed_by = p_admin_id,
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
    'unpaid_shipping_reviewed_by', p_admin_id,
    'unpaid_shipping_reviewed_at', now(),
    'unpaid_shipping_review_note', left(v_note, 500)
  );
END;
$$;

-- 最后一层数据库保护：未收款且未批准时，禁止转为已发货。
CREATE OR REPLACE FUNCTION public.guard_unpaid_shipping_transition()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'SHIPPED'
     AND OLD.status IS DISTINCT FROM 'SHIPPED'
     AND coalesce(NEW.payment_status, 'UNPAID') <> 'PAID'
     AND coalesce(NEW.unpaid_shipping_status, 'NONE') <> 'APPROVED' THEN
    RAISE EXCEPTION '未收款订单需管理员批准后才能发货';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_unpaid_shipping_transition ON public.orders;
CREATE TRIGGER trg_guard_unpaid_shipping_transition
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_unpaid_shipping_transition();

-- 审批字段只能由上面的 SECURITY DEFINER 函数修改，防止客户端直接写成 APPROVED。
CREATE OR REPLACE FUNCTION public.guard_unpaid_shipping_approval_fields()
RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF coalesce(NEW.unpaid_shipping_status, 'NONE') <> 'NONE'
         OR coalesce(NEW.unpaid_shipping_reason, '') <> ''
         OR NEW.unpaid_shipping_requested_by IS NOT NULL
         OR NEW.unpaid_shipping_requested_at IS NOT NULL
         OR NEW.unpaid_shipping_reviewed_by IS NOT NULL
         OR NEW.unpaid_shipping_reviewed_at IS NOT NULL
         OR coalesce(NEW.unpaid_shipping_review_note, '') <> '' THEN
        RAISE EXCEPTION '未收款发货审批字段不允许直接写入';
      END IF;
    ELSIF NEW.unpaid_shipping_status IS DISTINCT FROM OLD.unpaid_shipping_status
       OR NEW.unpaid_shipping_reason IS DISTINCT FROM OLD.unpaid_shipping_reason
       OR NEW.unpaid_shipping_requested_by IS DISTINCT FROM OLD.unpaid_shipping_requested_by
       OR NEW.unpaid_shipping_requested_at IS DISTINCT FROM OLD.unpaid_shipping_requested_at
       OR NEW.unpaid_shipping_reviewed_by IS DISTINCT FROM OLD.unpaid_shipping_reviewed_by
       OR NEW.unpaid_shipping_reviewed_at IS DISTINCT FROM OLD.unpaid_shipping_reviewed_at
       OR NEW.unpaid_shipping_review_note IS DISTINCT FROM OLD.unpaid_shipping_review_note THEN
      RAISE EXCEPTION '请通过未收款发货申请/审核功能操作';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_unpaid_shipping_approval_fields ON public.orders;
CREATE TRIGGER trg_guard_unpaid_shipping_approval_fields
BEFORE INSERT OR UPDATE OF unpaid_shipping_status, unpaid_shipping_reason,
  unpaid_shipping_requested_by, unpaid_shipping_requested_at,
  unpaid_shipping_reviewed_by, unpaid_shipping_reviewed_at,
  unpaid_shipping_review_note
ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.guard_unpaid_shipping_approval_fields();

GRANT EXECUTE ON FUNCTION public.request_unpaid_shipping(INTEGER, INTEGER, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_unpaid_shipping(INTEGER, INTEGER, BOOLEAN, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT
  count(*) FILTER (WHERE column_name LIKE 'unpaid_shipping_%') = 7 AS approval_columns_ready,
  to_regprocedure('public.request_unpaid_shipping(integer,integer,text)') IS NOT NULL AS request_function_ready,
  to_regprocedure('public.review_unpaid_shipping(integer,integer,boolean,text)') IS NOT NULL AS review_function_ready,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.orders'::regclass
      AND tgname = 'trg_guard_unpaid_shipping_transition'
      AND NOT tgisinternal
  ) AS shipping_guard_ready,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.orders'::regclass
      AND tgname = 'trg_guard_unpaid_shipping_approval_fields'
      AND NOT tgisinternal
  ) AS approval_field_guard_ready
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'orders';
