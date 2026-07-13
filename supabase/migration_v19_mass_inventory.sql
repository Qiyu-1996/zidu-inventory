-- ============================================================
-- ZIDU v19: 原料按 kg 统一库存，销售规格按密度自动换算
-- ============================================================
-- 重要：本迁移不会自动启用任何产品，也不会改动现有库存。
-- 管理员需在网页「系统管理 -> 产品管理」中逐个原料启用重量库存，
-- 填写实际库存 kg、密度及其来源后才开始换算。

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS inventory_mode TEXT NOT NULL DEFAULT 'SKU',
  ADD COLUMN IF NOT EXISTS base_stock_kg NUMERIC(14,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS safe_stock_kg NUMERIC(14,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS density_g_ml NUMERIC(8,5),
  ADD COLUMN IF NOT EXISTS density_temperature_c NUMERIC(5,2) DEFAULT 20,
  ADD COLUMN IF NOT EXISTS density_source TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS density_status TEXT NOT NULL DEFAULT 'UNSET';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_inventory_mode_check'
  ) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_inventory_mode_check
      CHECK (inventory_mode IN ('SKU', 'MASS'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_density_status_check'
  ) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_density_status_check
      CHECK (density_status IN ('UNSET', 'REFERENCE', 'CONFIRMED'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_density_positive_check'
  ) THEN
    ALTER TABLE public.products ADD CONSTRAINT products_density_positive_check
      CHECK (density_g_ml IS NULL OR density_g_ml > 0);
  END IF;
END $$;

ALTER TABLE public.stock_adjustments
  ADD COLUMN IF NOT EXISTS quantity_kg NUMERIC(14,6),
  ADD COLUMN IF NOT EXISTS before_stock_kg NUMERIC(14,6),
  ADD COLUMN IF NOT EXISTS after_stock_kg NUMERIC(14,6);

-- 批次入库允许 0.1kg、0.25kg 等小数。
ALTER TABLE public.product_batches
  ALTER COLUMN initial_qty TYPE NUMERIC(14,6) USING initial_qty::NUMERIC,
  ALTER COLUMN remaining_qty TYPE NUMERIC(14,6) USING remaining_qty::NUMERIC;

-- 将一个销售规格换算为每件消耗的 kg。
-- 示例：100ml、500g、1kg 分别返回 density*100/1000、0.5、1。
CREATE OR REPLACE FUNCTION public.zidu_spec_mass_kg(
  p_spec TEXT,
  p_density_g_ml NUMERIC
) RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v TEXT := lower(regexp_replace(coalesce(p_spec, ''), '\s+', '', 'g'));
  m TEXT[];
  n NUMERIC;
  u TEXT;
BEGIN
  m := regexp_match(v, '^([0-9]+(?:\.[0-9]+)?)(ml|毫升|l|升|kg|公斤|千克|g|克)');
  IF m IS NULL THEN RETURN NULL; END IF;
  n := m[1]::NUMERIC;
  u := m[2];
  IF u IN ('kg', '公斤', '千克') THEN RETURN n; END IF;
  IF u IN ('g', '克') THEN RETURN n / 1000; END IF;
  IF p_density_g_ml IS NULL THEN RETURN NULL; END IF;
  IF u IN ('l', '升') THEN n := n * 1000; END IF;
  RETURN n * p_density_g_ml / 1000;
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_sync_mass_spec_stock(p_product_id INTEGER)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.products%ROWTYPE;
BEGIN
  SELECT * INTO p FROM public.products WHERE id = p_product_id;
  IF p.id IS NULL OR p.inventory_mode <> 'MASS' THEN RETURN; END IF;
  PERFORM set_config('zidu.syncing_mass_stock', 'on', true);
  UPDATE public.product_specs s
     SET stock = greatest(0, floor(
       p.base_stock_kg / public.zidu_spec_mass_kg(s.spec, p.density_g_ml)
     ))::INTEGER
   WHERE s.product_id = p.id
     AND public.zidu_spec_mass_kg(s.spec, p.density_g_ml) IS NOT NULL;
  PERFORM set_config('zidu.syncing_mass_stock', 'off', true);
END;
$$;

-- 兼容现有网页和小程序：它们仍修改 product_specs.stock；触发器把变化
-- 转成 kg 后更新共享库存，再统一刷新该产品所有规格的可售数量。
CREATE OR REPLACE FUNCTION public.zidu_mass_stock_from_spec_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.products%ROWTYPE;
  mass_per_unit NUMERIC;
  delta_kg NUMERIC;
BEGIN
  IF current_setting('zidu.syncing_mass_stock', true) = 'on' THEN RETURN NEW; END IF;
  SELECT * INTO p FROM public.products WHERE id = NEW.product_id FOR UPDATE;
  IF p.id IS NULL OR p.inventory_mode <> 'MASS' OR NEW.stock = OLD.stock THEN RETURN NEW; END IF;

  mass_per_unit := public.zidu_spec_mass_kg(NEW.spec, p.density_g_ml);
  IF mass_per_unit IS NULL THEN
    RAISE EXCEPTION '规格 % 无法换算为 kg，请先填写已确认密度或改用 g/kg 规格', NEW.spec;
  END IF;
  delta_kg := (NEW.stock - OLD.stock) * mass_per_unit;
  UPDATE public.products
     SET base_stock_kg = greatest(0, base_stock_kg + delta_kg)
   WHERE id = p.id;
  PERFORM public.zidu_sync_mass_spec_stock(p.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_zidu_mass_stock_from_spec_change ON public.product_specs;
CREATE TRIGGER trg_zidu_mass_stock_from_spec_change
BEFORE UPDATE OF stock ON public.product_specs
FOR EACH ROW EXECUTE FUNCTION public.zidu_mass_stock_from_spec_change();

CREATE OR REPLACE FUNCTION public.zidu_sync_mass_stock_after_product_change()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.inventory_mode = 'MASS' AND (
    OLD.inventory_mode IS DISTINCT FROM NEW.inventory_mode OR
    OLD.base_stock_kg IS DISTINCT FROM NEW.base_stock_kg OR
    OLD.density_g_ml IS DISTINCT FROM NEW.density_g_ml
  ) THEN
    PERFORM public.zidu_sync_mass_spec_stock(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zidu_sync_mass_stock_after_product_change ON public.products;
CREATE TRIGGER trg_zidu_sync_mass_stock_after_product_change
AFTER UPDATE OF inventory_mode, base_stock_kg, density_g_ml ON public.products
FOR EACH ROW EXECUTE FUNCTION public.zidu_sync_mass_stock_after_product_change();

CREATE OR REPLACE FUNCTION public.zidu_sync_mass_stock_after_spec_insert()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.zidu_sync_mass_spec_stock(NEW.product_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zidu_sync_mass_stock_after_spec_insert ON public.product_specs;
CREATE TRIGGER trg_zidu_sync_mass_stock_after_spec_insert
AFTER INSERT OR UPDATE OF spec ON public.product_specs
FOR EACH ROW EXECUTE FUNCTION public.zidu_sync_mass_stock_after_spec_insert();

-- 精确库存调整入口。重量原料可直接传 KG，避免可售件数取整后丢失余量。
CREATE OR REPLACE FUNCTION public.zidu_adjust_inventory(
  p_spec_id INTEGER,
  p_type TEXT,
  p_quantity NUMERIC,
  p_quantity_unit TEXT DEFAULT 'SPEC'
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s public.product_specs%ROWTYPE;
  p public.products%ROWTYPE;
  factor NUMERIC;
  before_units NUMERIC;
  after_units NUMERIC;
  before_kg NUMERIC;
  after_kg NUMERIC;
  delta_kg NUMERIC;
BEGIN
  IF p_type NOT IN ('IN', 'OUT', 'CORRECTION') OR p_quantity < 0 THEN
    RAISE EXCEPTION '无效的库存调整参数';
  END IF;
  SELECT * INTO s FROM public.product_specs WHERE id = p_spec_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION '规格不存在'; END IF;
  SELECT * INTO p FROM public.products WHERE id = s.product_id FOR UPDATE;
  before_units := s.stock;

  IF p.inventory_mode = 'MASS' THEN
    factor := CASE WHEN upper(p_quantity_unit) = 'KG' THEN 1
      ELSE public.zidu_spec_mass_kg(s.spec, p.density_g_ml) END;
    IF factor IS NULL THEN RAISE EXCEPTION '规格 % 无法换算为 kg', s.spec; END IF;
    before_kg := p.base_stock_kg;
    IF p_type = 'CORRECTION' THEN
      after_kg := CASE WHEN upper(p_quantity_unit) = 'KG' THEN p_quantity ELSE p_quantity * factor END;
    ELSE
      delta_kg := p_quantity * factor * CASE WHEN p_type = 'IN' THEN 1 ELSE -1 END;
      IF before_kg + delta_kg < 0 THEN RAISE EXCEPTION '库存不足'; END IF;
      after_kg := before_kg + delta_kg;
    END IF;
    UPDATE public.products SET base_stock_kg = after_kg WHERE id = p.id;
    PERFORM public.zidu_sync_mass_spec_stock(p.id);
    SELECT stock INTO after_units FROM public.product_specs WHERE id = p_spec_id;
  ELSE
    before_kg := NULL;
    after_kg := NULL;
    IF upper(p_quantity_unit) = 'KG' THEN RAISE EXCEPTION '独立 SKU 库存不能按 kg 调整'; END IF;
    IF p_type = 'CORRECTION' THEN after_units := p_quantity;
    ELSIF p_type = 'IN' THEN after_units := before_units + p_quantity;
    ELSE
      IF before_units < p_quantity THEN RAISE EXCEPTION '库存不足'; END IF;
      after_units := before_units - p_quantity;
    END IF;
    PERFORM set_config('zidu.syncing_mass_stock', 'on', true);
    UPDATE public.product_specs SET stock = after_units WHERE id = p_spec_id;
    PERFORM set_config('zidu.syncing_mass_stock', 'off', true);
  END IF;

  RETURN json_build_object(
    'before', before_units, 'after', after_units,
    'beforeKg', before_kg, 'afterKg', after_kg,
    'quantityKg', CASE WHEN p.inventory_mode = 'MASS' THEN abs(after_kg - before_kg) ELSE NULL END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.zidu_adjust_inventory(INTEGER, TEXT, NUMERIC, TEXT) TO anon, authenticated;

-- 给旧库存日志补充 kg 审计字段；新日志插入时自动记录当时的换算值。
CREATE OR REPLACE FUNCTION public.zidu_fill_stock_adjustment_mass()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  p public.products%ROWTYPE;
  s public.product_specs%ROWTYPE;
  factor NUMERIC;
BEGIN
  SELECT * INTO p FROM public.products WHERE id = NEW.product_id;
  IF p.inventory_mode <> 'MASS' THEN RETURN NEW; END IF;
  -- RPC 调整已提供精确 kg 审计值时直接保留；普通订单旧逻辑才按规格补算。
  IF NEW.quantity_kg IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO s FROM public.product_specs WHERE id = NEW.spec_id;
  factor := public.zidu_spec_mass_kg(s.spec, p.density_g_ml);
  IF factor IS NULL THEN RETURN NEW; END IF;
  NEW.quantity_kg := round(NEW.quantity * factor, 6);
  NEW.after_stock_kg := p.base_stock_kg;
  NEW.before_stock_kg := CASE
    WHEN NEW.type = 'IN' THEN p.base_stock_kg - NEW.quantity_kg
    WHEN NEW.type = 'OUT' THEN p.base_stock_kg + NEW.quantity_kg
    ELSE NULL
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zidu_fill_stock_adjustment_mass ON public.stock_adjustments;
CREATE TRIGGER trg_zidu_fill_stock_adjustment_mass
BEFORE INSERT ON public.stock_adjustments
FOR EACH ROW EXECUTE FUNCTION public.zidu_fill_stock_adjustment_mass();

COMMENT ON COLUMN public.products.base_stock_kg IS '重量库存基准余量，单位kg；仅inventory_mode=MASS时使用';
COMMENT ON COLUMN public.products.density_g_ml IS '密度g/ml，须同时记录参考温度与来源；优先使用本批次COA/SDS';
COMMENT ON COLUMN public.products.density_status IS 'UNSET未录/REFERENCE公开资料参考/CONFIRMED本批次或供应商确认';

-- 验证：执行后应返回新增字段，不会改变产品库存。
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'products'
  AND column_name IN ('inventory_mode','base_stock_kg','density_g_ml','density_temperature_c','density_source','density_status')
ORDER BY column_name;
