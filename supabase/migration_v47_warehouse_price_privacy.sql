-- ============================================================
-- ZIDU v47: 仓库角色价格隔离
--
-- 仓库只能通过下列受控 RPC 读取履约与库存数据。售价、成本、
-- 折扣、收付款和退款金额不会返回；其他角色继续使用原表查询。
-- 依赖：migration_v39_auth_foundation.sql、migration_v41_role_rls.sql
-- ============================================================

BEGIN;

-- 仓库不读取销售折扣上限等客户端财务设置。
CREATE OR REPLACE FUNCTION public.zidu_get_client_settings()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.zidu_has_role(ARRAY['WAREHOUSE']) THEN '{}'::JSONB
    ELSE COALESCE((
      SELECT jsonb_object_agg(key, value)
      FROM public.app_settings
      WHERE key IN ('max_discount_percent')
    ), '{}'::JSONB)
  END
$$;

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
          - ARRAY['shippingFee', 'freightFee', 'shipping_fee'],
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
    WHERE o.status NOT IN ('DRAFT', 'SUBMITTED', 'CANCELLED')
      AND (
        o.payment_status = 'PAID'
        OR o.unpaid_shipping_status = 'APPROVED'
        OR o.status IN ('SHIPPED', 'DELIVERED', 'COMPLETED')
      )
  ), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_warehouse_purchase_orders()
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
      (to_jsonb(po) - 'total') || jsonb_build_object(
        'total', NULL,
        'items', COALESCE((
          SELECT jsonb_agg(
            (to_jsonb(pi) - ARRAY['unit_cost', 'subtotal'])
              || jsonb_build_object('unit_cost', NULL, 'subtotal', NULL)
            ORDER BY pi.id
          )
          FROM public.purchase_order_items pi
          WHERE pi.po_id = po.id
        ), '[]'::JSONB)
      )
      ORDER BY po.id DESC
    )
    FROM public.purchase_orders po
  ), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_warehouse_batches()
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
      (to_jsonb(b) - 'unit_cost') || jsonb_build_object('unit_cost', NULL)
      ORDER BY b.received_date DESC, b.id DESC
    )
    FROM public.product_batches b
  ), '[]'::JSONB);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_warehouse_suppliers()
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
      (to_jsonb(s) - ARRAY['payment_terms', 'note'])
        || jsonb_build_object('payment_terms', NULL, 'note', '')
      ORDER BY s.id
    )
    FROM public.suppliers s
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
      AND o.status NOT IN ('DRAFT', 'SUBMITTED', 'CANCELLED')
      AND (
        o.payment_status = 'PAID'
        OR o.unpaid_shipping_status = 'APPROVED'
        OR o.status IN ('SHIPPED', 'DELIVERED', 'COMPLETED')
      )
  )
$$;

REVOKE ALL ON FUNCTION public.zidu_warehouse_products() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zidu_warehouse_orders() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zidu_warehouse_purchase_orders() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zidu_warehouse_batches() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zidu_warehouse_suppliers() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zidu_warehouse_customer_visible(INTEGER) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.zidu_warehouse_products() TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_warehouse_orders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_warehouse_purchase_orders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_warehouse_batches() TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_warehouse_suppliers() TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_warehouse_customer_visible(INTEGER) TO authenticated;

-- 仓库不再直接读取含价格列的原表，只能调用上面的脱敏 RPC。
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

DROP POLICY IF EXISTS product_batches_read ON public.product_batches;
CREATE POLICY product_batches_read ON public.product_batches
FOR SELECT TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN']));

DROP POLICY IF EXISTS purchase_orders_read ON public.purchase_orders;
CREATE POLICY purchase_orders_read ON public.purchase_orders
FOR SELECT TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN']));

DROP POLICY IF EXISTS purchase_items_read ON public.purchase_order_items;
CREATE POLICY purchase_items_read ON public.purchase_order_items
FOR SELECT TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN']));

DROP POLICY IF EXISTS suppliers_read ON public.suppliers;
CREATE POLICY suppliers_read ON public.suppliers
FOR SELECT TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN']));

DROP POLICY IF EXISTS pricing_tiers_read ON public.pricing_tiers;
CREATE POLICY pricing_tiers_read ON public.pricing_tiers
FOR SELECT TO authenticated USING (
  public.zidu_current_user_id() IS NOT NULL
  AND NOT public.zidu_has_role(ARRAY['WAREHOUSE'])
);

DROP POLICY IF EXISTS scenarios_read ON public.scenario_packages;
CREATE POLICY scenarios_read ON public.scenario_packages
FOR SELECT TO authenticated USING (
  public.zidu_current_user_id() IS NOT NULL
  AND NOT public.zidu_has_role(ARRAY['WAREHOUSE'])
);

DROP POLICY IF EXISTS scenario_items_read ON public.scenario_package_items;
CREATE POLICY scenario_items_read ON public.scenario_package_items
FOR SELECT TO authenticated USING (
  public.zidu_current_user_id() IS NOT NULL
  AND NOT public.zidu_has_role(ARRAY['WAREHOUSE'])
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

SELECT
  to_regprocedure('public.zidu_warehouse_products()') IS NOT NULL AS warehouse_products_ready,
  to_regprocedure('public.zidu_warehouse_orders()') IS NOT NULL AS warehouse_orders_ready,
  to_regprocedure('public.zidu_warehouse_purchase_orders()') IS NOT NULL AS warehouse_purchase_orders_ready,
  to_regprocedure('public.zidu_warehouse_batches()') IS NOT NULL AS warehouse_batches_ready,
  to_regprocedure('public.zidu_warehouse_suppliers()') IS NOT NULL AS warehouse_suppliers_ready;
