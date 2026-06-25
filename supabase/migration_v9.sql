-- ═══════════════════════════════════════════════
-- ZIDU v9 Migration: 财务角色 FINANCE + 财务账号
-- 在 Supabase SQL Editor 整段运行（幂等，可重复跑）
-- ═══════════════════════════════════════════════

-- ① 扩展 users.role 白名单，加入 FINANCE
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('ADMIN', 'SALES', 'WAREHOUSE', 'FINANCE'));

-- ② 创建财务账号（若不存在）
--    手机号 13900000000  密码 finance123  角色 FINANCE
INSERT INTO users (name, phone, role, password_hash)
SELECT '财务', '13900000000', 'FINANCE', crypt('finance123', gen_salt('bf'))
WHERE NOT EXISTS (SELECT 1 FROM users WHERE phone = '13900000000');
