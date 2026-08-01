-- ============================================================
-- ZIDU v58: 小程序销售能力、个人业绩与提成后台
--
-- 1. 岗位角色与小程序销售资格解耦，任何在职账号都可被开通。
-- 2. 只有超级管理员可以配置资格、推广码与提成比例。
-- 3. 超级管理员看全员；其他已开通账号只能看自己的数据。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS miniprogram_commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_miniprogram_commission_rate_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_miniprogram_commission_rate_check
  CHECK (miniprogram_commission_rate >= 0 AND miniprogram_commission_rate <= 100);

CREATE OR REPLACE VIEW public.users_safe AS
SELECT
  id, name, phone, role, status, created_at
FROM public.users;
ALTER VIEW public.users_safe SET (security_invoker = true);
GRANT SELECT ON public.users_safe TO authenticated;
REVOKE SELECT (
  referral_code, referral_enabled, customer_service_enabled,
  wecom_userid, wecom_customer_service_url, customer_service_account_name
) ON public.users FROM authenticated;

CREATE OR REPLACE FUNCTION public.zidu_current_profile()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT jsonb_build_object(
        'id', id,
        'name', name,
        'phone', phone,
        'role', role,
        'status', status,
        'referralCode', coalesce(referral_code, ''),
        'referralEnabled', referral_enabled,
        'miniprogramCommissionRate', miniprogram_commission_rate
      )
      FROM public.users
      WHERE auth_user_id = (SELECT auth.uid())
        AND status = 'active'
      LIMIT 1
    ),
    jsonb_build_object('error', '账号未关联或已停用')
  )
$$;

REVOKE ALL ON FUNCTION public.zidu_current_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.zidu_current_profile() TO authenticated;

CREATE OR REPLACE VIEW public.sales_referral_summary AS
SELECT
  u.id AS sales_id,
  u.name AS sales_name,
  u.phone,
  u.status,
  u.referral_code,
  u.referral_enabled,
  u.customer_service_enabled,
  u.wecom_userid,
  u.customer_service_account_name,
  count(*) FILTER (
    WHERE e.event_type = 'OPEN' AND e.created_at >= now() - interval '30 days'
  ) AS opens_30d,
  count(*) FILTER (
    WHERE e.event_type = 'CONSULT' AND e.created_at >= now() - interval '30 days'
  ) AS consults_30d,
  count(*) FILTER (
    WHERE e.event_type = 'ORDER_PAID' AND e.created_at >= now() - interval '30 days'
  ) AS paid_orders_30d,
  coalesce(sum(e.order_amount) FILTER (
    WHERE e.event_type = 'ORDER_PAID' AND e.created_at >= now() - interval '30 days'
  ), 0)::numeric(12,2) AS paid_revenue_30d,
  max(e.created_at) AS last_event_at
FROM public.users u
LEFT JOIN public.sales_referral_events e ON e.sales_id = u.id
WHERE u.referral_enabled AND u.status <> 'deleted'
GROUP BY
  u.id, u.name, u.phone, u.status, u.referral_code, u.referral_enabled,
  u.customer_service_enabled, u.wecom_userid, u.customer_service_account_name;

ALTER VIEW public.sales_referral_summary SET (security_invoker = true);
REVOKE SELECT ON public.sales_referral_summary FROM authenticated;
GRANT SELECT ON public.sales_referral_summary TO service_role;

