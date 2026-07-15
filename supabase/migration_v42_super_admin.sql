-- ============================================================
-- ZIDU v42: 管理员 / 超级管理员分级
--
-- 规则：
-- 1. SUPER_ADMIN 继承 ADMIN 的全部业务权限。
-- 2. 只有 SUPER_ADMIN 可以创建账号或授予 SUPER_ADMIN 身份。
-- 3. ADMIN 可维护普通账号，但不能操作 SUPER_ADMIN。
-- 4. 系统始终至少保留一名启用中的 SUPER_ADMIN。
--
-- 执行条件：已依次运行 migration_v39 至 migration_v41。
-- ============================================================

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'SALES', 'WAREHOUSE', 'FINANCE'));

-- 首次升级优先把默认负责人账号设为超级管理员；若该账号不存在，
-- 则选择最早创建的启用管理员。重复运行不会改变已有超级管理员。
DO $$
DECLARE
  v_super_admin_id INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE role = 'SUPER_ADMIN' AND status = 'active'
  ) THEN
    SELECT id INTO v_super_admin_id
    FROM public.users
    WHERE role = 'ADMIN' AND status = 'active'
    ORDER BY (phone = '18301792268') DESC, id
    LIMIT 1;

    IF v_super_admin_id IS NULL THEN
      RAISE EXCEPTION '没有可升级的启用管理员，请先把一个账号设置为 ADMIN 后再运行 v42';
    END IF;

    UPDATE public.users
    SET role = 'SUPER_ADMIN'
    WHERE id = v_super_admin_id;
  END IF;
END $$;

