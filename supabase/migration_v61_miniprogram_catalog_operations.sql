-- ============================================================
-- ZIDU v61: 小程序完整商品运营、SKU 合并与图片上传
--
-- 1. 旧的无编号规格保留历史引用，但不再出现在商城管理中。
-- 2. 正式编号 SKU 继承旧规格库存，避免同一规格显示两份库存。
-- 3. 超级管理员可新增商品、增减商城 SKU、管理分类和上下架。
-- 4. 创建公开图片桶，只有超级管理员可以上传或删除商城图片。
-- ============================================================

BEGIN;

ALTER TABLE public.product_specs
  ADD COLUMN IF NOT EXISTS catalog_visible_2c BOOLEAN NOT NULL DEFAULT TRUE;

-- 将旧无编号规格的库存归并到同产品、同规格的正式 SKU；不相加，避免重复记账。
WITH legacy_stock AS (
  SELECT
    numbered.id AS numbered_id,
    max(coalesce(legacy.stock, 0)) AS legacy_stock,
    max(coalesce(legacy.safe_stock, 0)) AS legacy_safe_stock
  FROM public.product_specs numbered
  JOIN public.product_specs legacy
    ON legacy.product_id = numbered.product_id
   AND lower(regexp_replace(coalesce(legacy.spec, ''), '\s+', '', 'g'))
       = lower(regexp_replace(coalesce(numbered.spec, ''), '\s+', '', 'g'))
   AND legacy.id <> numbered.id
  WHERE nullif(trim(numbered.sku), '') IS NOT NULL
    AND nullif(trim(legacy.sku), '') IS NULL
  GROUP BY numbered.id
)
UPDATE public.product_specs numbered
SET stock = greatest(coalesce(numbered.stock, 0), legacy_stock.legacy_stock),
    safe_stock = greatest(coalesce(numbered.safe_stock, 0), legacy_stock.legacy_safe_stock)
FROM legacy_stock
WHERE numbered.id = legacy_stock.numbered_id;

-- 历史规格不物理删除，避免破坏采购、批次、配方和订单引用。
UPDATE public.product_specs legacy
SET catalog_visible_2c = false,
    on_sale_2c = false
WHERE nullif(trim(legacy.sku), '') IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.product_specs numbered
    WHERE numbered.product_id = legacy.product_id
      AND nullif(trim(numbered.sku), '') IS NOT NULL
      AND lower(regexp_replace(coalesce(numbered.spec, ''), '\s+', '', 'g'))
          = lower(regexp_replace(coalesce(legacy.spec, ''), '\s+', '', 'g'))
  );

UPDATE public.product_specs
SET catalog_visible_2c = true
WHERE nullif(trim(sku), '') IS NOT NULL;

-- 小程序商品图片：公开读取，仅超级管理员可以维护。
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'miniprogram-catalog',
  'miniprogram-catalog',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS miniprogram_catalog_public_read ON storage.objects;
CREATE POLICY miniprogram_catalog_public_read
ON storage.objects FOR SELECT
USING (bucket_id = 'miniprogram-catalog');

DROP POLICY IF EXISTS miniprogram_catalog_superadmin_insert ON storage.objects;
CREATE POLICY miniprogram_catalog_superadmin_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'miniprogram-catalog'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE id = public.zidu_current_user_id()
      AND role = 'SUPER_ADMIN' AND status = 'active'
  )
);

DROP POLICY IF EXISTS miniprogram_catalog_superadmin_update ON storage.objects;
CREATE POLICY miniprogram_catalog_superadmin_update
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'miniprogram-catalog'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE id = public.zidu_current_user_id()
      AND role = 'SUPER_ADMIN' AND status = 'active'
  )
)
WITH CHECK (
  bucket_id = 'miniprogram-catalog'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE id = public.zidu_current_user_id()
      AND role = 'SUPER_ADMIN' AND status = 'active'
  )
);

DROP POLICY IF EXISTS miniprogram_catalog_superadmin_delete ON storage.objects;
CREATE POLICY miniprogram_catalog_superadmin_delete
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'miniprogram-catalog'
  AND EXISTS (
    SELECT 1 FROM public.users
    WHERE id = public.zidu_current_user_id()
      AND role = 'SUPER_ADMIN' AND status = 'active'
  )
);

