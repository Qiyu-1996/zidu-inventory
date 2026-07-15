-- ============================================================
-- ZIDU v41: 正式环境 Auth / RLS 权限收紧
--
-- 执行前必须：
-- 1. 已运行 migration_v39_auth_foundation.sql。
-- 2. 网页和小程序已用 Supabase Auth 登录。
-- 3. 已运行 migration_v40_secure_rpc.sql。
-- 4. auth-bootstrap Edge Function 已部署；尚未关联的在职账号会在
--    第一次成功登录时自动创建并关联 Supabase Auth 身份。
--
-- 本迁移会删除所有 Allow all 策略，禁止 anon 直连业务数据。
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.users
    WHERE status = 'active' AND auth_user_id IS NULL
  ) THEN
    RAISE NOTICE '仍有在职账号待关联；将由 auth-bootstrap 在其首次登录时自动完成';
  END IF;
END $$;

-- 客户端只能读取业务必需的非敏感设置。
CREATE OR REPLACE FUNCTION public.zidu_get_client_settings()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_object_agg(key, value), '{}'::JSONB)
  FROM public.app_settings
  WHERE key IN ('max_discount_percent')
$$;

CREATE OR REPLACE FUNCTION public.zidu_inventory_valuation()
RETURNS SETOF public.inventory_valuation
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  RETURN QUERY SELECT * FROM public.inventory_valuation;
END;
$$;

REVOKE ALL ON FUNCTION public.zidu_get_client_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zidu_inventory_valuation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_get_client_settings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_inventory_valuation() TO authenticated;

-- 撤回全部旧策略，包括 Allow all ... USING (true)。
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY(ARRAY[
        'users','products','product_specs','customers','customer_notes',
        'orders','order_items','order_logs','shipments','stock_adjustments',
        'payment_records','purchase_orders','purchase_order_items','pricing_tiers',
        'scenario_packages','scenario_package_items','suppliers','sales_tasks',
        'sales_targets','audit_logs','shipment_notifications','config_options',
        'product_batches','app_settings','after_sales','deleted_orders',
        'batch_stock_movements','zidu_auth_login_attempts'
      ])
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- 不允许 anon 或 PUBLIC 直连任何业务表/视图/序列。
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon;

-- 所有业务表开启 RLS。
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scenario_package_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shipment_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.config_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.after_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deleted_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_stock_movements ENABLE ROW LEVEL SECURITY;

-- authenticated 只拿到必要的表级权限，具体行由下方 RLS 再限制。
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;

GRANT SELECT (id, name, phone, role, status, created_at) ON public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.products, public.product_specs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers, public.customer_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders, public.order_items, public.order_logs, public.shipments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_adjustments, public.payment_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders, public.purchase_order_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricing_tiers, public.scenario_packages, public.scenario_package_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers, public.sales_tasks, public.sales_targets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_logs, public.shipment_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.config_options, public.product_batches, public.app_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.after_sales, public.deleted_orders, public.batch_stock_movements TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- users_safe 必须使用调用者权限，不能绕过 users RLS。
ALTER VIEW public.users_safe SET (security_invoker = true);
ALTER VIEW public.sales_by_business SET (security_invoker = true);
ALTER VIEW public.inventory_valuation SET (security_invoker = true);
GRANT SELECT ON public.users_safe, public.sales_by_business TO authenticated;
REVOKE ALL ON public.inventory_valuation FROM authenticated;

-- 用户名录：登录后可读在职/停用人员基础信息，密码列永远不授权。
CREATE POLICY users_read_directory ON public.users
FOR SELECT TO authenticated
USING (status <> 'deleted' AND public.zidu_current_user_id() IS NOT NULL);

-- 产品与规格：所有内部角色可读，只有管理员可改商品资料。
CREATE POLICY products_read ON public.products
FOR SELECT TO authenticated USING (public.zidu_current_user_id() IS NOT NULL);
CREATE POLICY products_admin_insert ON public.products
FOR INSERT TO authenticated WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY products_admin_update ON public.products
FOR UPDATE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY products_admin_delete ON public.products
FOR DELETE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN']));

