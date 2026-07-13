-- =============================================
-- ZIDU v18 - Standardize legacy order numbers
--
-- New order number shape:
--   ZDR-260709-BEA001-N000123
--   prefix-date-customerCode+customerIdSuffix-sequence
--
-- Prefixes:
--   ZDR raw material
--   ZDF finished goods
--   ZDM mixed raw + finished
--   ZDB brand custom
--   ZDP private custom
--
-- Idempotent: already-standard order numbers are not changed.
-- This migration only updates order_no text fields. It does not touch
-- product data, prices, stock, payments, or order items.
-- =============================================

-- Active orders
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
      WHEN o.order_no ~* '^ZDB' THEN 'ZDB'
      WHEN o.order_no ~* '^ZDP' THEN 'ZDP'
      WHEN o.order_no ~* '^OEM' THEN 'ZDB'
      WHEN o.order_no ~* '^ODM' THEN 'ZDP'
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
),
mapped_orders AS (
  SELECT
    id,
    prefix || '-' || date_code || '-' || customer_code || customer_suffix || '-' || sequence_code AS new_order_no
  FROM legacy_orders
)
UPDATE public.orders o
SET order_no = m.new_order_no
FROM mapped_orders m
WHERE o.id = m.id
  AND NOT EXISTS (
    SELECT 1
    FROM public.orders other
    WHERE other.order_no = m.new_order_no
      AND other.id <> o.id
  );

-- Deleted order library snapshots
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
      WHEN d.order_no ~* '^ZDB' THEN 'ZDB'
      WHEN d.order_no ~* '^ZDP' THEN 'ZDP'
      WHEN d.order_no ~* '^OEM' THEN 'ZDB'
      WHEN d.order_no ~* '^ODM' THEN 'ZDP'
      WHEN d.snapshot->'order'->>'business_type' IN ('品牌定制', 'OEM代工') THEN 'ZDB'
      WHEN d.snapshot->'order'->>'business_type' IN ('私人定制', 'ODM定制') THEN 'ZDP'
      ELSE 'ZDF'
    END AS prefix,
    to_char(
      COALESCE(
        CASE
          WHEN d.snapshot->'order'->>'created_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          THEN (d.snapshot->'order'->>'created_at')::date
          ELSE NULL
        END,
        d.deleted_at::date,
        CURRENT_DATE
      ),
      'YYMMDD'
    ) AS date_code,
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
),
mapped_deleted AS (
  SELECT
    id,
    prefix || '-' || date_code || '-' || customer_code || customer_suffix || '-' || sequence_code AS new_order_no
  FROM legacy_deleted
)
UPDATE public.deleted_orders d
SET
  order_no = m.new_order_no,
  snapshot = CASE
    WHEN d.snapshot ? 'order'
    THEN jsonb_set(d.snapshot, '{order,order_no}', to_jsonb(m.new_order_no), true)
    ELSE d.snapshot
  END
FROM mapped_deleted m
WHERE d.id = m.id;

-- Verification: should return 0 rows after the migration.
SELECT id, order_no
FROM public.orders
WHERE order_no !~ '^ZD[RFMBP]-[0-9]{6}-[A-Z0-9]{2,6}[0-9]{3}-[A-Z0-9]{4,8}$'
ORDER BY id;