CREATE OR REPLACE FUNCTION public.get_miniprogram_catalog_admin()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_products JSONB := '[]'::JSONB;
BEGIN
  SELECT * INTO v_actor
  FROM public.users
  WHERE id = public.zidu_current_user_id() AND status = 'active';
  IF v_actor.id IS NULL OR v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN jsonb_build_object('error', '只有超级管理员可以管理小程序商品');
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.category_order, p.code, p.id), '[]'::JSONB)
  INTO v_products
  FROM (
    SELECT
      product.id,
      product.code,
      product.name,
      product.origin,
      coalesce(product.extraction_method, '') AS extraction_method,
      coalesce(product.oil_id, '') AS oil_id,
      coalesce(product.cat_2c, '') AS cat_2c,
      CASE coalesce(product.cat_2c, '')
        WHEN '单方精油' THEN 1 WHEN '复方精油' THEN 2
        WHEN '基础油' THEN 3 WHEN '纯露' THEN 4 ELSE 9
      END AS category_order,
      coalesce(product.copy_2c, '') AS copy_2c,
      coalesce(product.description_2c, '') AS description_2c,
      coalesce(product.usage_2c, '') AS usage_2c,
      coalesce(product.image_url, '') AS image_url,
      CASE
        WHEN jsonb_array_length(coalesce(product.main_gallery_2c, '[]'::JSONB)) > 0
          THEN product.main_gallery_2c
        ELSE coalesce(product.gallery, '[]'::JSONB)
      END AS main_gallery_2c,
      coalesce(product.detail_gallery_2c, '[]'::JSONB) AS detail_gallery_2c,
      product.on_sale_2c,
      coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'id', spec.id,
          'sku', coalesce(spec.sku, ''),
          'spec', spec.spec,
          'price', spec.price,
          'stock', spec.stock,
          'on_sale_2c', spec.on_sale_2c
        ) ORDER BY spec.sku, spec.id)
        FROM public.product_specs spec
        WHERE spec.product_id = product.id
          AND spec.catalog_visible_2c = true
          AND nullif(trim(spec.sku), '') IS NOT NULL
      ), '[]'::JSONB) AS specs
    FROM public.products product
    WHERE product.code LIKE 'ZDEO-%'
       OR product.on_sale_2c
       OR coalesce(product.cat_2c, '') IN ('单方精油', '复方精油', '基础油', '纯露')
  ) p;

  RETURN jsonb_build_object(
    'success', true,
    'schemaVersion', 61,
    'publishMode', 'FIVE_MINUTES',
    'categories', jsonb_build_array('单方精油', '复方精油', '基础油', '纯露'),
    'products', v_products,
    'summary', jsonb_build_object(
      'products', jsonb_array_length(v_products),
      'onSaleProducts', (SELECT count(*) FROM public.products p WHERE p.on_sale_2c),
      'onSaleSpecs', (SELECT count(*) FROM public.product_specs s WHERE s.on_sale_2c AND s.catalog_visible_2c)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.superadmin_create_miniprogram_product(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_code TEXT := upper(trim(coalesce(p_payload->>'code', '')));
  v_name TEXT := trim(coalesce(p_payload->>'name', ''));
  v_category TEXT := trim(coalesce(p_payload->>'category', ''));
  v_origin TEXT := trim(coalesce(p_payload->>'origin', '中国'));
  v_product_id INTEGER;
BEGIN
  SELECT * INTO v_actor
  FROM public.users
  WHERE id = public.zidu_current_user_id() AND status = 'active';
  IF v_actor.id IS NULL OR v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN jsonb_build_object('error', '只有超级管理员可以新增小程序商品');
  END IF;
  IF v_category NOT IN ('单方精油', '复方精油', '基础油', '纯露') THEN
    RETURN jsonb_build_object('error', '请选择有效商品分类');
  END IF;
  IF v_code !~ '^[A-Z0-9][A-Z0-9-]{2,39}$' THEN
    RETURN jsonb_build_object('error', '商品编码需为 3 至 40 位大写字母、数字或横线');
  END IF;
  IF v_name = '' OR length(v_name) > 80 THEN
    RETURN jsonb_build_object('error', '商品名称不能为空且不能超过 80 字');
  END IF;
  IF EXISTS (SELECT 1 FROM public.products WHERE upper(code) = v_code) THEN
    RETURN jsonb_build_object('error', '商品编码已经存在');
  END IF;

  INSERT INTO public.products(
    code, name, series, origin, channel, extraction_method,
    oil_id, cat_2c, copy_2c, image_url, gallery,
    description_2c, usage_2c, main_gallery_2c, detail_gallery_2c, on_sale_2c
  ) VALUES (
    v_code, v_name, v_category || '系列', nullif(v_origin, ''), 'BOTH',
    trim(coalesce(p_payload->>'extractionMethod', '')),
    trim(coalesce(p_payload->>'oilId', '')), v_category,
    trim(coalesce(p_payload->>'tagline', '')),
    trim(coalesce(p_payload->>'cover', '')), '[]'::JSONB,
    trim(coalesce(p_payload->>'description', '')),
    trim(coalesce(p_payload->>'usage', '')), '[]'::JSONB, '[]'::JSONB, false
  ) RETURNING id INTO v_product_id;

  INSERT INTO public.miniprogram_catalog_audit(product_id, actor_id, action, snapshot)
  VALUES (v_product_id, v_actor.id, 'CREATE', p_payload);

  RETURN jsonb_build_object('success', true, 'productId', v_product_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.superadmin_update_miniprogram_product(
  p_product_id INTEGER,
  p_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_name TEXT := trim(coalesce(p_payload->>'name', ''));
  v_cat TEXT := trim(coalesce(p_payload->>'category', ''));
  v_tagline TEXT := trim(coalesce(p_payload->>'tagline', ''));
  v_description TEXT := trim(coalesce(p_payload->>'description', ''));
  v_usage TEXT := trim(coalesce(p_payload->>'usage', ''));
  v_origin TEXT := trim(coalesce(p_payload->>'origin', ''));
  v_extraction TEXT := trim(coalesce(p_payload->>'extractionMethod', ''));
  v_oil_id TEXT := trim(coalesce(p_payload->>'oilId', ''));
  v_cover TEXT := trim(coalesce(p_payload->>'cover', ''));
  v_main JSONB := coalesce(p_payload->'mainGallery', '[]'::JSONB);
  v_detail JSONB := coalesce(p_payload->'detailGallery', '[]'::JSONB);
  v_specs JSONB := coalesce(p_payload->'specs', '[]'::JSONB);
  v_on_sale BOOLEAN := lower(coalesce(p_payload->>'onSale', 'false')) = 'true';
  v_entry JSONB;
  v_spec_id INTEGER;
  v_sku TEXT;
  v_spec TEXT;
  v_price NUMERIC;
  v_spec_on_sale BOOLEAN;
  v_kept_ids INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
  SELECT * INTO v_actor
  FROM public.users
  WHERE id = public.zidu_current_user_id() AND status = 'active';
  IF v_actor.id IS NULL OR v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN jsonb_build_object('error', '只有超级管理员可以管理小程序商品');
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF v_product.id IS NULL THEN RETURN jsonb_build_object('error', '商品不存在'); END IF;
  IF v_cat NOT IN ('单方精油', '复方精油', '基础油', '纯露') THEN
    RETURN jsonb_build_object('error', '请选择有效商品分类');
  END IF;
  IF v_name = '' OR length(v_name) > 80 THEN
    RETURN jsonb_build_object('error', '商品名称不能为空且不能超过 80 字');
  END IF;
  IF length(v_tagline) > 160 OR length(v_description) > 1000 OR length(v_usage) > 1500 THEN
    RETURN jsonb_build_object('error', '商品文案超过允许长度');
  END IF;
  IF v_cover <> '' AND (length(v_cover) > 1000 OR v_cover !~ '^https://') THEN
    RETURN jsonb_build_object('error', '主图必须使用 https:// 地址');
  END IF;
  IF jsonb_typeof(v_main) <> 'array' OR jsonb_typeof(v_detail) <> 'array' OR jsonb_typeof(v_specs) <> 'array' THEN
    RETURN jsonb_build_object('error', '图片和规格数据格式不正确');
  END IF;
  IF jsonb_array_length(v_main) > 6 OR jsonb_array_length(v_detail) > 20 OR jsonb_array_length(v_specs) > 24 THEN
    RETURN jsonb_build_object('error', '轮播图最多 6 张、详情图最多 20 张、规格最多 24 个');
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_main || v_detail) image(url)
    WHERE trim(url) = '' OR length(trim(url)) > 1000 OR trim(url) !~ '^https://'
  ) THEN
    RETURN jsonb_build_object('error', '图片列表中存在无效地址');
  END IF;
  IF EXISTS (
    SELECT lower(trim(entry->>'sku'))
    FROM jsonb_array_elements(v_specs) entry
    GROUP BY lower(trim(entry->>'sku'))
    HAVING count(*) > 1
  ) THEN
    RETURN jsonb_build_object('error', '同一商品不能填写重复 SKU');
  END IF;
  IF v_on_sale AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_specs) entry
    WHERE lower(coalesce(entry->>'onSale', 'false')) = 'true'
  ) THEN
    RETURN jsonb_build_object('error', '商品上架时至少需要上架一个规格');
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_specs)
  LOOP
    v_sku := upper(trim(coalesce(v_entry->>'sku', '')));
    v_spec := trim(coalesce(v_entry->>'spec', ''));
    v_spec_on_sale := lower(coalesce(v_entry->>'onSale', 'false')) = 'true';
    IF v_sku !~ '^[A-Z0-9][A-Z0-9-]{2,49}$' THEN
      RETURN jsonb_build_object('error', '每个商城规格都必须填写正式 SKU 编号');
    END IF;
    IF v_spec = '' OR length(v_spec) > 40 THEN
      RETURN jsonb_build_object('error', '规格名称不能为空且不能超过 40 字');
    END IF;
    IF coalesce(v_entry->>'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$' THEN
      RETURN jsonb_build_object('error', '商城价格格式不正确');
    END IF;
    v_price := (v_entry->>'price')::NUMERIC;
    IF v_price <= 0 THEN RETURN jsonb_build_object('error', '商城价格必须大于 0'); END IF;

    IF coalesce(v_entry->>'id', '') ~ '^[0-9]+$' THEN
      v_spec_id := (v_entry->>'id')::INTEGER;
      IF NOT EXISTS (
        SELECT 1 FROM public.product_specs
        WHERE id = v_spec_id AND product_id = p_product_id
      ) THEN RETURN jsonb_build_object('error', '规格不属于当前商品'); END IF;
      IF EXISTS (
        SELECT 1 FROM public.product_specs
        WHERE lower(coalesce(sku, '')) = lower(v_sku) AND id <> v_spec_id
      ) THEN RETURN jsonb_build_object('error', 'SKU 编号已经存在'); END IF;

      UPDATE public.product_specs
      SET sku = v_sku,
          spec = v_spec,
          price = v_price,
          catalog_visible_2c = true,
          on_sale_2c = v_on_sale AND v_spec_on_sale
      WHERE id = v_spec_id;
    ELSE
      IF EXISTS (SELECT 1 FROM public.product_specs WHERE lower(coalesce(sku, '')) = lower(v_sku)) THEN
        RETURN jsonb_build_object('error', 'SKU 编号已经存在');
      END IF;
      INSERT INTO public.product_specs(
        product_id, sku, spec, price, stock, safe_stock, catalog_visible_2c, on_sale_2c
      ) VALUES (
        p_product_id, v_sku, v_spec, v_price, 0, 10, true, v_on_sale AND v_spec_on_sale
      ) RETURNING id INTO v_spec_id;
    END IF;
    v_kept_ids := array_append(v_kept_ids, v_spec_id);
  END LOOP;

  UPDATE public.product_specs
  SET catalog_visible_2c = false, on_sale_2c = false
  WHERE product_id = p_product_id
    AND catalog_visible_2c = true
    AND NOT (id = ANY(v_kept_ids));

  UPDATE public.products
  SET name = v_name,
      origin = nullif(v_origin, ''),
      extraction_method = v_extraction,
      oil_id = v_oil_id,
      cat_2c = v_cat,
      series = v_cat || '系列',
      copy_2c = v_tagline,
      description_2c = v_description,
      usage_2c = v_usage,
      image_url = v_cover,
      gallery = v_main,
      main_gallery_2c = v_main,
      detail_gallery_2c = v_detail,
      on_sale_2c = v_on_sale
  WHERE id = p_product_id;

  INSERT INTO public.miniprogram_catalog_audit(product_id, actor_id, action, snapshot)
  VALUES (p_product_id, v_actor.id, CASE WHEN v_on_sale THEN 'SAVE_ON_SALE' ELSE 'SAVE_OFF_SALE' END, p_payload);

  RETURN jsonb_build_object('success', true, 'productId', p_product_id, 'onSale', v_on_sale);
END;
$$;

REVOKE ALL ON FUNCTION public.get_miniprogram_catalog_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.superadmin_create_miniprogram_product(JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.superadmin_update_miniprogram_product(INTEGER, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_miniprogram_catalog_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_create_miniprogram_product(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_update_miniprogram_product(INTEGER, JSONB) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT
  to_regprocedure('public.superadmin_create_miniprogram_product(jsonb)') IS NOT NULL AS product_create_ready,
  to_regprocedure('public.superadmin_update_miniprogram_product(integer,jsonb)') IS NOT NULL AS product_update_ready,
  count(*) FILTER (WHERE catalog_visible_2c AND nullif(trim(sku), '') IS NOT NULL) AS numbered_catalog_specs,
  count(*) FILTER (WHERE NOT catalog_visible_2c AND nullif(trim(sku), '') IS NULL) AS hidden_legacy_specs
FROM public.product_specs;
