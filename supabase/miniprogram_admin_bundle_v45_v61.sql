-- ZIDU 小程序经营后台完整升级包（v45 + v59 + v60 + v61）
-- 执行方式：在 Supabase SQL Editor 中打开本文件并运行一次。
-- 可安全重复执行；包含商品基础目录、客户看板、SKU 合并、分类、上下架和图片上传。

-- ZIDU 2C official essential-oil catalog, 2026-07.
-- Supabase is the management source; CloudBase receives a published read-only snapshot.
BEGIN;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS extraction_method TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS on_sale_2c BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS oil_id TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cat_2c TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS copy_2c TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS gallery JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.product_specs ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE public.product_specs ADD COLUMN IF NOT EXISTS on_sale_2c BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_specs_sku_key') THEN
    ALTER TABLE public.product_specs ADD CONSTRAINT product_specs_sku_key UNIQUE (sku);
  END IF;
END $$;

WITH catalog(code, name, origin, extraction_method, oil_id) AS (
VALUES
  ('ZDEO-01', '甜橙', '巴西', '冷压', 'orange'),
  ('ZDEO-02', '蓝胶尤加利', '中国', '蒸馏', 'eucalyptus'),
  ('ZDEO-03', '柠檬', '南美', '冷压', 'lemon'),
  ('ZDEO-04', '柠檬草', '印度', '蒸馏', 'lemongrass'),
  ('ZDEO-05', '白兰叶', '中国 广西', '蒸馏', 'magnolia_leaf'),
  ('ZDEO-06', '桉油醇迷迭香', '中国', '蒸馏', 'rosemary'),
  ('ZDEO-07', '真正薰衣草', '中国 新疆', '蒸馏', 'lavender'),
  ('ZDEO-08', '山苍子', '中国 云南', '蒸馏', 'maychang'),
  ('ZDEO-09', '茶树', '中国', '蒸馏', 'teatree'),
  ('ZDEO-10', '澳洲茶树', '澳大利亚', '蒸馏', 'teatree_au'),
  ('ZDEO-11', '喜马拉雅雪松', '尼泊尔', '蒸馏', 'cedar'),
  ('ZDEO-12', '快乐鼠尾草', '中国', '蒸馏', 'clarysage'),
  ('ZDEO-13', '欧薄荷', '中国', '蒸馏', 'peppermint'),
  ('ZDEO-14', '冬青', '中国', '蒸馏', 'wintergreen'),
  ('ZDEO-15', '罗文莎叶', '马达加斯加', '蒸馏', 'ravintsara'),
  ('ZDEO-16', '甜罗勒', '印度', '蒸馏', 'basil'),
  ('ZDEO-17', '粉葡萄柚', '南非', '冷压', 'grapefruit'),
  ('ZDEO-18', '小黄姜', '中国 云南', '超临界', 'ginger'),
  ('ZDEO-19', '广藿香', '印尼', '蒸馏', 'patchouli'),
  ('ZDEO-20', '小青柑', '中国 广东', '蒸馏', 'greentangerine'),
  ('ZDEO-21', '佛手柑', '意大利', '冷压', 'bergamot'),
  ('ZDEO-22', '杜松', '奥地利', '蒸馏', 'juniper'),
  ('ZDEO-23', '玫瑰天竺葵', '埃及', '蒸馏', 'geranium_r'),
  ('ZDEO-24', '波旁天竺葵', '法国 留尼汪岛', '蒸馏', 'geranium_b'),
  ('ZDEO-25', '北艾草', '尼泊尔', '蒸馏', 'mugwort'),
  ('ZDEO-26', '罗马洋甘菊', '中国', '蒸馏', 'chamomile'),
  ('ZDEO-27', '完全依兰', '马达加斯加', '蒸馏', 'ylang'),
  ('ZDEO-28', '索马里乳香', '索马里', '蒸馏', 'frankincense_c'),
  ('ZDEO-29', '没药', '索马里', '蒸馏', 'myrrh'),
  ('ZDEO-30', '阿曼绿乳香', '阿曼', '蒸馏', 'frankincense'),
  ('ZDEO-31', '海地岩兰草', '海地', '蒸馏', 'vetiver'),
  ('ZDEO-32', '白兰花', '中国', '蒸馏', 'magnolia_flower'),
  ('ZDEO-33', '苦橙花', '中国', '蒸馏', 'neroli'),
  ('ZDEO-34', '德国蓝甘菊', '中国新疆', '蒸馏', 'gchamomile'),
  ('ZDEO-35', '澳洲檀香', '澳洲', '超临界', 'sandalwood'),
  ('ZDEO-36', '墨红玫瑰（待定）', '中国', '溶剂', 'darkrose'),
  ('ZDEO-37', '意大利永久花', '科西嘉', '蒸馏', 'helichrysum'),
  ('ZDEO-38', '小花茉莉', '中国', '溶剂', 'jasmine'),
  ('ZDEO-39', '大马士革玫瑰', '中国', '蒸馏', 'rose'),
  ('ZDEO-40', '东印度檀香', '印度', '蒸馏', 'sandalwood_in')
)
INSERT INTO public.products (code, name, series, origin, extraction_method, oil_id, cat_2c, on_sale_2c, channel)
SELECT code, name, '单方精油系列', origin, extraction_method, oil_id, '单方精油', TRUE, 'BOTH'
FROM catalog
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  series = EXCLUDED.series,
  origin = EXCLUDED.origin,
  extraction_method = EXCLUDED.extraction_method,
  oil_id = EXCLUDED.oil_id,
  cat_2c = EXCLUDED.cat_2c,
  on_sale_2c = TRUE;

