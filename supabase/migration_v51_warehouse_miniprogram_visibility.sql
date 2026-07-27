-- ============================================================
-- ZIDU v51: 小程序仓库数据可见性修复
--
-- 目标：
-- 1. 仓库可查看全部库存商品，但不返回售价和成本。
-- 2. 仓库可查看待确认、待发货、已发货及有发货记录的已完成订单。
-- 3. 未收款且未获特批的订单只可查看，仍不能执行发货。
-- 4. 保持仓库不能直接读取含价格字段的业务表。
--
-- 依赖：migration_v39_auth_foundation.sql、migration_v41_role_rls.sql
-- 可重复执行。
-- ============================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.zidu_has_role(text[])') IS NULL THEN
    RAISE EXCEPTION '请先运行 migration_v39_auth_foundation.sql 和 migration_v41_role_rls.sql';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.zidu_warehouse_products()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.zidu_has_role(ARRAY['WAREHOUSE']) THEN
    RAISE EXCEPTION 'warehouse role required' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      to_jsonb(p) || jsonb_build_object(
        'specs', COALESCE((
          SELECT jsonb_agg(
            (to_jsonb(s) - ARRAY['price', 'cost'])
              || jsonb_build_object('price', NULL, 'cost', NULL)
            ORDER BY s.id
          )
          FROM public.product_specs s
          WHERE s.product_id = p.id
        ), '[]'::JSONB)
      )
      ORDER BY p.id
    )
    FROM public.products p
  ), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_warehouse_orders()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.zidu_has_role(ARRAY['WAREHOUSE']) THEN
    RAISE EXCEPTION 'warehouse role required' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(
      (
        to_jsonb(o) - ARRAY[
          'subtotal', 'discount_percent', 'discount_amount', 'total', 'paid_amount',
          'discount_responsibility', 'discount_reason',
          'discount_responsibility_updated_by', 'discount_responsibility_updated_at'
        ]
      ) || jsonb_build_object(
        'subtotal', NULL,
        'discount_percent', NULL,
        'discount_amount', NULL,
        'total', NULL,
        'paid_amount', NULL,
        'discount_responsibility', NULL,
        'discount_reason', '',
        'channel_meta', COALESCE(o.channel_meta, '{}'::JSONB)
          - ARRAY['shippingFee', 'freightFee', 'shipping_fee', 'customFormula', 'customFormulaVersion'],
        'items', COALESCE((
          SELECT jsonb_agg(
            (to_jsonb(oi) - ARRAY['unit_price', 'unit_cost', 'subtotal'])
              || jsonb_build_object('unit_price', NULL, 'unit_cost', NULL, 'subtotal', NULL)
            ORDER BY oi.id
          )
          FROM public.order_items oi
          WHERE oi.order_id = o.id
        ), '[]'::JSONB),
        'logs', COALESCE((
          SELECT jsonb_agg(
            to_jsonb(ol) || jsonb_build_object(
              'action', CASE
                WHEN ol.action ~ '(收款|退款|补款|价格调整|折扣|金额|单价|成本|销售额|提成)'
                  THEN '财务信息已隐藏'
                ELSE ol.action
              END
            )
            ORDER BY ol.id
          )
          FROM public.order_logs ol
          WHERE ol.order_id = o.id
        ), '[]'::JSONB),
        'shipment', COALESCE((
          SELECT jsonb_agg(to_jsonb(sh) ORDER BY sh.id)
          FROM public.shipments sh
          WHERE sh.order_id = o.id
        ), '[]'::JSONB),
        'payments', '[]'::JSONB,
        'afterSales', COALESCE((
          SELECT jsonb_agg(
            (
              to_jsonb(a) - ARRAY[
                'requested_amount', 'finance_amount', 'finance_method', 'finance_note'
              ]
            ) || jsonb_build_object(
              'requested_amount', NULL,
              'finance_amount', NULL,
              'finance_method', '',
              'finance_note', '',
              'items', COALESCE((
                SELECT jsonb_agg(
                  item - ARRAY['unitPrice', 'unit_price', 'subtotal', 'amount']
                )
                FROM jsonb_array_elements(COALESCE(a.items, '[]'::JSONB)) AS entries(item)
              ), '[]'::JSONB)
            )
            ORDER BY a.id DESC
          )
          FROM public.after_sales a
          WHERE a.order_id = o.id
        ), '[]'::JSONB)
      )
      ORDER BY o.id DESC
    )
    FROM public.orders o
    WHERE o.status IN ('SUBMITTED', 'CONFIRMED', 'PREPARING', 'SHIPPED', 'DELIVERED')
       OR (
         o.status = 'COMPLETED'
         AND EXISTS (SELECT 1 FROM public.shipments sh WHERE sh.order_id = o.id)
       )
  ), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_warehouse_customer_visible(p_customer_id INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.zidu_has_role(ARRAY['WAREHOUSE']) AND EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE o.customer_id = p_customer_id
      AND (
        o.status IN ('SUBMITTED', 'CONFIRMED', 'PREPARING', 'SHIPPED', 'DELIVERED')
        OR (
          o.status = 'COMPLETED'
          AND EXISTS (SELECT 1 FROM public.shipments sh WHERE sh.order_id = o.id)
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION public.zidu_warehouse_products() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zidu_warehouse_orders() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zidu_warehouse_customer_visible(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.zidu_warehouse_products() TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_warehouse_orders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_warehouse_customer_visible(INTEGER) TO authenticated;

-- 仓库只能通过上面的脱敏 RPC 读取库存和订单。
DROP POLICY IF EXISTS products_read ON public.products;
CREATE POLICY products_read ON public.products
FOR SELECT TO authenticated USING (
  public.zidu_current_user_id() IS NOT NULL
  AND NOT public.zidu_has_role(ARRAY['WAREHOUSE'])
);

DROP POLICY IF EXISTS specs_read ON public.product_specs;
CREATE POLICY specs_read ON public.product_specs
FOR SELECT TO authenticated USING (
  public.zidu_current_user_id() IS NOT NULL
  AND NOT public.zidu_has_role(ARRAY['WAREHOUSE'])
);

DROP POLICY IF EXISTS orders_read ON public.orders;
CREATE POLICY orders_read ON public.orders
FOR SELECT TO authenticated USING (
  public.zidu_has_role(ARRAY['ADMIN', 'FINANCE'])
  OR (public.zidu_has_role(ARRAY['SALES']) AND sales_id = public.zidu_current_user_id())
);

DROP POLICY IF EXISTS order_items_read ON public.order_items;
CREATE POLICY order_items_read ON public.order_items
FOR SELECT TO authenticated USING (
  NOT public.zidu_has_role(ARRAY['WAREHOUSE'])
  AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id)
);

DROP POLICY IF EXISTS payments_read ON public.payment_records;
CREATE POLICY payments_read ON public.payment_records
FOR SELECT TO authenticated USING (
  NOT public.zidu_has_role(ARRAY['WAREHOUSE'])
  AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = payment_records.order_id)
);

DROP POLICY IF EXISTS after_sales_read ON public.after_sales;
CREATE POLICY after_sales_read ON public.after_sales
FOR SELECT TO authenticated USING (
  NOT public.zidu_has_role(ARRAY['WAREHOUSE'])
  AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = after_sales.order_id)
);

DROP POLICY IF EXISTS customers_read ON public.customers;
CREATE POLICY customers_read ON public.customers
FOR SELECT TO authenticated USING (
  public.zidu_has_role(ARRAY['ADMIN', 'FINANCE'])
  OR (public.zidu_has_role(ARRAY['SALES']) AND sales_id = public.zidu_current_user_id())
  OR public.zidu_warehouse_customer_visible(id)
);

DROP POLICY IF EXISTS customer_notes_read ON public.customer_notes;
CREATE POLICY customer_notes_read ON public.customer_notes
FOR SELECT TO authenticated USING (
  NOT public.zidu_has_role(ARRAY['WAREHOUSE'])
  AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_notes.customer_id)
);

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT
  to_regprocedure('public.zidu_warehouse_products()') IS NOT NULL AS warehouse_products_ready,
  to_regprocedure('public.zidu_warehouse_orders()') IS NOT NULL AS warehouse_orders_ready,
  to_regprocedure('public.zidu_warehouse_customer_visible(integer)') IS NOT NULL AS warehouse_customers_ready;
