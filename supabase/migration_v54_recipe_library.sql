-- ZIDU v54: 配方库、配方销售 SKU 与组成 SKU 库存联动。
--
-- 规则：
-- 1. 每个登录账号只能查看和维护自己的配方，SUPER_ADMIN 可查看全部。
-- 2. 配方保存后生成唯一 ZDPF SKU，通过原有购物车和订单链路销售。
-- 3. 下单时按销售数量扣减每个组成 SKU；MASS 库存按 ml 经密度换算 kg，SKU 库存按瓶/个扣减。
-- 4. 库存不足时整单回滚；取消或删除未取消订单时，使用下单时固化的用量归还。
-- 5. 配方明细仅保存在受控配方表和订单私有元数据中，订单页只显示配方 SKU。
--
-- 依赖：migration_v35_fifo_batch_inventory.sql、migration_v39_auth_foundation.sql、
--       migration_v40_secure_rpc.sql、migration_v43_super_admin_permission_fix.sql。

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.zidu_create_order_atomic_impl(jsonb)') IS NULL THEN
    RAISE EXCEPTION '请先运行 migration_v40_secure_rpc.sql，启用受控下单入口';
  END IF;
  IF to_regprocedure('public.zidu_adjust_inventory(integer,text,numeric,text)') IS NULL THEN
    RAISE EXCEPTION '请先运行 migration_v35_fifo_batch_inventory.sql';
  END IF;
END $$;

ALTER TABLE public.stock_adjustments
  ALTER COLUMN quantity TYPE NUMERIC(18,6) USING quantity::NUMERIC;

