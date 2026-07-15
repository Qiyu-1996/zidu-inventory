-- ============================================================
-- ZIDU v39: Supabase Auth 身份基础（不停机阶段）
--
-- 作用：
-- 1. 将现有业务账号关联到 auth.users。
-- 2. 提供基于 auth.uid() 的当前用户/角色函数。
-- 3. 为旧账号第一次登录升级提供限速、仅 service_role 可调用的接口。
--
-- 本迁移不会删除现有 Allow all 策略；必须等网页和小程序都改用 Auth 后，
-- 再运行最终 RLS 收紧迁移。
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_user_id UUID,
  ADD COLUMN IF NOT EXISTS auth_phone TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_auth_user_id_fkey'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_auth_user_id_fkey
      FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_unique
  ON public.users(auth_user_id) WHERE auth_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_auth_phone_active_unique
  ON public.users(auth_phone)
  WHERE auth_phone IS NOT NULL AND status = 'active';

CREATE OR REPLACE FUNCTION public.zidu_normalize_auth_phone(p_phone TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_original TEXT := trim(coalesce(p_phone, ''));
  v_digits TEXT := regexp_replace(trim(coalesce(p_phone, '')), '[^0-9]', '', 'g');
BEGIN
  IF v_digits = '' OR length(v_digits) < 8 OR length(v_digits) > 15 THEN
    RAISE EXCEPTION '请输入有效手机号';
  END IF;
  IF v_original LIKE '+%' THEN RETURN '+' || v_digits; END IF;
  IF v_digits ~ '^1[3-9][0-9]{9}$' THEN RETURN '+86' || v_digits; END IF;
  IF v_digits ~ '^86[1-9][0-9]{10}$' THEN RETURN '+' || v_digits; END IF;
  RETURN '+' || v_digits;
END;
$$;

-- 登录失败只保存手机号摘要，不保存手机号和密码明文。
CREATE TABLE IF NOT EXISTS public.zidu_auth_login_attempts (
  id BIGSERIAL PRIMARY KEY,
  phone_hash TEXT NOT NULL,
  succeeded BOOLEAN NOT NULL DEFAULT false,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS zidu_auth_login_attempts_recent_idx
  ON public.zidu_auth_login_attempts(phone_hash, attempted_at DESC);

ALTER TABLE public.zidu_auth_login_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.zidu_auth_login_attempts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.zidu_auth_login_attempts_id_seq FROM PUBLIC, anon, authenticated;

-- 仅由 auth-bootstrap Edge Function 使用。连续失败 10 次后锁定 15 分钟。
CREATE OR REPLACE FUNCTION public.zidu_legacy_auth_lookup(
  p_phone TEXT,
  p_password TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_phone TEXT;
  v_hash TEXT;
  v_failed INTEGER;
  v_user public.users%ROWTYPE;
BEGIN
  v_phone := public.zidu_normalize_auth_phone(p_phone);
  v_hash := encode(digest(lower(v_phone), 'sha256'), 'hex');
  PERFORM pg_advisory_xact_lock(hashtext(v_hash));

  SELECT count(*) INTO v_failed
  FROM public.zidu_auth_login_attempts
  WHERE phone_hash = v_hash
    AND succeeded = false
    AND attempted_at > now() - interval '15 minutes';

  IF v_failed >= 10 THEN
    RETURN jsonb_build_object('error', '尝试次数过多，请15分钟后再试');
  END IF;

  SELECT * INTO v_user
  FROM public.users
  WHERE status = 'active'
    AND (phone = trim(p_phone) OR auth_phone = v_phone)
  ORDER BY id
  LIMIT 1;

  IF v_user.id IS NULL
     OR v_user.password_hash IS NULL
     OR v_user.password_hash <> crypt(coalesce(p_password, ''), v_user.password_hash) THEN
    INSERT INTO public.zidu_auth_login_attempts(phone_hash, succeeded)
    VALUES (v_hash, false);
    RETURN jsonb_build_object('error', '账号或密码错误');
  END IF;

  INSERT INTO public.zidu_auth_login_attempts(phone_hash, succeeded)
  VALUES (v_hash, true);

  UPDATE public.users
  SET auth_phone = v_phone
  WHERE id = v_user.id AND auth_phone IS DISTINCT FROM v_phone;

  RETURN jsonb_build_object(
    'id', v_user.id,
    'name', v_user.name,
    'phone', v_user.phone,
    'authPhone', v_phone,
    'role', v_user.role,
    'status', v_user.status,
    'authUserId', v_user.auth_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.zidu_legacy_auth_lookup(TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_legacy_auth_lookup(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.zidu_link_auth_user(
  p_user_id INTEGER,
  p_auth_user_id UUID,
  p_auth_phone TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user public.users%ROWTYPE;
  v_phone TEXT;
BEGIN
  v_phone := public.zidu_normalize_auth_phone(p_auth_phone);
  SELECT * INTO v_user FROM public.users WHERE id = p_user_id FOR UPDATE;
  IF v_user.id IS NULL OR v_user.status <> 'active' THEN
    RETURN jsonb_build_object('error', '业务账号不存在或已停用');
  END IF;
  IF v_user.auth_user_id IS NOT NULL AND v_user.auth_user_id <> p_auth_user_id THEN
    RETURN jsonb_build_object('error', '业务账号已经关联其他登录身份');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.users
    WHERE id <> p_user_id
      AND (auth_user_id = p_auth_user_id OR (status = 'active' AND auth_phone = v_phone))
  ) THEN
    RETURN jsonb_build_object('error', '登录身份或手机号已关联其他账号');
  END IF;

  UPDATE public.users
  SET auth_user_id = p_auth_user_id,
      auth_phone = v_phone
  WHERE id = p_user_id;

  RETURN jsonb_build_object('success', true, 'userId', p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.zidu_link_auth_user(INTEGER, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_link_auth_user(INTEGER, UUID, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.zidu_current_user_id()
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM public.users
  WHERE auth_user_id = (SELECT auth.uid())
    AND status = 'active'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.zidu_current_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.users
  WHERE auth_user_id = (SELECT auth.uid())
    AND status = 'active'
  LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.zidu_has_role(p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(public.zidu_current_role() = ANY(p_roles), false)
$$;

CREATE OR REPLACE FUNCTION public.zidu_current_profile()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (
      SELECT jsonb_build_object(
        'id', id,
        'name', name,
        'phone', phone,
        'role', role,
        'status', status
      )
      FROM public.users
      WHERE auth_user_id = (SELECT auth.uid())
        AND status = 'active'
      LIMIT 1
    ),
    jsonb_build_object('error', '账号未关联或已停用')
  )
$$;

REVOKE ALL ON FUNCTION public.zidu_current_user_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zidu_current_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zidu_has_role(TEXT[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.zidu_current_profile() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.zidu_current_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_current_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_has_role(TEXT[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.zidu_current_profile() TO authenticated;

NOTIFY pgrst, 'reload schema';

-- 运行后只做结构检查；auth_linked_users 为 0 是正常的，用户首次登录后会增加。
SELECT
  count(*) FILTER (WHERE status = 'active') AS active_users,
  count(*) FILTER (WHERE status = 'active' AND auth_user_id IS NOT NULL) AS auth_linked_users,
  count(*) FILTER (WHERE status = 'active' AND auth_user_id IS NULL) AS pending_auth_users
FROM public.users;
