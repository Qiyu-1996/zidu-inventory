-- ZIDU v50: 定制配方与原料重量库存联动。
-- 1. 定制单中每种原料按本单总用量 ml 记录。
-- 2. 数据库按产品密度换算 kg，与订单在同一事务中校验、FIFO 出库。
-- 3. 取消订单或删除未取消订单时自动归还；已取消订单删除时不重复归还。
-- 4. 配方保存在 orders.channel_meta.customFormula，不写入 order_items，因此订单页只显示定制品。

ALTER TABLE public.stock_adjustments
  ALTER COLUMN quantity TYPE NUMERIC(14,6) USING quantity::NUMERIC;

CREATE TABLE IF NOT EXISTS public.custom_formula_inventory_usage (
  id BIGSERIAL PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity_ml NUMERIC(18,6) NOT NULL CHECK (quantity_ml > 0),
  density_g_ml NUMERIC(12,6) NOT NULL CHECK (density_g_ml > 0),
  quantity_kg NUMERIC(18,6) NOT NULL CHECK (quantity_kg > 0),
  returned_at TIMESTAMPTZ,
  returned_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(order_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_custom_formula_usage_product
  ON public.custom_formula_inventory_usage(product_id);
ALTER TABLE public.custom_formula_inventory_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.custom_formula_inventory_usage FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.custom_formula_inventory_usage_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.zidu_apply_custom_formula_inventory(
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
  v_formula JSONB := coalesce(p_channel_meta->'customFormula', '[]'::JSONB);
  v_usage RECORD;
  v_product public.products%ROWTYPE;
  v_spec_id INTEGER;
  v_required_kg NUMERIC;
  v_adjustment JSON;
  v_order_no TEXT;
  v_result JSONB := '[]'::JSONB;
BEGIN
  IF p_direction NOT IN ('OUT', 'IN') THEN
    RAISE EXCEPTION '定制配方库存方向无效';
  END IF;

  SELECT order_no INTO v_order_no FROM public.orders WHERE id = p_order_id;

  -- 归还必须使用下单时固化的 kg，不能受日后密度修改影响。
  IF p_direction = 'IN' THEN
    PERFORM spec.id
    FROM public.product_specs spec
    WHERE spec.product_id IN (
      SELECT usage.product_id
      FROM public.custom_formula_inventory_usage usage
      WHERE usage.order_id = p_order_id AND usage.returned_at IS NULL
    )
    ORDER BY spec.id
    FOR UPDATE;

    PERFORM product.id
    FROM public.products product
    WHERE product.id IN (
      SELECT usage.product_id
      FROM public.custom_formula_inventory_usage usage
      WHERE usage.order_id = p_order_id AND usage.returned_at IS NULL
    )
    ORDER BY product.id
    FOR UPDATE;

    FOR v_usage IN
      SELECT usage.*
      FROM public.custom_formula_inventory_usage usage
      WHERE usage.order_id = p_order_id AND usage.returned_at IS NULL
      ORDER BY usage.product_id
      FOR UPDATE
    LOOP
      SELECT * INTO v_product FROM public.products WHERE id = v_usage.product_id;
      IF v_product.id IS NULL THEN
        RAISE EXCEPTION '定制订单原料已不存在，无法归还库存';
      END IF;
      IF v_product.inventory_mode <> 'MASS' THEN
        RAISE EXCEPTION '% 已不再按重量管理，无法自动归还原库存', v_product.name;
      END IF;

      SELECT min(id) INTO v_spec_id
      FROM public.product_specs
      WHERE product_id = v_product.id;
      IF v_spec_id IS NULL THEN
        RAISE EXCEPTION '% 没有可用规格，无法记录库存流水', v_product.name;
      END IF;

      v_adjustment := public.zidu_adjust_inventory(v_spec_id, 'IN', v_usage.quantity_kg, 'KG');
      INSERT INTO public.stock_adjustments(
        spec_id, product_id, type, reason, quantity,
        before_stock, after_stock, quantity_kg, before_stock_kg, after_stock_kg,
        note, operator_name
      ) VALUES (
        v_spec_id, v_product.id, 'IN', 'CANCEL_RESTORE', v_usage.quantity_kg,
        (v_adjustment->>'before')::NUMERIC,
        (v_adjustment->>'after')::NUMERIC,
        v_usage.quantity_kg,
        nullif(v_adjustment->>'beforeKg', '')::NUMERIC,
        nullif(v_adjustment->>'afterKg', '')::NUMERIC,
        '取消/删除定制订单归还 ' || coalesce(v_order_no, p_order_id::TEXT)
          || ' · ' || v_product.name || ' ' || v_usage.quantity_ml || 'ml',
        coalesce(p_operator_name, '')
      );

      UPDATE public.custom_formula_inventory_usage
      SET returned_at = now(), returned_by = coalesce(p_operator_name, '')
      WHERE id = v_usage.id;

      v_result := v_result || jsonb_build_array(jsonb_build_object(
        'productId', v_product.id,
        'productCode', v_product.code,
        'productName', v_product.name,
        'quantityMl', v_usage.quantity_ml,
        'quantityKg', v_usage.quantity_kg,
        'direction', 'IN'
      ));
    END LOOP;

    RETURN v_result;
  END IF;

  IF jsonb_typeof(v_formula) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION '定制配方数据格式无效';
  END IF;
  IF jsonb_array_length(v_formula) = 0 THEN
    RETURN v_result;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_formula) formula_item
    WHERE jsonb_typeof(formula_item->'ingredients') IS DISTINCT FROM 'array'
  ) THEN
    RAISE EXCEPTION '每个定制产品的原料格式必须是列表';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_formula) formula_item
    WHERE jsonb_array_length(formula_item->'ingredients') = 0
  ) THEN
    RAISE EXCEPTION '每个定制产品至少需要一种原料';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_formula) formula_item
    CROSS JOIN LATERAL jsonb_array_elements(formula_item->'ingredients') ingredient
    WHERE coalesce(ingredient->>'productId', '') !~ '^[0-9]+$'
       OR coalesce(ingredient->>'quantityMl', '') !~ '^[0-9]+([.][0-9]+)?$'
  ) THEN
    RAISE EXCEPTION '定制配方的原料或 ml 用量无效';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_formula) formula_item
    CROSS JOIN LATERAL jsonb_array_elements(formula_item->'ingredients') ingredient
    WHERE (ingredient->>'quantityMl')::NUMERIC <= 0
  ) THEN
    RAISE EXCEPTION '定制配方的 ml 用量必须大于 0';
  END IF;

  IF EXISTS (
    WITH ingredient_rows AS (
      SELECT DISTINCT (ingredient->>'productId')::INTEGER AS product_id
      FROM jsonb_array_elements(v_formula) formula_item
      CROSS JOIN LATERAL jsonb_array_elements(formula_item->'ingredients') ingredient
    )
    SELECT 1
    FROM ingredient_rows usage
    LEFT JOIN public.products product ON product.id = usage.product_id
    WHERE product.id IS NULL
  ) THEN
    RAISE EXCEPTION '定制配方中存在已删除的原料';
  END IF;

  -- 与既有库存调整函数保持同样的锁顺序：先规格，后产品。
  PERFORM spec.id
  FROM public.product_specs spec
  WHERE spec.product_id IN (
    SELECT DISTINCT (ingredient->>'productId')::INTEGER
    FROM jsonb_array_elements(v_formula) formula_item
    CROSS JOIN LATERAL jsonb_array_elements(formula_item->'ingredients') ingredient
  )
  ORDER BY spec.id
  FOR UPDATE;

  PERFORM product.id
  FROM public.products product
  WHERE product.id IN (
    SELECT DISTINCT (ingredient->>'productId')::INTEGER
    FROM jsonb_array_elements(v_formula) formula_item
    CROSS JOIN LATERAL jsonb_array_elements(formula_item->'ingredients') ingredient
  )
  ORDER BY product.id
  FOR UPDATE;

  FOR v_usage IN
    SELECT
      (ingredient->>'productId')::INTEGER AS product_id,
      sum((ingredient->>'quantityMl')::NUMERIC) AS quantity_ml
    FROM jsonb_array_elements(v_formula) formula_item
    CROSS JOIN LATERAL jsonb_array_elements(formula_item->'ingredients') ingredient
    GROUP BY (ingredient->>'productId')::INTEGER
    ORDER BY (ingredient->>'productId')::INTEGER
  LOOP
    SELECT * INTO v_product FROM public.products WHERE id = v_usage.product_id;
    IF v_product.inventory_mode <> 'MASS' OR v_product.channel NOT IN ('RAW', 'BOTH') THEN
      RAISE EXCEPTION '% 不是可按重量扣减的原料', v_product.name;
    END IF;
    IF coalesce(v_product.density_g_ml, 0) <= 0 THEN
      RAISE EXCEPTION '% 没有有效密度，无法从 ml 换算 kg', v_product.name;
    END IF;

    SELECT min(id) INTO v_spec_id
    FROM public.product_specs
    WHERE product_id = v_product.id;
    IF v_spec_id IS NULL THEN
      RAISE EXCEPTION '% 没有可用规格，无法记录库存流水', v_product.name;
    END IF;

    v_required_kg := round(v_usage.quantity_ml * v_product.density_g_ml / 1000, 6);
    IF v_required_kg <= 0 THEN
      RAISE EXCEPTION '% 的原料用量太小，无法记录', v_product.name;
    END IF;
    IF p_direction = 'OUT' AND coalesce(v_product.base_stock_kg, 0) + 0.000001 < v_required_kg THEN
      RAISE EXCEPTION '% 库存不足：需要 %ml，当前 %kg',
        v_product.name, v_usage.quantity_ml, coalesce(v_product.base_stock_kg, 0);
    END IF;

    v_adjustment := public.zidu_adjust_inventory(v_spec_id, p_direction, v_required_kg, 'KG');
    INSERT INTO public.stock_adjustments(
      spec_id, product_id, type, reason, quantity,
      before_stock, after_stock, quantity_kg, before_stock_kg, after_stock_kg,
      note, operator_name
    ) VALUES (
      v_spec_id, v_product.id, p_direction,
      CASE WHEN p_direction = 'OUT' THEN 'ORDER' ELSE 'CANCEL_RESTORE' END,
      v_required_kg,
      (v_adjustment->>'before')::NUMERIC,
      (v_adjustment->>'after')::NUMERIC,
      v_required_kg,
      nullif(v_adjustment->>'beforeKg', '')::NUMERIC,
      nullif(v_adjustment->>'afterKg', '')::NUMERIC,
      CASE WHEN p_direction = 'OUT' THEN '定制订单 ' ELSE '取消/删除定制订单归还 ' END
        || coalesce(v_order_no, p_order_id::TEXT) || ' · ' || v_product.name || ' ' || v_usage.quantity_ml || 'ml',
      coalesce(p_operator_name, '')
    );

    INSERT INTO public.custom_formula_inventory_usage(
      order_id, product_id, quantity_ml, density_g_ml, quantity_kg
    ) VALUES (
      p_order_id, v_product.id, v_usage.quantity_ml,
      v_product.density_g_ml, v_required_kg
    );

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'productCode', v_product.code,
      'productName', v_product.name,
      'quantityMl', v_usage.quantity_ml,
      'quantityKg', v_required_kg,
      'direction', p_direction
    ));
  END LOOP;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_custom_formula_after_order_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_formula JSONB := NEW.channel_meta->'customFormula';
