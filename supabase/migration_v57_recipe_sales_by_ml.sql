-- ZIDU 配方销售：销售数量统一表示 ml，按配方基准量等比扣减原料。
-- 配方 price 字段从本迁移起表示“每 ml 售价”。
-- 请在 migration_v54、v55 成功后运行。

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.zidu_recipe_raw_only_ready()') IS NULL
     OR NOT public.zidu_recipe_raw_only_ready()
     OR to_regprocedure('public.zidu_create_order_atomic_impl(jsonb)') IS NULL THEN
    RAISE EXCEPTION '请先完成 migration_v54 和 migration_v55';
  END IF;
END;
$$;

ALTER TABLE public.recipe_library
  ADD COLUMN IF NOT EXISTS price_unit TEXT NOT NULL DEFAULT 'BATCH';

-- v54/v55 的售价表示整个基准配方的价格；仅在首次迁移时换算为每 ml 售价。
UPDATE public.recipe_library
SET price = greatest(
      0.01,
      round(price / regexp_replace(spec, 'ml$', '', 'i')::NUMERIC, 2)
    ),
    price_unit = 'ML',
    updated_at = now()
WHERE price_unit = 'BATCH'
  AND spec ~* '^[0-9]+([.][0-9]+)?ml$'
  AND regexp_replace(spec, 'ml$', '', 'i')::NUMERIC > 0;

-- v55 已归档的非法旧配方不参与换算；重新保存时会按新的每 ml 售价覆盖。
UPDATE public.recipe_library
SET price_unit = 'ML', updated_at = now()
WHERE price_unit = 'BATCH';