WITH official(sku, code, spec, price) AS (
VALUES
  ('ZDEO-01-5ML', 'ZDEO-01', '5ml', 32),
  ('ZDEO-01-15ML', 'ZDEO-01', '15ml', 56),
  ('ZDEO-02-5ML', 'ZDEO-02', '5ml', 42),
  ('ZDEO-02-15ML', 'ZDEO-02', '15ml', 76),
  ('ZDEO-03-5ML', 'ZDEO-03', '5ml', 32),
  ('ZDEO-03-15ML', 'ZDEO-03', '15ml', 58.8),
  ('ZDEO-04-5ML', 'ZDEO-04', '5ml', 32),
  ('ZDEO-04-15ML', 'ZDEO-04', '15ml', 58.8),
  ('ZDEO-05-5ML', 'ZDEO-05', '5ml', 52),
  ('ZDEO-05-15ML', 'ZDEO-05', '15ml', 98),
  ('ZDEO-06-5ML', 'ZDEO-06', '5ml', 54),
  ('ZDEO-06-15ML', 'ZDEO-06', '15ml', 87),
  ('ZDEO-07-5ML', 'ZDEO-07', '5ml', 39),
  ('ZDEO-07-15ML', 'ZDEO-07', '15ml', 66.8),
  ('ZDEO-08-5ML', 'ZDEO-08', '5ml', 42),
  ('ZDEO-08-15ML', 'ZDEO-08', '15ml', 82),
  ('ZDEO-09-5ML', 'ZDEO-09', '5ml', 39),
  ('ZDEO-09-15ML', 'ZDEO-09', '15ml', 76),
  ('ZDEO-10-5ML', 'ZDEO-10', '5ml', 48),
  ('ZDEO-10-15ML', 'ZDEO-10', '15ml', 85),
  ('ZDEO-11-5ML', 'ZDEO-11', '5ml', 42),
  ('ZDEO-11-15ML', 'ZDEO-11', '15ml', 85),
  ('ZDEO-12-5ML', 'ZDEO-12', '5ml', 56),
  ('ZDEO-12-15ML', 'ZDEO-12', '15ml', 115),
  ('ZDEO-13-5ML', 'ZDEO-13', '5ml', 45),
  ('ZDEO-13-15ML', 'ZDEO-13', '15ml', 82),
  ('ZDEO-14-5ML', 'ZDEO-14', '5ml', 49),
  ('ZDEO-14-15ML', 'ZDEO-14', '15ml', 88),
  ('ZDEO-15-5ML', 'ZDEO-15', '5ml', 55),
  ('ZDEO-15-15ML', 'ZDEO-15', '15ml', 97),
  ('ZDEO-16-5ML', 'ZDEO-16', '5ml', 62),
  ('ZDEO-16-15ML', 'ZDEO-16', '15ml', 109),
  ('ZDEO-17-5ML', 'ZDEO-17', '5ml', 46),
  ('ZDEO-17-15ML', 'ZDEO-17', '15ml', 92),
  ('ZDEO-18-5ML', 'ZDEO-18', '5ml', 56),
  ('ZDEO-18-15ML', 'ZDEO-18', '15ml', 129),
  ('ZDEO-19-5ML', 'ZDEO-19', '5ml', 56),
  ('ZDEO-19-15ML', 'ZDEO-19', '15ml', 108),
  ('ZDEO-20-5ML', 'ZDEO-20', '5ml', 68),
  ('ZDEO-20-15ML', 'ZDEO-20', '15ml', 115),
  ('ZDEO-21-5ML', 'ZDEO-21', '5ml', 56),
  ('ZDEO-21-15ML', 'ZDEO-21', '15ml', 118),
  ('ZDEO-22-5ML', 'ZDEO-22', '5ml', 57),
  ('ZDEO-22-15ML', 'ZDEO-22', '15ml', 105),
  ('ZDEO-23-5ML', 'ZDEO-23', '5ml', 62),
  ('ZDEO-23-15ML', 'ZDEO-23', '15ml', 135),
  ('ZDEO-24-5ML', 'ZDEO-24', '5ml', 85),
  ('ZDEO-24-15ML', 'ZDEO-24', '15ml', 156),
  ('ZDEO-25-5ML', 'ZDEO-25', '5ml', 86),
  ('ZDEO-25-15ML', 'ZDEO-25', '15ml', 165),
  ('ZDEO-26-5ML', 'ZDEO-26', '5ml', 228),
  ('ZDEO-26-15ML', 'ZDEO-26', '15ml', 485),
  ('ZDEO-27-5ML', 'ZDEO-27', '5ml', 145),
  ('ZDEO-27-15ML', 'ZDEO-27', '15ml', 282),
  ('ZDEO-28-5ML', 'ZDEO-28', '5ml', 135),
  ('ZDEO-28-15ML', 'ZDEO-28', '15ml', 282),
  ('ZDEO-29-5ML', 'ZDEO-29', '5ml', 135),
  ('ZDEO-29-15ML', 'ZDEO-29', '15ml', 283),
  ('ZDEO-30-5ML', 'ZDEO-30', '5ml', 149),
  ('ZDEO-30-15ML', 'ZDEO-30', '15ml', 296),
  ('ZDEO-31-2ML', 'ZDEO-31', '2ml', 65),
  ('ZDEO-31-5ML', 'ZDEO-31', '5ml', 129),
  ('ZDEO-32-2ML', 'ZDEO-32', '2ml', 95),
  ('ZDEO-32-5ML', 'ZDEO-32', '5ml', 168),
  ('ZDEO-33-2ML', 'ZDEO-33', '2ml', 125),
  ('ZDEO-33-5ML', 'ZDEO-33', '5ml', 228),
  ('ZDEO-34-2ML', 'ZDEO-34', '2ml', 136),
  ('ZDEO-34-5ML', 'ZDEO-34', '5ml', 235),
  ('ZDEO-35-2ML', 'ZDEO-35', '2ml', 165),
  ('ZDEO-35-5ML', 'ZDEO-35', '5ml', 326),
  ('ZDEO-36-2ML', 'ZDEO-36', '2ml', 245),
  ('ZDEO-36-5ML', 'ZDEO-36', '5ml', 466),
  ('ZDEO-37-2ML', 'ZDEO-37', '2ml', 228),
  ('ZDEO-37-5ML', 'ZDEO-37', '5ml', 425),
  ('ZDEO-38-2ML', 'ZDEO-38', '2ml', 265),
  ('ZDEO-38-5ML', 'ZDEO-38', '5ml', 472),
  ('ZDEO-39-2ML', 'ZDEO-39', '2ml', 396),
  ('ZDEO-39-5ML', 'ZDEO-39', '5ml', 850),
  ('ZDEO-40-2ML', 'ZDEO-40', '2ml', 650),
  ('ZDEO-40-5ML', 'ZDEO-40', '5ml', 1290)
)
INSERT INTO public.product_specs (product_id, sku, spec, price, stock, safe_stock, on_sale_2c)
SELECT p.id, official.sku, official.spec, official.price, 0, 10, TRUE
FROM official
JOIN public.products p ON p.code = official.code
ON CONFLICT (sku) DO UPDATE SET
  product_id = EXCLUDED.product_id,
  spec = EXCLUDED.spec,
  price = EXCLUDED.price,
  on_sale_2c = TRUE;