CREATE OR REPLACE FUNCTION public.superadmin_update_miniprogram_sales(
  p_target_user_id INTEGER,
  p_referral_enabled BOOLEAN,
  p_commission_rate NUMERIC DEFAULT 0,
  p_referral_code TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_code TEXT := upper(trim(coalesce(p_referral_code, '')));
  v_rate NUMERIC := coalesce(p_commission_rate, 0);
BEGIN
  SELECT * INTO v_actor FROM public.users
  WHERE id = public.zidu_current_user_id() AND status = 'active';

  IF v_actor.id IS NULL OR v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN jsonb_build_object('error', '只有超级管理员可以配置小程序销售');
  END IF;

  SELECT * INTO v_target FROM public.users
  WHERE id = p_target_user_id AND status <> 'deleted' FOR UPDATE;
  IF v_target.id IS NULL THEN
    RETURN jsonb_build_object('error', '账号不存在');
  END IF;
  IF v_rate < 0 OR v_rate > 100 THEN
    RETURN jsonb_build_object('error', '提成比例必须在 0 到 100 之间');
  END IF;

  IF v_code = '' THEN
    v_code := upper(trim(coalesce(v_target.referral_code, '')));
  END IF;
  IF p_referral_enabled AND v_code = '' THEN
    LOOP
      v_code := 'ZD-' || upper(encode(gen_random_bytes(5), 'hex'));
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.users WHERE upper(referral_code) = v_code AND id <> p_target_user_id
      );
    END LOOP;
  END IF;
  IF v_code <> '' AND v_code !~ '^[A-Z0-9-]{6,32}$' THEN
    RETURN jsonb_build_object('error', '推广码只能使用 6-32 位大写字母、数字或短横线');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.users WHERE upper(referral_code) = v_code AND id <> p_target_user_id
  ) THEN
    RETURN jsonb_build_object('error', '推广码已被其他账号使用');
  END IF;

  UPDATE public.users
  SET referral_code = nullif(v_code, ''),
      referral_enabled = coalesce(p_referral_enabled, false),
      miniprogram_commission_rate = v_rate
  WHERE id = p_target_user_id
  RETURNING * INTO v_target;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_target.id,
    'name', v_target.name,
    'referralCode', coalesce(v_target.referral_code, ''),
    'referralEnabled', v_target.referral_enabled,
    'commissionRate', v_target.miniprogram_commission_rate
  );
END;
$$;