ALTER TABLE public.recipe_library ALTER COLUMN price_unit SET DEFAULT 'ML';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.recipe_library'::regclass
      AND conname = 'recipe_library_price_unit_check'
  ) THEN
    ALTER TABLE public.recipe_library
      ADD CONSTRAINT recipe_library_price_unit_check CHECK (price_unit = 'ML');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_create_order_atomic(p_order JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_payload JSONB := coalesce(p_order, '{}'::JSONB);
  v_customer_id INTEGER;
  v_discount NUMERIC;
  v_allowed_discount NUMERIC;
  v_dealer_level INTEGER := 0;
  v_item JSONB;
  v_recipe public.recipe_library%ROWTYPE;
  v_recipe_id BIGINT;
  v_quantity_ml INTEGER;
  v_yield_ml NUMERIC;
  v_channel_meta JSONB;
  v_recipe_selections JSONB := '[]'::JSONB;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN','SALES']);
  v_customer_id := nullif(v_payload->>'customerId', '')::INTEGER;
  IF v_actor.role = 'SALES' THEN
    IF v_customer_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.customers WHERE id = v_customer_id AND sales_id = v_actor.id
    ) THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = '只能为自己负责的客户下单'; END IF;
    v_payload := jsonb_set(v_payload, '{salesId}', to_jsonb(v_actor.id), true);
    v_discount := coalesce(nullif(v_payload->>'discountPercent', '')::NUMERIC, 0);
    IF v_discount < 0 OR v_discount > 100 THEN RAISE EXCEPTION '折扣比例无效'; END IF;
    SELECT coalesce(distributor_level, 0) INTO v_dealer_level
    FROM public.customers WHERE id = v_customer_id;
    v_dealer_level := coalesce(v_dealer_level, 0);
    SELECT coalesce(nullif(value, '')::NUMERIC, 20) INTO v_allowed_discount
    FROM public.app_settings WHERE key = 'max_discount_percent' ORDER BY id DESC LIMIT 1;
    v_allowed_discount := coalesce(v_allowed_discount, 20);
    IF NOT ((v_dealer_level = 1 AND abs(v_discount - 50) < 0.001)
      OR (v_dealer_level = 2 AND abs(v_discount - 35) < 0.001)
      OR (v_dealer_level NOT IN (1,2) AND v_discount <= v_allowed_discount)) THEN
      RAISE EXCEPTION '折扣超过销售权限';
    END IF;
  END IF;

  IF jsonb_typeof(coalesce(v_payload->'items', '[]'::JSONB)) <> 'array' THEN
    RAISE EXCEPTION '订单商品数据无效';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(v_payload->'items', '[]'::JSONB))
  LOOP
    IF nullif(v_item->>'recipeId', '') IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM public.recipe_library
        WHERE sku_code = coalesce(v_item->>'productCode', '')
      ) THEN RAISE EXCEPTION '配方 SKU 缺少库存联动信息，请刷新商品后重试'; END IF;
      CONTINUE;
    END IF;
    IF coalesce(v_item->>'recipeId', '') !~ '^[0-9]+$'
       OR coalesce(v_item->>'quantity', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION '配方 SKU 数据无效';
    END IF;
    v_recipe_id := (v_item->>'recipeId')::BIGINT;
    v_quantity_ml := (v_item->>'quantity')::INTEGER;
    IF v_quantity_ml <= 0 THEN RAISE EXCEPTION '配方销售 ml 必须大于 0'; END IF;
    SELECT * INTO v_recipe FROM public.recipe_library WHERE id = v_recipe_id;
    IF v_recipe.id IS NULL OR v_recipe.status <> 'ACTIVE' THEN RAISE EXCEPTION '配方已归档或不存在'; END IF;
    IF v_recipe.owner_user_id <> v_actor.id AND v_actor.role <> 'SUPER_ADMIN' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = '无权销售其他人的配方';
    END IF;
    IF v_recipe.spec !~* '^[0-9]+([.][0-9]+)?ml$' THEN
      RAISE EXCEPTION '配方基准量无效，请先在配方库重新保存';
    END IF;
    IF v_recipe.price_unit <> 'ML' THEN
      RAISE EXCEPTION '配方售价尚未换算为每 ml 售价';
    END IF;
    v_yield_ml := regexp_replace(v_recipe.spec, 'ml$', '', 'i')::NUMERIC;
    IF v_yield_ml <= 0 THEN RAISE EXCEPTION '配方基准量必须大于 0'; END IF;
    IF nullif(v_item->>'productId', '') IS NOT NULL OR nullif(v_item->>'specId', '') IS NOT NULL THEN
      RAISE EXCEPTION '配方 SKU 不能重复扣减虚拟成品库存';
    END IF;
    IF coalesce(v_item->>'productCode', '') <> v_recipe.sku_code
       OR coalesce(v_item->>'productName', '') <> v_recipe.name
       OR lower(coalesce(v_item->>'spec', '')) <> '1ml'
       OR abs(coalesce(nullif(v_item->>'unitPrice', '')::NUMERIC, 0) - v_recipe.price) > 0.001 THEN
      RAISE EXCEPTION '配方 SKU 信息已变化，请返回购物车刷新后重试';
    END IF;
  END LOOP;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'recipeId', grouped.recipe_id,
    'quantity', grouped.quantity_ml,
    'salesUnit', 'ML',
    'recipeYieldMl', regexp_replace(recipe.spec, 'ml$', '', 'i')::NUMERIC,
    'skuCode', recipe.sku_code,
    'name', recipe.name,
    'spec', '1ml',
    'unitPrice', recipe.price,
    'priceUnit', 'ML',
    'components', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'componentId', component.id,
        'productId', component.component_product_id,
        'specId', component.component_spec_id,
        'inventoryMode', 'MASS',
        'unit', 'ML',
        'quantityPerUnit', round(
          component.quantity / regexp_replace(recipe.spec, 'ml$', '', 'i')::NUMERIC,
          9
        ),
        'densityGml', product.density_g_ml,
        'productCode', product.code,
        'productName', product.name,
        'specName', spec.spec
      ) ORDER BY component.id)
      FROM public.recipe_components component
      JOIN public.products product ON product.id = component.component_product_id
      JOIN public.product_specs spec ON spec.id = component.component_spec_id
      WHERE component.recipe_id = recipe.id
    ), '[]'::JSONB)
  ) ORDER BY grouped.recipe_id), '[]'::JSONB)
  INTO v_recipe_selections
  FROM (
    SELECT (item->>'recipeId')::BIGINT AS recipe_id,
           sum((item->>'quantity')::INTEGER)::INTEGER AS quantity_ml
    FROM jsonb_array_elements(coalesce(v_payload->'items', '[]'::JSONB)) item
    WHERE nullif(item->>'recipeId', '') IS NOT NULL
    GROUP BY (item->>'recipeId')::BIGINT
  ) grouped
  JOIN public.recipe_library recipe ON recipe.id = grouped.recipe_id;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_recipe_selections) selection
    WHERE jsonb_array_length(selection->'components') = 0
  ) THEN RAISE EXCEPTION '配方没有可扣减的组成原料'; END IF;

  v_channel_meta := coalesce(v_payload->'channelMeta', '{}'::JSONB)
    - ARRAY['recipeSelections', 'recipeVersion', 'recipeSalesUnit'];
  IF jsonb_array_length(v_recipe_selections) > 0 THEN
    v_channel_meta := v_channel_meta || jsonb_build_object(
      'recipeSelections', v_recipe_selections,
      'recipeVersion', 2,
      'recipeSalesUnit', 'ML'
    );
  END IF;
  v_channel_meta := v_channel_meta || jsonb_build_object(
    'enteredBy', jsonb_build_object(
      'id', v_actor.id, 'name', v_actor.name, 'role', v_actor.role
    )
  );
  v_payload := jsonb_set(v_payload, '{channelMeta}', v_channel_meta, true);
  RETURN public.zidu_create_order_atomic_impl(v_payload);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_recipe_ml_sales_ready()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.zidu_recipe_raw_only_ready()
    AND NOT EXISTS (
      SELECT 1 FROM public.recipe_library WHERE price_unit <> 'ML'
    )
    AND position(
      'recipeSalesUnit' IN pg_get_functiondef(
        'public.zidu_create_order_atomic(jsonb)'::regprocedure
      )
    ) > 0;
$$;

REVOKE ALL ON FUNCTION public.zidu_create_order_atomic(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zidu_recipe_ml_sales_ready() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.zidu_create_order_atomic(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_recipe_ml_sales_ready() TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

SELECT
  public.zidu_recipe_ml_sales_ready() AS recipe_sales_by_ml_ready,
  NOT has_function_privilege('anon', 'public.zidu_recipe_ml_sales_ready()', 'EXECUTE') AS anon_recipe_check_blocked,
  has_function_privilege('authenticated', 'public.zidu_recipe_ml_sales_ready()', 'EXECUTE') AS authenticated_recipe_check_ready;