BEGIN
  IF NEW.business_type IN ('品牌定制', '私人定制') THEN
    IF jsonb_typeof(v_formula) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION '定制订单必须填写原料成分及本单 ml 用量';
    END IF;
    IF jsonb_array_length(v_formula) = 0 THEN
      RAISE EXCEPTION '定制订单必须填写原料成分及本单 ml 用量';
    END IF;
  END IF;

  IF jsonb_typeof(v_formula) = 'array' THEN
    IF jsonb_array_length(v_formula) > 0 AND NEW.status <> 'CANCELLED' THEN
      PERFORM public.zidu_apply_custom_formula_inventory(
        NEW.id,
        NEW.channel_meta,
        'OUT',
        coalesce(NEW.channel_meta #>> '{enteredBy,name}', '')
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_custom_formula_after_order_cancel()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.custom_formula_inventory_usage
    WHERE order_id = NEW.id AND returned_at IS NULL
  ) THEN
    PERFORM public.zidu_apply_custom_formula_inventory(NEW.id, NEW.channel_meta, 'IN', '系统');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_custom_formula_before_order_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status <> 'CANCELLED' AND EXISTS (
    SELECT 1 FROM public.custom_formula_inventory_usage
    WHERE order_id = OLD.id AND returned_at IS NULL
  ) THEN
    PERFORM public.zidu_apply_custom_formula_inventory(OLD.id, OLD.channel_meta, 'IN', '系统');
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.zidu_guard_custom_formula_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.channel_meta->'customFormula' IS DISTINCT FROM NEW.channel_meta->'customFormula' THEN
    RAISE EXCEPTION '订单提交后不能在订单页修改定制配方，请通过库存盘点修正';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_zidu_custom_formula_order_insert ON public.orders;
CREATE TRIGGER trg_zidu_custom_formula_order_insert
AFTER INSERT ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.zidu_custom_formula_after_order_insert();

DROP TRIGGER IF EXISTS trg_zidu_custom_formula_order_cancel ON public.orders;
CREATE TRIGGER trg_zidu_custom_formula_order_cancel
AFTER UPDATE OF status ON public.orders
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM 'CANCELLED' AND NEW.status = 'CANCELLED')
EXECUTE FUNCTION public.zidu_custom_formula_after_order_cancel();