WITH official_skus(sku) AS (
VALUES
  ('ZDEO-01-5ML'),
  ('ZDEO-01-15ML'),
  ('ZDEO-02-5ML'),
  ('ZDEO-02-15ML'),
  ('ZDEO-03-5ML'),
  ('ZDEO-03-15ML'),
  ('ZDEO-04-5ML'),
  ('ZDEO-04-15ML'),
  ('ZDEO-05-5ML'),
  ('ZDEO-05-15ML'),
  ('ZDEO-06-5ML'),
  ('ZDEO-06-15ML'),
  ('ZDEO-07-5ML'),
  ('ZDEO-07-15ML'),
  ('ZDEO-08-5ML'),
  ('ZDEO-08-15ML'),
  ('ZDEO-09-5ML'),
  ('ZDEO-09-15ML'),
  ('ZDEO-10-5ML'),
  ('ZDEO-10-15ML'),
  ('ZDEO-11-5ML'),
  ('ZDEO-11-15ML'),
  ('ZDEO-12-5ML'),
  ('ZDEO-12-15ML'),
  ('ZDEO-13-5ML'),
  ('ZDEO-13-15ML'),
  ('ZDEO-14-5ML'),
  ('ZDEO-14-15ML'),
  ('ZDEO-15-5ML'),
  ('ZDEO-15-15ML'),
  ('ZDEO-16-5ML'),
  ('ZDEO-16-15ML'),
  ('ZDEO-17-5ML'),
  ('ZDEO-17-15ML'),
  ('ZDEO-18-5ML'),
  ('ZDEO-18-15ML'),
  ('ZDEO-19-5ML'),
  ('ZDEO-19-15ML'),
  ('ZDEO-20-5ML'),
  ('ZDEO-20-15ML'),
  ('ZDEO-21-5ML'),
  ('ZDEO-21-15ML'),
  ('ZDEO-22-5ML'),
  ('ZDEO-22-15ML'),
  ('ZDEO-23-5ML'),
  ('ZDEO-23-15ML'),
  ('ZDEO-24-5ML'),
  ('ZDEO-24-15ML'),
  ('ZDEO-25-5ML'),
  ('ZDEO-25-15ML'),
  ('ZDEO-26-5ML'),
  ('ZDEO-26-15ML'),
  ('ZDEO-27-5ML'),
  ('ZDEO-27-15ML'),
  ('ZDEO-28-5ML'),
  ('ZDEO-28-15ML'),
  ('ZDEO-29-5ML'),
  ('ZDEO-29-15ML'),
  ('ZDEO-30-5ML'),
  ('ZDEO-30-15ML'),
  ('ZDEO-31-2ML'),
  ('ZDEO-31-5ML'),
  ('ZDEO-32-2ML'),
  ('ZDEO-32-5ML'),
  ('ZDEO-33-2ML'),
  ('ZDEO-33-5ML'),
  ('ZDEO-34-2ML'),
  ('ZDEO-34-5ML'),
  ('ZDEO-35-2ML'),
  ('ZDEO-35-5ML'),
  ('ZDEO-36-2ML'),
  ('ZDEO-36-5ML'),
  ('ZDEO-37-2ML'),
  ('ZDEO-37-5ML'),
  ('ZDEO-38-2ML'),
  ('ZDEO-38-5ML'),
  ('ZDEO-39-2ML'),
  ('ZDEO-39-5ML'),
  ('ZDEO-40-2ML'),
  ('ZDEO-40-5ML')
)
UPDATE public.product_specs spec
SET on_sale_2c = FALSE
WHERE spec.product_id IN (SELECT id FROM public.products WHERE code LIKE 'ZDEO-%')
  AND spec.sku IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM official_skus WHERE official_skus.sku = spec.sku);

