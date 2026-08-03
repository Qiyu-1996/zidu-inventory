-- ============================================================
-- ZIDU v60: 小程序商品内容管理（仅超级管理员）
--
-- Supabase 继续作为商品主数据；syncProducts 每小时发布只读快照到 CloudBase。
-- 本迁移只管理小程序展示字段和销售规格，不改变库存数量、成本或批次。
-- ============================================================

BEGIN;

-- 兼容尚未执行 v45 的数据库：先补齐小程序目录基础字段。
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS extraction_method TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS on_sale_2c BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS oil_id TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cat_2c TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS copy_2c TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS gallery JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE public.product_specs ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE public.product_specs ADD COLUMN IF NOT EXISTS on_sale_2c BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS description_2c TEXT NOT NULL DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS usage_2c TEXT NOT NULL DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS main_gallery_2c JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS detail_gallery_2c JSONB NOT NULL DEFAULT '[]'::JSONB;

CREATE TABLE IF NOT EXISTS public.miniprogram_catalog_audit (
  id BIGSERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  actor_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL DEFAULT 'UPDATE',
  snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS miniprogram_catalog_audit_product_idx
  ON public.miniprogram_catalog_audit(product_id, created_at DESC);
ALTER TABLE public.miniprogram_catalog_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.miniprogram_catalog_audit FROM PUBLIC, anon, authenticated;

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

  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.code, p.id), '[]'::JSONB)
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
        ) ORDER BY spec.id)
        FROM public.product_specs spec
        WHERE spec.product_id = product.id
      ), '[]'::JSONB) AS specs
    FROM public.products product
    WHERE product.code LIKE 'ZDEO-%'
       OR product.on_sale_2c
       OR coalesce(product.oil_id, '') <> ''
       OR coalesce(product.cat_2c, '') <> ''
  ) p;

  RETURN jsonb_build_object(
    'success', true,
    'publishMode', 'HOURLY',
    'products', v_products,
    'summary', jsonb_build_object(
      'products', jsonb_array_length(v_products),
      'onSaleProducts', (SELECT count(*) FROM public.products p WHERE p.on_sale_2c),
      'onSaleSpecs', (SELECT count(*) FROM public.product_specs s WHERE s.on_sale_2c)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_miniprogram_catalog_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_miniprogram_catalog_admin() TO authenticated;

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
  v_cover TEXT := trim(coalesce(p_payload->>'cover', ''));
  v_main JSONB := coalesce(p_payload->'mainGallery', '[]'::JSONB);
  v_detail JSONB := coalesce(p_payload->'detailGallery', '[]'::JSONB);
  v_specs JSONB := coalesce(p_payload->'specs', '[]'::JSONB);
  v_on_sale BOOLEAN := lower(coalesce(p_payload->>'onSale', 'false')) = 'true';
  v_invalid INTEGER := 0;
BEGIN
  SELECT * INTO v_actor
  FROM public.users
  WHERE id = public.zidu_current_user_id() AND status = 'active';
  IF v_actor.id IS NULL OR v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN jsonb_build_object('error', '只有超级管理员可以管理小程序商品');
  END IF;

  SELECT * INTO v_product FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF v_product.id IS NULL THEN
    RETURN jsonb_build_object('error', '商品不存在');
  END IF;
  IF v_name = '' OR length(v_name) > 80 THEN
    RETURN jsonb_build_object('error', '商品名称不能为空且不能超过 80 字');
  END IF;
  IF length(v_cat) > 40 OR length(v_tagline) > 160 OR length(v_description) > 1000 OR length(v_usage) > 1500 THEN
    RETURN jsonb_build_object('error', '商品文案超过允许长度');
  END IF;
  IF v_cover <> '' AND (length(v_cover) > 1000 OR v_cover !~ '^(https://|cloud://)') THEN
    RETURN jsonb_build_object('error', '主图必须使用 https:// 或 cloud:// 地址');
  END IF;
  IF jsonb_typeof(v_main) <> 'array' OR jsonb_typeof(v_detail) <> 'array' OR jsonb_typeof(v_specs) <> 'array' THEN
    RETURN jsonb_build_object('error', '图片和规格数据格式不正确');
  END IF;
  IF jsonb_array_length(v_main) > 6 OR jsonb_array_length(v_detail) > 20 THEN
    RETURN jsonb_build_object('error', '轮播图最多 6 张，详情图最多 20 张');
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(v_main || v_detail) image(url)
    WHERE trim(url) = '' OR length(trim(url)) > 1000 OR trim(url) !~ '^(https://|cloud://)'
  ) THEN
    RETURN jsonb_build_object('error', '图片列表中存在无效地址');
  END IF;

  SELECT count(*) INTO v_invalid
  FROM jsonb_array_elements(v_specs) entry
  WHERE coalesce(entry->>'id', '') !~ '^[0-9]+$'
     OR coalesce(entry->>'price', '') !~ '^[0-9]+([.][0-9]{1,2})?$';
  IF v_invalid > 0 THEN
    RETURN jsonb_build_object('error', '规格或价格数据不正确');
  END IF;
  SELECT count(*) INTO v_invalid
  FROM jsonb_array_elements(v_specs) entry
  WHERE (entry->>'price')::NUMERIC <= 0
     OR NOT EXISTS (
       SELECT 1 FROM public.product_specs spec
       WHERE spec.id = (entry->>'id')::INTEGER AND spec.product_id = p_product_id
     );
  IF v_invalid > 0 THEN
    RETURN jsonb_build_object('error', '规格或价格数据不正确');
  END IF;
  IF v_on_sale AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_specs) entry
    WHERE lower(coalesce(entry->>'onSale', 'false')) = 'true'
  ) THEN
    RETURN jsonb_build_object('error', '商品上架时至少需要上架一个规格');
  END IF;

  UPDATE public.products
  SET name = v_name,
      cat_2c = v_cat,
      copy_2c = v_tagline,
      description_2c = v_description,
      usage_2c = v_usage,
      image_url = v_cover,
      gallery = v_main,
      main_gallery_2c = v_main,
      detail_gallery_2c = v_detail,
      on_sale_2c = v_on_sale
  WHERE id = p_product_id;

  UPDATE public.product_specs SET on_sale_2c = false WHERE product_id = p_product_id;
  UPDATE public.product_specs spec
  SET price = (entry->>'price')::NUMERIC,
      on_sale_2c = v_on_sale AND lower(coalesce(entry->>'onSale', 'false')) = 'true'
  FROM jsonb_array_elements(v_specs) entry
  WHERE spec.id = (entry->>'id')::INTEGER
    AND spec.product_id = p_product_id;

  INSERT INTO public.miniprogram_catalog_audit(product_id, actor_id, action, snapshot)
  VALUES (p_product_id, v_actor.id, CASE WHEN v_on_sale THEN 'SAVE_ON_SALE' ELSE 'SAVE_OFF_SALE' END, p_payload);

  RETURN jsonb_build_object('success', true, 'productId', p_product_id, 'onSale', v_on_sale);
END;
$$;

REVOKE ALL ON FUNCTION public.superadmin_update_miniprogram_product(INTEGER, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_update_miniprogram_product(INTEGER, JSONB) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT
  to_regprocedure('public.get_miniprogram_catalog_admin()') IS NOT NULL AS catalog_admin_ready,
  to_regprocedure('public.superadmin_update_miniprogram_product(integer,jsonb)') IS NOT NULL AS catalog_update_ready;
