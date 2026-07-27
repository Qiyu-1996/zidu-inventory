-- ============================================================
-- ZIDU v48: 基础油销售规格统一为 ml；新增“公司”客户类型
-- 例：500g -> 500ml，1kg -> 1000ml，5kg -> 5000ml。
-- 仅处理“基础油”系列，不会修改单方精油等其他原料规格。
-- ============================================================

CREATE OR REPLACE FUNCTION public.zidu_base_oil_volume_spec(p_spec TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  normalized TEXT := lower(regexp_replace(trim(coalesce(p_spec, '')), '[[:space:]]+', '', 'g'));
  matched TEXT[];
  amount_ml NUMERIC;
  amount_text TEXT;
BEGIN
  matched := regexp_match(
    normalized,
    '^([0-9]+([.][0-9]+)?)(kg|公斤|千克|g|克)$'
  );
  IF matched IS NULL THEN
    RETURN trim(coalesce(p_spec, ''));
  END IF;

  amount_ml := matched[1]::NUMERIC;
  IF matched[3] IN ('kg', '公斤', '千克') THEN
    amount_ml := amount_ml * 1000;
  END IF;

  amount_text := amount_ml::TEXT;
  IF position('.' IN amount_text) > 0 THEN
    amount_text := regexp_replace(amount_text, '0+$', '');
    amount_text := regexp_replace(amount_text, '[.]$', '');
  END IF;
  RETURN amount_text || 'ml';
END;
$$;

-- 保留已有规格 ID。如果同一产品同时存在 500g 和 500ml，
-- 先把所有 spec_id 关联转到 ml 记录，再删除重复的重量记录。
DO $$
DECLARE
  old_spec RECORD;
  ref_column RECORD;
  keep_spec_id INTEGER;
BEGIN
  FOR old_spec IN
    SELECT
      s.id,
      s.product_id,
      s.spec,
      p.inventory_mode,
      public.zidu_base_oil_volume_spec(s.spec) AS volume_spec
    FROM public.product_specs s
    JOIN public.products p ON p.id = s.product_id
    WHERE coalesce(p.series, '') ILIKE '%基础油%'
      AND public.zidu_base_oil_volume_spec(s.spec) IS DISTINCT FROM trim(s.spec)
    ORDER BY s.id
  LOOP
    SELECT s.id
      INTO keep_spec_id
    FROM public.product_specs s
    WHERE s.product_id = old_spec.product_id
      AND lower(regexp_replace(trim(s.spec), '[[:space:]]+', '', 'g')) = lower(old_spec.volume_spec)
      AND s.id <> old_spec.id
    ORDER BY s.id
    LIMIT 1;

    IF keep_spec_id IS NULL THEN
      UPDATE public.product_specs
      SET spec = old_spec.volume_spec
      WHERE id = old_spec.id;
    ELSE
      -- 同步订单、批次、采购和库存流水等现有关联。
      FOR ref_column IN
        SELECT c.table_name
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema
         AND t.table_name = c.table_name
         AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public'
          AND c.column_name = 'spec_id'
          AND c.table_name <> 'product_specs'
      LOOP
        EXECUTE format(
          'UPDATE public.%I SET spec_id = $1 WHERE spec_id = $2',
          ref_column.table_name
        ) USING keep_spec_id, old_spec.id;
      END LOOP;

      UPDATE public.product_specs target
      SET price = CASE WHEN coalesce(target.price, 0) > 0 THEN target.price ELSE source.price END,
          cost = CASE WHEN coalesce(target.cost, 0) > 0 THEN target.cost ELSE source.cost END,
          safe_stock = greatest(coalesce(target.safe_stock, 0), coalesce(source.safe_stock, 0)),
          stock = CASE
            WHEN old_spec.inventory_mode = 'MASS' THEN target.stock
            ELSE greatest(coalesce(target.stock, 0), coalesce(source.stock, 0))
          END
      FROM public.product_specs source
      WHERE target.id = keep_spec_id
        AND source.id = old_spec.id;

      DELETE FROM public.product_specs WHERE id = old_spec.id;
    END IF;

    keep_spec_id := NULL;
  END LOOP;

  -- 按每款基础油自己的密度重新计算可售规格数；总 kg 不变。
  IF to_regprocedure('public.zidu_sync_mass_spec_stock(integer)') IS NOT NULL THEN
    PERFORM public.zidu_sync_mass_spec_stock(p.id)
    FROM public.products p
    WHERE coalesce(p.series, '') ILIKE '%基础油%'
      AND p.inventory_mode = 'MASS';
  END IF;
END;
$$;

-- 防止网页、小程序或以后的导入再把基础油写成 g/kg。
CREATE OR REPLACE FUNCTION public.zidu_normalize_base_oil_spec_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  product_series TEXT;
BEGIN
  SELECT p.series INTO product_series
  FROM public.products p
  WHERE p.id = NEW.product_id;

  IF coalesce(product_series, '') ILIKE '%基础油%' THEN
    NEW.spec := public.zidu_base_oil_volume_spec(NEW.spec);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zidu_normalize_base_oil_spec ON public.product_specs;
CREATE TRIGGER trg_zidu_normalize_base_oil_spec
BEFORE INSERT OR UPDATE OF product_id, spec ON public.product_specs
FOR EACH ROW
EXECUTE FUNCTION public.zidu_normalize_base_oil_spec_row();

INSERT INTO public.config_options (category, value, sort_order, is_active)
SELECT 'CUSTOMER_TYPE', '公司', coalesce(max(sort_order), 0) + 1, true
FROM public.config_options
WHERE category = 'CUSTOMER_TYPE'
ON CONFLICT (category, value) DO UPDATE SET is_active = true;

INSERT INTO public.config_options (category, value, sort_order, is_active)
VALUES
  ('SPEC_OPTION', '1000ml', 8, true),
  ('SPEC_OPTION', '5000ml', 9, true)
ON CONFLICT (category, value) DO UPDATE SET is_active = true;

-- 修复仓库采购单脱敏查询的关联字段，并确认仓库接口权限。
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

-- 脱敏接口仍不返回售价、成本和订单金额。
GRANT EXECUTE ON FUNCTION public.zidu_warehouse_products() TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_warehouse_orders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_warehouse_purchase_orders() TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_warehouse_batches() TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_warehouse_suppliers() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- 执行成功后：remaining_weight_specs 应为 0，company_customer_type 应为 1。
SELECT
  count(*) FILTER (
    WHERE coalesce(p.series, '') ILIKE '%基础油%'
      AND s.spec ~* '^[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*(kg|公斤|千克|g|克)[[:space:]]*$'
  ) AS remaining_weight_specs,
  count(*) FILTER (
    WHERE coalesce(p.series, '') ILIKE '%基础油%'
      AND s.spec ~* '^[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*ml[[:space:]]*$'
  ) AS base_oil_ml_specs,
  (SELECT count(*) FROM public.config_options
    WHERE category = 'CUSTOMER_TYPE' AND value = '公司' AND is_active) AS company_customer_type
FROM public.products p
LEFT JOIN public.product_specs s ON s.product_id = p.id;
