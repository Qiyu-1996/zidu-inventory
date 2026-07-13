-- ============================================================
-- ZIDU v20: 管理员修改角色 / 删除（归档）账号
-- ============================================================
-- 删除采用归档：保留用户 id、姓名及历史订单关联，禁止继续登录，
-- 同时释放原手机号，允许以后用该手机号重新创建账号。

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS archived_phone TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by INTEGER;

CREATE OR REPLACE FUNCTION public.admin_update_user_role(
  p_admin_id INTEGER,
  p_target_user_id INTEGER,
  p_new_role TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_active_admins INTEGER;
BEGIN
  SELECT * INTO v_admin FROM public.users
   WHERE id = p_admin_id AND role = 'ADMIN' AND status = 'active';
  IF v_admin.id IS NULL THEN RETURN json_build_object('error', '无权限'); END IF;
  IF p_new_role NOT IN ('ADMIN', 'SALES', 'WAREHOUSE', 'FINANCE') THEN
    RETURN json_build_object('error', '无效角色');
  END IF;
  SELECT * INTO v_target FROM public.users WHERE id = p_target_user_id FOR UPDATE;
  IF v_target.id IS NULL OR v_target.status = 'deleted' THEN
    RETURN json_build_object('error', '账号不存在');
  END IF;
  IF p_admin_id = p_target_user_id AND p_new_role <> 'ADMIN' THEN
    RETURN json_build_object('error', '不能修改自己的管理员角色');
  END IF;
  IF v_target.role = 'ADMIN' AND p_new_role <> 'ADMIN' THEN
    SELECT count(*) INTO v_active_admins FROM public.users
     WHERE role = 'ADMIN' AND status = 'active';
    IF v_active_admins <= 1 THEN RETURN json_build_object('error', '系统至少需要保留一名管理员'); END IF;
  END IF;
  UPDATE public.users SET role = p_new_role WHERE id = p_target_user_id;
  RETURN json_build_object('success', true, 'role', p_new_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_archive_user(
  p_admin_id INTEGER,
  p_target_user_id INTEGER
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_admin public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_active_admins INTEGER;
BEGIN
  SELECT * INTO v_admin FROM public.users
   WHERE id = p_admin_id AND role = 'ADMIN' AND status = 'active';
  IF v_admin.id IS NULL THEN RETURN json_build_object('error', '无权限'); END IF;
  IF p_admin_id = p_target_user_id THEN RETURN json_build_object('error', '不能删除自己的账号'); END IF;
  SELECT * INTO v_target FROM public.users WHERE id = p_target_user_id FOR UPDATE;
  IF v_target.id IS NULL OR v_target.status = 'deleted' THEN
    RETURN json_build_object('error', '账号不存在或已删除');
  END IF;
  IF v_target.role = 'ADMIN' THEN
    SELECT count(*) INTO v_active_admins FROM public.users
     WHERE role = 'ADMIN' AND status = 'active';
    IF v_active_admins <= 1 THEN RETURN json_build_object('error', '系统至少需要保留一名管理员'); END IF;
  END IF;
  UPDATE public.users
     SET archived_phone = phone,
         phone = 'DELETED-' || id::TEXT || '-' || floor(extract(epoch FROM clock_timestamp()))::BIGINT::TEXT,
         password_hash = crypt(gen_random_uuid()::TEXT, gen_salt('bf')),
         status = 'deleted',
         archived_at = now(),
         archived_by = p_admin_id
   WHERE id = p_target_user_id;
  RETURN json_build_object('success', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_update_user_role(INTEGER, INTEGER, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_archive_user(INTEGER, INTEGER) TO anon, authenticated;

-- 让 PostgREST 立即识别新建/更新后的 RPC，避免短时间内提示 schema cache 找不到函数。
NOTIFY pgrst, 'reload schema';

SELECT id, name, role, status FROM public.users ORDER BY id;