CREATE TABLE IF NOT EXISTS public.recipe_library (
  id BIGSERIAL PRIMARY KEY,
  owner_user_id INTEGER NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  sku_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  spec TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL CHECK (price > 0),
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recipe_library_owner
  ON public.recipe_library(owner_user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.recipe_components (
  id BIGSERIAL PRIMARY KEY,
  recipe_id BIGINT NOT NULL REFERENCES public.recipe_library(id) ON DELETE CASCADE,
  component_product_id INTEGER NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  component_spec_id INTEGER NOT NULL REFERENCES public.product_specs(id) ON DELETE RESTRICT,
  quantity NUMERIC(18,6) NOT NULL CHECK (quantity > 0),
  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('ML', 'SPEC')),
  product_code_snapshot TEXT NOT NULL DEFAULT '',
  product_name_snapshot TEXT NOT NULL DEFAULT '',
  spec_snapshot TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(recipe_id, component_spec_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_components_recipe
  ON public.recipe_components(recipe_id, id);
CREATE INDEX IF NOT EXISTS idx_recipe_components_spec
  ON public.recipe_components(component_spec_id);

CREATE TABLE IF NOT EXISTS public.recipe_inventory_usage (
  id BIGSERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  recipe_id BIGINT NOT NULL REFERENCES public.recipe_library(id) ON DELETE RESTRICT,
  component_id BIGINT REFERENCES public.recipe_components(id) ON DELETE SET NULL,
  product_id INTEGER NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  spec_id INTEGER NOT NULL REFERENCES public.product_specs(id) ON DELETE RESTRICT,
  inventory_mode TEXT NOT NULL CHECK (inventory_mode IN ('MASS', 'SKU')),
  quantity_unit TEXT NOT NULL CHECK (quantity_unit IN ('ML', 'SPEC')),
  quantity_per_unit NUMERIC(18,6) NOT NULL CHECK (quantity_per_unit > 0),
  ordered_quantity INTEGER NOT NULL CHECK (ordered_quantity > 0),
  consumed_quantity NUMERIC(18,6) NOT NULL CHECK (consumed_quantity > 0),
  density_g_ml NUMERIC(12,6),
  quantity_kg NUMERIC(18,6),
  product_code_snapshot TEXT NOT NULL DEFAULT '',
  product_name_snapshot TEXT NOT NULL DEFAULT '',
  spec_snapshot TEXT NOT NULL DEFAULT '',
  returned_at TIMESTAMPTZ,
  returned_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id, recipe_id, component_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_usage_order
  ON public.recipe_inventory_usage(order_id, returned_at);
CREATE INDEX IF NOT EXISTS idx_recipe_usage_spec
  ON public.recipe_inventory_usage(spec_id);

ALTER TABLE public.recipe_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_components ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_inventory_usage ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.recipe_library, public.recipe_components, public.recipe_inventory_usage
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.recipe_library_id_seq, public.recipe_components_id_seq,
  public.recipe_inventory_usage_id_seq FROM PUBLIC, anon, authenticated;

-- 客户端统一通过下方 RPC 访问，表本身不对登录用户直开。
DROP POLICY IF EXISTS recipe_library_owner_read ON public.recipe_library;
CREATE POLICY recipe_library_owner_read ON public.recipe_library
FOR SELECT TO authenticated USING (
  owner_user_id = public.zidu_current_user_id()
  OR public.zidu_has_role(ARRAY['SUPER_ADMIN'])
);

DROP POLICY IF EXISTS recipe_components_owner_read ON public.recipe_components;
CREATE POLICY recipe_components_owner_read ON public.recipe_components
FOR SELECT TO authenticated USING (EXISTS (
  SELECT 1 FROM public.recipe_library recipe
  WHERE recipe.id = recipe_components.recipe_id
    AND (
      recipe.owner_user_id = public.zidu_current_user_id()
      OR public.zidu_has_role(ARRAY['SUPER_ADMIN'])
    )
));

CREATE OR REPLACE FUNCTION public.zidu_recipe_list()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_result JSONB;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(
    ARRAY['SUPER_ADMIN','ADMIN','SALES','WAREHOUSE','FINANCE']
  );

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', recipe.id,
      'ownerUserId', recipe.owner_user_id,
      'ownerName', owner_user.name,
      'skuCode', recipe.sku_code,
      'name', recipe.name,
      'spec', recipe.spec,
      'price', recipe.price,
      'notes', recipe.notes,
      'status', recipe.status,
      'createdAt', recipe.created_at,
      'updatedAt', recipe.updated_at,
      'components', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', component.id,
          'productId', component.component_product_id,
          'specId', component.component_spec_id,
          'quantity', component.quantity,
          'unit', component.quantity_unit,
          'productCode', component.product_code_snapshot,
          'productName', component.product_name_snapshot,
          'specName', component.spec_snapshot
        ) ORDER BY component.id)
        FROM public.recipe_components component
        WHERE component.recipe_id = recipe.id
      ), '[]'::JSONB)
    ) ORDER BY recipe.updated_at DESC, recipe.id DESC
  ), '[]'::JSONB)
  INTO v_result
  FROM public.recipe_library recipe
  JOIN public.users owner_user ON owner_user.id = recipe.owner_user_id
  WHERE v_actor.role = 'SUPER_ADMIN' OR recipe.owner_user_id = v_actor.id;

  RETURN v_result;
