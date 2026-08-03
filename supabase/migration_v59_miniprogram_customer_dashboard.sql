-- ============================================================
-- ZIDU v59: 微信商城客户、经营看板与仓库发货闭环
--
-- 1. 微信会员只用不可逆 member_key 与 Supabase 订单关联。
-- 2. 超级管理员可查看商城经营数据、客户和客户订单；销售只看本人归属业绩。
-- 3. 已支付微信商城订单统一进入 CONFIRMED，自动出现在仓库待发货队列。
-- 4. 仓库继续通过 v51 脱敏 RPC 读取，不获得售价、成本和客户经营数据。
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.miniprogram_members (
  id BIGSERIAL PRIMARY KEY,
  member_key TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ,
  attributed_sales_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  referral_code TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT miniprogram_members_key_format CHECK (member_key ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS miniprogram_members_phone_idx
  ON public.miniprogram_members(phone) WHERE phone <> '';
CREATE INDEX IF NOT EXISTS miniprogram_members_registered_idx
  ON public.miniprogram_members(registered_at DESC);
CREATE INDEX IF NOT EXISTS miniprogram_members_sales_idx
  ON public.miniprogram_members(attributed_sales_id) WHERE attributed_sales_id IS NOT NULL;

ALTER TABLE public.miniprogram_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.miniprogram_members FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.miniprogram_members TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.miniprogram_members_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.miniprogram_order_member_key(p_channel_meta JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
  SELECT coalesce(
    nullif(p_channel_meta->>'member_key', ''),
    CASE
      WHEN nullif(p_channel_meta->>'openid', '') IS NOT NULL
        THEN encode(digest('wechat_2c|' || (p_channel_meta->>'openid'), 'sha256'), 'hex')
      ELSE NULL
    END
  )
$$;

CREATE OR REPLACE FUNCTION public.miniprogram_mask_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN length(coalesce(p_phone, '')) >= 7
      THEN left(p_phone, 3) || '****' || right(p_phone, 4)
    ELSE coalesce(p_phone, '')
  END
$$;

REVOKE ALL ON FUNCTION public.miniprogram_order_member_key(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.miniprogram_mask_phone(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.miniprogram_order_member_key(JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.miniprogram_mask_phone(TEXT) TO service_role;

-- 旧回流订单补齐不可逆会员键，并删除 Supabase 中不再需要的原始 openid。
UPDATE public.orders
SET channel_meta = (coalesce(channel_meta, '{}'::JSONB) - 'openid')
  || jsonb_build_object('member_key', public.miniprogram_order_member_key(channel_meta))
WHERE source = 'wechat_2c'
  AND nullif(channel_meta->>'member_key', '') IS NULL
  AND nullif(channel_meta->>'openid', '') IS NOT NULL;

-- 运费保留给管理员核账，但改用 v51 仓库脱敏 RPC 已覆盖的字段名。
UPDATE public.orders
SET channel_meta = (coalesce(channel_meta, '{}'::JSONB) - 'freight')
  || jsonb_build_object('shippingFee', coalesce(channel_meta->'freight', '0'::JSONB))
WHERE source = 'wechat_2c' AND channel_meta ? 'freight';

CREATE INDEX IF NOT EXISTS orders_wechat_member_key_idx
  ON public.orders(public.miniprogram_order_member_key(channel_meta))
  WHERE source = 'wechat_2c';

-- mirrorOrder 旧版本曾把业务状态写成 PAID；支付状态已单独保存在 payment_status。
WITH moved AS (
  UPDATE public.orders
  SET status = 'CONFIRMED'
  WHERE source = 'wechat_2c'
    AND payment_status = 'PAID'
    AND status = 'PAID'
  RETURNING id
)
INSERT INTO public.order_logs(order_id, time, user_name, action)
SELECT id, to_char(now(), 'YYYY-MM-DD HH24:MI'), '系统', '微信商城已付款，进入仓库待发货'
FROM moved;

CREATE OR REPLACE FUNCTION public.get_miniprogram_sales_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_is_super BOOLEAN := false;
  v_accounts JSONB := '[]'::JSONB;
  v_summary JSONB := '{}'::JSONB;
  v_daily JSONB := '[]'::JSONB;
  v_top_products JSONB := '[]'::JSONB;
  v_customers JSONB := '[]'::JSONB;
  v_orders JSONB := '[]'::JSONB;
BEGIN
  SELECT * INTO v_actor
  FROM public.users
  WHERE id = public.zidu_current_user_id() AND status = 'active';

  IF v_actor.id IS NULL THEN
    RETURN jsonb_build_object('error', '账号未关联或已停用');
  END IF;

  v_is_super := v_actor.role = 'SUPER_ADMIN';
  IF NOT v_is_super AND NOT v_actor.referral_enabled THEN
    RETURN jsonb_build_object('error', '尚未开通小程序销售资格');
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id), '[]'::JSONB)
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
         AND o.created_at >= current_date - 29) AS paid_orders_30d,
      coalesce((SELECT sum(coalesce(nullif(o.paid_amount, 0), o.total))
       FROM public.orders o
       WHERE o.sales_id = u.id AND o.source = 'wechat_2c'
         AND o.payment_status = 'PAID'
         AND o.created_at >= current_date - 29), 0)::numeric(12,2) AS paid_revenue_30d
    FROM public.users u
    WHERE u.status = 'active' AND (v_is_super OR u.id = v_actor.id)
  ) a;

  SELECT jsonb_build_object(
    'paidRevenue30d', coalesce(sum(coalesce(nullif(o.paid_amount, 0), o.total))
      FILTER (WHERE o.created_at >= current_date - 29), 0)::numeric(12,2),
    'paidOrders30d', count(*) FILTER (WHERE o.created_at >= current_date - 29),
    'averageOrder30d', coalesce(avg(coalesce(nullif(o.paid_amount, 0), o.total))
      FILTER (WHERE o.created_at >= current_date - 29), 0)::numeric(12,2),
    'buyers30d', count(DISTINCT public.miniprogram_order_member_key(o.channel_meta))
      FILTER (WHERE o.created_at >= current_date - 29),
    'paidRevenueTotal', coalesce(sum(coalesce(nullif(o.paid_amount, 0), o.total)), 0)::numeric(12,2),
    'paidOrdersTotal', count(*),
    'pendingShipments', count(*) FILTER (WHERE o.status IN ('CONFIRMED', 'PREPARING')),
    'attributedRevenue30d', coalesce(sum(coalesce(nullif(o.paid_amount, 0), o.total))
      FILTER (WHERE o.created_at >= current_date - 29 AND o.sales_id IS NOT NULL), 0)::numeric(12,2),
    'unattributedRevenue30d', coalesce(sum(coalesce(nullif(o.paid_amount, 0), o.total))
      FILTER (WHERE o.created_at >= current_date - 29 AND o.sales_id IS NULL), 0)::numeric(12,2),
    'opens30d', (SELECT count(*) FROM public.sales_referral_events e
      WHERE e.event_type = 'OPEN'
        AND e.created_at >= now() - interval '30 days'
        AND (v_is_super OR e.sales_id = v_actor.id)),
    'totalMembers', CASE WHEN v_is_super
      THEN (SELECT count(*) FROM public.miniprogram_members)
      ELSE count(DISTINCT public.miniprogram_order_member_key(o.channel_meta))
    END,
    'newMembers30d', CASE WHEN v_is_super
      THEN (SELECT count(*) FROM public.miniprogram_members m WHERE m.registered_at >= now() - interval '30 days')
      ELSE count(DISTINCT public.miniprogram_order_member_key(o.channel_meta))
        FILTER (WHERE o.created_at >= current_date - 29)
    END,
    'repeatBuyers', (
      SELECT count(*) FROM (
        SELECT public.miniprogram_order_member_key(r.channel_meta) AS member_key
        FROM public.orders r
        WHERE r.source = 'wechat_2c' AND r.payment_status = 'PAID'
          AND (v_is_super OR r.sales_id = v_actor.id)
          AND public.miniprogram_order_member_key(r.channel_meta) IS NOT NULL
        GROUP BY public.miniprogram_order_member_key(r.channel_meta)
        HAVING count(*) >= 2
      ) repeat_rows
    )
  ) INTO v_summary
  FROM public.orders o
  WHERE o.source = 'wechat_2c'
    AND o.payment_status = 'PAID'
    AND (v_is_super OR o.sales_id = v_actor.id);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'date', days.day,
    'revenue', coalesce(stats.revenue, 0)::numeric(12,2),
    'orders', coalesce(stats.orders, 0)
  ) ORDER BY days.day), '[]'::JSONB)
  INTO v_daily
  FROM (
    SELECT generate_series(current_date - 29, current_date, interval '1 day')::date AS day
  ) days
  LEFT JOIN LATERAL (
    SELECT
      sum(coalesce(nullif(o.paid_amount, 0), o.total)) AS revenue,
      count(*) AS orders
    FROM public.orders o
    WHERE o.source = 'wechat_2c' AND o.payment_status = 'PAID'
      AND o.created_at = days.day
      AND (v_is_super OR o.sales_id = v_actor.id)
  ) stats ON true;

  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.revenue DESC), '[]'::JSONB)
  INTO v_top_products
  FROM (
    SELECT
      coalesce(nullif(oi.product_name, ''), '未命名商品') AS name,
      coalesce(oi.spec, '') AS spec,
      sum(oi.quantity)::integer AS quantity,
      sum(oi.subtotal)::numeric(12,2) AS revenue
    FROM public.order_items oi
    JOIN public.orders o ON o.id = oi.order_id
    WHERE o.source = 'wechat_2c' AND o.payment_status = 'PAID'
      AND o.created_at >= current_date - 29
      AND (v_is_super OR o.sales_id = v_actor.id)
    GROUP BY oi.product_name, oi.spec
    ORDER BY revenue DESC, quantity DESC
    LIMIT 8
  ) p;

  IF v_is_super THEN
    WITH identity_keys AS (
      SELECT member_key FROM public.miniprogram_members
      UNION
      SELECT public.miniprogram_order_member_key(o.channel_meta)
      FROM public.orders o
      WHERE o.source = 'wechat_2c'
        AND public.miniprogram_order_member_key(o.channel_meta) IS NOT NULL
    ), customer_rows AS (
      SELECT
        k.member_key,
        coalesce(nullif(m.nickname, ''), nullif(latest.address->>'name', ''), '紫都会员') AS nickname,
        public.miniprogram_mask_phone(coalesce(nullif(m.phone, ''), latest.address->>'phone', '')) AS phone_mask,
        coalesce(m.registered_at, stats.first_order_at::timestamp) AS registered_at,
        m.last_login_at,
        coalesce(stats.order_count, 0) AS order_count,
        coalesce(stats.total_paid, 0)::numeric(12,2) AS total_paid,
        stats.first_order_at,
        stats.last_order_at,
        coalesce(m.attributed_sales_id, latest.sales_id) AS sales_id,
        u.name AS sales_name,
        coalesce(nullif(m.referral_code, ''), latest.referral_code, '') AS referral_code,
        coalesce(latest.address->>'name', '') AS latest_recipient,
        coalesce(latest.address->>'region', '') AS latest_region,
        coalesce(latest.address->>'detail', '') AS latest_address
      FROM identity_keys k
      LEFT JOIN public.miniprogram_members m ON m.member_key = k.member_key
      LEFT JOIN LATERAL (
        SELECT
          count(*) AS order_count,
          sum(coalesce(nullif(o.paid_amount, 0), o.total)) AS total_paid,
          min(o.created_at) AS first_order_at,
          max(o.created_at) AS last_order_at
        FROM public.orders o
        WHERE o.source = 'wechat_2c' AND o.payment_status = 'PAID'
          AND public.miniprogram_order_member_key(o.channel_meta) = k.member_key
      ) stats ON true
      LEFT JOIN LATERAL (
        SELECT
          o.sales_id,
          coalesce(o.channel_meta->>'sales_referral_code', '') AS referral_code,
          coalesce(o.channel_meta->'address', '{}'::JSONB) AS address
        FROM public.orders o
        WHERE o.source = 'wechat_2c'
          AND public.miniprogram_order_member_key(o.channel_meta) = k.member_key
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT 1
      ) latest ON true
      LEFT JOIN public.users u ON u.id = coalesce(m.attributed_sales_id, latest.sales_id)
    )
    SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.last_order_at DESC NULLS LAST, c.registered_at DESC), '[]'::JSONB)
    INTO v_customers
    FROM customer_rows c;
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC, r.id DESC), '[]'::JSONB)
  INTO v_orders
  FROM (
    SELECT
      o.id,
      o.order_no,
      o.sales_id,
      u.name AS sales_name,
      public.miniprogram_order_member_key(o.channel_meta) AS member_key,
      coalesce(nullif(m.nickname, ''), nullif(o.channel_meta->'address'->>'name', ''), '紫都会员') AS customer_name,
      public.miniprogram_mask_phone(coalesce(nullif(m.phone, ''), o.channel_meta->'address'->>'phone', '')) AS phone_mask,
      coalesce(nullif(o.paid_amount, 0), o.total)::numeric(12,2) AS amount,
      o.payment_status,
      o.status,
      o.created_at,
      coalesce(o.channel_meta->'address'->>'name', '') AS recipient_name,
      coalesce(o.channel_meta->'address'->>'region', '') AS recipient_region,
      coalesce((SELECT sum(oi.quantity) FROM public.order_items oi WHERE oi.order_id = o.id), 0) AS item_count,
      coalesce((SELECT string_agg(oi.product_name || CASE WHEN coalesce(oi.spec, '') <> '' THEN ' ' || oi.spec ELSE '' END || '×' || oi.quantity, '，' ORDER BY oi.id)
        FROM public.order_items oi WHERE oi.order_id = o.id), '') AS item_summary,
      (SELECT sh.carrier FROM public.shipments sh WHERE sh.order_id = o.id ORDER BY sh.id DESC LIMIT 1) AS carrier,
      (SELECT sh.tracking_no FROM public.shipments sh WHERE sh.order_id = o.id ORDER BY sh.id DESC LIMIT 1) AS tracking_no
    FROM public.orders o
    LEFT JOIN public.users u ON u.id = o.sales_id
    LEFT JOIN public.miniprogram_members m
      ON m.member_key = public.miniprogram_order_member_key(o.channel_meta)
    WHERE o.source = 'wechat_2c' AND o.payment_status = 'PAID'
      AND (v_is_super OR o.sales_id = v_actor.id)
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT 200
  ) r;

  RETURN jsonb_build_object(
    'success', true,
    'schemaVersion', 59,
    'scope', CASE WHEN v_is_super THEN 'ALL' ELSE 'SELF' END,
    'currentUserId', v_actor.id,
    'summary', v_summary,
    'daily', v_daily,
    'topProducts', v_top_products,
    'customers', v_customers,
    'accounts', v_accounts,
    'orders', v_orders
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_miniprogram_sales_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_miniprogram_sales_dashboard() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_miniprogram_customer_orders(p_member_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_key TEXT := lower(trim(coalesce(p_member_key, '')));
  v_customer JSONB := '{}'::JSONB;
  v_orders JSONB := '[]'::JSONB;
BEGIN
  SELECT * INTO v_actor
  FROM public.users
  WHERE id = public.zidu_current_user_id() AND status = 'active';

  IF v_actor.id IS NULL OR v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN jsonb_build_object('error', '只有超级管理员可以查看商城客户详情');
  END IF;
  IF v_key !~ '^[a-f0-9]{64}$' THEN
    RETURN jsonb_build_object('error', '客户标识无效');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.miniprogram_members m WHERE m.member_key = v_key
    UNION ALL
    SELECT 1 FROM public.orders o
      WHERE o.source = 'wechat_2c'
        AND public.miniprogram_order_member_key(o.channel_meta) = v_key
  ) THEN
    RETURN jsonb_build_object('error', '客户不存在');
  END IF;

  SELECT jsonb_build_object(
    'member_key', v_key,
    'nickname', coalesce(nullif(m.nickname, ''), nullif(latest.address->>'name', ''), '紫都会员'),
    'phone', coalesce(nullif(m.phone, ''), latest.address->>'phone', ''),
    'registered_at', coalesce(m.registered_at, stats.first_order_at::timestamp),
    'last_login_at', m.last_login_at,
    'order_count', coalesce(stats.order_count, 0),
    'total_paid', coalesce(stats.total_paid, 0)::numeric(12,2),
    'first_order_at', stats.first_order_at,
    'last_order_at', stats.last_order_at,
    'sales_id', coalesce(m.attributed_sales_id, latest.sales_id),
    'sales_name', u.name,
    'referral_code', coalesce(nullif(m.referral_code, ''), latest.referral_code, ''),
    'recipient_name', coalesce(latest.address->>'name', ''),
    'recipient_phone', coalesce(latest.address->>'phone', ''),
    'recipient_region', coalesce(latest.address->>'region', ''),
    'recipient_address', coalesce(latest.address->>'detail', '')
  ) INTO v_customer
  FROM (SELECT 1) seed
  LEFT JOIN public.miniprogram_members m ON m.member_key = v_key
  LEFT JOIN LATERAL (
    SELECT
      count(*) AS order_count,
      sum(coalesce(nullif(o.paid_amount, 0), o.total)) AS total_paid,
      min(o.created_at) AS first_order_at,
      max(o.created_at) AS last_order_at
    FROM public.orders o
    WHERE o.source = 'wechat_2c' AND o.payment_status = 'PAID'
      AND public.miniprogram_order_member_key(o.channel_meta) = v_key
  ) stats ON true
  LEFT JOIN LATERAL (
    SELECT
      o.sales_id,
      coalesce(o.channel_meta->>'sales_referral_code', '') AS referral_code,
      coalesce(o.channel_meta->'address', '{}'::JSONB) AS address
    FROM public.orders o
    WHERE o.source = 'wechat_2c'
      AND public.miniprogram_order_member_key(o.channel_meta) = v_key
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT 1
  ) latest ON true
  LEFT JOIN public.users u ON u.id = coalesce(m.attributed_sales_id, latest.sales_id);

  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC, r.id DESC), '[]'::JSONB)
  INTO v_orders
  FROM (
    SELECT
      o.id,
      o.order_no,
      o.created_at,
      o.status,
      o.payment_status,
      coalesce(nullif(o.paid_amount, 0), o.total)::numeric(12,2) AS amount,
      o.sales_id,
      u.name AS sales_name,
      coalesce(o.channel_meta->'address'->>'name', '') AS recipient_name,
      coalesce(o.channel_meta->'address'->>'phone', '') AS recipient_phone,
      coalesce(o.channel_meta->'address'->>'region', '') AS recipient_region,
      coalesce(o.channel_meta->'address'->>'detail', '') AS recipient_address,
      coalesce((SELECT jsonb_agg(jsonb_build_object(
        'name', oi.product_name,
        'spec', oi.spec,
        'quantity', oi.quantity,
        'unitPrice', oi.unit_price,
        'subtotal', oi.subtotal
      ) ORDER BY oi.id) FROM public.order_items oi WHERE oi.order_id = o.id), '[]'::JSONB) AS items,
      (SELECT sh.carrier FROM public.shipments sh WHERE sh.order_id = o.id ORDER BY sh.id DESC LIMIT 1) AS carrier,
      (SELECT sh.tracking_no FROM public.shipments sh WHERE sh.order_id = o.id ORDER BY sh.id DESC LIMIT 1) AS tracking_no,
      (SELECT sh.shipped_at FROM public.shipments sh WHERE sh.order_id = o.id ORDER BY sh.id DESC LIMIT 1) AS shipped_at
    FROM public.orders o
    LEFT JOIN public.users u ON u.id = o.sales_id
    WHERE o.source = 'wechat_2c'
      AND public.miniprogram_order_member_key(o.channel_meta) = v_key
    ORDER BY o.created_at DESC, o.id DESC
  ) r;

  RETURN jsonb_build_object('success', true, 'customer', v_customer, 'orders', v_orders);
END;
$$;

REVOKE ALL ON FUNCTION public.get_miniprogram_customer_orders(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_miniprogram_customer_orders(TEXT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT
  to_regclass('public.miniprogram_members') IS NOT NULL AS members_ready,
  to_regprocedure('public.get_miniprogram_sales_dashboard()') IS NOT NULL AS dashboard_ready,
  to_regprocedure('public.get_miniprogram_customer_orders(text)') IS NOT NULL AS customer_orders_ready,
  count(*) FILTER (WHERE source = 'wechat_2c' AND payment_status = 'PAID' AND status IN ('CONFIRMED', 'PREPARING')) AS warehouse_ready_orders
FROM public.orders;
