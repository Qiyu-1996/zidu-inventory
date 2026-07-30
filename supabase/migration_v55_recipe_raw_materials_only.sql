-- ZIDU 配方库：组成项仅允许原料，用量统一为 ml。
-- 请在 migration_v54_recipe_library.sql 成功后运行。

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.recipe_library') IS NULL
     OR to_regclass('public.recipe_components') IS NULL
     OR to_regprocedure('public.zidu_save_recipe(jsonb)') IS NULL THEN
    RAISE EXCEPTION '请先运行 migration_v54_recipe_library.sql';
  END IF;
END;
$$;

-- 保留旧数据，但不让不符合新规则的旧配方继续下单。
UPDATE public.recipe_library recipe
SET spec = lower(regexp_replace(trim(recipe.spec), '[[:space:]]+', '', 'g')),
    updated_at = now()
WHERE recipe.spec ~* '^[0-9]+([.][0-9]+)?[[:space:]]*ml$';

UPDATE public.recipe_library recipe
SET status = 'ARCHIVED', updated_at = now()
WHERE recipe.status = 'ACTIVE'
  AND (
    recipe.spec !~* '^[0-9]+([.][0-9]+)?ml$'
    OR NOT EXISTS (
      SELECT 1 FROM public.recipe_components component
      WHERE component.recipe_id = recipe.id
    )
    OR EXISTS (
      SELECT 1
      FROM public.recipe_components component
      JOIN public.products product ON product.id = component.component_product_id
      JOIN public.product_specs spec ON spec.id = component.component_spec_id
      WHERE component.recipe_id = recipe.id
        AND (
          spec.product_id <> product.id
          OR coalesce(product.channel, '') NOT IN ('RAW', 'BOTH')
          OR coalesce(product.inventory_mode, '') <> 'MASS'
          OR coalesce(product.density_g_ml, 0) <= 0
          OR component.quantity_unit <> 'ML'
        )
    )
    OR EXISTS (
      SELECT 1
      FROM public.recipe_components component
      WHERE component.recipe_id = recipe.id
      GROUP BY component.component_product_id
      HAVING count(*) > 1
    )
  );

CREATE OR REPLACE FUNCTION public.zidu_validate_recipe_component_raw()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.products%ROWTYPE;
  v_spec public.product_specs%ROWTYPE;
BEGIN
  SELECT * INTO v_product
  FROM public.products
  WHERE id = NEW.component_product_id;

  SELECT * INTO v_spec
  FROM public.product_specs
  WHERE id = NEW.component_spec_id;

  IF v_product.id IS NULL OR v_spec.id IS NULL OR v_spec.product_id <> v_product.id THEN
    RAISE EXCEPTION '配方组成原料不存在';
  END IF;
  IF coalesce(v_product.channel, '') NOT IN ('RAW', 'BOTH')
     OR coalesce(v_product.inventory_mode, '') <> 'MASS' THEN
    RAISE EXCEPTION '% 不是按重量管理的原料，不能加入配方', v_product.name;
  END IF;
  IF coalesce(v_product.density_g_ml, 0) <= 0 THEN
    RAISE EXCEPTION '% 没有有效密度，无法按 ml 扣减原料', v_product.name;
  END IF;
  IF NEW.quantity_unit <> 'ML' THEN
    RAISE EXCEPTION '配方原料用量必须使用 ml';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zidu_recipe_component_raw ON public.recipe_components;
CREATE TRIGGER trg_zidu_recipe_component_raw
BEFORE INSERT OR UPDATE OF component_product_id, component_spec_id, quantity_unit
ON public.recipe_components
FOR EACH ROW EXECUTE FUNCTION public.zidu_validate_recipe_component_raw();