END;
$$;

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
  v_unit TEXT;
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
  IF trim(coalesce(p_recipe->>'spec', '')) = '' THEN RAISE EXCEPTION '请填写销售规格'; END IF;
  IF length(trim(p_recipe->>'spec')) > 80 THEN RAISE EXCEPTION '销售规格过长'; END IF;
  IF coalesce(p_recipe->>'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$' THEN
    RAISE EXCEPTION '请填写有效售价';
  END IF;
  v_price := (p_recipe->>'price')::NUMERIC;
  IF v_price <= 0 THEN RAISE EXCEPTION '售价必须大于 0'; END IF;
  IF jsonb_typeof(coalesce(p_recipe->'components', '[]'::JSONB)) <> 'array'
     OR jsonb_array_length(coalesce(p_recipe->'components', '[]'::JSONB)) = 0 THEN
    RAISE EXCEPTION '配方至少需要一个组成 SKU';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_recipe->'components') component
    WHERE coalesce(component->>'specId', '') !~ '^[0-9]+$'
       OR coalesce(component->>'quantity', '') !~ '^[0-9]+([.][0-9]+)?$'
  ) THEN
    RAISE EXCEPTION '组成 SKU 或用量无效';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_recipe->'components') component
    WHERE (component->>'quantity')::NUMERIC <= 0
  ) THEN
    RAISE EXCEPTION '组成 SKU 用量必须大于 0';
  END IF;

  IF (
    SELECT count(*) <> count(DISTINCT (component->>'specId')::INTEGER)
    FROM jsonb_array_elements(p_recipe->'components') component
  ) THEN
    RAISE EXCEPTION '同一个组成 SKU 不能重复添加';
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
      trim(p_recipe->>'name'), trim(p_recipe->>'spec'), round(v_price, 2),
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
      spec = trim(p_recipe->>'spec'),
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
    IF v_spec.id IS NULL THEN RAISE EXCEPTION '组成 SKU 不存在'; END IF;

    SELECT * INTO v_product FROM public.products WHERE id = v_spec.product_id;
    IF v_product.id IS NULL THEN RAISE EXCEPTION '组成商品不存在'; END IF;

    v_quantity := (v_component->>'quantity')::NUMERIC;
    IF v_product.inventory_mode = 'MASS' THEN
      IF coalesce(v_product.density_g_ml, 0) <= 0 THEN
        RAISE EXCEPTION '% 没有有效密度，无法作为 ml 配方原料', v_product.name;
      END IF;
      v_unit := 'ML';
    ELSE
      IF v_quantity <> trunc(v_quantity) THEN
        RAISE EXCEPTION '% % 按瓶/个管理，用量必须是整数', v_product.name, v_spec.spec;
      END IF;
      v_unit := 'SPEC';
    END IF;

    INSERT INTO public.recipe_components(
      recipe_id, component_product_id, component_spec_id,
      quantity, quantity_unit,
      product_code_snapshot, product_name_snapshot, spec_snapshot
    ) VALUES (
      v_recipe_id, v_product.id, v_spec.id,
      round(v_quantity, 6), v_unit,
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

CREATE OR REPLACE FUNCTION public.zidu_archive_recipe(p_recipe_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_recipe public.recipe_library%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(
    ARRAY['SUPER_ADMIN','ADMIN','SALES','WAREHOUSE','FINANCE']
  );
  SELECT * INTO v_recipe FROM public.recipe_library WHERE id = p_recipe_id FOR UPDATE;
  IF v_recipe.id IS NULL THEN RAISE EXCEPTION '配方不存在'; END IF;
  IF v_recipe.owner_user_id <> v_actor.id AND v_actor.role <> 'SUPER_ADMIN' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = '只能归档自己的配方';
  END IF;
  UPDATE public.recipe_library SET status = 'ARCHIVED', updated_at = now()
  WHERE id = p_recipe_id;
  RETURN jsonb_build_object('success', true, 'id', p_recipe_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_apply_recipe_inventory(
  p_order_id INTEGER,
  p_channel_meta JSONB,
  p_direction TEXT,
  p_operator_name TEXT DEFAULT ''
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_selections JSONB := coalesce(p_channel_meta->'recipeSelections', '[]'::JSONB);
  v_usage RECORD;
  v_product public.products%ROWTYPE;
  v_spec public.product_specs%ROWTYPE;
  v_adjustment JSON;
  v_required NUMERIC;
  v_required_kg NUMERIC;
  v_order_no TEXT;
  v_result JSONB := '[]'::JSONB;
BEGIN
  IF p_direction NOT IN ('OUT', 'IN') THEN RAISE EXCEPTION '配方库存方向无效'; END IF;
  SELECT order_no INTO v_order_no FROM public.orders WHERE id = p_order_id;

  -- 归还使用下单时已固化的实际扣减值，不受后续配方或密度修改影响。
  IF p_direction = 'IN' THEN
    PERFORM spec.id
    FROM public.product_specs spec
    WHERE spec.id IN (
      SELECT usage.spec_id FROM public.recipe_inventory_usage usage
      WHERE usage.order_id = p_order_id AND usage.returned_at IS NULL
    )
    ORDER BY spec.id FOR UPDATE;

    PERFORM product.id
    FROM public.products product
    WHERE product.id IN (
      SELECT usage.product_id FROM public.recipe_inventory_usage usage
      WHERE usage.order_id = p_order_id AND usage.returned_at IS NULL
    )
    ORDER BY product.id FOR UPDATE;

    FOR v_usage IN
      SELECT * FROM public.recipe_inventory_usage
      WHERE order_id = p_order_id AND returned_at IS NULL
      ORDER BY spec_id, id FOR UPDATE
    LOOP
      SELECT * INTO v_product FROM public.products WHERE id = v_usage.product_id;
      SELECT * INTO v_spec FROM public.product_specs WHERE id = v_usage.spec_id;
      IF v_product.id IS NULL OR v_spec.id IS NULL THEN
        RAISE EXCEPTION '配方组成 SKU 已不存在，无法自动归还';
      END IF;
      IF v_usage.inventory_mode = 'MASS' THEN
        IF v_product.inventory_mode <> 'MASS' THEN RAISE EXCEPTION '% 库存模式已变更，无法自动归还', v_product.name; END IF;
        v_adjustment := public.zidu_adjust_inventory(v_usage.spec_id, 'IN', v_usage.quantity_kg, 'KG');
      ELSE
        IF v_product.inventory_mode = 'MASS' THEN RAISE EXCEPTION '% 库存模式已变更，无法自动归还', v_product.name; END IF;
        v_adjustment := public.zidu_adjust_inventory(v_usage.spec_id, 'IN', v_usage.consumed_quantity, 'SPEC');
      END IF;

      INSERT INTO public.stock_adjustments(
        spec_id, product_id, type, reason, quantity,
        before_stock, after_stock, quantity_kg, before_stock_kg, after_stock_kg,
        note, operator_name
      ) VALUES (
        v_usage.spec_id, v_usage.product_id, 'IN', 'CANCEL_RESTORE',
        CASE WHEN v_usage.inventory_mode = 'MASS' THEN v_usage.quantity_kg ELSE v_usage.consumed_quantity END,
        (v_adjustment->>'before')::NUMERIC,
        (v_adjustment->>'after')::NUMERIC,
        CASE WHEN v_usage.inventory_mode = 'MASS' THEN v_usage.quantity_kg ELSE NULL END,
        nullif(v_adjustment->>'beforeKg', '')::NUMERIC,
        nullif(v_adjustment->>'afterKg', '')::NUMERIC,
        '取消/删除配方订单归还 ' || coalesce(v_order_no, p_order_id::TEXT)
          || ' · ' || v_usage.product_name_snapshot || ' ' || v_usage.consumed_quantity
          || CASE WHEN v_usage.quantity_unit = 'ML' THEN 'ml' ELSE '瓶/个' END,
        coalesce(p_operator_name, '')
      );

      UPDATE public.recipe_inventory_usage
      SET returned_at = now(), returned_by = coalesce(p_operator_name, '')
      WHERE id = v_usage.id;
    END LOOP;
    RETURN jsonb_build_object('success', true, 'direction', 'IN');
  END IF;

  IF jsonb_typeof(v_selections) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION '订单配方数据无效'; END IF;
  IF jsonb_array_length(v_selections) = 0 THEN RETURN v_result; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_selections) selection
    WHERE coalesce(selection->>'recipeId', '') !~ '^[0-9]+$'
       OR coalesce(selection->>'quantity', '') !~ '^[0-9]+$'
       OR jsonb_typeof(selection->'components') IS DISTINCT FROM 'array'
  ) THEN RAISE EXCEPTION '订单配方快照无效'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_selections) selection
    WHERE (selection->>'quantity')::INTEGER <= 0
       OR jsonb_array_length(selection->'components') = 0
  ) THEN RAISE EXCEPTION '订单配方快照无效'; END IF;

  -- 统一锁顺序，与原有订单/FIFO 出库保持一致。
  PERFORM spec.id
  FROM public.product_specs spec
  WHERE spec.id IN (
    SELECT DISTINCT (component->>'specId')::INTEGER
    FROM jsonb_array_elements(v_selections) selection
    CROSS JOIN LATERAL jsonb_array_elements(selection->'components') component
  )
  ORDER BY spec.id FOR UPDATE;

  PERFORM product.id
  FROM public.products product
  WHERE product.id IN (
    SELECT DISTINCT (component->>'productId')::INTEGER
    FROM jsonb_array_elements(v_selections) selection
    CROSS JOIN LATERAL jsonb_array_elements(selection->'components') component
  )
  ORDER BY product.id FOR UPDATE;

  FOR v_usage IN
    SELECT
      (selection->>'recipeId')::BIGINT AS recipe_id,
      (selection->>'quantity')::INTEGER AS ordered_quantity,
      (component->>'componentId')::BIGINT AS component_id,
      (component->>'productId')::INTEGER AS product_id,
      (component->>'specId')::INTEGER AS spec_id,
      component->>'inventoryMode' AS inventory_mode,
      component->>'unit' AS quantity_unit,
      (component->>'quantityPerUnit')::NUMERIC AS quantity_per_unit,
      (component->>'densityGml')::NUMERIC AS density_g_ml,
      coalesce(component->>'productCode', '') AS product_code,
      coalesce(component->>'productName', '') AS product_name,
      coalesce(component->>'specName', '') AS spec_name
    FROM jsonb_array_elements(v_selections) selection
    CROSS JOIN LATERAL jsonb_array_elements(selection->'components') component
    ORDER BY (component->>'specId')::INTEGER, (selection->>'recipeId')::BIGINT
  LOOP
    IF v_usage.component_id IS NULL OR v_usage.product_id IS NULL OR v_usage.spec_id IS NULL
       OR v_usage.quantity_per_unit <= 0
       OR v_usage.inventory_mode NOT IN ('MASS', 'SKU')
       OR v_usage.quantity_unit NOT IN ('ML', 'SPEC') THEN
      RAISE EXCEPTION '订单配方组成项无效';
    END IF;
    SELECT * INTO v_product FROM public.products WHERE id = v_usage.product_id;
    SELECT * INTO v_spec FROM public.product_specs
    WHERE id = v_usage.spec_id AND product_id = v_usage.product_id;
    IF v_product.id IS NULL OR v_spec.id IS NULL THEN RAISE EXCEPTION '配方组成 SKU 不存在'; END IF;

    v_required := round(v_usage.quantity_per_unit * v_usage.ordered_quantity, 6);
    IF v_usage.inventory_mode = 'MASS' THEN
      IF v_product.inventory_mode <> 'MASS' OR v_usage.quantity_unit <> 'ML'
         OR coalesce(v_usage.density_g_ml, 0) <= 0 THEN
        RAISE EXCEPTION '% 的配方重量换算数据无效', v_product.name;
      END IF;
      v_required_kg := round(v_required * v_usage.density_g_ml / 1000, 6);
      IF v_required_kg <= 0 OR coalesce(v_product.base_stock_kg, 0) + 0.000001 < v_required_kg THEN
        RAISE EXCEPTION '% 库存不足：需要 %ml', v_product.name, v_required;
      END IF;
      v_adjustment := public.zidu_adjust_inventory(v_usage.spec_id, 'OUT', v_required_kg, 'KG');
    ELSE
      IF v_product.inventory_mode = 'MASS' OR v_usage.quantity_unit <> 'SPEC'
         OR v_required <> trunc(v_required) THEN
        RAISE EXCEPTION '% % 的配方数量无效', v_product.name, v_spec.spec;
      END IF;
      v_required_kg := NULL;
      IF coalesce(v_spec.stock, 0) < v_required THEN
        RAISE EXCEPTION '% % 库存不足：需要 % 瓶/个', v_product.name, v_spec.spec, v_required;
      END IF;
      v_adjustment := public.zidu_adjust_inventory(v_usage.spec_id, 'OUT', v_required, 'SPEC');
    END IF;

    INSERT INTO public.stock_adjustments(
      spec_id, product_id, type, reason, quantity,
      before_stock, after_stock, quantity_kg, before_stock_kg, after_stock_kg,
      note, operator_name
    ) VALUES (
      v_usage.spec_id, v_usage.product_id, 'OUT', 'ORDER',
      CASE WHEN v_usage.inventory_mode = 'MASS' THEN v_required_kg ELSE v_required END,
      (v_adjustment->>'before')::NUMERIC,
      (v_adjustment->>'after')::NUMERIC,
      v_required_kg,
      nullif(v_adjustment->>'beforeKg', '')::NUMERIC,
      nullif(v_adjustment->>'afterKg', '')::NUMERIC,
      '配方订单 ' || coalesce(v_order_no, p_order_id::TEXT)
        || ' · ' || coalesce(v_product.name, v_usage.product_name) || ' ' || v_required
        || CASE WHEN v_usage.quantity_unit = 'ML' THEN 'ml' ELSE '瓶/个' END,
      coalesce(p_operator_name, '')
    );

    INSERT INTO public.recipe_inventory_usage(
      order_id, recipe_id, component_id, product_id, spec_id,
      inventory_mode, quantity_unit, quantity_per_unit, ordered_quantity,
      consumed_quantity, density_g_ml, quantity_kg,
      product_code_snapshot, product_name_snapshot, spec_snapshot
    ) VALUES (
      p_order_id, v_usage.recipe_id,
      CASE WHEN EXISTS (
        SELECT 1 FROM public.recipe_components component
        WHERE component.id = v_usage.component_id
      ) THEN v_usage.component_id ELSE NULL END,
      v_usage.product_id, v_usage.spec_id,
      v_usage.inventory_mode, v_usage.quantity_unit,
      v_usage.quantity_per_unit, v_usage.ordered_quantity,
      v_required, CASE WHEN v_usage.inventory_mode = 'MASS' THEN v_usage.density_g_ml ELSE NULL END,
      v_required_kg,
      coalesce(v_product.code, v_usage.product_code),
      coalesce(v_product.name, v_usage.product_name),
      coalesce(v_spec.spec, v_usage.spec_name)
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'direction', 'OUT');
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_recipe_after_order_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_selections JSONB := NEW.channel_meta->'recipeSelections';
BEGIN
  IF jsonb_typeof(v_selections) = 'array'
     AND jsonb_array_length(v_selections) > 0
     AND NEW.status <> 'CANCELLED' THEN
    PERFORM public.zidu_apply_recipe_inventory(
      NEW.id, NEW.channel_meta, 'OUT', coalesce(NEW.channel_meta #>> '{enteredBy,name}', '')
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_recipe_after_order_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.recipe_inventory_usage
    WHERE order_id = NEW.id AND returned_at IS NULL
  ) THEN
    PERFORM public.zidu_apply_recipe_inventory(NEW.id, NEW.channel_meta, 'IN', 'system');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_recipe_before_order_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status <> 'CANCELLED' AND EXISTS (
    SELECT 1 FROM public.recipe_inventory_usage
    WHERE order_id = OLD.id AND returned_at IS NULL
  ) THEN
    PERFORM public.zidu_apply_recipe_inventory(OLD.id, OLD.channel_meta, 'IN', 'system');
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_guard_recipe_selection_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.channel_meta->'recipeSelections' IS DISTINCT FROM NEW.channel_meta->'recipeSelections' THEN
    RAISE EXCEPTION '订单提交后不能修改配方用量，请取消后重新下单';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zidu_recipe_order_insert ON public.orders;
CREATE TRIGGER trg_zidu_recipe_order_insert
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.zidu_recipe_after_order_insert();

DROP TRIGGER IF EXISTS trg_zidu_recipe_order_cancel ON public.orders;
CREATE TRIGGER trg_zidu_recipe_order_cancel
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM 'CANCELLED' AND NEW.status = 'CANCELLED')
EXECUTE FUNCTION public.zidu_recipe_after_order_cancel();

