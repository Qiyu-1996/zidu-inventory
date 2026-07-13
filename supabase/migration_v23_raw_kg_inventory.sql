-- ============================================================
-- ZIDU v23: 原料统一按 kg 管理；成品继续按规格瓶数管理
-- 依赖：migration_v19_mass_inventory.sql、migration_v21_batch_delete_and_kg_receiving.sql
-- ============================================================

-- 清除导入阶段统一写入的 999 占位库存。非 999 的真实盘点数不会受影响；
-- 成品之后按 2ml/5ml/15ml 等规格分别录入瓶数。
UPDATE public.product_specs
SET stock = 0
WHERE stock = 999;

-- 清除旧原料规格上的独立库存。原料的唯一库存来源改为
-- products.base_stock_kg，不能保留第二套规格库存。
UPDATE public.product_specs s
SET stock = 0
FROM public.products p
WHERE p.id = s.product_id
  AND p.channel = 'RAW'
  AND p.inventory_mode <> 'MASS';

-- 已有密度，或全部销售规格本身就是 g/kg 的原料，可以立即切换为重量库存。
-- 实际库存从 0kg 开始，之后通过入库/盘点录入，绝不沿用旧占位数量。
UPDATE public.products p
SET inventory_mode = 'MASS',
    base_stock_kg = 0,
    density_status = CASE
      WHEN p.density_g_ml IS NOT NULL AND p.density_status = 'UNSET' THEN 'REFERENCE'
      ELSE p.density_status
    END
WHERE p.channel = 'RAW'
  AND p.inventory_mode <> 'MASS'
  AND (
    p.density_g_ml IS NOT NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.product_specs s
      WHERE s.product_id = p.id
        AND s.spec ~* '^[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*(ml|毫升|l|升)'
    )
  );

-- 原料重量调整的唯一入口：自动初始化重量模式、调整 kg、刷新全部
-- 销售规格的可售件数，并写入库存流水，任何一步失败都会整体回滚。
CREATE OR REPLACE FUNCTION public.zidu_adjust_raw_inventory(
  p_product_id INTEGER,
  p_type TEXT,
  p_quantity_kg NUMERIC,
  p_reason TEXT DEFAULT 'OTHER',
  p_note TEXT DEFAULT '',
  p_operator_name TEXT DEFAULT '',
  p_density_g_ml NUMERIC DEFAULT NULL,
  p_density_temperature_c NUMERIC DEFAULT 20
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.products%ROWTYPE;
  s public.product_specs%ROWTYPE;
  adjusted JSON;
  has_volume_spec BOOLEAN;
  effective_density NUMERIC;
  logged_quantity NUMERIC;
BEGIN
  IF p_type NOT IN ('IN', 'OUT', 'CORRECTION') OR p_quantity_kg < 0 THEN
    RAISE EXCEPTION '无效的原料库存调整参数';
  END IF;

  SELECT * INTO p FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF p.id IS NULL THEN RAISE EXCEPTION '产品不存在'; END IF;
  IF p.channel <> 'RAW' THEN RAISE EXCEPTION '只有原料产品可以按 kg 调整'; END IF;

  SELECT * INTO s
  FROM public.product_specs
  WHERE product_id = p.id
  ORDER BY
    CASE WHEN spec ~* '(kg|公斤|千克|g|克)' THEN 0 ELSE 1 END,
    id
  LIMIT 1
  FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION '该原料没有销售规格'; END IF;

  IF p.inventory_mode <> 'MASS' THEN
    SELECT exists(
      SELECT 1 FROM public.product_specs x
      WHERE x.product_id = p.id
        AND x.spec ~* '^[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*(ml|毫升|l|升)'
    ) INTO has_volume_spec;

    effective_density := coalesce(nullif(p_density_g_ml, 0), p.density_g_ml);
    IF has_volume_spec AND coalesce(effective_density, 0) <= 0 THEN
      RAISE EXCEPTION '该原料有 ml/L 销售规格，请先填写密度 g/ml';
    END IF;

    UPDATE public.products
    SET inventory_mode = 'MASS',
        base_stock_kg = 0,
        density_g_ml = effective_density,
        density_temperature_c = coalesce(p_density_temperature_c, 20),
        density_status = CASE WHEN effective_density > 0 THEN 'REFERENCE' ELSE 'UNSET' END,
        density_source = CASE
          WHEN effective_density > 0 THEN '首次按kg调整库存时录入，待供应商/批次确认'
          ELSE coalesce(density_source, '')
        END
    WHERE id = p.id;
  ELSIF p_density_g_ml > 0 AND p.density_g_ml IS NULL THEN
    UPDATE public.products
    SET density_g_ml = p_density_g_ml,
        density_temperature_c = coalesce(p_density_temperature_c, 20),
        density_status = 'REFERENCE',
        density_source = '按kg调整库存时补录，待供应商/批次确认'
    WHERE id = p.id;
  END IF;

  adjusted := public.zidu_adjust_inventory(s.id, p_type, p_quantity_kg, 'KG');
  logged_quantity := CASE
    WHEN p_type = 'CORRECTION' THEN abs(
      coalesce((adjusted->>'afterKg')::NUMERIC, 0)
      - coalesce((adjusted->>'beforeKg')::NUMERIC, 0)
    )
    ELSE p_quantity_kg
  END;

  INSERT INTO public.stock_adjustments (
    spec_id, product_id, type, reason, quantity,
    before_stock, after_stock, quantity_kg, before_stock_kg, after_stock_kg,
    operator_name, note
  ) VALUES (
    s.id, p.id, p_type, coalesce(nullif(p_reason, ''), 'OTHER'), logged_quantity,
    (adjusted->>'before')::NUMERIC, (adjusted->>'after')::NUMERIC,
    logged_quantity,
    nullif(adjusted->>'beforeKg', '')::NUMERIC,
    nullif(adjusted->>'afterKg', '')::NUMERIC,
    coalesce(p_operator_name, ''), coalesce(p_note, '')
  );

  RETURN (adjusted::jsonb || jsonb_build_object('productId', p.id, 'unit', 'KG'))::json;
END;
$$;

GRANT EXECUTE ON FUNCTION public.zidu_adjust_raw_inventory(
  INTEGER, TEXT, NUMERIC, TEXT, TEXT, TEXT, NUMERIC, NUMERIC
) TO anon, authenticated;

COMMENT ON FUNCTION public.zidu_adjust_raw_inventory IS
  '原料统一按kg调整并写流水；首次录入时自动启用MASS，ml/L规格必须提供密度';

-- 结果检查：raw_not_mass 应仅剩“含 ml/L 规格但尚未补密度”的原料。
SELECT
  count(DISTINCT p.id) FILTER (WHERE p.channel = 'RAW') AS raw_products,
  count(DISTINCT p.id) FILTER (WHERE p.channel = 'RAW' AND p.inventory_mode = 'MASS') AS raw_mass_ready,
  count(DISTINCT p.id) FILTER (WHERE p.channel = 'RAW' AND p.inventory_mode <> 'MASS') AS raw_pending_density,
  count(*) FILTER (WHERE p.channel = 'RAW' AND s.stock = 999) AS raw_legacy_999_specs,
  count(*) FILTER (WHERE p.channel <> 'RAW' AND s.stock = 999) AS finished_legacy_999_specs
FROM public.products p
LEFT JOIN public.product_specs s ON s.product_id = p.id;
