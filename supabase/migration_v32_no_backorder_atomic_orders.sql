-- ZIDU v32: 禁止缺货预订，并把下单与扣库存合并为一个原子事务。
-- 依赖：migration_v19_mass_inventory.sql、migration_v29_sales_commission.sql。
-- 可重复运行；不会修改已有订单和已有库存。

CREATE OR REPLACE FUNCTION public.zidu_create_order_atomic(p_order JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_item JSONB;
  v_log JSONB;
  v_stock RECORD;
  v_adjustment JSON;
  v_quantity INTEGER;
  v_operator TEXT := coalesce(p_order #>> '{logs,0,user}', '');
BEGIN
  IF p_order IS NULL OR jsonb_typeof(p_order) <> 'object' THEN
    RAISE EXCEPTION '订单数据无效';
  END IF;
  IF coalesce(jsonb_array_length(coalesce(p_order->'items', '[]'::JSONB)), 0) = 0 THEN
    RAISE EXCEPTION '订单中没有商品';
  END IF;

  -- 重量库存会联动同一产品的全部规格，因此先按统一顺序锁住相关产品的
  -- 全部规格，再锁产品。这样既避免超卖，也与库存调整函数的锁顺序一致。
  PERFORM 1
    FROM public.product_specs
   WHERE product_id IN (
     SELECT DISTINCT ps.product_id
       FROM public.product_specs ps
      WHERE ps.id IN (
        SELECT DISTINCT (item->>'specId')::INTEGER
          FROM jsonb_array_elements(coalesce(p_order->'items', '[]'::JSONB)) item
         WHERE nullif(item->>'specId', '') IS NOT NULL
      )
   )
   ORDER BY id
   FOR UPDATE;

  PERFORM 1
    FROM public.products
   WHERE id IN (
     SELECT DISTINCT ps.product_id
       FROM public.product_specs ps
      WHERE ps.id IN (
        SELECT DISTINCT (item->>'specId')::INTEGER
       FROM jsonb_array_elements(coalesce(p_order->'items', '[]'::JSONB)) item
       WHERE nullif(item->>'specId', '') IS NOT NULL
      )
   )
   ORDER BY id
   FOR UPDATE;

  -- 同一规格即使出现多行也合并校验；缺一件都不创建订单。
  FOR v_stock IN
    SELECT
      (item->>'specId')::INTEGER AS spec_id,
      sum((item->>'quantity')::INTEGER)::INTEGER AS required,
      min(coalesce(item->>'productName', '商品')) AS product_name,
      min(coalesce(item->>'spec', '')) AS spec_name
    FROM jsonb_array_elements(coalesce(p_order->'items', '[]'::JSONB)) item
    WHERE nullif(item->>'specId', '') IS NOT NULL
    GROUP BY (item->>'specId')::INTEGER
    ORDER BY (item->>'specId')::INTEGER
  LOOP
    IF v_stock.required <= 0 THEN
      RAISE EXCEPTION '% % 数量无效', v_stock.product_name, v_stock.spec_name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.product_specs
       WHERE id = v_stock.spec_id AND stock >= v_stock.required
    ) THEN
      RAISE EXCEPTION '% % 库存不足，无法下单', v_stock.product_name, v_stock.spec_name;
    END IF;
  END LOOP;

  INSERT INTO public.orders (
    order_no, customer_id, sales_id, status,
    subtotal, discount_percent, discount_amount, total,
    notes, business_type, created_at, source, channel_meta,
    discount_responsibility, discount_reason,
    discount_responsibility_updated_by, discount_responsibility_updated_at
  ) VALUES (
    p_order->>'orderNo', nullif(p_order->>'customerId', '')::INTEGER,
    nullif(p_order->>'salesId', '')::INTEGER, coalesce(nullif(p_order->>'status', ''), 'SUBMITTED'),
    coalesce((p_order->>'subtotal')::NUMERIC, 0),
    coalesce((p_order->>'discountPercent')::NUMERIC, 0),
    coalesce((p_order->>'discountAmount')::NUMERIC, 0),
    coalesce((p_order->>'total')::NUMERIC, 0),
    coalesce(p_order->>'notes', ''), coalesce(nullif(p_order->>'businessType', ''), '院线'),
    coalesce(nullif(p_order->>'createdAt', '')::DATE, current_date),
    coalesce(nullif(p_order->>'source', ''), 'sales_miniprogram'),
    coalesce(p_order->'channelMeta', '{}'::JSONB),
    CASE WHEN p_order->>'discountResponsibility' = 'SALES' THEN 'SALES' ELSE 'COMPANY' END,
    coalesce(p_order->>'discountReason', ''),
    coalesce(p_order->>'discountResponsibilityUpdatedBy', ''),
    nullif(p_order->>'discountResponsibilityUpdatedAt', '')::TIMESTAMPTZ
  ) RETURNING * INTO v_order;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_order->'items')
  LOOP
    v_quantity := coalesce((v_item->>'quantity')::INTEGER, 0);
    IF v_quantity <= 0 THEN
      RAISE EXCEPTION '% % 数量无效', coalesce(v_item->>'productName', '商品'), coalesce(v_item->>'spec', '');
    END IF;
    INSERT INTO public.order_items (
      order_id, product_id, spec_id, product_name, product_code,
      spec, quantity, unit_price, unit_cost, subtotal
    ) VALUES (
      v_order.id, nullif(v_item->>'productId', '')::INTEGER,
      nullif(v_item->>'specId', '')::INTEGER,
      coalesce(v_item->>'productName', ''), coalesce(v_item->>'productCode', ''),
      coalesce(v_item->>'spec', ''), v_quantity,
      coalesce((v_item->>'unitPrice')::NUMERIC, 0),
      coalesce((v_item->>'unitCost')::NUMERIC, 0),
      coalesce((v_item->>'subtotal')::NUMERIC, 0)
    );
  END LOOP;

  FOR v_log IN SELECT value FROM jsonb_array_elements(coalesce(p_order->'logs', '[]'::JSONB))
  LOOP
    INSERT INTO public.order_logs (order_id, time, user_name, action)
    VALUES (
      v_order.id, coalesce(v_log->>'time', ''),
      coalesce(v_log->>'user', ''), coalesce(v_log->>'action', '')
    );
  END LOOP;

  -- 扣库存与写流水也在本事务中；任一规格不足时，上面的订单及明细全部回滚。
  FOR v_stock IN
    SELECT
      (item->>'specId')::INTEGER AS spec_id,
      sum((item->>'quantity')::INTEGER)::INTEGER AS required,
      min(nullif(item->>'productId', '')::INTEGER) AS product_id
    FROM jsonb_array_elements(p_order->'items') item
    WHERE nullif(item->>'specId', '') IS NOT NULL
    GROUP BY (item->>'specId')::INTEGER
    ORDER BY (item->>'specId')::INTEGER
  LOOP
    v_adjustment := public.zidu_adjust_inventory(v_stock.spec_id, 'OUT', v_stock.required, 'SPEC');
    INSERT INTO public.stock_adjustments (
      spec_id, product_id, type, reason, quantity,
      before_stock, after_stock, quantity_kg, before_stock_kg, after_stock_kg,
      note, operator_name
    ) VALUES (
      v_stock.spec_id, v_stock.product_id, 'OUT', 'ORDER', v_stock.required,
      (v_adjustment->>'before')::NUMERIC, (v_adjustment->>'after')::NUMERIC,
      nullif(v_adjustment->>'quantityKg', '')::NUMERIC,
      nullif(v_adjustment->>'beforeKg', '')::NUMERIC,
      nullif(v_adjustment->>'afterKg', '')::NUMERIC,
      '订单 ' || v_order.order_no, v_operator
    );
  END LOOP;

  RETURN jsonb_build_object('id', v_order.id, 'orderNo', v_order.order_no);
END;
$$;

REVOKE ALL ON FUNCTION public.zidu_create_order_atomic(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.zidu_create_order_atomic(JSONB) TO anon, authenticated;

COMMENT ON FUNCTION public.zidu_create_order_atomic(JSONB)
  IS '原子创建订单并扣减库存；库存不足时整单回滚，禁止缺货预订。';

SELECT to_regprocedure('public.zidu_create_order_atomic(jsonb)') IS NOT NULL AS atomic_order_ready;
