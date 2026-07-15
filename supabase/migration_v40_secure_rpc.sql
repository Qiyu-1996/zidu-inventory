-- ============================================================
-- ZIDU v40: 使用 auth.uid() 加固所有敏感 RPC
--
-- 执行条件：
-- 1. 已运行 migration_v39_auth_foundation.sql。
-- 2. 已部署 auth-bootstrap Edge Function。
-- 3. 网页和小程序已更新为 Supabase Auth 登录。
--
-- 本迁移会停止 anon 调用敏感 RPC，但尚不删除业务表的旧宽松 RLS。
-- ============================================================

CREATE OR REPLACE FUNCTION public.zidu_require_actor(p_roles TEXT[])
RETURNS public.users
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor
  FROM public.users
  WHERE auth_user_id = (SELECT auth.uid())
    AND status = 'active'
  LIMIT 1;
  IF v_actor.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = '登录已失效或账号未关联';
  END IF;
  IF NOT (v_actor.role = ANY(p_roles)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = '当前账号没有执行此操作的权限';
  END IF;
  RETURN v_actor;
END;
$$;

REVOKE ALL ON FUNCTION public.zidu_require_actor(TEXT[]) FROM PUBLIC, anon, authenticated;

-- 首次运行时把原业务函数改成仅内部调用的实现；重复运行不会再次改名。
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('public.zidu_create_order_atomic(jsonb)', 'public.zidu_create_order_atomic_impl(jsonb)', 'zidu_create_order_atomic_impl'),
    ('public.zidu_cancel_order(integer,text,text)', 'public.zidu_cancel_order_impl(integer,text,text)', 'zidu_cancel_order_impl'),
    ('public.zidu_update_order_status_atomic(integer,text,jsonb,jsonb)', 'public.zidu_update_order_status_atomic_impl(integer,text,jsonb,jsonb)', 'zidu_update_order_status_atomic_impl'),
    ('public.zidu_record_payment_atomic(integer,numeric,text,text,text,numeric)', 'public.zidu_record_payment_atomic_impl(integer,numeric,text,text,text,numeric)', 'zidu_record_payment_atomic_impl'),
    ('public.zidu_update_order_items_atomic(integer,jsonb,jsonb,jsonb)', 'public.zidu_update_order_items_atomic_impl(integer,jsonb,jsonb,jsonb)', 'zidu_update_order_items_atomic_impl'),
    ('public.zidu_create_after_sale_atomic(integer,jsonb)', 'public.zidu_create_after_sale_atomic_impl(integer,jsonb)', 'zidu_create_after_sale_atomic_impl'),
    ('public.zidu_process_after_sale_warehouse_atomic(integer,jsonb)', 'public.zidu_process_after_sale_warehouse_atomic_impl(integer,jsonb)', 'zidu_process_after_sale_warehouse_atomic_impl'),
    ('public.zidu_complete_after_sale_finance_atomic(integer,jsonb)', 'public.zidu_complete_after_sale_finance_atomic_impl(integer,jsonb)', 'zidu_complete_after_sale_finance_atomic_impl'),
    ('public.zidu_cancel_after_sale(integer,text,text)', 'public.zidu_cancel_after_sale_impl(integer,text,text)', 'zidu_cancel_after_sale_impl'),
    ('public.zidu_delete_order_atomic(integer,boolean,text)', 'public.zidu_delete_order_atomic_impl(integer,boolean,text)', 'zidu_delete_order_atomic_impl'),
    ('public.request_unpaid_shipping(integer,integer,text)', 'public.request_unpaid_shipping_impl(integer,integer,text)', 'request_unpaid_shipping_impl'),
    ('public.review_unpaid_shipping(integer,integer,boolean,text)', 'public.review_unpaid_shipping_impl(integer,integer,boolean,text)', 'review_unpaid_shipping_impl'),
    ('public.zidu_adjust_raw_inventory(integer,text,numeric,text,text,text,numeric,numeric)', 'public.zidu_adjust_raw_inventory_impl(integer,text,numeric,text,text,text,numeric,numeric)', 'zidu_adjust_raw_inventory_impl'),
    ('public.zidu_adjust_inventory_from_batch(integer,integer,numeric,text,text,text)', 'public.zidu_adjust_inventory_from_batch_impl(integer,integer,numeric,text,text,text)', 'zidu_adjust_inventory_from_batch_impl'),
    ('public.zidu_delete_inventory_batch(integer,text)', 'public.zidu_delete_inventory_batch_impl(integer,text)', 'zidu_delete_inventory_batch_impl'),
    ('public.zidu_create_inventory_batch(text,integer,integer,numeric,text,date,date,numeric,text,text,text,numeric,numeric)', 'public.zidu_create_inventory_batch_impl(text,integer,integer,numeric,text,date,date,numeric,text,text,text,numeric,numeric)', 'zidu_create_inventory_batch_impl'),
    ('public.zidu_receive_purchase_order(integer,jsonb,text)', 'public.zidu_receive_purchase_order_impl(integer,jsonb,text)', 'zidu_receive_purchase_order_impl'),
    ('public.zidu_create_purchase_order_v2(text,text,text,text,jsonb,date)', 'public.zidu_create_purchase_order_v2_impl(text,text,text,text,jsonb,date)', 'zidu_create_purchase_order_v2_impl'),
    ('public.zidu_update_purchase_order_v2(integer,text,text,jsonb,date)', 'public.zidu_update_purchase_order_v2_impl(integer,text,text,jsonb,date)', 'zidu_update_purchase_order_v2_impl'),
    ('public.zidu_delete_purchase_order(integer,text)', 'public.zidu_delete_purchase_order_impl(integer,text)', 'zidu_delete_purchase_order_impl'),
    ('public.zidu_restore_deleted_purchase_order(integer,text)', 'public.zidu_restore_deleted_purchase_order_impl(integer,text)', 'zidu_restore_deleted_purchase_order_impl'),
    ('public.zidu_permanently_delete_purchase_order(integer)', 'public.zidu_permanently_delete_purchase_order_impl(integer)', 'zidu_permanently_delete_purchase_order_impl'),
    ('public.zidu_purge_expired_deleted_purchase_orders()', 'public.zidu_purge_expired_deleted_purchase_orders_impl()', 'zidu_purge_expired_deleted_purchase_orders_impl'),
    ('public.zidu_update_purchase_order_status(integer,text,text)', 'public.zidu_update_purchase_order_status_impl(integer,text,text)', 'zidu_update_purchase_order_status_impl'),
    ('public.zidu_close_purchase_order(integer,text,text)', 'public.zidu_close_purchase_order_impl(integer,text,text)', 'zidu_close_purchase_order_impl'),
    ('public.zidu_reverse_purchase_receipt(integer,text,text)', 'public.zidu_reverse_purchase_receipt_impl(integer,text,text)', 'zidu_reverse_purchase_receipt_impl'),
    ('public.backfill_spec_cost_from_batches()', 'public.backfill_spec_cost_from_batches_impl()', 'backfill_spec_cost_from_batches_impl')
  ) AS x(original_signature, impl_signature, impl_name)
  LOOP
    IF to_regprocedure(r.original_signature) IS NOT NULL
       AND to_regprocedure(r.impl_signature) IS NULL THEN
      EXECUTE format('ALTER FUNCTION %s RENAME TO %I', to_regprocedure(r.original_signature), r.impl_name);
    END IF;
  END LOOP;