DROP TRIGGER IF EXISTS trg_zidu_recipe_order_delete ON public.orders;
CREATE TRIGGER trg_zidu_recipe_order_delete
BEFORE DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.zidu_recipe_before_order_delete();

DROP TRIGGER IF EXISTS trg_zidu_guard_recipe_selection_change ON public.orders;
CREATE TRIGGER trg_zidu_guard_recipe_selection_change
BEFORE UPDATE OF channel_meta ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.zidu_guard_recipe_selection_change();

-- 保留 v40 的身份、客户归属和折扣校验，在进入原子下单实现前，
-- 把配方订单明细转成数据库固化的私有快照。
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
  v_quantity INTEGER;
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
    v_quantity := (v_item->>'quantity')::INTEGER;
    IF v_quantity <= 0 THEN RAISE EXCEPTION '配方 SKU 数量无效'; END IF;
    SELECT * INTO v_recipe FROM public.recipe_library WHERE id = v_recipe_id;
    IF v_recipe.id IS NULL OR v_recipe.status <> 'ACTIVE' THEN RAISE EXCEPTION '配方已归档或不存在'; END IF;
    IF v_recipe.owner_user_id <> v_actor.id AND v_actor.role <> 'SUPER_ADMIN' THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = '无权销售其他人的配方';
    END IF;
    IF nullif(v_item->>'productId', '') IS NOT NULL OR nullif(v_item->>'specId', '') IS NOT NULL THEN
      RAISE EXCEPTION '配方 SKU 不能重复扣减虚拟成品库存';
    END IF;
    IF coalesce(v_item->>'productCode', '') <> v_recipe.sku_code
       OR coalesce(v_item->>'productName', '') <> v_recipe.name
       OR coalesce(v_item->>'spec', '') <> v_recipe.spec
       OR abs(coalesce(nullif(v_item->>'unitPrice', '')::NUMERIC, 0) - v_recipe.price) > 0.001 THEN
      RAISE EXCEPTION '配方 SKU 信息已变化，请返回购物车刷新后重试';
    END IF;
  END LOOP;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'recipeId', grouped.recipe_id,
    'quantity', grouped.quantity,
    'skuCode', recipe.sku_code,
    'name', recipe.name,
    'spec', recipe.spec,
    'unitPrice', recipe.price,
    'components', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'componentId', component.id,
        'productId', component.component_product_id,
        'specId', component.component_spec_id,
        'inventoryMode', CASE WHEN product.inventory_mode = 'MASS' THEN 'MASS' ELSE 'SKU' END,
        'unit', component.quantity_unit,
        'quantityPerUnit', component.quantity,
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
           sum((item->>'quantity')::INTEGER)::INTEGER AS quantity
    FROM jsonb_array_elements(coalesce(v_payload->'items', '[]'::JSONB)) item
    WHERE nullif(item->>'recipeId', '') IS NOT NULL
    GROUP BY (item->>'recipeId')::BIGINT
  ) grouped
  JOIN public.recipe_library recipe ON recipe.id = grouped.recipe_id;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_recipe_selections) selection
    WHERE jsonb_array_length(selection->'components') = 0
  ) THEN RAISE EXCEPTION '配方没有可扣减的组成 SKU'; END IF;

  v_channel_meta := coalesce(v_payload->'channelMeta', '{}'::JSONB)
    - ARRAY['recipeSelections', 'recipeVersion'];
  IF jsonb_array_length(v_recipe_selections) > 0 THEN
    v_channel_meta := v_channel_meta || jsonb_build_object(
      'recipeSelections', v_recipe_selections,
      'recipeVersion', 1
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

-- 配方订单的数量与组成 SKU 消耗已绑定，提交后不允许用普通明细编辑器改数量。
CREATE OR REPLACE FUNCTION public.zidu_update_order_items_atomic(
  p_order_id INTEGER,
  p_changes JSONB,
  p_totals JSONB,
  p_log JSONB DEFAULT '{}'::JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_log JSONB := coalesce(p_log, '{}'::JSONB);
  v_selections JSONB;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  SELECT channel_meta->'recipeSelections' INTO v_selections
  FROM public.orders WHERE id = p_order_id;
  IF jsonb_typeof(v_selections) = 'array'
     AND jsonb_array_length(v_selections) > 0
     AND jsonb_array_length(coalesce(p_changes, '[]'::JSONB)) > 0 THEN
    RAISE EXCEPTION '配方订单的数量不能直接修改，请取消后重新下单';
  END IF;
  v_log := jsonb_set(v_log, '{user}', to_jsonb(v_actor.name), true);
  RETURN public.zidu_update_order_items_atomic_impl(p_order_id, p_changes, p_totals, v_log);
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_recipe_inventory_ready()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    to_regclass('public.recipe_library') IS NOT NULL
    AND to_regclass('public.recipe_components') IS NOT NULL
    AND to_regclass('public.recipe_inventory_usage') IS NOT NULL
    AND to_regprocedure('public.zidu_recipe_list()') IS NOT NULL
    AND to_regprocedure('public.zidu_save_recipe(jsonb)') IS NOT NULL
    AND to_regprocedure('public.zidu_apply_recipe_inventory(integer,jsonb,text,text)') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.orders'::regclass
        AND tgname = 'trg_zidu_recipe_order_insert'
        AND NOT tgisinternal
    )
    AND EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.orders'::regclass
        AND tgname = 'trg_zidu_recipe_order_cancel'
        AND NOT tgisinternal
    )
    AND EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.orders'::regclass
        AND tgname = 'trg_zidu_recipe_order_delete'
        AND NOT tgisinternal
    );
$$;

REVOKE ALL ON FUNCTION public.zidu_recipe_list() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zidu_save_recipe(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zidu_archive_recipe(BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zidu_recipe_inventory_ready() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zidu_apply_recipe_inventory(INTEGER, JSONB, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zidu_recipe_after_order_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zidu_recipe_after_order_cancel() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zidu_recipe_before_order_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zidu_guard_recipe_selection_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zidu_create_order_atomic(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zidu_update_order_items_atomic(INTEGER, JSONB, JSONB, JSONB)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.zidu_recipe_list() TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_save_recipe(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_archive_recipe(BIGINT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_recipe_inventory_ready() TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_create_order_atomic(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_update_order_items_atomic(INTEGER, JSONB, JSONB, JSONB)
  TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;

SELECT
  public.zidu_recipe_inventory_ready() AS recipe_inventory_ready,
  to_regprocedure('public.zidu_create_order_atomic_impl(jsonb)') IS NOT NULL AS secure_order_impl_ready,
  has_function_privilege('anon', 'public.zidu_recipe_list()', 'EXECUTE') AS anon_can_read_recipes,
  has_function_privilege('authenticated', 'public.zidu_recipe_list()', 'EXECUTE') AS authenticated_can_read_recipes;
