-- ZIDU 上线前数据完整性检查（只读，不修改任何数据）。
-- 请在 migration_v34 至 migration_v54 全部成功后运行。

SELECT
  to_regprocedure('public.zidu_create_order_atomic(jsonb)') IS NOT NULL AS create_order_ready,
  to_regprocedure('public.zidu_cancel_order(integer,text,text)') IS NOT NULL AS cancel_ready,
  to_regprocedure('public.zidu_update_order_status_atomic(integer,text,jsonb,jsonb)') IS NOT NULL AS status_ready,
  to_regprocedure('public.zidu_record_payment_atomic(integer,numeric,text,text,text,numeric)') IS NOT NULL AS payment_ready,
  to_regprocedure('public.zidu_update_order_items_atomic(integer,jsonb,jsonb,jsonb)') IS NOT NULL AS edit_ready,
  to_regprocedure('public.zidu_create_after_sale_atomic(integer,jsonb)') IS NOT NULL AS after_sale_ready,
  to_regprocedure('public.zidu_process_after_sale_warehouse_atomic(integer,jsonb)') IS NOT NULL AS warehouse_ready,
  to_regprocedure('public.zidu_complete_after_sale_finance_atomic(integer,jsonb)') IS NOT NULL AS finance_ready,
  to_regprocedure('public.zidu_cancel_after_sale(integer,text,text)') IS NOT NULL AS after_sale_cancel_ready,
  to_regprocedure('public.zidu_delete_order_atomic(integer,boolean,text)') IS NOT NULL AS delete_ready,
  public.zidu_custom_formula_inventory_ready() AS custom_formula_inventory_ready,
  public.zidu_recipe_inventory_ready() AS recipe_inventory_ready,
  to_regclass('public.batch_stock_movements') IS NOT NULL AS batch_movements_ready,
  to_regprocedure('public.zidu_fifo_consume_batches(integer,integer,numeric,text)') IS NOT NULL AS fifo_ready,
  to_regprocedure('public.zidu_adjust_inventory_from_batch(integer,integer,numeric,text,text,text)') IS NOT NULL AS manual_batch_out_ready,
  to_regprocedure('public.zidu_create_purchase_order_v2(text,text,text,text,jsonb,date)') IS NOT NULL AS purchase_create_v2_ready,
  to_regprocedure('public.zidu_delete_purchase_order(integer,text)') IS NOT NULL AS purchase_recycle_ready,
  to_regprocedure('public.zidu_close_purchase_order(integer,text,text)') IS NOT NULL AS purchase_close_ready,
  to_regprocedure('public.zidu_reverse_purchase_receipt(integer,text,text)') IS NOT NULL AS purchase_reverse_ready;

SELECT
  to_regprocedure('public.zidu_current_profile()') IS NOT NULL AS auth_profile_ready,
  to_regprocedure('public.zidu_create_order_atomic_impl(jsonb)') IS NOT NULL AS secure_order_impl_ready,
  to_regprocedure('public.zidu_adjust_inventory_authorized(integer,text,numeric,text)') IS NOT NULL AS secure_inventory_ready,
  to_regprocedure('public.zidu_get_client_settings()') IS NOT NULL AS safe_settings_ready,
  NOT has_table_privilege('anon', 'public.orders', 'SELECT') AS anon_orders_blocked,
  NOT has_table_privilege('anon', 'public.products', 'SELECT') AS anon_products_blocked,
  NOT has_table_privilege('anon', 'public.custom_formula_inventory_usage', 'SELECT') AS anon_formula_usage_blocked,
  NOT has_table_privilege('authenticated', 'public.custom_formula_inventory_usage', 'SELECT') AS signed_in_formula_usage_blocked,
  NOT has_table_privilege('anon', 'public.recipe_library', 'SELECT') AS anon_recipe_table_blocked,
  NOT has_table_privilege('authenticated', 'public.recipe_inventory_usage', 'SELECT') AS signed_in_recipe_usage_blocked,
  NOT has_function_privilege('anon', 'public.zidu_recipe_list()', 'EXECUTE') AS anon_recipe_rpc_blocked,
  has_function_privilege('authenticated', 'public.zidu_recipe_list()', 'EXECUTE') AS signed_in_recipe_rpc_ready,
  NOT has_function_privilege('anon', 'public.zidu_create_order_atomic(jsonb)', 'EXECUTE') AS anon_order_rpc_blocked,
  NOT has_function_privilege('anon', 'public.zidu_adjust_inventory(integer,text,numeric,text)', 'EXECUTE') AS anon_inventory_rpc_blocked,
  has_function_privilege('authenticated', 'public.zidu_create_order_atomic(jsonb)', 'EXECUTE') AS signed_in_order_rpc_ready,
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_role_check'
      AND pg_get_constraintdef(oid) LIKE '%SUPER_ADMIN%'
  ) AS super_admin_role_ready,
  EXISTS (
    SELECT 1 FROM public.users
    WHERE role = 'SUPER_ADMIN' AND status = 'active'
  ) AS active_super_admin_ready;

