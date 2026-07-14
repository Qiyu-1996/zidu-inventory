-- ZIDU 上线前数据完整性检查（只读，不修改任何数据）。
-- 请在 migration_v34 至 migration_v37 全部成功后运行。

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
  to_regclass('public.batch_stock_movements') IS NOT NULL AS batch_movements_ready,
  to_regprocedure('public.zidu_fifo_consume_batches(integer,integer,numeric,text)') IS NOT NULL AS fifo_ready,
  to_regprocedure('public.zidu_adjust_inventory_from_batch(integer,integer,numeric,text,text,text)') IS NOT NULL AS manual_batch_out_ready,
  to_regprocedure('public.zidu_create_purchase_order_v2(text,text,text,text,jsonb,date)') IS NOT NULL AS purchase_create_v2_ready,
  to_regprocedure('public.zidu_delete_purchase_order(integer,text)') IS NOT NULL AS purchase_recycle_ready,
  to_regprocedure('public.zidu_close_purchase_order(integer,text,text)') IS NOT NULL AS purchase_close_ready,
  to_regprocedure('public.zidu_reverse_purchase_receipt(integer,text,text)') IS NOT NULL AS purchase_reverse_ready;

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
-- 1. 第一个结果的 ready 应全部为 true。
-- 2. 中间所有异常明细结果应为 0 行。
-- 3. 最后的宽松 RLS 策略列表当前会有数据，这是 Auth + RLS 权限改造待办，不要直接改成 false 导致系统停摆。
