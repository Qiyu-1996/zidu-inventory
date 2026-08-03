-- ============================================================
-- ZIDU v62: 小程序首页内容管理
--
-- 1. 首页 Hero 轮播可上传、改文案、排序、上下架和配置小程序跳转。
-- 2. 仅超级管理员可在后台读取和修改；小程序仍由 CloudBase 发布快照读取。
-- 3. 预置当前两张首页 KV，执行升级后视觉保持不变。
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.miniprogram_home_banners (
  id BIGSERIAL PRIMARY KEY,
  banner_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL DEFAULT '',
  subtitle TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL,
  target_path TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT miniprogram_home_banner_title_length CHECK (length(title) <= 80),
  CONSTRAINT miniprogram_home_banner_subtitle_length CHECK (length(subtitle) <= 120),
  CONSTRAINT miniprogram_home_banner_image_length CHECK (length(image_url) <= 1200),
  CONSTRAINT miniprogram_home_banner_target_length CHECK (length(target_path) <= 500)
);

CREATE INDEX IF NOT EXISTS idx_miniprogram_home_banners_publish
  ON public.miniprogram_home_banners(is_active, sort_order, id);

ALTER TABLE public.miniprogram_home_banners ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.miniprogram_content_audit (
  id BIGSERIAL PRIMARY KEY,
  content_type TEXT NOT NULL,
  content_id BIGINT,
  actor_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.miniprogram_content_audit ENABLE ROW LEVEL SECURITY;

INSERT INTO public.miniprogram_home_banners(
  banner_key, title, subtitle, image_url, target_path, sort_order, is_active
) VALUES
  (
    'DEFAULT-FAMILY',
    '以植物芳香，关照身心',
    'Natural Wellness',
    'cloud://cloudbase-d2g87ujdj41b8ed03.636c-cloudbase-d2g87ujdj41b8ed03-1450946575/cloud-upload/img/reference-0731-original/embedded-01.jpg',
    '', 10, true
  ),
  (
    'DEFAULT-GARDEN',
    '以植物芳香，关照身心',
    'Natural Wellness',
    'cloud://cloudbase-d2g87ujdj41b8ed03.636c-cloudbase-d2g87ujdj41b8ed03-1450946575/cloud-upload/img/reference-0731-original/embedded-07.jpg',
    '', 20, true
  )
ON CONFLICT (banner_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_miniprogram_content_admin()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_banners JSONB := '[]'::JSONB;
BEGIN
  SELECT * INTO v_actor
  FROM public.users
  WHERE id = public.zidu_current_user_id() AND status = 'active';

  IF v_actor.id IS NULL OR v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN jsonb_build_object('error', '只有超级管理员可以管理小程序首页');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', banner.id,
    'key', banner.banner_key,
    'title', banner.title,
    'subtitle', banner.subtitle,
    'imageUrl', banner.image_url,
    'targetPath', banner.target_path,
    'sortOrder', banner.sort_order,
    'active', banner.is_active,
    'updatedAt', banner.updated_at
  ) ORDER BY banner.sort_order, banner.id), '[]'::JSONB)
  INTO v_banners
  FROM public.miniprogram_home_banners banner;

  RETURN jsonb_build_object(
    'success', true,
    'schemaVersion', 62,
    'publishMode', 'NEXT_APP_ENTRY',
    'banners', v_banners,
    'summary', jsonb_build_object(
      'total', jsonb_array_length(v_banners),
      'active', (SELECT count(*) FROM public.miniprogram_home_banners WHERE is_active)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.superadmin_save_miniprogram_home_banner(
  p_banner_id BIGINT,
  p_payload JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_id BIGINT;
  v_key TEXT;
  v_title TEXT := trim(coalesce(p_payload->>'title', ''));
  v_subtitle TEXT := trim(coalesce(p_payload->>'subtitle', ''));
  v_image_url TEXT := trim(coalesce(p_payload->>'imageUrl', ''));
  v_target_path TEXT := trim(coalesce(p_payload->>'targetPath', ''));
  v_sort_order INTEGER := coalesce(nullif(p_payload->>'sortOrder', '')::INTEGER, 100);
  v_active BOOLEAN := lower(coalesce(p_payload->>'active', 'false')) = 'true';
BEGIN
  SELECT * INTO v_actor
  FROM public.users
  WHERE id = public.zidu_current_user_id() AND status = 'active';

  IF v_actor.id IS NULL OR v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN jsonb_build_object('error', '只有超级管理员可以管理小程序首页');
  END IF;
  IF v_image_url = '' OR v_image_url !~ '^(https://|cloud://)' OR length(v_image_url) > 1200 THEN
    RETURN jsonb_build_object('error', '请上传图片或填写有效的 https://、cloud:// 图片地址');
  END IF;
  IF length(v_title) > 80 OR length(v_subtitle) > 120 THEN
    RETURN jsonb_build_object('error', '轮播标题或副标题过长');
  END IF;
  IF v_target_path <> '' AND (v_target_path !~ '^/pages/' OR v_target_path ~ '[[:space:]]' OR length(v_target_path) > 500) THEN
    RETURN jsonb_build_object('error', '跳转路径应以 /pages/ 开头；不需要跳转时请留空');
  END IF;
  IF v_sort_order < -10000 OR v_sort_order > 10000 THEN
    RETURN jsonb_build_object('error', '排序值应在 -10000 到 10000 之间');
  END IF;
  IF v_active AND (
    SELECT count(*)
    FROM public.miniprogram_home_banners
    WHERE is_active AND (p_banner_id IS NULL OR id <> p_banner_id)
  ) >= 8 THEN
    RETURN jsonb_build_object('error', '首页最多同时启用 8 张轮播图');
  END IF;

  IF p_banner_id IS NULL THEN
    v_key := 'HOME-' || upper(substr(md5(clock_timestamp()::TEXT || random()::TEXT), 1, 12));
    INSERT INTO public.miniprogram_home_banners(
      banner_key, title, subtitle, image_url, target_path, sort_order,
      is_active, created_by, updated_by
    ) VALUES (
      v_key, v_title, v_subtitle, v_image_url, v_target_path, v_sort_order,
      v_active, v_actor.id, v_actor.id
    ) RETURNING id INTO v_id;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM public.miniprogram_home_banners WHERE id = p_banner_id) THEN
      RETURN jsonb_build_object('error', '轮播图不存在或已经删除');
    END IF;
    UPDATE public.miniprogram_home_banners
    SET title = v_title,
        subtitle = v_subtitle,
        image_url = v_image_url,
        target_path = v_target_path,
        sort_order = v_sort_order,
        is_active = v_active,
        updated_by = v_actor.id,
        updated_at = now()
    WHERE id = p_banner_id
    RETURNING id, banner_key INTO v_id, v_key;
  END IF;

  INSERT INTO public.miniprogram_content_audit(content_type, content_id, actor_id, action, snapshot)
  VALUES (
    'HOME_BANNER', v_id, v_actor.id,
    CASE WHEN p_banner_id IS NULL THEN 'CREATE' WHEN v_active THEN 'SAVE_ACTIVE' ELSE 'SAVE_INACTIVE' END,
    p_payload
  );

  RETURN jsonb_build_object('success', true, 'bannerId', v_id, 'key', v_key, 'active', v_active);
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN jsonb_build_object('error', '排序值必须是整数');
END;
$$;

CREATE OR REPLACE FUNCTION public.superadmin_delete_miniprogram_home_banner(p_banner_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_banner public.miniprogram_home_banners%ROWTYPE;
BEGIN
  SELECT * INTO v_actor
  FROM public.users
  WHERE id = public.zidu_current_user_id() AND status = 'active';

  IF v_actor.id IS NULL OR v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN jsonb_build_object('error', '只有超级管理员可以删除小程序首页内容');
  END IF;

  SELECT * INTO v_banner
  FROM public.miniprogram_home_banners
  WHERE id = p_banner_id
  FOR UPDATE;
  IF v_banner.id IS NULL THEN RETURN jsonb_build_object('error', '轮播图不存在或已经删除'); END IF;

  INSERT INTO public.miniprogram_content_audit(content_type, content_id, actor_id, action, snapshot)
  VALUES ('HOME_BANNER', v_banner.id, v_actor.id, 'DELETE', to_jsonb(v_banner));

  DELETE FROM public.miniprogram_home_banners WHERE id = p_banner_id;
  RETURN jsonb_build_object('success', true, 'bannerId', p_banner_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_miniprogram_content_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.superadmin_save_miniprogram_home_banner(BIGINT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.superadmin_delete_miniprogram_home_banner(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_miniprogram_content_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_save_miniprogram_home_banner(BIGINT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.superadmin_delete_miniprogram_home_banner(BIGINT) TO authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT
  to_regprocedure('public.get_miniprogram_content_admin()') IS NOT NULL AS content_admin_ready,
  to_regprocedure('public.superadmin_save_miniprogram_home_banner(bigint,jsonb)') IS NOT NULL AS banner_save_ready,
  count(*) AS home_banner_count,
  count(*) FILTER (WHERE is_active) AS active_home_banner_count
FROM public.miniprogram_home_banners;
