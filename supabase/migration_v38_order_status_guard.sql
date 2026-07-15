-- ZIDU v38: 订单状态流转与发货资料保护。
-- 依赖：migration_v31、v33、v34。
-- 可重复运行；不修改任何已有订单、库存或财务数据。

SET lock_timeout = '30s';

-- 所有网页和小程序都必须通过原子函数更新订单状态，避免客户端直接改表绕过日志。
CREATE OR REPLACE FUNCTION public.zidu_guard_direct_order_status_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status
     AND current_user IN ('anon', 'authenticated') THEN
    RAISE EXCEPTION '请通过订单状态功能操作';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zidu_guard_direct_order_status_update ON public.orders;
CREATE TRIGGER trg_zidu_guard_direct_order_status_update
BEFORE UPDATE OF status ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.zidu_guard_direct_order_status_update();

-- 状态、日志与物流在同一事务提交，并校验完整业务路径。
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
  v_customer_type TEXT := '';
  v_same_status BOOLEAN;
BEGIN
  IF p_new_status = 'CANCELLED' THEN RAISE EXCEPTION '取消订单请使用专用取消功能'; END IF;
  IF p_new_status NOT IN ('DRAFT', 'SUBMITTED', 'CONFIRMED', 'PREPARING', 'SHIPPED', 'DELIVERED', 'COMPLETED') THEN
    RAISE EXCEPTION '订单状态无效';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN RAISE EXCEPTION '订单不存在'; END IF;
  IF v_order.status = 'CANCELLED' THEN RAISE EXCEPTION '已取消订单不能更改状态'; END IF;
  v_same_status := v_order.status = p_new_status;

  IF NOT v_same_status THEN
    IF NOT (
      (v_order.status = 'DRAFT' AND p_new_status IN ('SUBMITTED', 'CONFIRMED', 'COMPLETED'))
      OR (v_order.status = 'SUBMITTED' AND p_new_status IN ('CONFIRMED', 'COMPLETED'))
      OR (v_order.status = 'CONFIRMED' AND p_new_status IN ('PREPARING', 'SHIPPED'))
      OR (v_order.status = 'PREPARING' AND p_new_status = 'SHIPPED')
      OR (v_order.status = 'SHIPPED' AND p_new_status IN ('DELIVERED', 'COMPLETED'))
      OR (v_order.status = 'DELIVERED' AND p_new_status = 'COMPLETED')
    ) THEN
      RAISE EXCEPTION '订单状态不能从 % 变更为 %', v_order.status, p_new_status;
    END IF;

    IF p_new_status = 'CONFIRMED'
       AND coalesce(v_order.payment_status, 'UNPAID') <> 'PAID'
       AND coalesce(v_order.unpaid_shipping_status, 'NONE') <> 'APPROVED' THEN
      RAISE EXCEPTION '订单未收款且未获管理员批准，不能确认';
    END IF;

    IF p_new_status = 'COMPLETED' AND v_order.status IN ('DRAFT', 'SUBMITTED') THEN
      SELECT coalesce(type, '') INTO v_customer_type
      FROM public.customers WHERE id = v_order.customer_id;
      IF coalesce(v_order.payment_status, 'UNPAID') <> 'PAID'
         OR v_customer_type NOT IN ('展会', '线下') THEN
        RAISE EXCEPTION '只有已收款的现场交付订单可直接完成';
      END IF;
    END IF;
  END IF;

  IF p_new_status = 'SHIPPED' AND NOT v_same_status THEN
    IF coalesce(v_order.payment_status, 'UNPAID') <> 'PAID'
       AND coalesce(v_order.unpaid_shipping_status, 'NONE') <> 'APPROVED' THEN
      RAISE EXCEPTION '未收款订单需管理员批准后才能发货';
    END IF;
    IF p_shipment IS NULL OR jsonb_typeof(p_shipment) <> 'object'
       OR coalesce(trim(p_shipment->>'carrier'), '') = ''
       OR coalesce(trim(p_shipment->>'trackingNo'), '') = '' THEN
      RAISE EXCEPTION '发货必须填写快递公司和快递单号';
    END IF;
  ELSIF p_shipment IS NOT NULL THEN
    RAISE EXCEPTION '只有发货操作可以写入物流信息';
  END IF;

  UPDATE public.orders SET status = p_new_status WHERE id = p_order_id;

  IF coalesce(trim(p_log->>'action'), '') <> '' THEN
    INSERT INTO public.order_logs(order_id, time, user_name, action)
    VALUES (
      p_order_id,
      coalesce(nullif(p_log->>'time', ''), to_char(now(), 'YYYY-MM-DD HH24:MI')),
      coalesce(p_log->>'user', ''), p_log->>'action'
    );
  END IF;

  IF p_new_status = 'SHIPPED' AND NOT v_same_status THEN
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

REVOKE ALL ON FUNCTION public.zidu_update_order_status_atomic(INTEGER, TEXT, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.zidu_update_order_status_atomic(INTEGER, TEXT, JSONB, JSONB) TO anon, authenticated;

SELECT
  to_regprocedure('public.zidu_update_order_status_atomic(integer,text,jsonb,jsonb)') IS NOT NULL AS status_guard_ready,
  EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.orders'::regclass
      AND tgname = 'trg_zidu_guard_direct_order_status_update'
      AND NOT tgisinternal
  ) AS direct_update_guard_ready;
