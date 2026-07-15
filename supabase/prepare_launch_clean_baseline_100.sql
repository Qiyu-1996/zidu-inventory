-- ============================================================
-- ZIDU 上线数据清理与初始库存
--
-- 保留：产品、SKU、价格、用户、供应商、系统配置、销售目标。
-- 清理：测试客户、订单、售后、收发货、采购、批次及旧库存流水。
-- 初始化：每个原料产品 100kg；每个非原料销售规格 100瓶/个。
--
-- 这是破坏性操作。必须使用文件末尾的确认词才会执行。
-- 执行前会把被清理的数据保存到仅数据库管理员可见的备份表。
-- ============================================================

CREATE TABLE IF NOT EXISTS public.zidu_admin_reset_backups (
  id BIGSERIAL PRIMARY KEY,
  reset_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.zidu_admin_reset_backups
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.zidu_admin_reset_backups_id_seq
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.zidu_prepare_launch_baseline_100(
  p_confirmation TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_backup_id BIGINT;
  v_customer_count INTEGER;
  v_order_count INTEGER;
  v_deleted_order_count INTEGER;
  v_purchase_count INTEGER;
  v_batch_count INTEGER;
  v_raw_count INTEGER;
  v_finished_spec_count INTEGER;
  v_preflight_issue TEXT;
BEGIN
  IF p_confirmation IS DISTINCT FROM 'CLEAN_ZIDU_LAUNCH_100' THEN
    RAISE EXCEPTION '确认文字不正确，未执行上线清理';
  END IF;

  SELECT concat(p.code, ' ', p.name)
  INTO v_preflight_issue
  FROM public.products p
  WHERE p.channel = 'RAW'
    AND NOT EXISTS (
      SELECT 1 FROM public.product_specs s WHERE s.product_id = p.id
    )
  ORDER BY p.id
  LIMIT 1;

  IF v_preflight_issue IS NOT NULL THEN
    RAISE EXCEPTION '原料 % 没有销售规格，未执行任何清理',
      v_preflight_issue;
  END IF;

  v_preflight_issue := NULL;
  SELECT concat(p.code, ' ', p.name)
  INTO v_preflight_issue
  FROM public.products p
  WHERE p.channel = 'RAW'
    AND coalesce(p.density_g_ml, 0) <= 0
    AND EXISTS (
      SELECT 1
      FROM public.product_specs s
      WHERE s.product_id = p.id
        AND s.spec ~* '^[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*(ml|毫升|l|升)'
    )
  ORDER BY p.id
  LIMIT 1;

  IF v_preflight_issue IS NOT NULL THEN
    RAISE EXCEPTION '原料 % 有 ml/L 规格但没有有效密度，未执行任何清理',
      v_preflight_issue;
  END IF;

  PERFORM set_config('lock_timeout', '10s', true);

  LOCK TABLE
    public.shipment_notifications,
    public.after_sales,
    public.payment_records,
    public.shipments,
    public.order_logs,
    public.order_items,
    public.orders,
    public.deleted_orders,
    public.sales_tasks,
    public.customer_notes,
    public.customers,
    public.batch_stock_movements,
    public.stock_adjustments,
    public.product_batches,
    public.purchase_order_items,
    public.purchase_orders,
    public.audit_logs,
    public.zidu_auth_login_attempts,
    public.products,
    public.product_specs
  IN ACCESS EXCLUSIVE MODE;

  SELECT count(*) INTO v_customer_count FROM public.customers;
  SELECT count(*) INTO v_order_count FROM public.orders;
  SELECT count(*) INTO v_deleted_order_count FROM public.deleted_orders;
  SELECT count(*) INTO v_purchase_count FROM public.purchase_orders;
  SELECT count(*) INTO v_batch_count FROM public.product_batches;

  INSERT INTO public.zidu_admin_reset_backups(reset_type, payload)
  SELECT 'LAUNCH_CLEAN_BASELINE_100', jsonb_build_object(
    'customers', (
      SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB)
      FROM public.customers row_data
    ),
    'customer_notes', (
      SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB)
      FROM public.customer_notes row_data
    ),
    'sales_tasks', (
      SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB)
      FROM public.sales_tasks row_data
    ),
    'orders', (
      SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB)
      FROM public.orders row_data
    ),
    'order_items', (
      SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB)
      FROM public.order_items row_data
    ),
    'order_logs', (
      SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB)
      FROM public.order_logs row_data
    ),
    'shipments', (
      SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB)
      FROM public.shipments row_data
    ),
    'shipment_notifications', (
      SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB)
      FROM public.shipment_notifications row_data
    ),
    'payment_records', (
      SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB)
      FROM public.payment_records row_data
    ),
    'after_sales', (
      SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB)
      FROM public.after_sales row_data
    ),
    'deleted_orders', (
      SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB)
      FROM public.deleted_orders row_data
    ),
    'purchase_orders', (
      SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB)
      FROM public.purchase_orders row_data
    ),
    'purchase_order_items', (
      SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB)
      FROM public.purchase_order_items row_data
    ),
    'product_batches', (
      SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB)
      FROM public.product_batches row_data
    ),
    'batch_stock_movements', (
      SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB)
      FROM public.batch_stock_movements row_data
    ),
    'stock_adjustments', (
      SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB)
      FROM public.stock_adjustments row_data
    ),
    'audit_logs', (
      SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB)
      FROM public.audit_logs row_data
    ),
    'products_inventory', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', id,
        'code', code,
        'channel', channel,
        'inventory_mode', inventory_mode,
        'base_stock_kg', base_stock_kg
      )), '[]'::JSONB)
      FROM public.products
    ),
    'spec_inventory', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', id,
        'product_id', product_id,
        'spec', spec,
        'stock', stock,
        'safe_stock', safe_stock
      )), '[]'::JSONB)
      FROM public.product_specs
    )
  )
  RETURNING id INTO v_backup_id;

  -- 订单和客户业务数据。
  DELETE FROM public.shipment_notifications;
  DELETE FROM public.after_sales;
  DELETE FROM public.payment_records;
  DELETE FROM public.shipments;
  DELETE FROM public.order_logs;
  DELETE FROM public.order_items;
  DELETE FROM public.orders;
  DELETE FROM public.deleted_orders;
  DELETE FROM public.sales_tasks;
  DELETE FROM public.customer_notes;
  DELETE FROM public.customers;

  -- 采购、批次与旧库存流水。
  DELETE FROM public.batch_stock_movements;
  DELETE FROM public.stock_adjustments;
  DELETE FROM public.product_batches;
  DELETE FROM public.purchase_order_items;
  DELETE FROM public.purchase_orders;

  -- 测试期操作日志和登录尝试摘要。
  DELETE FROM public.audit_logs;
  DELETE FROM public.zidu_auth_login_attempts;

  -- 先归零所有销售规格，避免重量库存触发器反向改写 kg。
  PERFORM set_config('zidu.syncing_mass_stock', 'on', true);
  UPDATE public.product_specs SET stock = 0;
  PERFORM set_config('zidu.syncing_mass_stock', 'off', true);

  -- 原料统一按产品独立管理 100kg；各 ml/g/kg 销售规格会按
  -- 该产品自己的密度自动换算可售数量。
  UPDATE public.products
  SET inventory_mode = CASE WHEN channel = 'RAW' THEN 'MASS' ELSE 'SKU' END,
      base_stock_kg = CASE WHEN channel = 'RAW' THEN 100 ELSE 0 END;

  -- 即使原料原本已经是 MASS / 100kg，也强制重算各销售规格的可售件数。
  -- 否则“先把规格归零”后，产品值没有变化时不会触发自动同步。
  PERFORM public.zidu_sync_mass_spec_stock(p.id)
  FROM public.products p
  WHERE p.channel = 'RAW';

  -- 成品与包材按每个独立销售规格 100瓶/个初始化。
  UPDATE public.product_specs s
  SET stock = 100
  FROM public.products p
  WHERE p.id = s.product_id
    AND coalesce(p.channel, 'BOTH') <> 'RAW';

  -- 留下正式的上线初始盘点流水，不使用“测试库存”字样。
  INSERT INTO public.stock_adjustments(
    spec_id, product_id, type, reason, quantity,
    before_stock, after_stock,
    quantity_kg, before_stock_kg, after_stock_kg,
    note, operator_name
  )
  SELECT
    first_spec.id,
    p.id,
    'CORRECTION',
    'CORRECTION',
    100,
    0,
    first_spec.stock,
    100,
    0,
    100,
    '上线初始盘点',
    '系统初始化'
  FROM public.products p
  JOIN LATERAL (
    SELECT s.id, s.stock
    FROM public.product_specs s
    WHERE s.product_id = p.id
    ORDER BY
      CASE WHEN s.spec ~* '(kg|公斤|千克|g|克)' THEN 0 ELSE 1 END,
      s.id
    LIMIT 1
  ) first_spec ON true
  WHERE p.channel = 'RAW';

  INSERT INTO public.stock_adjustments(
    spec_id, product_id, type, reason, quantity,
    before_stock, after_stock,
    quantity_kg, before_stock_kg, after_stock_kg,
    note, operator_name
  )
  SELECT
    s.id,
    s.product_id,
    'CORRECTION',
    'CORRECTION',
    100,
    0,
    100,
    NULL,
    NULL,
    NULL,
    '上线初始盘点',
    '系统初始化'
  FROM public.product_specs s
  JOIN public.products p ON p.id = s.product_id
  WHERE coalesce(p.channel, 'BOTH') <> 'RAW';

  SELECT count(*) INTO v_raw_count
  FROM public.products WHERE channel = 'RAW';
  SELECT count(*) INTO v_finished_spec_count
  FROM public.product_specs s
  JOIN public.products p ON p.id = s.product_id
  WHERE coalesce(p.channel, 'BOTH') <> 'RAW';

  RETURN jsonb_build_object(
    'success', true,
    'backup_id', v_backup_id,
    'deleted_customers', v_customer_count,
    'deleted_orders', v_order_count,
    'deleted_recycle_orders', v_deleted_order_count,
    'deleted_purchase_orders', v_purchase_count,
    'deleted_batches', v_batch_count,
    'raw_products_set_to_100kg', v_raw_count,
    'finished_specs_set_to_100', v_finished_spec_count,
    'remaining_customers', (SELECT count(*) FROM public.customers),
    'remaining_orders', (SELECT count(*) FROM public.orders),
    'remaining_purchase_orders', (SELECT count(*) FROM public.purchase_orders),
    'raw_stock_min_kg', (
      SELECT min(base_stock_kg) FROM public.products WHERE channel = 'RAW'
    ),
    'raw_stock_max_kg', (
      SELECT max(base_stock_kg) FROM public.products WHERE channel = 'RAW'
    ),
    'finished_stock_min', (
      SELECT min(s.stock)
      FROM public.product_specs s
      JOIN public.products p ON p.id = s.product_id
      WHERE coalesce(p.channel, 'BOTH') <> 'RAW'
    ),
    'finished_stock_max', (
      SELECT max(s.stock)
      FROM public.product_specs s
      JOIN public.products p ON p.id = s.product_id
      WHERE coalesce(p.channel, 'BOTH') <> 'RAW'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.zidu_prepare_launch_baseline_100(TEXT)
  FROM PUBLIC, anon, authenticated;

SELECT public.zidu_prepare_launch_baseline_100(
  'CLEAN_ZIDU_LAUNCH_100'
) AS launch_reset_result;