COMMIT;

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

-- ============================================================
-- ZIDU v60: 小程序商品内容管理（仅超级管理员）
--
-- Supabase 继续作为商品主数据；syncProducts 每小时发布只读快照到 CloudBase。
-- 本迁移只管理小程序展示字段和销售规格，不改变库存数量、成本或批次。
-- ============================================================

BEGIN;

-- 兼容尚未执行 v45 的数据库：先补齐小程序目录基础字段。
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS extraction_method TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS on_sale_2c BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS oil_id TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cat_2c TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS copy_2c TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS gallery JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE public.product_specs ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE public.product_specs ADD COLUMN IF NOT EXISTS on_sale_2c BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS description_2c TEXT NOT NULL DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS usage_2c TEXT NOT NULL DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS main_gallery_2c JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS detail_gallery_2c JSONB NOT NULL DEFAULT '[]'::JSONB;

CREATE TABLE IF NOT EXISTS public.miniprogram_catalog_audit (
  id BIGSERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL DEFAULT 'UPDATE',
  snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS miniprogram_catalog_audit_product_idx
  ON public.miniprogram_catalog_audit(product_id, created_at DESC);
ALTER TABLE public.miniprogram_catalog_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.miniprogram_catalog_audit FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_miniprogram_catalog_admin()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_products JSONB := '[]'::JSONB;
BEGIN
  SELECT * INTO v_actor
  FROM public.users
  WHERE id = public.zidu_current_user_id() AND status = 'active';
  IF v_actor.id IS NULL OR v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN jsonb_build_object('error', '只有超级管理员可以管理小程序商品');
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.code, p.id), '[]'::JSONB)
  INTO v_products
  FROM (
    SELECT
      product.id,
      product.code,
      product.name,
      product.origin,
      coalesce(product.extraction_method, '') AS extraction_method,
      coalesce(product.oil_id, '') AS oil_id,
      coalesce(product.cat_2c, '') AS cat_2c,
      coalesce(product.copy_2c, '') AS copy_2c,
      coalesce(product.description_2c, '') AS description_2c,
      coalesce(product.usage_2c, '') AS usage_2c,
      coalesce(product.image_url, '') AS image_url,
      CASE
        WHEN jsonb_array_length(coalesce(product.main_gallery_2c, '[]'::JSONB)) > 0
          THEN product.main_gallery_2c
        ELSE coalesce(product.gallery, '[]'::JSONB)
      END AS main_gallery_2c,
      coalesce(product.detail_gallery_2c, '[]'::JSONB) AS detail_gallery_2c,
      product.on_sale_2c,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', spec.id,
          'sku', coalesce(spec.sku, ''),
          'spec', spec.spec,
          'price', spec.price,
          'stock', spec.stock,
          'on_sale_2c', spec.on_sale_2c
        ) ORDER BY spec.id)
        FROM public.product_specs spec
        WHERE spec.product_id = product.id
      ), '[]'::JSONB) AS specs
    FROM public.products product
    WHERE product.code LIKE 'ZDEO-%'
       OR product.on_sale_2c
       OR coalesce(product.oil_id, '') <> ''
       OR coalesce(product.cat_2c, '') <> ''
  ) p;

  RETURN jsonb_build_object(
    'success', true,
    'publishMode', 'HOURLY',
    'products', v_products,
    'summary', jsonb_build_object(
      'products', jsonb_array_length(v_products),
      'onSaleProducts', (SELECT count(*) FROM public.products p WHERE p.on_sale_2c),
      'onSaleSpecs', (SELECT count(*) FROM public.product_specs s WHERE s.on_sale_2c)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_miniprogram_catalog_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_miniprogram_catalog_admin() TO authenticated;

CREATE OR REPLACE FUNCTION public.superadmin_update_miniprogram_product(
  p_product_id INTEGER,
  p_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_name TEXT := trim(coalesce(p_payload->>'name', ''));
  v_cat TEXT := trim(coalesce(p_payload->>'category', ''));
  v_tagline TEXT := trim(coalesce(p_payload->>'tagline', ''));
  v_description TEXT := trim(coalesce(p_payload->>'description', ''));
  v_usage TEXT := trim(coalesce(p_payload->>'usage', ''));
  v_cover TEXT := trim(coalesce(p_payload->>'cover', ''));
  v_main JSONB := coalesce(p_payload->'mainGallery', '[]'::JSONB);
  v_detail JSONB := coalesce(p_payload->'detailGallery', '[]'::JSONB);
  v_specs JSONB := coalesce(p_payload->'specs', '[]'::JSONB);
  v_on_sale BOOLEAN := lower(coalesce(p_payload->>'onSale', 'false')) = 'true';
  v_invalid INTEGER := 0;
BEGIN
  SELECT * INTO v_actor
  FROM public.users
  WHERE id = public.zidu_current_user_id() AND status = 'active';
  IF v_actor.id IS NULL OR v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN jsonb_build_object('error', '只有超级管理员可以管理小程序商品');
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF v_product.id IS NULL THEN
    RETURN jsonb_build_object('error', '商品不存在');
  END IF;
  IF v_name = '' OR length(v_name) > 80 THEN
    RETURN jsonb_build_object('error', '商品名称不能为空且不能超过 80 字');
  END IF;
  IF length(v_cat) > 40 OR length(v_tagline) > 160 OR length(v_description) > 1000 OR length(v_usage) > 1500 THEN
    RETURN jsonb_build_object('error', '商品文案超过允许长度');
  END IF;
  IF v_cover <> '' AND (length(v_cover) > 1000 OR v_cover !~ '^(https://|cloud://)') THEN
    RETURN jsonb_build_object('error', '主图必须使用 https:// 或 cloud:// 地址');
  END IF;
  IF jsonb_typeof(v_main) <> 'array' OR jsonb_typeof(v_detail) <> 'array' OR jsonb_typeof(v_specs) <> 'array' THEN
    RETURN jsonb_build_object('error', '图片和规格数据格式不正确');
  END IF;
  IF jsonb_array_length(v_main) > 6 OR jsonb_array_length(v_detail) > 20 THEN
    RETURN jsonb_build_object('error', '轮播图最多 6 张，详情图最多 20 张');
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_main || v_detail) image(url)
    WHERE trim(url) = '' OR length(trim(url)) > 1000 OR trim(url) !~ '^(https://|cloud://)'
  ) THEN
    RETURN jsonb_build_object('error', '图片列表中存在无效地址');
  END IF;

  SELECT count(*) INTO v_invalid
  FROM jsonb_array_elements(v_specs) entry
  WHERE coalesce(entry->>'id', '') !~ '^[0-9]+$'
     OR coalesce(entry->>'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$';
  IF v_invalid > 0 THEN
    RETURN jsonb_build_object('error', '规格或价格数据不正确');
  END IF;
  SELECT count(*) INTO v_invalid
  FROM jsonb_array_elements(v_specs) entry
  WHERE (entry->>'price')::NUMERIC <= 0
     OR NOT EXISTS (
       SELECT 1 FROM public.product_specs spec
       WHERE spec.id = (entry->>'id')::INTEGER AND spec.product_id = p_product_id
     );
  IF v_invalid > 0 THEN
    RETURN jsonb_build_object('error', '规格或价格数据不正确');
  END IF;
  IF v_on_sale AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_specs) entry
    WHERE lower(coalesce(entry->>'onSale', 'false')) = 'true'
  ) THEN
    RETURN jsonb_build_object('error', '商品上架时至少需要上架一个规格');
  END IF;

  UPDATE public.products
  SET name = v_name,
      cat_2c = v_cat,
      copy_2c = v_tagline,
      description_2c = v_description,
      usage_2c = v_usage,
      image_url = v_cover,
      gallery = v_main,
      main_gallery_2c = v_main,
      detail_gallery_2c = v_detail,
      on_sale_2c = v_on_sale
  WHERE id = p_product_id;

  UPDATE public.product_specs SET on_sale_2c = false WHERE product_id = p_product_id;
  UPDATE public.product_specs spec
  SET price = (entry->>'price')::NUMERIC,
      on_sale_2c = v_on_sale AND lower(coalesce(entry->>'onSale', 'false')) = 'true'
  FROM jsonb_array_elements(v_specs) entry
  WHERE spec.id = (entry->>'id')::INTEGER
    AND spec.product_id = p_product_id;

  INSERT INTO public.miniprogram_catalog_audit(product_id, actor_id, action, snapshot)
  VALUES (p_product_id, v_actor.id, CASE WHEN v_on_sale THEN 'SAVE_ON_SALE' ELSE 'SAVE_OFF_SALE' END, p_payload);

  RETURN jsonb_build_object('success', true, 'productId', p_product_id, 'onSale', v_on_sale);
