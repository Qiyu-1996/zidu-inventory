-- ZIDU 订单与库存初始化：清空历史订单，原料=1kg，成品/包材每个规格=10瓶/个。
-- 这是破坏性操作。产品、价格、客户、用户、供应商和采购单不会删除。
-- 执行前会把订单与库存历史保存到仅数据库管理员可见的备份表。

CREATE TABLE IF NOT EXISTS public.zidu_admin_reset_backups (
  id BIGSERIAL PRIMARY KEY,
  reset_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.zidu_admin_reset_backups FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.zidu_admin_reset_backups_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.zidu_reset_orders_and_inventory(p_confirmation TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_backup_id BIGINT;
  v_order_count INTEGER;
  v_deleted_order_count INTEGER;
  v_batch_count INTEGER;
  v_adjustment_count INTEGER;
  v_raw_count INTEGER := 0;
  v_finished_spec_count INTEGER := 0;
  v_preflight_issue TEXT;
  v_product RECORD;
  v_spec RECORD;
  v_adjusted JSON;
BEGIN
  IF p_confirmation IS DISTINCT FROM 'RESET_ZIDU_BASELINE' THEN
    RAISE EXCEPTION '确认文字不正确，未执行重置';
  END IF;

  -- 删除任何数据前先确认原料资料足以完成 kg 与销售规格换算。
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
    RAISE EXCEPTION '原料 % 没有销售规格，未执行任何重置', v_preflight_issue;
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
    RAISE EXCEPTION '原料 % 有 ml/L 规格但没有有效密度，未执行任何重置', v_preflight_issue;
  END IF;

  -- 页面仍有人操作时快速失败，避免长时间等待或造成死锁。
  PERFORM set_config('lock_timeout', '5s', true);

  LOCK TABLE public.orders IN ACCESS EXCLUSIVE MODE;
  LOCK TABLE public.products IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.product_specs IN SHARE ROW EXCLUSIVE MODE;

  SELECT count(*) INTO v_order_count FROM public.orders;
  SELECT count(*) INTO v_deleted_order_count FROM public.deleted_orders;
  SELECT count(*) INTO v_batch_count FROM public.product_batches;
  SELECT count(*) INTO v_adjustment_count FROM public.stock_adjustments;

  INSERT INTO public.zidu_admin_reset_backups(reset_type, payload)
  SELECT 'ORDERS_AND_INVENTORY_BASELINE', jsonb_build_object(
    'orders', (SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB) FROM public.orders row_data),
    'order_items', (SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB) FROM public.order_items row_data),
    'order_logs', (SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB) FROM public.order_logs row_data),
    'shipments', (SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB) FROM public.shipments row_data),
    'shipment_notifications', (SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB) FROM public.shipment_notifications row_data),
    'payment_records', (SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB) FROM public.payment_records row_data),
    'after_sales', (SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB) FROM public.after_sales row_data),
    'deleted_orders', (SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB) FROM public.deleted_orders row_data),
    'products_inventory', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'code', code, 'channel', channel,
        'inventory_mode', inventory_mode, 'base_stock_kg', base_stock_kg
      )), '[]'::JSONB)
      FROM public.products
    ),
    'spec_inventory', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'product_id', product_id, 'spec', spec,
        'stock', stock, 'safe_stock', safe_stock
      )), '[]'::JSONB)
      FROM public.product_specs
    ),
    'product_batches', (SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB) FROM public.product_batches row_data),
    'batch_stock_movements', (SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB) FROM public.batch_stock_movements row_data),
    'stock_adjustments', (SELECT coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::JSONB) FROM public.stock_adjustments row_data)
  )
  RETURNING id INTO v_backup_id;

  -- 先清子表，避免已收款/售后订单的删除保护阻止初始化。
  DELETE FROM public.shipment_notifications;
  DELETE FROM public.after_sales;
  DELETE FROM public.payment_records;
  DELETE FROM public.shipments;
  DELETE FROM public.order_logs;
  DELETE FROM public.order_items;
  DELETE FROM public.orders;
  DELETE FROM public.deleted_orders;

  -- 旧批次与旧库存流水会和统一初始库存冲突，因此一并清空；采购单本身保留。
  DELETE FROM public.batch_stock_movements;
  DELETE FROM public.stock_adjustments;
  DELETE FROM public.product_batches;

  -- 先把所有库存归零。使用会话标记，避免重量库存规格触发器反向改写 kg。
  PERFORM set_config('zidu.syncing_mass_stock', 'on', true);
  UPDATE public.product_specs SET stock = 0;
  PERFORM set_config('zidu.syncing_mass_stock', 'off', true);

  UPDATE public.products
  SET inventory_mode = CASE WHEN channel = 'RAW' THEN 'MASS' ELSE 'SKU' END,
      base_stock_kg = 0;

  -- 每个原料产品统一设置为 1kg；销售规格按该精油自己的密度自动换算。
  FOR v_product IN
    SELECT id, density_g_ml, density_temperature_c
    FROM public.products
    WHERE channel = 'RAW'
    ORDER BY id
  LOOP
    PERFORM public.zidu_adjust_raw_inventory(
      v_product.id,
      'CORRECTION',
      1,
      'CORRECTION',
      '初始库存盘点：1kg',
      '系统初始化',
      v_product.density_g_ml,
      coalesce(v_product.density_temperature_c, 20)
    );
    v_raw_count := v_raw_count + 1;
  END LOOP;

  -- 非原料产品按每个销售规格 10瓶/个设置，规格之间独立计数。
  FOR v_spec IN
    SELECT s.id AS spec_id, s.product_id
    FROM public.product_specs s
    JOIN public.products p ON p.id = s.product_id
    WHERE coalesce(p.channel, 'BOTH') <> 'RAW'
    ORDER BY s.id
  LOOP
    v_adjusted := public.zidu_adjust_inventory(v_spec.spec_id, 'CORRECTION', 10, 'SPEC');
    INSERT INTO public.stock_adjustments(
      spec_id, product_id, type, reason, quantity,
      before_stock, after_stock, quantity_kg, before_stock_kg, after_stock_kg,
      note, operator_name
    ) VALUES (
      v_spec.spec_id, v_spec.product_id, 'CORRECTION', 'CORRECTION',
      abs(coalesce((v_adjusted->>'after')::NUMERIC, 0) - coalesce((v_adjusted->>'before')::NUMERIC, 0)),
      (v_adjusted->>'before')::NUMERIC,
      (v_adjusted->>'after')::NUMERIC,
      nullif(v_adjusted->>'quantityKg', '')::NUMERIC,
      nullif(v_adjusted->>'beforeKg', '')::NUMERIC,
      nullif(v_adjusted->>'afterKg', '')::NUMERIC,
      '初始库存盘点：10瓶/个',
      '系统初始化'
    );
    v_finished_spec_count := v_finished_spec_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'backup_id', v_backup_id,
    'deleted_orders', v_order_count,
    'deleted_recycle_orders', v_deleted_order_count,
    'deleted_batches', v_batch_count,
    'deleted_stock_adjustments', v_adjustment_count,
    'raw_products_set_to_1kg', v_raw_count,
    'finished_specs_set_to_10', v_finished_spec_count,
    'remaining_orders', (SELECT count(*) FROM public.orders),
    'raw_stock_min_kg', (SELECT min(base_stock_kg) FROM public.products WHERE channel = 'RAW'),
    'raw_stock_max_kg', (SELECT max(base_stock_kg) FROM public.products WHERE channel = 'RAW'),
    'finished_stock_min', (
      SELECT min(s.stock) FROM public.product_specs s
      JOIN public.products p ON p.id = s.product_id
      WHERE coalesce(p.channel, 'BOTH') <> 'RAW'
    ),
    'finished_stock_max', (
      SELECT max(s.stock) FROM public.product_specs s
      JOIN public.products p ON p.id = s.product_id
      WHERE coalesce(p.channel, 'BOTH') <> 'RAW'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.zidu_reset_orders_and_inventory(TEXT) FROM PUBLIC, anon, authenticated;

SELECT public.zidu_reset_orders_and_inventory('RESET_ZIDU_BASELINE') AS reset_result;