SELECT id, name, phone, role, status
FROM public.users
WHERE status = 'active' AND auth_user_id IS NULL;

SELECT EXISTS (
  SELECT 1 FROM pg_trigger
  WHERE tgrelid = 'public.orders'::regclass
    AND tgname = 'trg_zidu_guard_direct_order_status_update'
    AND NOT tgisinternal
) AS direct_order_status_guard_ready;

WITH payment_totals AS (
  SELECT order_id, round(coalesce(sum(amount), 0), 2) AS actual_paid
  FROM public.payment_records
  GROUP BY order_id
)
SELECT
  o.id,
  o.order_no,
  o.status,
  o.payment_status,
  o.paid_amount AS recorded_paid,
  coalesce(p.actual_paid, 0) AS actual_paid,
  o.total
FROM public.orders o
LEFT JOIN payment_totals p ON p.order_id = o.id
WHERE abs(coalesce(o.paid_amount, 0) - coalesce(p.actual_paid, 0)) > 0.01
   OR coalesce(o.paid_amount, 0) < -0.01
   OR (o.status = 'CANCELLED' AND (abs(coalesce(o.paid_amount, 0)) > 0.01 OR p.order_id IS NOT NULL));

SELECT id, order_no, status, payment_status, paid_amount, total, unpaid_shipping_status
FROM public.orders
WHERE (payment_status = 'PAID' AND status IN ('DRAFT', 'SUBMITTED'))
   OR (status IN ('SHIPPED', 'DELIVERED', 'COMPLETED')
       AND payment_status <> 'PAID'
       AND coalesce(unpaid_shipping_status, 'NONE') <> 'APPROVED'
       AND total > 0);

SELECT order_id, count(*) AS open_after_sales
FROM public.after_sales
WHERE status IN ('WAREHOUSE_PENDING', 'FINANCE_PENDING')
GROUP BY order_id
HAVING count(*) > 1;

SELECT id, order_id, status, warehouse_at, finance_at
FROM public.after_sales
WHERE status = 'CANCELLED'
  AND (warehouse_at IS NOT NULL OR finance_at IS NOT NULL);

-- 启用中配方必须有组成 SKU，且用量单位必须与库存模式一致。
SELECT recipe.id, recipe.sku_code, recipe.name
FROM public.recipe_library recipe
WHERE recipe.status = 'ACTIVE'
  AND NOT EXISTS (
    SELECT 1 FROM public.recipe_components component
    WHERE component.recipe_id = recipe.id
  );

SELECT recipe.sku_code, component.id AS component_id,
       product.code AS product_code, product.name AS product_name,
       product.inventory_mode, component.quantity_unit, product.density_g_ml
FROM public.recipe_components component
JOIN public.recipe_library recipe ON recipe.id = component.recipe_id
JOIN public.products product ON product.id = component.component_product_id
WHERE (product.inventory_mode = 'MASS' AND (
         component.quantity_unit <> 'ML' OR coalesce(product.density_g_ml, 0) <= 0
       ))
   OR (product.inventory_mode <> 'MASS' AND component.quantity_unit <> 'SPEC');