END;
$$;

REVOKE ALL ON FUNCTION public.superadmin_update_miniprogram_product(INTEGER, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_update_miniprogram_product(INTEGER, JSONB) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT
  to_regprocedure('public.get_miniprogram_catalog_admin()') IS NOT NULL AS catalog_admin_ready,
  to_regprocedure('public.superadmin_update_miniprogram_product(integer,jsonb)') IS NOT NULL AS catalog_update_ready;

-- ============================================================
-- ZIDU v61: 小程序完整商品运营、SKU 合并与图片上传
--
-- 1. 旧的无编号规格保留历史引用，但不再出现在商城管理中。
-- 2. 正式编号 SKU 继承旧规格库存，避免同一规格显示两份库存。
-- 3. 超级管理员可新增商品、增减商城 SKU、管理分类和上下架。
-- 4. 创建公开图片桶，只有超级管理员可以上传或删除商城图片。
-- ============================================================

BEGIN;

ALTER TABLE public.product_specs
  ADD COLUMN IF NOT EXISTS catalog_visible_2c BOOLEAN NOT NULL DEFAULT TRUE;

-- 将旧无编号规格的库存归并到同产品、同规格的正式 SKU；不相加，避免重复记账。
WITH legacy_stock AS (
  SELECT
    numbered.id AS numbered_id,
    max(coalesce(legacy.stock, 0)) AS legacy_stock,
    max(coalesce(legacy.safe_stock, 0)) AS legacy_safe_stock
  FROM public.product_specs numbered
  JOIN public.product_specs legacy
    ON legacy.product_id = numbered.product_id
   AND lower(regexp_replace(coalesce(legacy.spec, ''), '\s+', '', 'g'))
       = lower(regexp_replace(coalesce(numbered.spec, ''), '\s+', '', 'g'))
   AND legacy.id <> numbered.id
  WHERE nullif(trim(numbered.sku), '') IS NOT NULL
    AND nullif(trim(legacy.sku), '') IS NULL
  GROUP BY numbered.id
)
UPDATE public.product_specs numbered
SET stock = greatest(coalesce(numbered.stock, 0), legacy_stock.legacy_stock),
    safe_stock = greatest(coalesce(numbered.safe_stock, 0), legacy_stock.legacy_safe_stock)
FROM legacy_stock
WHERE numbered.id = legacy_stock.numbered_id;

-- 历史规格不物理删除，避免破坏采购、批次、配方和订单引用。
UPDATE public.product_specs legacy
SET catalog_visible_2c = false,
    on_sale_2c = false
WHERE nullif(trim(legacy.sku), '') IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.product_specs numbered
    WHERE numbered.product_id = legacy.product_id
      AND nullif(trim(numbered.sku), '') IS NOT NULL
      AND lower(regexp_replace(coalesce(numbered.spec, ''), '\s+', '', 'g'))
          = lower(regexp_replace(coalesce(legacy.spec, ''), '\s+', '', 'g'))
  );