-- SUPER_ADMIN 在全部既有策略和业务 RPC 中继承 ADMIN 权限。
CREATE OR REPLACE FUNCTION public.zidu_has_role(p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    public.zidu_current_role() = ANY(p_roles)
    OR (
      public.zidu_current_role() = 'SUPER_ADMIN'
      AND 'ADMIN' = ANY(p_roles)
    ),
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.zidu_require_actor(p_roles TEXT[])
RETURNS public.users
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor
  FROM public.users
  WHERE auth_user_id = (SELECT auth.uid())
    AND status = 'active'
  LIMIT 1;

  IF v_actor.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = '登录已失效或账号未关联';
  END IF;

  IF NOT coalesce(
    v_actor.role = ANY(p_roles)
    OR (v_actor.role = 'SUPER_ADMIN' AND 'ADMIN' = ANY(p_roles)),
    false
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = '当前账号没有执行此操作的权限';
  END IF;

  RETURN v_actor;
END;
$$;

REVOKE ALL ON FUNCTION public.zidu_has_role(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.zidu_has_role(TEXT[]) TO authenticated;
REVOKE ALL ON FUNCTION public.zidu_require_actor(TEXT[]) FROM PUBLIC, anon, authenticated;

-- 只有超级管理员可以创建账号。
CREATE OR REPLACE FUNCTION public.create_user(
  p_name TEXT, p_phone TEXT, p_password TEXT, p_role TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_auth_phone TEXT;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['SUPER_ADMIN']);
  IF trim(coalesce(p_name, '')) = '' THEN RETURN json_build_object('error', '请填写姓名'); END IF;
  IF length(coalesce(p_password, '')) < 8 THEN RETURN json_build_object('error', '密码至少需要8位'); END IF;
  IF p_role NOT IN ('SUPER_ADMIN', 'ADMIN', 'SALES', 'WAREHOUSE', 'FINANCE') THEN
    RETURN json_build_object('error', '无效角色');
  END IF;

  v_auth_phone := public.zidu_normalize_auth_phone(p_phone);
  INSERT INTO public.users(name, phone, auth_phone, password_hash, role, status)
  VALUES (trim(p_name), trim(p_phone), v_auth_phone, crypt(p_password, gen_salt('bf')), p_role, 'active')
  RETURNING * INTO v_user;

  RETURN json_build_object(
    'id', v_user.id,
    'name', v_user.name,
    'phone', v_user.phone,
    'role', v_user.role,
    'status', v_user.status
  );
EXCEPTION WHEN unique_violation THEN
  RETURN json_build_object('error', '该手机号已注册');
END;
$$;

-- 普通管理员可维护普通账号；超级管理员账号只能由超级管理员维护。
CREATE OR REPLACE FUNCTION public.admin_reset_password(
  p_admin_id INTEGER, p_target_user_id INTEGER, p_new_password TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  IF length(coalesce(p_new_password, '')) < 8 THEN RETURN json_build_object('error', '密码至少需要8位'); END IF;

  SELECT * INTO v_target FROM public.users WHERE id = p_target_user_id FOR UPDATE;
  IF v_target.id IS NULL OR v_target.status = 'deleted' THEN RETURN json_build_object('error', '账号不存在'); END IF;
  IF v_target.role = 'SUPER_ADMIN' AND v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN json_build_object('error', '只有超级管理员可以维护超级管理员账号');
  END IF;

  UPDATE public.users
  SET password_hash = crypt(p_new_password, gen_salt('bf')),
      auth_user_id = NULL
  WHERE id = p_target_user_id;

  RETURN json_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_user_status(
  p_admin_id INTEGER, p_target_user_id INTEGER, p_new_status TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_active_super_admins INTEGER;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  IF v_actor.id = p_target_user_id THEN RETURN json_build_object('error', '不能禁用自己'); END IF;
  IF p_new_status NOT IN ('active', 'disabled') THEN RETURN json_build_object('error', '无效状态'); END IF;

  PERFORM pg_advisory_xact_lock(hashtext('zidu-super-admin-guard'));
  SELECT * INTO v_target FROM public.users WHERE id = p_target_user_id FOR UPDATE;
  IF v_target.id IS NULL OR v_target.status = 'deleted' THEN RETURN json_build_object('error', '账号不存在'); END IF;
  IF v_target.role = 'SUPER_ADMIN' AND v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN json_build_object('error', '只有超级管理员可以维护超级管理员账号');
  END IF;
  IF v_target.role = 'SUPER_ADMIN' AND v_target.status = 'active' AND p_new_status = 'disabled' THEN
    SELECT count(*) INTO v_active_super_admins
    FROM public.users WHERE role = 'SUPER_ADMIN' AND status = 'active';
    IF v_active_super_admins <= 1 THEN RETURN json_build_object('error', '系统至少需要保留一名启用中的超级管理员'); END IF;
  END IF;

  UPDATE public.users SET status = p_new_status WHERE id = p_target_user_id;
  RETURN json_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_user_role(
  p_admin_id INTEGER, p_target_user_id INTEGER, p_new_role TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_active_super_admins INTEGER;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  IF p_new_role NOT IN ('SUPER_ADMIN', 'ADMIN', 'SALES', 'WAREHOUSE', 'FINANCE') THEN
    RETURN json_build_object('error', '无效角色');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('zidu-super-admin-guard'));
  SELECT * INTO v_target FROM public.users WHERE id = p_target_user_id FOR UPDATE;
  IF v_target.id IS NULL OR v_target.status = 'deleted' THEN RETURN json_build_object('error', '账号不存在'); END IF;
  IF v_actor.id = v_target.id AND p_new_role <> v_target.role THEN
    RETURN json_build_object('error', '不能修改自己的角色');
  END IF;
  IF v_actor.role <> 'SUPER_ADMIN' AND (v_target.role = 'SUPER_ADMIN' OR p_new_role = 'SUPER_ADMIN') THEN
    RETURN json_build_object('error', '只有超级管理员可以授予或维护超级管理员身份');
  END IF;
  IF v_target.role = 'SUPER_ADMIN' AND p_new_role <> 'SUPER_ADMIN' AND v_target.status = 'active' THEN
    SELECT count(*) INTO v_active_super_admins
    FROM public.users WHERE role = 'SUPER_ADMIN' AND status = 'active';
    IF v_active_super_admins <= 1 THEN RETURN json_build_object('error', '系统至少需要保留一名启用中的超级管理员'); END IF;
  END IF;

  UPDATE public.users SET role = p_new_role WHERE id = p_target_user_id;
  RETURN json_build_object('success', true, 'role', p_new_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_archive_user(
  p_admin_id INTEGER, p_target_user_id INTEGER
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_actor public.users%ROWTYPE;
  v_target public.users%ROWTYPE;
  v_active_super_admins INTEGER;
BEGIN
  SELECT * INTO v_actor FROM public.zidu_require_actor(ARRAY['ADMIN']);
  IF v_actor.id = p_target_user_id THEN RETURN json_build_object('error', '不能删除自己的账号'); END IF;

  PERFORM pg_advisory_xact_lock(hashtext('zidu-super-admin-guard'));
  SELECT * INTO v_target FROM public.users WHERE id = p_target_user_id FOR UPDATE;
  IF v_target.id IS NULL OR v_target.status = 'deleted' THEN RETURN json_build_object('error', '账号不存在或已删除'); END IF;
  IF v_target.role = 'SUPER_ADMIN' AND v_actor.role <> 'SUPER_ADMIN' THEN
    RETURN json_build_object('error', '只有超级管理员可以维护超级管理员账号');
  END IF;
  IF v_target.role = 'SUPER_ADMIN' AND v_target.status = 'active' THEN
    SELECT count(*) INTO v_active_super_admins
    FROM public.users WHERE role = 'SUPER_ADMIN' AND status = 'active';
    IF v_active_super_admins <= 1 THEN RETURN json_build_object('error', '系统至少需要保留一名启用中的超级管理员'); END IF;
  END IF;

  UPDATE public.users
  SET archived_phone = phone,
      phone = 'DELETED-' || id::TEXT || '-' || floor(extract(epoch FROM clock_timestamp()))::BIGINT::TEXT,
      auth_phone = NULL,
      password_hash = crypt(gen_random_uuid()::TEXT, gen_salt('bf')),
      status = 'deleted',
      archived_at = now(),
      archived_by = v_actor.id
  WHERE id = p_target_user_id;

  RETURN json_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.create_user(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_reset_password(INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.toggle_user_status(INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_update_user_role(INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_archive_user(INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_user(TEXT, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_password(INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_user_status(INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role(INTEGER, INTEGER, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_archive_user(INTEGER, INTEGER) TO authenticated;

NOTIFY pgrst, 'reload schema';

SELECT id, name, phone, role, status
FROM public.users
WHERE role IN ('SUPER_ADMIN', 'ADMIN') AND status <> 'deleted'
ORDER BY CASE role WHEN 'SUPER_ADMIN' THEN 0 ELSE 1 END, id;

SELECT count(*) FILTER (WHERE role = 'SUPER_ADMIN' AND status = 'active') AS active_super_admins,
       count(*) FILTER (WHERE role = 'ADMIN' AND status = 'active') AS active_admins
FROM public.users;
