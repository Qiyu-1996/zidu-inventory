-- ═══════════════════════════════════════════════
-- ZIDU v8 Migration: 业务类型（院线 / 芳疗师 / OEM / ODM）
-- 在 Supabase SQL Editor 整段运行（幂等，可重复跑）
-- ═══════════════════════════════════════════════

-- ① 订单加业务类型字段（默认院线）
ALTER TABLE orders ADD COLUMN IF NOT EXISTS business_type TEXT DEFAULT '院线';

-- ② 去掉 category 的白名单 CHECK 约束（原约束不含 BUSINESS_TYPE，会拒绝插入）
ALTER TABLE config_options DROP CONSTRAINT IF EXISTS config_options_category_check;

-- ③ 预置业务类型选项到 config_options（管理员可在「基础设置」增删）
--    注意：config_options.sort_order 非空，INSERT 必须带上
INSERT INTO config_options (category, value, sort_order)
SELECT 'BUSINESS_TYPE', v, n
FROM (VALUES ('院线',1),('芳疗师',2),('OEM代工',3),('ODM定制',4),('其他',5)) AS t(v, n)
WHERE NOT EXISTS (
  SELECT 1 FROM config_options c WHERE c.category = 'BUSINESS_TYPE' AND c.value = t.v
);

-- ③ 按业务类型 × 销售 的汇总视图（销售汇总可视化用）
CREATE OR REPLACE VIEW sales_by_business AS
SELECT
  o.sales_id,
  COALESCE(o.business_type, '院线') AS business_type,
  COUNT(*)                          AS order_count,
  COALESCE(SUM(o.total), 0)         AS revenue
FROM orders o
WHERE o.status <> 'CANCELLED'
GROUP BY o.sales_id, COALESCE(o.business_type, '院线');

GRANT SELECT ON sales_by_business TO anon;