DROP TRIGGER IF EXISTS trg_zidu_custom_formula_order_delete ON public.orders;
CREATE TRIGGER trg_zidu_custom_formula_order_delete
BEFORE DELETE ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.zidu_custom_formula_before_order_delete();

DROP TRIGGER IF EXISTS trg_zidu_guard_custom_formula_change ON public.orders;
CREATE TRIGGER trg_zidu_guard_custom_formula_change
BEFORE UPDATE OF channel_meta ON public.orders
FOR EACH ROW EXECUTE FUNCTION public.zidu_guard_custom_formula_change();

CREATE OR REPLACE FUNCTION public.zidu_custom_formula_inventory_ready()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    to_regprocedure('public.zidu_apply_custom_formula_inventory(integer,jsonb,text,text)') IS NOT NULL
    AND to_regprocedure('public.zidu_adjust_inventory(integer,text,numeric,text)') IS NOT NULL
    AND to_regclass('public.custom_formula_inventory_usage') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.orders'::regclass
        AND tgname = 'trg_zidu_custom_formula_order_insert'
        AND NOT tgisinternal
    )
    AND EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.orders'::regclass
        AND tgname = 'trg_zidu_custom_formula_order_cancel'
        AND NOT tgisinternal
    )
    AND EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.orders'::regclass
        AND tgname = 'trg_zidu_custom_formula_order_delete'
        AND NOT tgisinternal
    )
    AND EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.orders'::regclass
        AND tgname = 'trg_zidu_guard_custom_formula_change'
        AND NOT tgisinternal
    )
    AND EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'stock_adjustments'
        AND column_name = 'quantity'
        AND data_type = 'numeric'
    );
$$;

REVOKE ALL ON FUNCTION public.zidu_apply_custom_formula_inventory(INTEGER, JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zidu_custom_formula_after_order_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zidu_custom_formula_after_order_cancel() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zidu_custom_formula_before_order_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zidu_guard_custom_formula_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.zidu_custom_formula_inventory_ready() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.zidu_custom_formula_inventory_ready() TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT
  public.zidu_custom_formula_inventory_ready() AS custom_formula_inventory_ready,
  data_type AS stock_adjustment_quantity_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'stock_adjustments'
  AND column_name = 'quantity';