-- 配方订单必须有对应的扣库快照；已取消订单不得留有未归还的配方用量。
SELECT order_row.id, order_row.order_no, order_row.status
FROM public.orders order_row
WHERE jsonb_typeof(order_row.channel_meta->'recipeSelections') = 'array'
  AND jsonb_array_length(order_row.channel_meta->'recipeSelections') > 0
  AND order_row.status <> 'CANCELLED'
  AND NOT EXISTS (
    SELECT 1 FROM public.recipe_inventory_usage usage
    WHERE usage.order_id = order_row.id AND usage.returned_at IS NULL
  );

SELECT order_row.id, order_row.order_no, usage.id AS usage_id
FROM public.orders order_row
JOIN public.recipe_inventory_usage usage ON usage.order_id = order_row.id
WHERE order_row.status = 'CANCELLED' AND usage.returned_at IS NULL;

-- 采购已收数量必须等于仍有效的采购收货批次累计数量。
WITH receipt_totals AS (
  SELECT purchase_order_item_id, sum(initial_qty) AS batch_received
  FROM public.product_batches
  WHERE purchase_order_item_id IS NOT NULL
    AND receipt_reversed_at IS NULL
  GROUP BY purchase_order_item_id
)
SELECT po.po_no, i.id AS item_id, i.product_name,
       i.received_qty AS recorded_received,
       coalesce(r.batch_received, 0) AS batch_received
FROM public.purchase_order_items i
JOIN public.purchase_orders po ON po.id = i.po_id
LEFT JOIN receipt_totals r ON r.purchase_order_item_id = i.id
WHERE abs(coalesce(i.received_qty, 0) - coalesce(r.batch_received, 0)) > 0.000001;

-- 回收站采购单不得存在已收货数量。
SELECT po.id, po.po_no, po.deleted_at, sum(i.received_qty) AS received_qty
FROM public.purchase_orders po
JOIN public.purchase_order_items i ON i.po_id = po.id
WHERE po.deleted_at IS NOT NULL
GROUP BY po.id, po.po_no, po.deleted_at
HAVING sum(i.received_qty) > 0;

SELECT p.id AS product_id, p.code, p.name, p.base_stock_kg
FROM public.products p
WHERE coalesce(p.base_stock_kg, 0) < 0
UNION ALL
SELECT p.id, p.code, p.name, s.stock::NUMERIC
FROM public.products p
JOIN public.product_specs s ON s.product_id = p.id
WHERE coalesce(s.stock, 0) < 0;

WITH batch_totals AS (
  SELECT product_id, spec_id, sum(remaining_qty) AS batch_qty
  FROM public.product_batches
  WHERE remaining_qty > 0
  GROUP BY product_id, spec_id
)
SELECT p.id AS product_id, p.code, p.name, NULL::INTEGER AS spec_id,
       p.base_stock_kg AS system_qty, coalesce(sum(b.batch_qty), 0) AS batch_qty, 'KG' AS unit
FROM public.products p
LEFT JOIN batch_totals b ON b.product_id = p.id
WHERE p.inventory_mode = 'MASS'
GROUP BY p.id, p.code, p.name, p.base_stock_kg
HAVING coalesce(sum(b.batch_qty), 0) > p.base_stock_kg + 0.000001
UNION ALL
SELECT p.id, p.code, p.name, s.id,
       s.stock::NUMERIC, coalesce(b.batch_qty, 0), 'SPEC'
FROM public.products p
JOIN public.product_specs s ON s.product_id = p.id
LEFT JOIN batch_totals b ON b.spec_id = s.id
WHERE p.inventory_mode <> 'MASS'
  AND coalesce(b.batch_qty, 0) > s.stock + 0.000001;

SELECT
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND (
    coalesce(qual, '') IN ('true', '(true)')
    OR coalesce(with_check, '') IN ('true', '(true)')
  )
ORDER BY tablename, policyname;

-- 判读方法：
-- 1. 前两个 ready/blocked 结果应全部为 true。
-- 2. 未关联在职账号、数据异常明细、宽松 RLS 策略均应为 0 行。
-- 3. users 表上 Block direct user ... 策略已由 v41 替换，不要手工把 false 改成 true。
