-- ============================================================
-- ZIDU v43: 修复 SUPER_ADMIN 的管理员权限继承
--
-- migration_v40 在 migration_v42 之后被重复执行时，会把
-- zidu_require_actor 恢复为旧的精确角色判断。本迁移重新统一
-- zidu_has_role 与 zidu_require_actor 的继承规则。
-- ============================================================

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
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = '登录已失效或账号未关联';
  END IF;

  IF NOT coalesce(
    v_actor.role = ANY(p_roles)
    OR (v_actor.role = 'SUPER_ADMIN' AND 'ADMIN' = ANY(p_roles)),
    false
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = '当前账号没有执行此操作的权限';
  END IF;

  RETURN v_actor;
END;
$$;

REVOKE ALL ON FUNCTION public.zidu_has_role(TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.zidu_has_role(TEXT[]) TO authenticated;
REVOKE ALL ON FUNCTION public.zidu_require_actor(TEXT[])
  FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';

SELECT
  position(
    'SUPER_ADMIN' IN pg_get_functiondef(
      'public.zidu_require_actor(text[])'::regprocedure
    )
  ) > 0 AS super_admin_inheritance_ready;