UPDATE public.product_specs
SET catalog_visible_2c = true
WHERE nullif(trim(sku), '') IS NOT NULL;

-- 小程序商品图片：公开读取，仅超级管理员可以维护。
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'miniprogram-catalog',
  'miniprogram-catalog',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS miniprogram_catalog_public_read ON storage.objects;
CREATE POLICY miniprogram_catalog_public_read
ON storage.objects FOR SELECT
USING (bucket_id = 'miniprogram-catalog');

DROP POLICY IF EXISTS miniprogram_catalog_superadmin_insert ON storage.objects;
CREATE POLICY miniprogram_catalog_superadmin_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'miniprogram-catalog'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE id = public.zidu_current_user_id()
      AND role = 'SUPER_ADMIN' AND status = 'active'
  )
);

DROP POLICY IF EXISTS miniprogram_catalog_superadmin_update ON storage.objects;
CREATE POLICY miniprogram_catalog_superadmin_update
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'miniprogram-catalog'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE id = public.zidu_current_user_id()
      AND role = 'SUPER_ADMIN' AND status = 'active'
  )
)
WITH CHECK (
  bucket_id = 'miniprogram-catalog'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE id = public.zidu_current_user_id()
      AND role = 'SUPER_ADMIN' AND status = 'active'
  )
);

DROP POLICY IF EXISTS miniprogram_catalog_superadmin_delete ON storage.objects;
CREATE POLICY miniprogram_catalog_superadmin_delete
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'miniprogram-catalog'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE id = public.zidu_current_user_id()
      AND role = 'SUPER_ADMIN' AND status = 'active'
  )
);