REVOKE ALL ON FUNCTION public.superadmin_update_miniprogram_sales(
  INTEGER, BOOLEAN, NUMERIC, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_update_miniprogram_sales(
  INTEGER, BOOLEAN, NUMERIC, TEXT
) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_miniprogram_sales_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_is_super BOOLEAN := false;
  v_accounts JSONB := '[]'::jsonb;
  v_orders JSONB := '[]'::jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.users
  WHERE id = public.zidu_current_user_id() AND status = 'active';
  IF v_actor.id IS NULL THEN
    RETURN jsonb_build_object('error', '账号未关联或已停用');
  END IF;

  v_is_super := v_actor.role = 'SUPER_ADMIN';
  IF NOT v_is_super AND NOT v_actor.referral_enabled THEN
    RETURN jsonb_build_object('error', '尚未开通小程序销售资格');
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id), '[]'::jsonb)
  INTO v_accounts
  FROM (
    SELECT
      u.id,
      u.name,
      u.phone,
      u.role,
      u.status,
      coalesce(u.referral_code, '') AS referral_code,
      u.referral_enabled,
      u.miniprogram_commission_rate,
      (SELECT count(*) FROM public.sales_referral_events e
       WHERE e.sales_id = u.id AND e.event_type = 'OPEN'
         AND e.created_at >= now() - interval '30 days') AS opens_30d,
      (SELECT count(*) FROM public.orders o
       WHERE o.sales_id = u.id AND o.source = 'wechat_2c'
         AND o.payment_status = 'PAID'
         AND o.created_at >= now() - interval '30 days') AS paid_orders_30d,
      coalesce((SELECT sum(coalesce(nullif(o.paid_amount, 0), o.total))
       FROM public.orders o
       WHERE o.sales_id = u.id AND o.source = 'wechat_2c'
         AND o.payment_status = 'PAID'
         AND o.created_at >= now() - interval '30 days'), 0)::numeric(12,2) AS paid_revenue_30d
    FROM public.users u
    WHERE u.status = 'active' AND (v_is_super OR u.id = v_actor.id)
  ) a;

  SELECT coalesce(jsonb_agg(to_jsonb(o) ORDER BY o.created_at DESC), '[]'::jsonb)
  INTO v_orders
  FROM (
    SELECT
      ord.id,
      ord.order_no,
      ord.sales_id,
      usr.name AS sales_name,
      coalesce(nullif(ord.paid_amount, 0), ord.total)::numeric(12,2) AS amount,
      ord.payment_status,
      ord.status,
      ord.created_at
    FROM public.orders ord
    LEFT JOIN public.users usr ON usr.id = ord.sales_id
    WHERE ord.source = 'wechat_2c'
      AND ord.payment_status = 'PAID'
      AND (v_is_super OR ord.sales_id = v_actor.id)
    ORDER BY ord.created_at DESC
    LIMIT 100
  ) o;

  RETURN jsonb_build_object(
    'success', true,
    'scope', CASE WHEN v_is_super THEN 'ALL' ELSE 'SELF' END,
    'currentUserId', v_actor.id,
    'accounts', v_accounts,
    'orders', v_orders
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_miniprogram_sales_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_miniprogram_sales_dashboard() TO authenticated;

-- 旧入口也收紧为超级管理员配置，但保留企业微信客服字段的兼容能力。
CREATE OR REPLACE FUNCTION public.admin_update_sales_channel(
  p_target_user_id INTEGER,
  p_referral_enabled BOOLEAN,
  p_customer_service_enabled BOOLEAN,
  p_referral_code TEXT DEFAULT '',
  p_wecom_userid TEXT DEFAULT '',
  p_customer_service_url TEXT DEFAULT '',
  p_customer_service_account_name TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_code TEXT := upper(trim(coalesce(p_referral_code, '')));
  v_userid TEXT := trim(coalesce(p_wecom_userid, ''));
  v_url TEXT := trim(coalesce(p_customer_service_url, ''));
  v_account_name TEXT := trim(coalesce(p_customer_service_account_name, ''));
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  IF v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN jsonb_build_object('error', '只有超级管理员可以配置小程序销售');
  END IF;

  SELECT * INTO v_target FROM public.users WHERE id = p_target_user_id FOR UPDATE;
  IF v_target.id IS NULL OR v_target.status = 'deleted' THEN
    RETURN jsonb_build_object('error', '账号不存在');
  END IF;
  IF p_customer_service_enabled AND NOT p_referral_enabled THEN
    RETURN jsonb_build_object('error', '请先开启推广归属，再开启对应销售客服');
  END IF;

  IF v_code = '' THEN
    v_code := upper(trim(coalesce(v_target.referral_code, '')));
  END IF;
  IF p_referral_enabled AND v_code = '' THEN
    LOOP
      v_code := 'ZD-' || upper(encode(gen_random_bytes(5), 'hex'));
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.users WHERE upper(referral_code) = v_code AND id <> p_target_user_id
      );
    END LOOP;
  END IF;
  IF v_code <> '' AND v_code !~ '^[A-Z0-9-]{6,32}$' THEN
    RETURN jsonb_build_object('error', '推广码只能使用 6-32 位大写字母、数字或短横线');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.users WHERE upper(referral_code) = v_code AND id <> p_target_user_id
  ) THEN
    RETURN jsonb_build_object('error', '推广码已被其他账号使用');
  END IF;

  IF length(v_userid) > 128 OR length(v_url) > 500 OR length(v_account_name) > 80 THEN
    RETURN jsonb_build_object('error', '微信客服配置内容过长');
  END IF;
  IF p_customer_service_enabled AND v_userid = '' THEN
    RETURN jsonb_build_object('error', '请填写企业微信成员 userid');
  END IF;
  IF p_customer_service_enabled AND v_url !~ '^https://work\.weixin\.qq\.com/kfid/' THEN
    RETURN jsonb_build_object('error', '请粘贴企业微信「微信客服」生成的 kfid 链接');
  END IF;

  UPDATE public.users
  SET referral_code = nullif(v_code, ''),
      referral_enabled = coalesce(p_referral_enabled, false),
      customer_service_enabled = coalesce(p_customer_service_enabled, false),
      wecom_userid = v_userid,
      wecom_customer_service_url = v_url,
      customer_service_account_name = v_account_name
  WHERE id = p_target_user_id
  RETURNING * INTO v_target;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_target.id,
    'referralCode', coalesce(v_target.referral_code, ''),
    'referralEnabled', v_target.referral_enabled,
    'customerServiceEnabled', v_target.customer_service_enabled,
    'wecomUserid', v_target.wecom_userid,
    'customerServiceUrl', v_target.wecom_customer_service_url,
    'customerServiceAccountName', v_target.customer_service_account_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_sales_channel(
  INTEGER, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_sales_channel(
  INTEGER, BOOLEAN, BOOLEAN, TEXT, TEXT, TEXT, TEXT
) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT public.get_miniprogram_sales_dashboard();