CREATE POLICY specs_read ON public.product_specs
FOR SELECT TO authenticated USING (public.zidu_current_user_id() IS NOT NULL);
CREATE POLICY specs_admin_insert ON public.product_specs
FOR INSERT TO authenticated WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY specs_admin_update ON public.product_specs
FOR UPDATE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY specs_admin_delete ON public.product_specs
FOR DELETE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN']));

-- 客户：销售只看自己的，仓库只看待履约订单关联客户。
CREATE POLICY customers_read ON public.customers
FOR SELECT TO authenticated USING (
  public.zidu_has_role(ARRAY['ADMIN','FINANCE'])
  OR (public.zidu_has_role(ARRAY['SALES']) AND sales_id = public.zidu_current_user_id())
  OR (public.zidu_has_role(ARRAY['WAREHOUSE']) AND EXISTS (
    SELECT 1 FROM public.orders o
    WHERE o.customer_id = customers.id
      AND o.status NOT IN ('DRAFT','SUBMITTED','CANCELLED')
  ))
);
CREATE POLICY customers_insert ON public.customers
FOR INSERT TO authenticated WITH CHECK (
  public.zidu_has_role(ARRAY['ADMIN'])
  OR (public.zidu_has_role(ARRAY['SALES']) AND sales_id = public.zidu_current_user_id())
);
CREATE POLICY customers_update ON public.customers
FOR UPDATE TO authenticated USING (
  public.zidu_has_role(ARRAY['ADMIN'])
  OR (public.zidu_has_role(ARRAY['SALES']) AND sales_id = public.zidu_current_user_id())
) WITH CHECK (
  public.zidu_has_role(ARRAY['ADMIN'])
  OR (public.zidu_has_role(ARRAY['SALES']) AND sales_id = public.zidu_current_user_id())
);
CREATE POLICY customers_delete ON public.customers
FOR DELETE TO authenticated USING (
  public.zidu_has_role(ARRAY['ADMIN'])
  OR (public.zidu_has_role(ARRAY['SALES']) AND sales_id = public.zidu_current_user_id())
);

CREATE POLICY customer_notes_read ON public.customer_notes
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.customers c WHERE c.id = customer_notes.customer_id
));
CREATE POLICY customer_notes_insert ON public.customer_notes
FOR INSERT TO authenticated WITH CHECK (
  public.zidu_has_role(ARRAY['ADMIN','SALES'])
  AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_notes.customer_id)
);
CREATE POLICY customer_notes_update ON public.customer_notes
FOR UPDATE TO authenticated USING (
  public.zidu_has_role(ARRAY['ADMIN','SALES'])
  AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_notes.customer_id)
) WITH CHECK (
  public.zidu_has_role(ARRAY['ADMIN','SALES'])
  AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_notes.customer_id)
);
CREATE POLICY customer_notes_delete ON public.customer_notes
FOR DELETE TO authenticated USING (
  public.zidu_has_role(ARRAY['ADMIN','SALES'])
  AND EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_notes.customer_id)
);

-- 订单：修改状态、收款、售后、库存只走 v40 的受控 RPC。
CREATE POLICY orders_read ON public.orders
FOR SELECT TO authenticated USING (
  public.zidu_has_role(ARRAY['ADMIN','FINANCE'])
  OR (public.zidu_has_role(ARRAY['SALES']) AND sales_id = public.zidu_current_user_id())
  OR (public.zidu_has_role(ARRAY['WAREHOUSE']) AND status NOT IN ('DRAFT','SUBMITTED','CANCELLED'))
);
CREATE POLICY orders_admin_insert ON public.orders
FOR INSERT TO authenticated WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY orders_admin_update ON public.orders
FOR UPDATE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY orders_admin_delete ON public.orders
FOR DELETE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN']));

CREATE POLICY order_items_read ON public.order_items
FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_items.order_id));
CREATE POLICY order_items_admin_insert ON public.order_items
FOR INSERT TO authenticated WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY order_items_admin_update ON public.order_items
FOR UPDATE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY order_items_admin_delete ON public.order_items
FOR DELETE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN']));

