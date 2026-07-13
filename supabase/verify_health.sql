-- =============================================
-- ZIDU launch database verification
-- Run this whole file in Supabase SQL Editor.
-- Read-only: it does not insert/update/delete any data.
-- =============================================

-- 1) Required business tables and row counts
WITH expected(tbl) AS (VALUES
  ('users'),('products'),('product_specs'),('customers'),('customer_notes'),
  ('orders'),('order_items'),('order_logs'),('shipments'),('payment_records'),
  ('stock_adjustments'),('purchase_orders'),('purchase_order_items'),
  ('pricing_tiers'),('scenario_packages'),('scenario_package_items'),
  ('config_options'),('product_batches'),('suppliers'),('sales_tasks'),
  ('sales_targets'),('audit_logs'),('shipment_notifications'),('app_settings'),
  ('after_sales'),('deleted_orders')
)
SELECT
  e.tbl AS table_name,
  CASE WHEN t.table_name IS NULL THEN 'MISSING' ELSE 'OK' END AS status,
  CASE WHEN t.table_name IS NULL THEN NULL
       ELSE (xpath(
         '/row/cnt/text()',
         query_to_xml('SELECT count(*) AS cnt FROM public.' || quote_ident(e.tbl), false, true, '')
       ))[1]::text::int
  END AS row_count
FROM expected e
LEFT JOIN information_schema.tables t
  ON t.table_schema = 'public' AND t.table_name = e.tbl
ORDER BY status DESC, table_name;

-- 2) Required columns from v2-v17 migrations
WITH expected(table_name, column_name) AS (VALUES
  ('products','channel'),
  ('products','inventory_mode'),
  ('products','base_stock_kg'),
  ('products','density_g_ml'),
  ('products','density_temperature_c'),
  ('products','density_source'),
  ('products','density_status'),
  ('users','archived_phone'),
  ('users','archived_at'),
  ('product_specs','cost'),
  ('customers','province'),
  ('customers','distributor_level'),
  ('orders','payment_status'),
  ('orders','paid_amount'),
  ('orders','business_type'),
  ('orders','source'),
  ('orders','channel_meta'),
  ('order_items','unit_cost'),
  ('order_items','batch_id'),
  ('order_items','batch_no'),
  ('order_items','gcms_no'),
  ('stock_adjustments','batch_id'),
  ('purchase_orders','supplier_id'),
  ('sales_targets','target_new_customers'),
  ('sales_targets','target_order_count'),
  ('after_sales','requested_amount'),
  ('after_sales','finance_amount'),
  ('after_sales','restock_returned'),
  ('after_sales','completed_at'),
  ('deleted_orders','snapshot'),
  ('deleted_orders','expires_at'),
  ('deleted_orders','restored_order_id')
)
SELECT
  e.table_name,
  e.column_name,
  CASE WHEN c.column_name IS NULL THEN 'MISSING' ELSE 'OK' END AS status
FROM expected e
LEFT JOIN information_schema.columns c
  ON c.table_schema = 'public'
 AND c.table_name = e.table_name
 AND c.column_name = e.column_name
ORDER BY status DESC, e.table_name, e.column_name;

-- 3) Required RPC functions
WITH expected(function_name) AS (VALUES
  ('login'),('create_user'),('change_password'),
  ('admin_reset_password'),('toggle_user_status'),
  ('admin_update_user_role'),('admin_archive_user'),
  ('zidu_delete_inventory_batch'),
  ('zidu_create_inventory_batch'),
  ('zidu_create_purchase_order'),('zidu_update_purchase_order'),
  ('zidu_delete_purchase_order'),('zidu_receive_purchase_order'),
  ('zidu_adjust_inventory'),('zidu_spec_mass_kg'),('zidu_sync_mass_spec_stock')
)
SELECT
  e.function_name,
  CASE WHEN p.proname IS NULL THEN 'MISSING' ELSE 'OK' END AS status
FROM expected e
LEFT JOIN (
  SELECT p.proname
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public'
) p ON p.proname = e.function_name
ORDER BY status DESC, e.function_name;

-- 3b) 重量库存配置质量：启用后不能有无法换算的销售规格
SELECT
  p.code,
  p.name,
  p.base_stock_kg,
  p.density_g_ml,
  p.density_status,
  count(*) FILTER (
    WHERE public.zidu_spec_mass_kg(s.spec, p.density_g_ml) IS NULL
  ) AS unconvertible_specs
FROM public.products p
JOIN public.product_specs s ON s.product_id = p.id
WHERE p.inventory_mode = 'MASS'
GROUP BY p.id, p.code, p.name, p.base_stock_kg, p.density_g_ml, p.density_status
ORDER BY unconvertible_specs DESC, p.code;

-- 4) User roles and FINANCE constraint
SELECT
  role,
  count(*) AS user_count,
  count(*) FILTER (WHERE status = 'active') AS active_count
FROM public.users
GROUP BY role
ORDER BY role;

SELECT
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS definition,
  CASE WHEN pg_get_constraintdef(oid) ILIKE '%FINANCE%' THEN 'OK' ELSE 'CHECK' END AS finance_role_status
FROM pg_constraint
WHERE conrelid = 'public.users'::regclass
  AND conname = 'users_role_check';

-- 5) Launch product data checks: packaging bottles
SELECT
  p.code,
  p.name,
  p.series,
  p.channel,
  count(s.id) AS spec_count,
  min(s.stock) AS min_stock,
  max(s.stock) AS max_stock,
  string_agg(s.spec || '=' || s.price::text, ' | ' ORDER BY s.id) AS specs_and_prices
FROM public.products p
LEFT JOIN public.product_specs s ON s.product_id = p.id
WHERE p.code IN ('ZDBTL-01','ZDBTL-02','ZDBTL-03','ZDBTL-04','ZDBTL-05','ZDBTL-06')
GROUP BY p.code, p.name, p.series, p.channel
ORDER BY p.code;

-- 6) Common data quality warnings
SELECT 'products_without_specs' AS check_name, count(*) AS count
FROM public.products p
WHERE NOT EXISTS (SELECT 1 FROM public.product_specs s WHERE s.product_id = p.id)
UNION ALL
SELECT 'duplicate_product_codes', count(*) FROM (
  SELECT code FROM public.products GROUP BY code HAVING count(*) > 1
) x
UNION ALL
SELECT 'orders_without_payment_status', count(*) FROM public.orders WHERE payment_status IS NULL
UNION ALL
SELECT 'orders_without_source', count(*) FROM public.orders WHERE source IS NULL
UNION ALL
SELECT 'negative_stock_specs', count(*) FROM public.product_specs WHERE stock < 0
UNION ALL
SELECT 'legacy_order_numbers', count(*) FROM public.orders
WHERE order_no !~ '^ZD[RFMBP]-[0-9]{6}-[A-Z0-9]{2,6}[0-9]{3}-[A-Z0-9]{4,8}$';

-- 7) RLS policy snapshot.
-- Current app still uses permissive policies on business tables; this is expected for now,
-- but should be hardened before public production.
SELECT
  tablename,
  policyname,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