CREATE OR REPLACE FUNCTION public.get_miniprogram_catalog_admin()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_products JSONB := '[]'::JSONB;
BEGIN
  SELECT * INTO v_actor
  FROM public.users
  WHERE id = public.zidu_current_user_id() AND status = 'active';
  IF v_actor.id IS NULL OR v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN jsonb_build_object('error', '只有超级管理员可以管理小程序商品');
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.category_order, p.code, p.id), '[]'::JSONB)
  INTO v_products
  FROM (
    SELECT
      product.id,
      product.code,
      product.name,
      product.origin,
      coalesce(product.extraction_method, '') AS extraction_method,
      coalesce(product.oil_id, '') AS oil_id,
      coalesce(product.cat_2c, '') AS cat_2c,
      CASE coalesce(product.cat_2c, '')
        WHEN '单方精油' THEN 1 WHEN '复方精油' THEN 2
        WHEN '基础油' THEN 3 WHEN '纯露' THEN 4 ELSE 9
      END AS category_order,
      coalesce(product.copy_2c, '') AS copy_2c,
      coalesce(product.description_2c, '') AS description_2c,
      coalesce(product.usage_2c, '') AS usage_2c,
      coalesce(product.image_url, '') AS image_url,
      CASE
        WHEN jsonb_array_length(coalesce(product.main_gallery_2c, '[]'::JSONB)) > 0
          THEN product.main_gallery_2c
        ELSE coalesce(product.gallery, '[]'::JSONB)
      END AS main_gallery_2c,
      coalesce(product.detail_gallery_2c, '[]'::JSONB) AS detail_gallery_2c,
      product.on_sale_2c,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', spec.id,
          'sku', coalesce(spec.sku, ''),
          'spec', spec.spec,
          'price', spec.price,
          'stock', spec.stock,
          'on_sale_2c', spec.on_sale_2c
        ) ORDER BY spec.sku, spec.id)
        FROM public.product_specs spec
        WHERE spec.product_id = product.id
          AND spec.catalog_visible_2c = true
          AND nullif(trim(spec.sku), '') IS NOT NULL
      ), '[]'::JSONB) AS specs
    FROM public.products product
    WHERE product.code LIKE 'ZDEO-%'
       OR product.on_sale_2c
       OR coalesce(product.cat_2c, '') IN ('单方精油', '复方精油', '基础油', '纯露')
  ) p;

  RETURN jsonb_build_object(
    'success', true,
    'schemaVersion', 61,
    'publishMode', 'FIVE_MINUTES',
    'categories', jsonb_build_array('单方精油', '复方精油', '基础油', '纯露'),
    'products', v_products,
    'summary', jsonb_build_object(
      'products', jsonb_array_length(v_products),
      'onSaleProducts', (SELECT count(*) FROM public.products p WHERE p.on_sale_2c),
      'onSaleSpecs', (SELECT count(*) FROM public.product_specs s WHERE s.on_sale_2c AND s.catalog_visible_2c)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.superadmin_create_miniprogram_product(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_code TEXT := upper(trim(coalesce(p_payload->>'code', '')));
  v_name TEXT := trim(coalesce(p_payload->>'name', ''));
  v_category TEXT := trim(coalesce(p_payload->>'category', ''));
  v_origin TEXT := trim(coalesce(p_payload->>'origin', '中国'));
  v_product_id INTEGER;
BEGIN
  SELECT * INTO v_actor
  FROM public.users
  WHERE id = public.zidu_current_user_id() AND status = 'active';
  IF v_actor.id IS NULL OR v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN jsonb_build_object('error', '只有超级管理员可以新增小程序商品');
  END IF;
  IF v_category NOT IN ('单方精油', '复方精油', '基础油', '纯露') THEN
    RETURN jsonb_build_object('error', '请选择有效商品分类');
  END IF;
  IF v_code !~ '^[A-Z0-9][A-Z0-9-]{2,39}$' THEN
    RETURN jsonb_build_object('error', '商品编码需为 3 至 40 位大写字母、数字或横线');
  END IF;
  IF v_name = '' OR length(v_name) > 80 THEN
    RETURN jsonb_build_object('error', '商品名称不能为空且不能超过 80 字');
  END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE upper(code) = v_code) THEN
    RETURN jsonb_build_object('error', '商品编码已经存在');
  END IF;

  INSERT INTO public.products(
    code, name, series, origin, channel, extraction_method,
    oil_id, cat_2c, copy_2c, image_url, gallery,
    description_2c, usage_2c, main_gallery_2c, detail_gallery_2c, on_sale_2c
  ) VALUES (
    v_code, v_name, v_category || '系列', nullif(v_origin, ''), 'BOTH',
    trim(coalesce(p_payload->>'extractionMethod', '')),
    trim(coalesce(p_payload->>'oilId', '')), v_category,
    trim(coalesce(p_payload->>'tagline', '')),
    trim(coalesce(p_payload->>'cover', '')), '[]'::JSONB,
    trim(coalesce(p_payload->>'description', '')),
    trim(coalesce(p_payload->>'usage', '')), '[]'::JSONB, '[]'::JSONB, false
  ) RETURNING id INTO v_product_id;

  INSERT INTO public.miniprogram_catalog_audit(product_id, actor_id, action, snapshot)
  VALUES (v_product_id, v_actor.id, 'CREATE', p_payload);

  RETURN jsonb_build_object('success', true, 'productId', v_product_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.superadmin_update_miniprogram_product(
  p_product_id INTEGER,
  p_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_name TEXT := trim(coalesce(p_payload->>'name', ''));
  v_cat TEXT := trim(coalesce(p_payload->>'category', ''));
  v_tagline TEXT := trim(coalesce(p_payload->>'tagline', ''));
  v_description TEXT := trim(coalesce(p_payload->>'description', ''));
  v_usage TEXT := trim(coalesce(p_payload->>'usage', ''));
  v_origin TEXT := trim(coalesce(p_payload->>'origin', ''));
  v_extraction TEXT := trim(coalesce(p_payload->>'extractionMethod', ''));
  v_oil_id TEXT := trim(coalesce(p_payload->>'oilId', ''));
  v_cover TEXT := trim(coalesce(p_payload->>'cover', ''));
  v_main JSONB := coalesce(p_payload->'mainGallery', '[]'::JSONB);
  v_detail JSONB := coalesce(p_payload->'detailGallery', '[]'::JSONB);
  v_specs JSONB := coalesce(p_payload->'specs', '[]'::JSONB);
  v_on_sale BOOLEAN := lower(coalesce(p_payload->>'onSale', 'false')) = 'true';
  v_entry JSONB;
  v_spec_id INTEGER;
  v_sku TEXT;
  v_spec TEXT;
  v_price NUMERIC;
  v_spec_on_sale BOOLEAN;
  v_kept_ids INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
  SELECT * INTO v_actor
  FROM public.users
  WHERE id = public.zidu_current_user_id() AND status = 'active';
  IF v_actor.id IS NULL OR v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN jsonb_build_object('error', '只有超级管理员可以管理小程序商品');
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF v_product.id IS NULL THEN RETURN jsonb_build_object('error', '商品不存在'); END IF;
  IF v_cat NOT IN ('单方精油', '复方精油', '基础油', '纯露') THEN
    RETURN jsonb_build_object('error', '请选择有效商品分类');
  END IF;
  IF v_name = '' OR length(v_name) > 80 THEN
    RETURN jsonb_build_object('error', '商品名称不能为空且不能超过 80 字');
  END IF;
  IF length(v_tagline) > 160 OR length(v_description) > 1000 OR length(v_usage) > 1500 THEN
    RETURN jsonb_build_object('error', '商品文案超过允许长度');
  END IF;
  IF v_cover <> '' AND (length(v_cover) > 1000 OR v_cover !~ '^https://') THEN
    RETURN jsonb_build_object('error', '主图必须使用 https:// 地址');
  END IF;
  IF jsonb_typeof(v_main) <> 'array' OR jsonb_typeof(v_detail) <> 'array' OR jsonb_typeof(v_specs) <> 'array' THEN
    RETURN jsonb_build_object('error', '图片和规格数据格式不正确');
  END IF;
  IF jsonb_array_length(v_main) > 6 OR jsonb_array_length(v_detail) > 20 OR jsonb_array_length(v_specs) > 24 THEN
    RETURN jsonb_build_object('error', '轮播图最多 6 张、详情图最多 20 张、规格最多 24 个');
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_main || v_detail) image(url)
    WHERE trim(url) = '' OR length(trim(url)) > 1000 OR trim(url) !~ '^https://'
  ) THEN
    RETURN jsonb_build_object('error', '图片列表中存在无效地址');
  END IF;
  IF EXISTS (
    SELECT lower(trim(entry->>'sku'))
    FROM jsonb_array_elements(v_specs) entry
    GROUP BY lower(trim(entry->>'sku'))
    HAVING count(*) > 1
  ) THEN
    RETURN jsonb_build_object('error', '同一商品不能填写重复 SKU');
  END IF;
  IF v_on_sale AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_specs) entry
    WHERE lower(coalesce(entry->>'onSale', 'false')) = 'true'
  ) THEN
    RETURN jsonb_build_object('error', '商品上架时至少需要上架一个规格');
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_specs)
  LOOP
    v_sku := upper(trim(coalesce(v_entry->>'sku', '')));
    v_spec := trim(coalesce(v_entry->>'spec', ''));
    v_spec_on_sale := lower(coalesce(v_entry->>'onSale', 'false')) = 'true';
    IF v_sku !~ '^[A-Z0-9][A-Z0-9-]{2,49}$' THEN
      RETURN jsonb_build_object('error', '每个商城规格都必须填写正式 SKU 编号');
    END IF;
    IF v_spec = '' OR length(v_spec) > 40 THEN
      RETURN jsonb_build_object('error', '规格名称不能为空且不能超过 40 字');
    END IF;
    IF coalesce(v_entry->>'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$' THEN
      RETURN jsonb_build_object('error', '商城价格格式不正确');
    END IF;
    v_price := (v_entry->>'price')::NUMERIC;
    IF v_price <= 0 THEN RETURN jsonb_build_object('error', '商城价格必须大于 0'); END IF;

    IF coalesce(v_entry->>'id', '') ~ '^[0-9]+$' THEN
      v_spec_id := (v_entry->>'id')::INTEGER;
      IF NOT EXISTS (
        SELECT 1 FROM public.product_specs
        WHERE id = v_spec_id AND product_id = p_product_id
      ) THEN RETURN jsonb_build_object('error', '规格不属于当前商品'); END IF;
      IF EXISTS (
        SELECT 1 FROM public.product_specs
        WHERE lower(coalesce(sku, '')) = lower(v_sku) AND id <> v_spec_id
      ) THEN RETURN jsonb_build_object('error', 'SKU 编号已经存在'); END IF;

      UPDATE public.product_specs
      SET sku = v_sku,
          spec = v_spec,
          price = v_price,
          catalog_visible_2c = true,
          on_sale_2c = v_on_sale AND v_spec_on_sale
      WHERE id = v_spec_id;
    ELSE
      IF EXISTS (SELECT 1 FROM public.product_specs WHERE lower(coalesce(sku, '')) = lower(v_sku)) THEN
        RETURN jsonb_build_object('error', 'SKU 编号已经存在');
      END IF;
      INSERT INTO public.product_specs(
        product_id, sku, spec, price, stock, safe_stock, catalog_visible_2c, on_sale_2c
      ) VALUES (
        p_product_id, v_sku, v_spec, v_price, 0, 10, true, v_on_sale AND v_spec_on_sale
      ) RETURNING id INTO v_spec_id;
    END IF;
    v_kept_ids := array_append(v_kept_ids, v_spec_id);
  END LOOP;

  UPDATE public.product_specs
  SET catalog_visible_2c = false, on_sale_2c = false
  WHERE product_id = p_product_id
    AND catalog_visible_2c = true
    AND NOT (id = ANY(v_kept_ids));

  UPDATE public.products
  SET name = v_name,
      origin = nullif(v_origin, ''),
      extraction_method = v_extraction,
      oil_id = v_oil_id,
      cat_2c = v_cat,
      series = v_cat || '系列',
      copy_2c = v_tagline,
      description_2c = v_description,
      usage_2c = v_usage,
      image_url = v_cover,
      gallery = v_main,
      main_gallery_2c = v_main,
      detail_gallery_2c = v_detail,
      on_sale_2c = v_on_sale
  WHERE id = p_product_id;

  INSERT INTO public.miniprogram_catalog_audit(product_id, actor_id, action, snapshot)
  VALUES (p_product_id, v_actor.id, CASE WHEN v_on_sale THEN 'SAVE_ON_SALE' ELSE 'SAVE_OFF_SALE' END, p_payload);

  RETURN jsonb_build_object('success', true, 'productId', p_product_id, 'onSale', v_on_sale);
END;
$$;

REVOKE ALL ON FUNCTION public.get_miniprogram_catalog_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.superadmin_create_miniprogram_product(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.superadmin_update_miniprogram_product(INTEGER, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_miniprogram_catalog_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_create_miniprogram_product(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_update_miniprogram_product(INTEGER, JSONB) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT
  to_regprocedure('public.superadmin_create_miniprogram_product(jsonb)') IS NOT NULL AS product_create_ready,
  to_regprocedure('public.superadmin_update_miniprogram_product(integer,jsonb)') IS NOT NULL AS product_update_ready,
  count(*) FILTER (WHERE catalog_visible_2c AND nullif(trim(sku), '') IS NOT NULL) AS numbered_catalog_specs,
  count(*) FILTER (WHERE NOT catalog_visible_2c AND nullif(trim(sku), '') IS NULL) AS hidden_legacy_specs
FROM public.product_specs;
