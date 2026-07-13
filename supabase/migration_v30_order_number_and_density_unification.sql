-- ============================================================
-- ZIDU v30: 统一历史订单编号，补齐原料换算密度
--
-- 一张 orders 表使用同一套编号规则：
-- ZDR 原料 / ZDF 成品 / ZDM 混合 / ZDB 品牌定制 / ZDP 私人定制
-- 本迁移可重复运行，不修改价格、订单金额、订单明细或库存重量。
-- ============================================================

-- 1. 把有效订单中的旧短编号转成统一格式。
WITH legacy_orders AS (
  SELECT
    o.id,
    CASE
      WHEN o.channel_meta->>'productSource' = 'RAW' THEN 'ZDR'
      WHEN o.channel_meta->>'productSource' = 'FINISHED' THEN 'ZDF'
      WHEN o.channel_meta->>'productSource' = 'MIXED' THEN 'ZDM'
      WHEN o.channel_meta->>'productSource' = 'BRAND_CUSTOM' THEN 'ZDB'
      WHEN o.channel_meta->>'productSource' = 'PRIVATE_CUSTOM' THEN 'ZDP'
      WHEN o.order_no ~* '^ZDR' THEN 'ZDR'
      WHEN o.order_no ~* '^ZDF' THEN 'ZDF'
      WHEN o.order_no ~* '^ZDM' THEN 'ZDM'
      WHEN o.order_no ~* '^ZDB' OR o.order_no ~* '^OEM' THEN 'ZDB'
      WHEN o.order_no ~* '^ZDP' OR o.order_no ~* '^ODM' THEN 'ZDP'
      WHEN o.business_type IN ('品牌定制', 'OEM代工') THEN 'ZDB'
      WHEN o.business_type IN ('私人定制', 'ODM定制') THEN 'ZDP'
      ELSE 'ZDF'
    END AS prefix,
    to_char(COALESCE(o.created_at, CURRENT_DATE)::date, 'YYMMDD') AS date_code,
    CASE
      WHEN c.distributor_level = 1 THEN 'D1'
      WHEN c.distributor_level = 2 THEN 'D2'
      WHEN c.type = '工厂' THEN 'FAC'
      WHEN c.type = '品牌' THEN 'BRD'
      WHEN c.type = '美容院' THEN 'BEA'
      WHEN c.type = '养生馆' THEN 'HLT'
      WHEN c.type = '医疗机构' THEN 'MED'
      WHEN c.type = 'SPA馆' THEN 'SPA'
      WHEN c.type = '头疗馆' THEN 'HAI'
      WHEN c.type = '足浴店' THEN 'FOO'
      WHEN c.type = '瑜伽馆' THEN 'YOG'
      WHEN c.type = '个人' THEN 'PER'
      WHEN c.type = '零售店' THEN 'RET'
      WHEN c.type = '展会' THEN 'EXH'
      WHEN c.type = '线下' THEN 'OFF'
      WHEN c.type = '其他' THEN 'OTH'
      ELSE 'CUS'
    END AS customer_code,
    lpad((COALESCE(o.customer_id, 0) % 1000)::text, 3, '0') AS customer_suffix,
    'N' || lpad(o.id::text, 6, '0') AS sequence_code
  FROM public.orders o
  LEFT JOIN public.customers c ON c.id = o.customer_id
  WHERE o.order_no !~ '^ZD[RFMBP]-[0-9]{6}-[A-Z0-9]{2,6}[0-9]{3}-[A-Z0-9]{4,8}$'
), mapped_orders AS (
  SELECT id, prefix || '-' || date_code || '-' || customer_code || customer_suffix || '-' || sequence_code AS new_order_no
  FROM legacy_orders
)
UPDATE public.orders o
SET order_no = m.new_order_no
FROM mapped_orders m
WHERE o.id = m.id;