CREATE OR REPLACE FUNCTION public.zidu_save_recipe(p_recipe JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_recipe public.recipe_library%ROWTYPE;
  v_recipe_id BIGINT;
  v_component JSONB;
  v_product public.products%ROWTYPE;
  v_spec public.product_specs%ROWTYPE;
  v_quantity NUMERIC;
  v_price NUMERIC;
  v_spec_label TEXT;
  v_sku_code TEXT;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(
    ARRAY['SUPER_ADMIN','ADMIN','SALES','WAREHOUSE','FINANCE']
  );

  IF p_recipe IS NULL OR jsonb_typeof(p_recipe) <> 'object' THEN
    RAISE EXCEPTION '配方数据无效';
  END IF;
  IF trim(coalesce(p_recipe->>'name', '')) = '' THEN RAISE EXCEPTION '请填写配方名称'; END IF;
  IF length(trim(p_recipe->>'name')) > 120 THEN RAISE EXCEPTION '配方名称过长'; END IF;
  IF trim(coalesce(p_recipe->>'spec', '')) !~* '^[0-9]+([.][0-9]+)?[[:space:]]*ml$' THEN
    RAISE EXCEPTION '配方成品规格必须使用 ml';
  END IF;
  v_spec_label := lower(regexp_replace(trim(p_recipe->>'spec'), '[[:space:]]+', '', 'g'));
  IF coalesce(p_recipe->>'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$' THEN
    RAISE EXCEPTION '请填写有效售价';
  END IF;
  v_price := (p_recipe->>'price')::NUMERIC;
  IF v_price <= 0 THEN RAISE EXCEPTION '售价必须大于 0'; END IF;
  IF jsonb_typeof(coalesce(p_recipe->'components', '[]'::JSONB)) <> 'array'
     OR jsonb_array_length(coalesce(p_recipe->'components', '[]'::JSONB)) = 0 THEN
    RAISE EXCEPTION '配方至少需要一种原料';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_recipe->'components') component
    WHERE coalesce(component->>'specId', '') !~ '^[0-9]+$'
       OR coalesce(component->>'quantity', '') !~ '^[0-9]+([.][0-9]+)?$'
  ) THEN
    RAISE EXCEPTION '原料或 ml 用量无效';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_recipe->'components') component
    WHERE (component->>'quantity')::NUMERIC <= 0
  ) THEN
    RAISE EXCEPTION '原料 ml 用量必须大于 0';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_recipe->'components') component
    LEFT JOIN public.product_specs spec ON spec.id = (component->>'specId')::INTEGER
    WHERE spec.id IS NULL
  ) THEN
    RAISE EXCEPTION '配方原料不存在';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_recipe->'components') component
    JOIN public.product_specs spec ON spec.id = (component->>'specId')::INTEGER
    GROUP BY spec.product_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION '同一种原料不能重复添加';
  END IF;

  v_recipe_id := nullif(p_recipe->>'id', '')::BIGINT;
  IF v_recipe_id IS NULL THEN
    v_recipe_id := nextval(pg_get_serial_sequence('public.recipe_library', 'id'));
    v_sku_code := 'ZDPF-' || lpad(v_recipe_id::TEXT, 6, '0');
    IF EXISTS (SELECT 1 FROM public.products WHERE code = v_sku_code)
       OR EXISTS (SELECT 1 FROM public.product_specs WHERE sku = v_sku_code) THEN
      RAISE EXCEPTION '配方 SKU 编号冲突，请联系管理员';
    END IF;
    INSERT INTO public.recipe_library(
      id, owner_user_id, sku_code, name, spec, price, notes, status
    ) VALUES (
      v_recipe_id, v_actor.id, v_sku_code,
      trim(p_recipe->>'name'), v_spec_label, round(v_price, 2),
      trim(coalesce(p_recipe->>'notes', '')), 'ACTIVE'
    ) RETURNING * INTO v_recipe;
  ELSE
    SELECT * INTO v_recipe FROM public.recipe_library WHERE id = v_recipe_id FOR UPDATE;
    IF v_recipe.id IS NULL THEN RAISE EXCEPTION '配方不存在'; END IF;
    IF v_recipe.owner_user_id <> v_actor.id AND v_actor.role <> 'SUPER_ADMIN' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = '只能修改自己的配方';
    END IF;
    UPDATE public.recipe_library SET
      name = trim(p_recipe->>'name'),
      spec = v_spec_label,
      price = round(v_price, 2),
      notes = trim(coalesce(p_recipe->>'notes', '')),
      status = 'ACTIVE',
      updated_at = now()
    WHERE id = v_recipe_id
    RETURNING * INTO v_recipe;
    DELETE FROM public.recipe_components WHERE recipe_id = v_recipe_id;
  END IF;

  FOR v_component IN SELECT value FROM jsonb_array_elements(p_recipe->'components')
  LOOP
    SELECT * INTO v_spec
    FROM public.product_specs
    WHERE id = (v_component->>'specId')::INTEGER;

    SELECT * INTO v_product FROM public.products WHERE id = v_spec.product_id;
    IF v_product.id IS NULL THEN RAISE EXCEPTION '配方原料不存在'; END IF;
    IF coalesce(v_product.channel, '') NOT IN ('RAW', 'BOTH')
       OR coalesce(v_product.inventory_mode, '') <> 'MASS' THEN
      RAISE EXCEPTION '% 不是按重量管理的原料，不能加入配方', v_product.name;
    END IF;
    IF coalesce(v_product.density_g_ml, 0) <= 0 THEN
      RAISE EXCEPTION '% 没有有效密度，无法按 ml 扣减原料', v_product.name;
    END IF;

    v_quantity := (v_component->>'quantity')::NUMERIC;
    INSERT INTO public.recipe_components(
      recipe_id, component_product_id, component_spec_id,
      quantity, quantity_unit,
      product_code_snapshot, product_name_snapshot, spec_snapshot
    ) VALUES (
      v_recipe_id, v_product.id, v_spec.id,
      round(v_quantity, 6), 'ML',
      coalesce(v_product.code, ''), coalesce(v_product.name, ''), coalesce(v_spec.spec, '')
    );
  END LOOP;

  UPDATE public.recipe_library SET updated_at = now() WHERE id = v_recipe_id;
  RETURN jsonb_build_object(
    'id', v_recipe_id,
    'skuCode', v_recipe.sku_code,
    'success', true
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_recipe_raw_only_ready()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.zidu_recipe_inventory_ready()
    AND EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.recipe_components'::regclass
        AND tgname = 'trg_zidu_recipe_component_raw'
        AND NOT tgisinternal
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.recipe_library recipe
      WHERE recipe.status = 'ACTIVE'
        AND (
          recipe.spec !~* '^[0-9]+([.][0-9]+)?ml$'
          OR NOT EXISTS (
            SELECT 1 FROM public.recipe_components component
            WHERE component.recipe_id = recipe.id
          )
          OR EXISTS (
            SELECT 1
            FROM public.recipe_components component
            JOIN public.products product ON product.id = component.component_product_id
            JOIN public.product_specs spec ON spec.id = component.component_spec_id
            WHERE component.recipe_id = recipe.id
              AND (
                spec.product_id <> product.id
                OR coalesce(product.channel, '') NOT IN ('RAW', 'BOTH')
                OR coalesce(product.inventory_mode, '') <> 'MASS'
                OR coalesce(product.density_g_ml, 0) <= 0
                OR component.quantity_unit <> 'ML'
              )
          )
          OR EXISTS (
            SELECT 1
            FROM public.recipe_components component
            WHERE component.recipe_id = recipe.id
            GROUP BY component.component_product_id
            HAVING count(*) > 1
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.zidu_validate_recipe_component_raw() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zidu_save_recipe(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zidu_recipe_raw_only_ready() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.zidu_save_recipe(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_recipe_raw_only_ready() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

SELECT
  public.zidu_recipe_raw_only_ready() AS recipe_raw_materials_only_ready,
  has_function_privilege('anon', 'public.zidu_recipe_raw_only_ready()', 'EXECUTE') AS anon_can_check_recipe_rules,
  has_function_privilege('authenticated', 'public.zidu_recipe_raw_only_ready()', 'EXECUTE') AS authenticated_can_check_recipe_rules;
