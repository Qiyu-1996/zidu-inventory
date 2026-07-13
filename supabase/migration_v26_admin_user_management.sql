-- ============================================================
-- ZIDU v26: 修复管理员角色修改、账号删除及密码函数
-- 可整份重复运行；不会删除历史订单、客户或财务记录。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS archived_phone TEXT,
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by INTEGER;

-- Supabase 通常把 pgcrypto 安装在 extensions schema。
-- 将 extensions 放入函数 search_path，避免 gen_salt/crypt 找不到。
CREATE OR REPLACE FUNCTION public.login(p_phone TEXT, p_password TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_user public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_user
  FROM public.users
  WHERE phone = p_phone AND status = 'active';

  IF v_user.id IS NULL THEN
    RETURN json_build_object('error', '账号不存在或已禁用');
  END IF;
  IF v_user.password_hash != crypt(p_password, v_user.password_hash) THEN
    RETURN json_build_object('error', '密码错误');
  END IF;

  RETURN json_build_object(
    'id', v_user.id,
    'name', v_user.name,
    'phone', v_user.phone,
    'role', v_user.role,
    'status', v_user.status
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.create_user(
  p_name TEXT,
  p_phone TEXT,
  p_password TEXT,
  p_role TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_user public.users%ROWTYPE;
BEGIN
  IF p_role NOT IN ('ADMIN', 'SALES', 'WAREHOUSE', 'FINANCE') THEN
    RETURN json_build_object('error', '无效角色');
  END IF;

  INSERT INTO public.users (name, phone, password_hash, role)
  VALUES (p_name, p_phone, crypt(p_password, gen_salt('bf')), p_role)
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

CREATE OR REPLACE FUNCTION public.change_password(
  p_user_id INTEGER,
  p_old_password TEXT,
  p_new_password TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_user public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id;
  IF v_user.id IS NULL THEN RETURN json_build_object('error', '用户不存在'); END IF;
  IF v_user.password_hash != crypt(p_old_password, v_user.password_hash) THEN
    RETURN json_build_object('error', '原密码错误');
  END IF;
  UPDATE public.users
  SET password_hash = crypt(p_new_password, gen_salt('bf'))
  WHERE id = p_user_id;
  RETURN json_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_reset_password(
  p_admin_id INTEGER,
  p_target_user_id INTEGER,
  p_new_password TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_admin public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_admin FROM public.users
  WHERE id = p_admin_id AND role = 'ADMIN' AND status = 'active';
  IF v_admin.id IS NULL THEN RETURN json_build_object('error', '无权限'); END IF;

  UPDATE public.users
  SET password_hash = crypt(p_new_password, gen_salt('bf'))
  WHERE id = p_target_user_id AND status <> 'deleted';
  IF NOT FOUND THEN RETURN json_build_object('error', '账号不存在'); END IF;
  RETURN json_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.toggle_user_status(
  p_admin_id INTEGER,
  p_target_user_id INTEGER,
  p_new_status TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  v_admin public.users%ROWTYPE;
BEGIN
  SELECT * INTO v_admin FROM public.users
  WHERE id = p_admin_id AND role = 'ADMIN' AND status = 'active';
  IF v_admin.id IS NULL THEN RETURN json_build_object('error', '无权限'); END IF;
  IF p_admin_id = p_target_user_id THEN RETURN json_build_object('error', '不能禁用自己'); END IF;
  IF p_new_status NOT IN ('active', 'disabled') THEN RETURN json_build_object('error', '无效状态'); END IF;

  UPDATE public.users SET status = p_new_status
  WHERE id = p_target_user_id AND status <> 'deleted';
  IF NOT FOUND THEN RETURN json_build_object('error', '账号不存在'); END IF;
  RETURN json_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_user_role(
  p_admin_id INTEGER,
  p_target_user_id INTEGER,
  p_new_role TEXT
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
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
    SELECT count(*) INTO v_active_admins
    FROM public.users WHERE role = 'ADMIN' AND status = 'active';
    IF v_active_admins <= 1 THEN
      RETURN json_build_object('error', '系统至少需要保留一名管理员');
    END IF;
  END IF;

  UPDATE public.users SET role = p_new_role WHERE id = p_target_user_id;
  RETURN json_build_object('success', true, 'role', p_new_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_archive_user(
  p_admin_id INTEGER,
  p_target_user_id INTEGER
) RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
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
    SELECT count(*) INTO v_active_admins
    FROM public.users WHERE role = 'ADMIN' AND status = 'active';
    IF v_active_admins <= 1 THEN
      RETURN json_build_object('error', '系统至少需要保留一名管理员');
    END IF;
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

GRANT EXECUTE ON FUNCTION public.login(TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_user(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_password(INTEGER, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_reset_password(INTEGER, INTEGER, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_user_status(INTEGER, INTEGER, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role(INTEGER, INTEGER, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_archive_user(INTEGER, INTEGER) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- 正确结果：7 行都是 true，pgcrypto_schema 通常为 extensions。
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  e.extnamespace::regnamespace::TEXT AS pgcrypto_schema
FROM pg_proc p
CROSS JOIN pg_extension e
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN (
    'login', 'create_user', 'change_password', 'admin_reset_password',
    'toggle_user_status', 'admin_update_user_role', 'admin_archive_user'
  )
  AND e.extname = 'pgcrypto'
ORDER BY p.proname;