CREATE POLICY order_logs_read ON public.order_logs
FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_logs.order_id));
CREATE POLICY order_logs_insert ON public.order_logs
FOR INSERT TO authenticated WITH CHECK (
  public.zidu_has_role(ARRAY['ADMIN','SALES','WAREHOUSE'])
  AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_logs.order_id)
);
CREATE POLICY order_logs_admin_change ON public.order_logs
FOR UPDATE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY order_logs_admin_delete ON public.order_logs
FOR DELETE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN']));

CREATE POLICY shipments_read ON public.shipments
FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = shipments.order_id));
CREATE POLICY shipments_admin_insert ON public.shipments
FOR INSERT TO authenticated WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY shipments_admin_update ON public.shipments
FOR UPDATE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY shipments_admin_delete ON public.shipments
FOR DELETE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN']));

CREATE POLICY payments_read ON public.payment_records
FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = payment_records.order_id));
CREATE POLICY payments_admin_insert ON public.payment_records
FOR INSERT TO authenticated WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY payments_admin_update ON public.payment_records
FOR UPDATE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY payments_admin_delete ON public.payment_records
FOR DELETE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN']));

CREATE POLICY after_sales_read ON public.after_sales
FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = after_sales.order_id));
CREATE POLICY after_sales_admin_insert ON public.after_sales
FOR INSERT TO authenticated WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY after_sales_admin_update ON public.after_sales
FOR UPDATE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY after_sales_admin_delete ON public.after_sales
FOR DELETE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN']));

CREATE POLICY shipment_notifications_read ON public.shipment_notifications
FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = shipment_notifications.order_id));
CREATE POLICY shipment_notifications_insert ON public.shipment_notifications
FOR INSERT TO authenticated WITH CHECK (
  public.zidu_has_role(ARRAY['ADMIN','SALES','WAREHOUSE'])
  AND EXISTS (SELECT 1 FROM public.orders o WHERE o.id = shipment_notifications.order_id)
);
CREATE POLICY shipment_notifications_admin_change ON public.shipment_notifications
FOR UPDATE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY shipment_notifications_admin_delete ON public.shipment_notifications
FOR DELETE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN']));

CREATE POLICY deleted_orders_admin_all ON public.deleted_orders
FOR ALL TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));

-- 库存/批次/采购：管理员和仓库可读，写入由受控 RPC 执行。
CREATE POLICY stock_adjustments_read ON public.stock_adjustments
FOR SELECT TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN','WAREHOUSE']));
CREATE POLICY stock_adjustments_insert ON public.stock_adjustments
FOR INSERT TO authenticated WITH CHECK (public.zidu_has_role(ARRAY['ADMIN','WAREHOUSE']));
CREATE POLICY stock_adjustments_admin_change ON public.stock_adjustments
FOR UPDATE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY stock_adjustments_admin_delete ON public.stock_adjustments
FOR DELETE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN']));

CREATE POLICY product_batches_read ON public.product_batches
FOR SELECT TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN','WAREHOUSE']));
CREATE POLICY product_batches_admin_change ON public.product_batches
FOR ALL TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));

CREATE POLICY batch_movements_read ON public.batch_stock_movements
FOR SELECT TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN','WAREHOUSE']));
CREATE POLICY batch_movements_admin_change ON public.batch_stock_movements
FOR ALL TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));

CREATE POLICY purchase_orders_read ON public.purchase_orders
FOR SELECT TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN','WAREHOUSE']));
CREATE POLICY purchase_items_read ON public.purchase_order_items
FOR SELECT TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN','WAREHOUSE']));

CREATE POLICY suppliers_read ON public.suppliers
FOR SELECT TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN','WAREHOUSE']));
CREATE POLICY suppliers_admin_insert ON public.suppliers
FOR INSERT TO authenticated WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY suppliers_admin_update ON public.suppliers
FOR UPDATE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY suppliers_admin_delete ON public.suppliers
FOR DELETE TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN']));

-- 参数与目标。
CREATE POLICY pricing_tiers_read ON public.pricing_tiers
FOR SELECT TO authenticated USING (public.zidu_current_user_id() IS NOT NULL);
CREATE POLICY pricing_tiers_admin_change ON public.pricing_tiers
FOR ALL TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));

