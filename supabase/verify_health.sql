-- ═══════════════════════════════════════════════════════════════
-- 紫都 ZBP 数据库健康检查（恢复项目后在 SQL Editor 整段运行）
-- 三个结果表：①表是否齐全+行数 ②RPC函数 ③关键配置
-- ═══════════════════════════════════════════════════════════════

-- ① 所有业务表 + 行数（缺失的表会显示 "❌ 缺失"）
WITH expected(tbl) AS (VALUES
  ('users'),('products'),('product_specs'),('customers'),('customer_notes'),
  ('orders'),('order_items'),('order_logs'),('shipments'),('payment_records'),
  ('stock_adjustments'),('purchase_orders'),('purchase_order_items'),
  ('pricing_tiers'),('scenario_packages'),('scenario_package_items'),
  ('config_options'),('product_batches'),('suppliers'),
  ('sales_tasks'),('sales_targets'),('audit_logs'),('app_settings')
)
SELECT
  e.tbl AS "表名",
  CASE WHEN t.table_name IS NULL THEN '❌ 缺失' ELSE '✅' END AS "状态",
  CASE WHEN t.table_name IS NULL THEN NULL
       ELSE (xpath('/row/cnt/text()',
              query_to_xml('SELECT count(*) AS cnt FROM public.' || quote_ident(e.tbl), false, true, ''))
            )[1]::text::int
  END AS "行数"
FROM expected e
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public' AND t.table_name = e.tbl
ORDER BY "状态", e.tbl;

-- ② RPC 函数检查
SELECT proname AS "函数",
       '✅' AS "状态"
FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND proname IN ('login','admin_reset_password','toggle_user_status')
ORDER BY proname;

-- ③ users_safe 视图 + 用户概况
SELECT role AS "角色", count(*) AS "人数",
       count(*) FILTER (WHERE active IS NOT FALSE) AS "启用中"
FROM public.users GROUP BY role ORDER BY role;