-- 2. 删除订单库也使用同样的标准格式，并同步快照中的编号。
WITH legacy_deleted AS (
  SELECT
    d.id,
    CASE
      WHEN d.snapshot->'order'->'channel_meta'->>'productSource' = 'RAW' THEN 'ZDR'
      WHEN d.snapshot->'order'->'channel_meta'->>'productSource' = 'FINISHED' THEN 'ZDF'
      WHEN d.snapshot->'order'->'channel_meta'->>'productSource' = 'MIXED' THEN 'ZDM'
      WHEN d.snapshot->'order'->'channel_meta'->>'productSource' = 'BRAND_CUSTOM' THEN 'ZDB'
      WHEN d.snapshot->'order'->'channel_meta'->>'productSource' = 'PRIVATE_CUSTOM' THEN 'ZDP'
      WHEN d.order_no ~* '^ZDR' THEN 'ZDR'
      WHEN d.order_no ~* '^ZDF' THEN 'ZDF'
      WHEN d.order_no ~* '^ZDM' THEN 'ZDM'
      WHEN d.order_no ~* '^ZDB' OR d.order_no ~* '^OEM' THEN 'ZDB'
      WHEN d.order_no ~* '^ZDP' OR d.order_no ~* '^ODM' THEN 'ZDP'
      ELSE 'ZDF'
    END AS prefix,
    to_char(COALESCE(d.deleted_at::date, CURRENT_DATE), 'YYMMDD') AS date_code,
    CASE
      WHEN c.distributor_level = 1 THEN 'D1'
      WHEN c.distributor_level = 2 THEN 'D2'
      WHEN c.type = '工厂' THEN 'FAC'
      WHEN c.type = '品牌' THEN 'BRD'
      WHEN c.type = '美容院' THEN 'BEA'
      WHEN c.type = '养生馆' THEN 'HLT'
      WHEN c.type = '医疗机构' THEN 'MED'
      WHEN c.type = 'SPA馆' THEN 'SPA'
      WHEN c.type = '头疗馆' THEN 'HAI'
      WHEN c.type = '足浴店' THEN 'FOO'
      WHEN c.type = '瑜伽馆' THEN 'YOG'
      WHEN c.type = '个人' THEN 'PER'
      WHEN c.type = '零售店' THEN 'RET'
      WHEN c.type = '展会' THEN 'EXH'
      WHEN c.type = '线下' THEN 'OFF'
      WHEN c.type = '其他' THEN 'OTH'
      ELSE 'CUS'
    END AS customer_code,
    lpad((COALESCE(d.customer_id, 0) % 1000)::text, 3, '0') AS customer_suffix,
    'D' || lpad(d.id::text, 6, '0') AS sequence_code
  FROM public.deleted_orders d
  LEFT JOIN public.customers c ON c.id = d.customer_id
  WHERE d.order_no !~ '^ZD[RFMBP]-[0-9]{6}-[A-Z0-9]{2,6}[0-9]{3}-[A-Z0-9]{4,8}$'
), mapped_deleted AS (
  SELECT id, prefix || '-' || date_code || '-' || customer_code || customer_suffix || '-' || sequence_code AS new_order_no
  FROM legacy_deleted
)
UPDATE public.deleted_orders d
SET
  order_no = m.new_order_no,
  snapshot = CASE
    WHEN d.snapshot ? 'order' THEN jsonb_set(d.snapshot, '{order,order_no}', to_jsonb(m.new_order_no), true)
    ELSE d.snapshot
  END
FROM mapped_deleted m
WHERE d.id = m.id;

-- 3. 防止网页、小程序或旧缓存再写入旧短编号。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.orders'::regclass
      AND conname = 'orders_order_no_standard_format'
  ) THEN
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_order_no_standard_format
      CHECK (order_no ~ '^ZD[RFMBP]-[0-9]{6}-[A-Z0-9]{2,6}[0-9]{3}-[A-Z0-9]{4,8}$')
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.orders VALIDATE CONSTRAINT orders_order_no_standard_format;

-- 4. 补齐当前还未保存密度的纯露和自有复配产品。
-- 139 个单方精油/基础油已使用各自产品编号对应的值，这里不覆盖。
WITH formulation_defaults (code, density_g_ml) AS (
  SELECT 'ZD-' || n::text, 1.000::numeric FROM generate_series(3001, 3021) n
  UNION ALL SELECT 'ZD-3021(波黑)', 1.000
  UNION ALL SELECT 'ZD-3027', 0.920
  UNION ALL SELECT 'ZD-3028', 0.920
  UNION ALL SELECT 'ZD-3029', 0.920
  UNION ALL SELECT 'ZD-3030', 1.030
  UNION ALL SELECT 'ZD-3031', 1.000
  UNION ALL SELECT 'ZD-3032', 1.000
  UNION ALL SELECT 'ZD-3033', 1.000
  UNION ALL SELECT 'ZD-3034', 1.000
  UNION ALL SELECT 'TX-' || n::text, 0.920::numeric FROM generate_series(2013, 2034) n
  UNION ALL SELECT 'TX-2035', 0.900
  UNION ALL SELECT 'TX-2036', 0.900
)
UPDATE public.products p
SET
  density_g_ml = d.density_g_ml,
  density_temperature_c = 20,
  density_source = '系统初始换算值，可在库存页修改',
  density_status = 'REFERENCE'
FROM formulation_defaults d
WHERE p.channel = 'RAW'
  AND upper(regexp_replace(trim(p.code), '[[:space:]]+', '', 'g')) = upper(regexp_replace(d.code, '[[:space:]]+', '', 'g'))
  AND (p.density_g_ml IS NULL OR p.density_g_ml <= 0);

NOTIFY pgrst, 'reload schema';

-- 正确结果：两个 remaining 都为 0，两个 ready 都为 true。
SELECT
  count(*) FILTER (
    WHERE o.order_no !~ '^ZD[RFMBP]-[0-9]{6}-[A-Z0-9]{2,6}[0-9]{3}-[A-Z0-9]{4,8}$'
  ) AS legacy_order_numbers_remaining,
  (
    SELECT count(*) FROM public.products p
    WHERE p.channel = 'RAW' AND (p.density_g_ml IS NULL OR p.density_g_ml <= 0)
  ) AS raw_density_missing,
  bool_and(o.order_no ~ '^ZD[RFMBP]-[0-9]{6}-[A-Z0-9]{2,6}[0-9]{3}-[A-Z0-9]{4,8}$') AS order_number_system_ready,
  NOT EXISTS (
    SELECT 1 FROM public.products p
    WHERE p.channel = 'RAW' AND (p.density_g_ml IS NULL OR p.density_g_ml <= 0)
  ) AS raw_density_ready
FROM public.orders o;