CREATE POLICY scenarios_read ON public.scenario_packages
FOR SELECT TO authenticated USING (public.zidu_current_user_id() IS NOT NULL);
CREATE POLICY scenarios_admin_change ON public.scenario_packages
FOR ALL TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY scenario_items_read ON public.scenario_package_items
FOR SELECT TO authenticated USING (public.zidu_current_user_id() IS NOT NULL);
CREATE POLICY scenario_items_admin_change ON public.scenario_package_items
FOR ALL TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));

CREATE POLICY config_read ON public.config_options
FOR SELECT TO authenticated USING (public.zidu_current_user_id() IS NOT NULL);
CREATE POLICY config_admin_change ON public.config_options
FOR ALL TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));

CREATE POLICY app_settings_admin_all ON public.app_settings
FOR ALL TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));

CREATE POLICY tasks_read ON public.sales_tasks
FOR SELECT TO authenticated USING (
  public.zidu_has_role(ARRAY['ADMIN'])
  OR (public.zidu_has_role(ARRAY['SALES']) AND sales_id = public.zidu_current_user_id())
);
CREATE POLICY tasks_insert ON public.sales_tasks
FOR INSERT TO authenticated WITH CHECK (
  public.zidu_has_role(ARRAY['ADMIN'])
  OR (public.zidu_has_role(ARRAY['SALES']) AND sales_id = public.zidu_current_user_id())
);
CREATE POLICY tasks_update ON public.sales_tasks
FOR UPDATE TO authenticated USING (
  public.zidu_has_role(ARRAY['ADMIN'])
  OR (public.zidu_has_role(ARRAY['SALES']) AND sales_id = public.zidu_current_user_id())
) WITH CHECK (
  public.zidu_has_role(ARRAY['ADMIN'])
  OR (public.zidu_has_role(ARRAY['SALES']) AND sales_id = public.zidu_current_user_id())
);
CREATE POLICY tasks_delete ON public.sales_tasks
FOR DELETE TO authenticated USING (
  public.zidu_has_role(ARRAY['ADMIN'])
  OR (public.zidu_has_role(ARRAY['SALES']) AND sales_id = public.zidu_current_user_id())
);

CREATE POLICY targets_read ON public.sales_targets
FOR SELECT TO authenticated USING (
  public.zidu_has_role(ARRAY['ADMIN','FINANCE'])
  OR (public.zidu_has_role(ARRAY['SALES']) AND sales_id = public.zidu_current_user_id())
);
CREATE POLICY targets_admin_change ON public.sales_targets
FOR ALL TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN'])) WITH CHECK (public.zidu_has_role(ARRAY['ADMIN']));

CREATE POLICY audit_read ON public.audit_logs
FOR SELECT TO authenticated USING (public.zidu_has_role(ARRAY['ADMIN']));
CREATE POLICY audit_insert ON public.audit_logs
FOR INSERT TO authenticated WITH CHECK (
  public.zidu_has_role(ARRAY['ADMIN']) OR user_id = public.zidu_current_user_id()
);

-- 旧的采购/库存函数不能绕过 v40 的身份校验。
REVOKE ALL ON FUNCTION public.zidu_create_purchase_order(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zidu_update_purchase_order(INTEGER, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zidu_delete_purchase_order(INTEGER) FROM PUBLIC, anon, authenticated;

-- SECURITY DEFINER 函数均撤回默认 PUBLIC/anon 权限；已明确授权的 authenticated/service_role 不受影响。
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', r.fn);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

SELECT
  count(*) FILTER (WHERE status = 'active') AS active_users,
  count(*) FILTER (WHERE status = 'active' AND auth_user_id IS NOT NULL) AS auth_linked_users,
  count(*) FILTER (WHERE status = 'active' AND auth_user_id IS NULL) AS pending_auth_users,
  has_table_privilege('anon', 'public.orders', 'SELECT') AS anon_can_read_orders,
  has_function_privilege('anon', 'public.zidu_create_order_atomic(jsonb)', 'EXECUTE') AS anon_can_create_order,
  has_function_privilege('authenticated', 'public.zidu_create_order_atomic(jsonb)', 'EXECUTE') AS authenticated_can_create_order
FROM public.users;
