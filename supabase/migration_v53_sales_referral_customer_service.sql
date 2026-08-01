-- ============================================================
-- ZIDU v53: 微信小程序销售推广归属 + 企业微信「微信客服」映射
--
-- 设计原则：
-- 1. 手机号只用于把小程序登录人与内部销售账号对应。
-- 2. 真正的客服权限仍在企业微信授予；后台只保存 userid 与客服链接映射。
-- 3. 小程序只拿 corpId + 客服链接，不拿手机号、userid、service_role 等内部信息。
-- 4. 推广归属按订单创建时固化的随机 referral_code，支付回流后写 sales_id。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS referral_code TEXT,
  ADD COLUMN IF NOT EXISTS referral_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_service_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wecom_userid TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS wecom_customer_service_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS customer_service_account_name TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_unique
  ON public.users ((upper(referral_code)))
  WHERE referral_code IS NOT NULL AND trim(referral_code) <> '';

CREATE TABLE IF NOT EXISTS public.sales_referral_events (
  id BIGSERIAL PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL CHECK (event_type IN ('OPEN', 'CONSULT', 'ORDER_PAID')),
  sales_id INTEGER NOT NULL REFERENCES public.users(id),
  referral_code TEXT NOT NULL DEFAULT '',
  visitor_key TEXT NOT NULL DEFAULT '',
  source_page TEXT NOT NULL DEFAULT '',
  order_no TEXT NOT NULL DEFAULT '',
  order_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sales_referral_events_sales_created_idx
  ON public.sales_referral_events(sales_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_referral_events_type_created_idx
  ON public.sales_referral_events(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS sales_referral_events_order_no_idx
  ON public.sales_referral_events(order_no)
  WHERE order_no <> '';

ALTER TABLE public.sales_referral_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sales_referral_events_read ON public.sales_referral_events;
CREATE POLICY sales_referral_events_read ON public.sales_referral_events
FOR SELECT TO authenticated USING (
  public.zidu_has_role(ARRAY['ADMIN','FINANCE'])
  OR (public.zidu_has_role(ARRAY['SALES']) AND sales_id = public.zidu_current_user_id())
);

-- 前端无权直接造访问/成交事件；只能由持 service_role 的云函数写入。
REVOKE INSERT, UPDATE, DELETE ON public.sales_referral_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sales_referral_events TO authenticated;

CREATE OR REPLACE VIEW public.users_safe AS
SELECT
  id, name, phone, role, status, created_at,
  referral_code, referral_enabled, customer_service_enabled,
  wecom_userid, wecom_customer_service_url, customer_service_account_name
FROM public.users;
ALTER VIEW public.users_safe SET (security_invoker = true);
GRANT SELECT ON public.users_safe TO authenticated;
GRANT SELECT (
  referral_code, referral_enabled, customer_service_enabled,
  wecom_userid, wecom_customer_service_url, customer_service_account_name
) ON public.users TO authenticated;

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
GRANT SELECT ON public.sales_referral_summary TO authenticated;

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
  SELECT * INTO v_target FROM public.users WHERE id = p_target_user_id FOR UPDATE;

  IF v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN jsonb_build_object('error', '只有超级管理员可以配置小程序销售');
  END IF;
  IF v_target.id IS NULL OR v_target.status = 'deleted' THEN
    RETURN jsonb_build_object('error', '账号不存在');
  END IF;
  IF p_customer_service_enabled AND NOT p_referral_enabled THEN
    RETURN jsonb_build_object('error', '请先开启推广归属，再开启对应销售客服');
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
    RETURN jsonb_build_object('error', '推广码已被其他销售使用');
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

COMMENT ON COLUMN public.users.wecom_userid IS
  '企业微信通讯录成员 userid；手机号登录不会自动获得微信客服权限';
COMMENT ON COLUMN public.users.wecom_customer_service_url IS
  '企业微信微信客服账号生成的 https://work.weixin.qq.com/kfid/... 链接';
COMMENT ON TABLE public.sales_referral_events IS
  '小程序推广打开、客服咨询、支付归属事件；不保存客户手机号或原始 openid';

NOTIFY pgrst, 'reload schema';

-- 运行后自检：应能看到所有销售账号，事件表初始为空属正常。
SELECT sales_id, sales_name, referral_code, referral_enabled, customer_service_enabled
FROM public.sales_referral_summary
ORDER BY sales_id;