END $$;

-- ── 账号管理 ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_user(
  p_name TEXT, p_phone TEXT, p_password TEXT, p_role TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_auth_phone TEXT;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  IF trim(coalesce(p_name, '')) = '' THEN RETURN json_build_object('error', '请填写姓名'); END IF;
  IF length(coalesce(p_password, '')) < 8 THEN RETURN json_build_object('error', '密码至少需要8位'); END IF;
  IF p_role NOT IN ('ADMIN', 'SALES', 'WAREHOUSE', 'FINANCE') THEN RETURN json_build_object('error', '无效角色'); END IF;
  v_auth_phone := public.zidu_normalize_auth_phone(p_phone);
  INSERT INTO public.users(name, phone, auth_phone, password_hash, role, status)
  VALUES (trim(p_name), trim(p_phone), v_auth_phone, crypt(p_password, gen_salt('bf')), p_role, 'active')
  RETURNING * INTO v_user;
  RETURN json_build_object('id', v_user.id, 'name', v_user.name, 'phone', v_user.phone, 'role', v_user.role, 'status', v_user.status);
EXCEPTION WHEN unique_violation THEN
  RETURN json_build_object('error', '该手机号已注册');
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reset_password(
  p_admin_id INTEGER, p_target_user_id INTEGER, p_new_password TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  IF length(coalesce(p_new_password, '')) < 8 THEN RETURN json_build_object('error', '密码至少需要8位'); END IF;
  UPDATE public.users
  SET password_hash = crypt(p_new_password, gen_salt('bf')),
      auth_user_id = NULL
  WHERE id = p_target_user_id AND status <> 'deleted';
  IF NOT FOUND THEN RETURN json_build_object('error', '账号不存在'); END IF;
  RETURN json_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_user_status(
  p_admin_id INTEGER, p_target_user_id INTEGER, p_new_status TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  IF v_actor.id = p_target_user_id THEN RETURN json_build_object('error', '不能禁用自己'); END IF;
  IF p_new_status NOT IN ('active', 'disabled') THEN RETURN json_build_object('error', '无效状态'); END IF;
  UPDATE public.users SET status = p_new_status WHERE id = p_target_user_id AND status <> 'deleted';
  IF NOT FOUND THEN RETURN json_build_object('error', '账号不存在'); END IF;
  RETURN json_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_user_role(
  p_admin_id INTEGER, p_target_user_id INTEGER, p_new_role TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_admins INTEGER;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  IF p_new_role NOT IN ('ADMIN', 'SALES', 'WAREHOUSE', 'FINANCE') THEN RETURN json_build_object('error', '无效角色'); END IF;
  SELECT * INTO v_target FROM public.users WHERE id = p_target_user_id FOR UPDATE;
  IF v_target.id IS NULL OR v_target.status = 'deleted' THEN RETURN json_build_object('error', '账号不存在'); END IF;
  IF v_actor.id = v_target.id AND p_new_role <> 'ADMIN' THEN RETURN json_build_object('error', '不能修改自己的管理员角色'); END IF;
  IF v_target.role = 'ADMIN' AND p_new_role <> 'ADMIN' THEN
    SELECT count(*) INTO v_admins FROM public.users WHERE role = 'ADMIN' AND status = 'active';
    IF v_admins <= 1 THEN RETURN json_build_object('error', '系统至少需要保留一名管理员'); END IF;
  END IF;
  UPDATE public.users SET role = p_new_role WHERE id = p_target_user_id;
  RETURN json_build_object('success', true, 'role', p_new_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_archive_user(
  p_admin_id INTEGER, p_target_user_id INTEGER
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_admins INTEGER;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  IF v_actor.id = p_target_user_id THEN RETURN json_build_object('error', '不能删除自己的账号'); END IF;
  SELECT * INTO v_target FROM public.users WHERE id = p_target_user_id FOR UPDATE;
  IF v_target.id IS NULL OR v_target.status = 'deleted' THEN RETURN json_build_object('error', '账号不存在或已删除'); END IF;
  IF v_target.role = 'ADMIN' THEN
    SELECT count(*) INTO v_admins FROM public.users WHERE role = 'ADMIN' AND status = 'active';
    IF v_admins <= 1 THEN RETURN json_build_object('error', '系统至少需要保留一名管理员'); END IF;
  END IF;
  UPDATE public.users SET archived_phone = phone,
    phone = 'DELETED-' || id::TEXT || '-' || floor(extract(epoch FROM clock_timestamp()))::BIGINT::TEXT,
    auth_phone = NULL, password_hash = crypt(gen_random_uuid()::TEXT, gen_salt('bf')),
    status = 'deleted', archived_at = now(), archived_by = v_actor.id
  WHERE id = p_target_user_id;
  RETURN json_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.login(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.change_password(INTEGER, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_user(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_reset_password(INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.toggle_user_status(INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_user_role(INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_archive_user(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_user(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_password(INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_user_status(INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role(INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_archive_user(INTEGER, INTEGER) TO authenticated;

-- ── 订单与财务 ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.zidu_create_order_atomic(p_order JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_payload JSONB := coalesce(p_order, '{}'::JSONB);
  v_customer_id INTEGER;
  v_discount NUMERIC;
  v_allowed_discount NUMERIC;
  v_dealer_level INTEGER := 0;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','SALES']);
  v_customer_id := nullif(v_payload->>'customerId', '')::INTEGER;
  IF v_actor.role = 'SALES' THEN
    IF v_customer_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.customers WHERE id = v_customer_id AND sales_id = v_actor.id
    ) THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = '只能为自己负责的客户下单'; END IF;
    v_payload := jsonb_set(v_payload, '{salesId}', to_jsonb(v_actor.id), true);
    v_discount := coalesce(nullif(v_payload->>'discountPercent', '')::NUMERIC, 0);
    IF v_discount < 0 OR v_discount > 100 THEN RAISE EXCEPTION '折扣比例无效'; END IF;
    SELECT coalesce(distributor_level, 0) INTO v_dealer_level FROM public.customers WHERE id = v_customer_id;
    v_dealer_level := coalesce(v_dealer_level, 0);
    SELECT coalesce(nullif(value, '')::NUMERIC, 20) INTO v_allowed_discount
    FROM public.app_settings WHERE key = 'max_discount_percent' ORDER BY id DESC LIMIT 1;
    v_allowed_discount := coalesce(v_allowed_discount, 20);
    IF NOT ((v_dealer_level = 1 AND abs(v_discount - 50) < 0.001)
      OR (v_dealer_level = 2 AND abs(v_discount - 35) < 0.001)
      OR (v_dealer_level NOT IN (1,2) AND v_discount <= v_allowed_discount)) THEN
      RAISE EXCEPTION '折扣超过销售权限';
    END IF;
  END IF;
  v_payload := jsonb_set(
    v_payload,
    '{channelMeta}',
    coalesce(v_payload->'channelMeta', '{}'::JSONB) || jsonb_build_object(
      'enteredBy', jsonb_build_object(
        'id', v_actor.id, 'name', v_actor.name, 'role', v_actor.role
      )
    ),
    true
  );
  RETURN public.zidu_create_order_atomic_impl(v_payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_cancel_order(p_order_id INTEGER, p_operator_name TEXT DEFAULT '', p_time TEXT DEFAULT '')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','SALES']);
  IF v_actor.role = 'SALES' AND NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND sales_id = v_actor.id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = '只能取消自己的订单';
  END IF;
  RETURN public.zidu_cancel_order_impl(p_order_id, v_actor.name, p_time);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_update_order_status_atomic(
  p_order_id INTEGER, p_new_status TEXT, p_log JSONB DEFAULT '{}'::JSONB, p_shipment JSONB DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_log JSONB := coalesce(p_log, '{}'::JSONB);
  v_shipment JSONB := p_shipment;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','SALES','WAREHOUSE']);
  IF v_actor.role = 'SALES' THEN
    IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND sales_id = v_actor.id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = '只能操作自己的订单';
    END IF;
    IF p_new_status NOT IN ('SHIPPED','DELIVERED','COMPLETED') THEN RAISE EXCEPTION '销售不能执行该状态操作'; END IF;
  ELSIF v_actor.role = 'WAREHOUSE' AND p_new_status NOT IN ('PREPARING','SHIPPED') THEN
    RAISE EXCEPTION '仓库只能执行备货和发货';
  END IF;
  v_log := jsonb_set(v_log, '{user}', to_jsonb(v_actor.name), true);
  IF v_shipment IS NOT NULL THEN v_shipment := jsonb_set(v_shipment, '{operator}', to_jsonb(v_actor.name), true); END IF;
  RETURN public.zidu_update_order_status_atomic_impl(p_order_id, p_new_status, v_log, v_shipment);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_record_payment_atomic(
  p_order_id INTEGER, p_amount NUMERIC, p_method TEXT, p_note TEXT DEFAULT '',
  p_recorded_by TEXT DEFAULT '', p_price_adjustment NUMERIC DEFAULT 0
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','SALES','FINANCE']);
  IF v_actor.role = 'SALES' AND NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND sales_id = v_actor.id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = '只能为自己的订单记录收款';
  END IF;
  IF v_actor.role = 'SALES' AND coalesce(p_price_adjustment, 0) <> 0 THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = '价格调整需要管理员或财务处理';
  END IF;
  RETURN public.zidu_record_payment_atomic_impl(p_order_id, p_amount, p_method, p_note, v_actor.name, p_price_adjustment);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_update_order_items_atomic(
  p_order_id INTEGER, p_changes JSONB, p_totals JSONB, p_log JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE; v_log JSONB := coalesce(p_log, '{}'::JSONB);
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  v_log := jsonb_set(v_log, '{user}', to_jsonb(v_actor.name), true);
  RETURN public.zidu_update_order_items_atomic_impl(p_order_id, p_changes, p_totals, v_log);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_create_after_sale_atomic(p_order_id INTEGER, p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE; v_payload JSONB := coalesce(p_payload, '{}'::JSONB);
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','SALES']);
  IF v_actor.role = 'SALES' AND NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND sales_id = v_actor.id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = '只能为自己的订单发起售后';
  END IF;
  v_payload := jsonb_set(v_payload, '{createdBy}', to_jsonb(v_actor.name), true);
  RETURN public.zidu_create_after_sale_atomic_impl(p_order_id, v_payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_process_after_sale_warehouse_atomic(p_after_sale_id INTEGER, p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE; v_payload JSONB := coalesce(p_payload, '{}'::JSONB);
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','WAREHOUSE']);
  v_payload := jsonb_set(v_payload, '{operatorName}', to_jsonb(v_actor.name), true);
  RETURN public.zidu_process_after_sale_warehouse_atomic_impl(p_after_sale_id, v_payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_complete_after_sale_finance_atomic(p_after_sale_id INTEGER, p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE; v_payload JSONB := coalesce(p_payload, '{}'::JSONB);
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','FINANCE']);
  v_payload := jsonb_set(v_payload, '{operatorName}', to_jsonb(v_actor.name), true);
  RETURN public.zidu_complete_after_sale_finance_atomic_impl(p_after_sale_id, v_payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_cancel_after_sale(p_after_sale_id INTEGER, p_operator_name TEXT DEFAULT '', p_note TEXT DEFAULT '')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  RETURN public.zidu_cancel_after_sale_impl(p_after_sale_id, v_actor.name, p_note);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_delete_order_atomic(p_order_id INTEGER, p_restore_stock BOOLEAN DEFAULT true, p_deleted_by TEXT DEFAULT '')
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  RETURN public.zidu_delete_order_atomic_impl(p_order_id, p_restore_stock, v_actor.name);
END;
$$;

CREATE OR REPLACE FUNCTION public.request_unpaid_shipping(p_order_id INTEGER, p_sales_id INTEGER, p_reason TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','SALES']);
  IF v_actor.role = 'SALES' AND NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order_id AND sales_id = v_actor.id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = '只能申请自己的订单';
  END IF;
  RETURN public.request_unpaid_shipping_impl(p_order_id, v_actor.id, p_reason);
END;
$$;

CREATE OR REPLACE FUNCTION public.review_unpaid_shipping(p_order_id INTEGER, p_admin_id INTEGER, p_approved BOOLEAN, p_note TEXT DEFAULT '')
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  RETURN public.review_unpaid_shipping_impl(p_order_id, v_actor.id, p_approved, p_note);
END;
$$;

-- ── 库存与采购 ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.zidu_adjust_inventory_authorized(
  p_spec_id INTEGER, p_type TEXT, p_quantity NUMERIC, p_quantity_unit TEXT DEFAULT 'SPEC'
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','WAREHOUSE']);
  RETURN public.zidu_adjust_inventory(p_spec_id, p_type, p_quantity, p_quantity_unit);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_adjust_raw_inventory(
  p_product_id INTEGER, p_type TEXT, p_quantity_kg NUMERIC, p_reason TEXT DEFAULT 'OTHER',
  p_note TEXT DEFAULT '', p_operator_name TEXT DEFAULT '', p_density_g_ml NUMERIC DEFAULT NULL,
  p_density_temperature_c NUMERIC DEFAULT 20
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','WAREHOUSE']);
  RETURN public.zidu_adjust_raw_inventory_impl(p_product_id, p_type, p_quantity_kg, p_reason, p_note, v_actor.name, p_density_g_ml, p_density_temperature_c);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_adjust_inventory_from_batch(
  p_spec_id INTEGER, p_batch_id INTEGER, p_quantity NUMERIC, p_reason TEXT DEFAULT 'OTHER',
  p_note TEXT DEFAULT '', p_operator_name TEXT DEFAULT ''
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','WAREHOUSE']);
  RETURN public.zidu_adjust_inventory_from_batch_impl(p_spec_id, p_batch_id, p_quantity, p_reason, p_note, v_actor.name);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_delete_inventory_batch(p_batch_id INTEGER, p_operator_name TEXT DEFAULT '')
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','WAREHOUSE']);
  RETURN public.zidu_delete_inventory_batch_impl(p_batch_id, v_actor.name);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_create_inventory_batch(
  p_batch_no TEXT, p_product_id INTEGER, p_spec_id INTEGER, p_quantity NUMERIC,
  p_gcms_no TEXT DEFAULT NULL, p_received_date DATE DEFAULT CURRENT_DATE,
  p_expiry_date DATE DEFAULT NULL, p_unit_cost NUMERIC DEFAULT 0, p_supplier TEXT DEFAULT '',
  p_note TEXT DEFAULT '', p_operator_name TEXT DEFAULT '', p_density_g_ml NUMERIC DEFAULT NULL,
  p_density_temperature_c NUMERIC DEFAULT 20
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','WAREHOUSE']);
  RETURN public.zidu_create_inventory_batch_impl(p_batch_no, p_product_id, p_spec_id, p_quantity,
    p_gcms_no, p_received_date, p_expiry_date, p_unit_cost, p_supplier, p_note, v_actor.name,
    p_density_g_ml, p_density_temperature_c);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_receive_purchase_order(p_po_id INTEGER, p_items JSONB, p_operator_name TEXT DEFAULT '')
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','WAREHOUSE']);
  RETURN public.zidu_receive_purchase_order_impl(p_po_id, p_items, v_actor.name);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_create_purchase_order_v2(
  p_po_no TEXT, p_supplier TEXT, p_notes TEXT, p_created_by_name TEXT, p_items JSONB, p_expected_date DATE DEFAULT NULL
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','WAREHOUSE']);
  RETURN public.zidu_create_purchase_order_v2_impl(p_po_no, p_supplier, p_notes, v_actor.name, p_items, p_expected_date);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_update_purchase_order_v2(
  p_po_id INTEGER, p_supplier TEXT, p_notes TEXT, p_items JSONB, p_expected_date DATE DEFAULT NULL
) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','WAREHOUSE']);
  RETURN public.zidu_update_purchase_order_v2_impl(p_po_id, p_supplier, p_notes, p_items, p_expected_date);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_delete_purchase_order(p_po_id INTEGER, p_operator_name TEXT)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','WAREHOUSE']);
  RETURN public.zidu_delete_purchase_order_impl(p_po_id, v_actor.name); END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_restore_deleted_purchase_order(p_po_id INTEGER, p_operator_name TEXT DEFAULT '')
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  RETURN public.zidu_restore_deleted_purchase_order_impl(p_po_id, v_actor.name); END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_permanently_delete_purchase_order(p_po_id INTEGER)
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  RETURN public.zidu_permanently_delete_purchase_order_impl(p_po_id); END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_purge_expired_deleted_purchase_orders()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  RETURN public.zidu_purge_expired_deleted_purchase_orders_impl(); END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_update_purchase_order_status(p_po_id INTEGER, p_new_status TEXT, p_operator_name TEXT DEFAULT '')
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','WAREHOUSE']);
  RETURN public.zidu_update_purchase_order_status_impl(p_po_id, p_new_status, v_actor.name); END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_close_purchase_order(p_po_id INTEGER, p_operator_name TEXT DEFAULT '', p_note TEXT DEFAULT '')
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','WAREHOUSE']);
  RETURN public.zidu_close_purchase_order_impl(p_po_id, v_actor.name, p_note); END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_reverse_purchase_receipt(p_batch_id INTEGER, p_operator_name TEXT DEFAULT '', p_note TEXT DEFAULT '')
RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','WAREHOUSE']);
  RETURN public.zidu_reverse_purchase_receipt_impl(p_batch_id, v_actor.name, p_note); END;
$$;

CREATE OR REPLACE FUNCTION public.backfill_spec_cost_from_batches()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  RETURN public.backfill_spec_cost_from_batches_impl(); END;
$$;

-- 内部库存函数不能被客户端直接调用；业务函数以所有者身份仍可调用。
REVOKE ALL ON FUNCTION public.zidu_adjust_inventory(INTEGER, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zidu_fifo_consume_batches(INTEGER, INTEGER, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE '%\_impl' ESCAPE '\'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.fn);
  END LOOP;
END $$;

-- PostgreSQL 新函数默认会给 PUBLIC 执行权；先彻底收回，再只授权给 authenticated。
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT to_regprocedure(signature) AS fn FROM (VALUES
    ('public.zidu_create_order_atomic(jsonb)'),
    ('public.zidu_cancel_order(integer,text,text)'),
    ('public.zidu_update_order_status_atomic(integer,text,jsonb,jsonb)'),
    ('public.zidu_record_payment_atomic(integer,numeric,text,text,text,numeric)'),
    ('public.zidu_update_order_items_atomic(integer,jsonb,jsonb,jsonb)'),
    ('public.zidu_create_after_sale_atomic(integer,jsonb)'),
    ('public.zidu_process_after_sale_warehouse_atomic(integer,jsonb)'),
    ('public.zidu_complete_after_sale_finance_atomic(integer,jsonb)'),
    ('public.zidu_cancel_after_sale(integer,text,text)'),
    ('public.zidu_delete_order_atomic(integer,boolean,text)'),
    ('public.request_unpaid_shipping(integer,integer,text)'),
    ('public.review_unpaid_shipping(integer,integer,boolean,text)'),
    ('public.zidu_adjust_inventory_authorized(integer,text,numeric,text)'),
    ('public.zidu_adjust_raw_inventory(integer,text,numeric,text,text,text,numeric,numeric)'),
    ('public.zidu_adjust_inventory_from_batch(integer,integer,numeric,text,text,text)'),
    ('public.zidu_delete_inventory_batch(integer,text)'),
    ('public.zidu_create_inventory_batch(text,integer,integer,numeric,text,date,date,numeric,text,text,text,numeric,numeric)'),
    ('public.zidu_receive_purchase_order(integer,jsonb,text)'),
    ('public.zidu_create_purchase_order_v2(text,text,text,text,jsonb,date)'),
    ('public.zidu_update_purchase_order_v2(integer,text,text,jsonb,date)'),
    ('public.zidu_delete_purchase_order(integer,text)'),
    ('public.zidu_restore_deleted_purchase_order(integer,text)'),
    ('public.zidu_permanently_delete_purchase_order(integer)'),
    ('public.zidu_purge_expired_deleted_purchase_orders()'),
    ('public.zidu_update_purchase_order_status(integer,text,text)'),
    ('public.zidu_close_purchase_order(integer,text,text)'),
    ('public.zidu_reverse_purchase_receipt(integer,text,text)'),
    ('public.backfill_spec_cost_from_batches()')
  ) AS x(signature)
  LOOP
    IF r.fn IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.fn);
    END IF;
  END LOOP;
END $$;

-- 只把经过身份校验的入口开放给 authenticated。
GRANT EXECUTE ON FUNCTION public.zidu_create_order_atomic(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_cancel_order(INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_update_order_status_atomic(INTEGER, TEXT, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_record_payment_atomic(INTEGER, NUMERIC, TEXT, TEXT, TEXT, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_update_order_items_atomic(INTEGER, JSONB, JSONB, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_create_after_sale_atomic(INTEGER, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_process_after_sale_warehouse_atomic(INTEGER, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_complete_after_sale_finance_atomic(INTEGER, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_cancel_after_sale(INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_delete_order_atomic(INTEGER, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_unpaid_shipping(INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_unpaid_shipping(INTEGER, INTEGER, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_adjust_inventory_authorized(INTEGER, TEXT, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_adjust_raw_inventory(INTEGER, TEXT, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_adjust_inventory_from_batch(INTEGER, INTEGER, NUMERIC, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_delete_inventory_batch(INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_create_inventory_batch(TEXT, INTEGER, INTEGER, NUMERIC, TEXT, DATE, DATE, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_receive_purchase_order(INTEGER, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_create_purchase_order_v2(TEXT, TEXT, TEXT, TEXT, JSONB, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_update_purchase_order_v2(INTEGER, TEXT, TEXT, JSONB, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_delete_purchase_order(INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_restore_deleted_purchase_order(INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_permanently_delete_purchase_order(INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_purge_expired_deleted_purchase_orders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_update_purchase_order_status(INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_close_purchase_order(INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_reverse_purchase_receipt(INTEGER, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_spec_cost_from_batches() TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT
  to_regprocedure('public.zidu_create_order_atomic(jsonb)') IS NOT NULL AS order_secure_entry,
  to_regprocedure('public.zidu_create_order_atomic_impl(jsonb)') IS NOT NULL AS order_internal_impl,
  to_regprocedure('public.zidu_adjust_inventory_authorized(integer,text,numeric,text)') IS NOT NULL AS inventory_secure_entry,
  has_function_privilege('anon', 'public.zidu_create_order_atomic(jsonb)', 'EXECUTE') AS anon_order_execute,
  has_function_privilege('authenticated', 'public.zidu_create_order_atomic(jsonb)', 'EXECUTE') AS authenticated_order_execute;
