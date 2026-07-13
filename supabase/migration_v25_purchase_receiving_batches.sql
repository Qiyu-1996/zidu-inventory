-- ============================================================
-- ZIDU v25: 采购收货与批次、库存、流水完整关联
-- 依赖：migration_v21、migration_v22、migration_v23、migration_v24
--
-- 原料采购数量与收货统一使用 kg；成品/包材使用具体规格数量。
-- 一次收货在同一事务中更新采购进度、创建批次、增加库存并写库存流水。
-- ============================================================

ALTER TABLE public.product_batches
  ADD COLUMN IF NOT EXISTS purchase_order_id INTEGER
    REFERENCES public.purchase_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purchase_order_item_id INTEGER
    REFERENCES public.purchase_order_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_product_batches_purchase_order
  ON public.product_batches(purchase_order_id);
CREATE INDEX IF NOT EXISTS idx_product_batches_purchase_order_item
  ON public.product_batches(purchase_order_item_id);

CREATE OR REPLACE FUNCTION public.zidu_receive_purchase_order(
  p_po_id INTEGER,
  p_items JSONB,
  p_operator_name TEXT DEFAULT ''
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  po public.purchase_orders%ROWTYPE;
  req JSONB;
  line public.purchase_order_items%ROWTYPE;
  prod public.products%ROWTYPE;
  batch public.product_batches%ROWTYPE;
  adjusted JSON;
  receive_qty NUMERIC;
  has_volume_spec BOOLEAN;
  all_received BOOLEAN;
  some_received BOOLEAN;
  effective_density NUMERIC;
  quantity_unit TEXT;
  received_on DATE;
  expires_on DATE;
  received_lines INTEGER := 0;
  batch_no_value TEXT;
  batch_note TEXT;
BEGIN
  SELECT * INTO po
  FROM public.purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF po.id IS NULL THEN RETURN json_build_object('error', '采购单不存在'); END IF;
  IF po.status NOT IN ('ORDERED', 'PARTIAL_RECEIVED') THEN
    RETURN json_build_object('error', '只有待收货或部分收货的采购单可以收货');
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN json_build_object('error', '请输入收货数量');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) item
    GROUP BY item->>'itemId'
    HAVING count(*) > 1
  ) THEN
    RETURN json_build_object('error', '同一采购明细不能重复提交');
  END IF;

  -- 先校验并锁定全部明细。校验阶段不改数据，避免多行收货时出现部分成功。
  FOR req IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    receive_qty := coalesce((req->>'receiveQty')::NUMERIC, 0);

    SELECT * INTO line
    FROM public.purchase_order_items
    WHERE id = (req->>'itemId')::INTEGER
      AND po_id = po.id
    FOR UPDATE;

    IF line.id IS NULL THEN RETURN json_build_object('error', '采购明细不存在'); END IF;
    IF receive_qty <= 0 OR line.received_qty + receive_qty > line.quantity THEN
      RETURN json_build_object('error', line.product_name || ' 的收货数量超过待收数量');
    END IF;

    SELECT * INTO prod
    FROM public.products
    WHERE id = line.product_id
    FOR UPDATE;

    IF prod.id IS NULL THEN RETURN json_build_object('error', '采购产品不存在'); END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.product_specs
      WHERE id = line.spec_id AND product_id = line.product_id
    ) THEN
      RETURN json_build_object('error', line.product_name || ' 的库存规格不存在');
    END IF;

    effective_density := coalesce(prod.density_g_ml, nullif((req->>'densityGml')::NUMERIC, 0));
    IF prod.channel = 'RAW' THEN
      SELECT exists(
        SELECT 1 FROM public.product_specs x
        WHERE x.product_id = prod.id
          AND x.spec ~* '^[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*(ml|毫升|l|升)'
      ) INTO has_volume_spec;
      IF has_volume_spec AND coalesce(effective_density, 0) <= 0 THEN
        RETURN json_build_object('error', prod.name || ' 缺少库存换算密度，暂时不能收货');
      END IF;
    END IF;
  END LOOP;

  FOR req IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    receive_qty := coalesce((req->>'receiveQty')::NUMERIC, 0);

    SELECT * INTO line
    FROM public.purchase_order_items
    WHERE id = (req->>'itemId')::INTEGER
      AND po_id = po.id
    FOR UPDATE;

    SELECT * INTO prod
    FROM public.products
    WHERE id = line.product_id
    FOR UPDATE;

    effective_density := coalesce(prod.density_g_ml, nullif((req->>'densityGml')::NUMERIC, 0));
    IF prod.channel = 'RAW' THEN
      UPDATE public.products
      SET inventory_mode = 'MASS',
          density_g_ml = effective_density,
          density_temperature_c = coalesce((req->>'densityTemperatureC')::NUMERIC, density_temperature_c, 20),
          density_status = CASE WHEN effective_density > 0 THEN 'REFERENCE' ELSE density_status END
      WHERE id = prod.id;
      prod.inventory_mode := 'MASS';
    END IF;

    quantity_unit := CASE WHEN prod.channel = 'RAW' OR prod.inventory_mode = 'MASS' THEN 'KG' ELSE 'SPEC' END;
    received_on := coalesce(nullif(req->>'receivedDate', '')::DATE, CURRENT_DATE);
    expires_on := nullif(req->>'expiryDate', '')::DATE;
    batch_no_value := coalesce(
      nullif(trim(coalesce(req->>'batchNo', '')), ''),
      po.po_no || '-' || line.id || '-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS')
    );
    batch_note := '采购单 ' || po.po_no
      || CASE WHEN nullif(trim(coalesce(req->>'note', '')), '') IS NOT NULL
              THEN ' · ' || trim(req->>'note') ELSE '' END;

    INSERT INTO public.product_batches (
      batch_no, product_id, spec_id, gcms_no, received_date, expiry_date,
      initial_qty, remaining_qty, unit_cost, supplier, note,
      purchase_order_id, purchase_order_item_id
    ) VALUES (
      batch_no_value, line.product_id, line.spec_id,
      nullif(trim(coalesce(req->>'gcmsNo', '')), ''), received_on, expires_on,
      receive_qty, receive_qty, coalesce(line.unit_cost, 0), po.supplier, batch_note,
      po.id, line.id
    ) RETURNING * INTO batch;

    adjusted := public.zidu_adjust_inventory(line.spec_id, 'IN', receive_qty, quantity_unit);

    UPDATE public.purchase_order_items
    SET received_qty = received_qty + receive_qty
    WHERE id = line.id;

    INSERT INTO public.stock_adjustments (
      spec_id, product_id, type, reason, quantity, before_stock, after_stock,
      quantity_kg, before_stock_kg, after_stock_kg,
      note, operator_name, batch_id
    ) VALUES (
      line.spec_id, line.product_id, 'IN', 'PURCHASE', receive_qty,
      (adjusted->>'before')::NUMERIC, (adjusted->>'after')::NUMERIC,
      nullif(adjusted->>'quantityKg', '')::NUMERIC,
      nullif(adjusted->>'beforeKg', '')::NUMERIC,
      nullif(adjusted->>'afterKg', '')::NUMERIC,
      batch_note || ' · 批次 ' || batch.batch_no,
      coalesce(p_operator_name, ''), batch.id
    );

    received_lines := received_lines + 1;
  END LOOP;

  SELECT bool_and(received_qty >= quantity), bool_or(received_qty > 0)
  INTO all_received, some_received
  FROM public.purchase_order_items
  WHERE po_id = po.id;

  UPDATE public.purchase_orders
  SET status = CASE
    WHEN all_received THEN 'RECEIVED'
    WHEN some_received THEN 'PARTIAL_RECEIVED'
    ELSE 'ORDERED'
  END
  WHERE id = po.id;

  RETURN json_build_object(
    'success', true,
    'purchaseOrderId', po.id,
    'receivedLines', received_lines,
    'status', CASE WHEN all_received THEN 'RECEIVED' ELSE 'PARTIAL_RECEIVED' END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.zidu_receive_purchase_order(INTEGER, JSONB, TEXT)
  TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- 正确结果：两个新增字段均为 true，函数存在为 true。
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'product_batches'
      AND column_name = 'purchase_order_id'
  ) AS has_purchase_order_id,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'product_batches'
      AND column_name = 'purchase_order_item_id'
  ) AS has_purchase_order_item_id,
  to_regprocedure('public.zidu_receive_purchase_order(integer,jsonb,text)') IS NOT NULL
    AS has_receive_function;
