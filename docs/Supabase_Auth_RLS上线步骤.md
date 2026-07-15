# Supabase Auth / RLS 上线步骤

## 这次解决什么

- 网页和小程序不再把本地缓存当成登录身份。
- 匿名访问无法读取订单、客户、库存、财务等业务数据。
- 销售只能看自己的客户和订单；仓库只看履约、库存和采购；财务看订单、收退款和业绩；管理员全局管理。
- 超级管理员继承管理员全部能力，并且只有超级管理员可以创建账号或授予超级管理员身份。
- 下单、收款、售后、发货、库存和采购操作会在云端再校验角色，不只依赖页面隐藏按钮。

## 上线顺序

### 1. 备份

在 Supabase Dashboard 的 Database 中先做一次备份或确认 PITR/每日备份可用。建议选一个没人下单、收款、入库的时段执行。

### 2. 运行 v39

在 SQL Editor 中完整运行：

`supabase/migration_v39_auth_foundation.sql`

结果中 `pending_auth_users` 暂时不为 0 是正常的。

### 3. 保持 Email provider，关闭 Phone provider

进入 Supabase Dashboard：

`Authentication` → `Providers`：

- `Email provider` 保持启用（Supabase 默认已启用）。
- `Phone provider` 关闭。

用户界面仍然是“手机号 + 密码”。系统会把手机号转换成只用于 Supabase Auth 的内部登录标识，不发送邮件或短信，也不依赖 Textlocal/Twilio。

### 4. 部署账号升级函数

部署目录：

`supabase/functions/auth-bootstrap`

项目 ref：`eylrztkwmpgaawdvdcjj`

使用 Supabase CLI 时：

```bash
npx supabase login
npx supabase link --project-ref eylrztkwmpgaawdvdcjj
npx supabase functions deploy auth-bootstrap --no-verify-jwt
```

`SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 是 Supabase Edge Function 的内置云端环境变量，不要放入网页、小程序或 GitHub。

### 5. 发布新网页和小程序

发布本次代码后，所有人需重新登录。第一次使用原手机号和原密码登录时，系统会自动创建 Supabase Auth 身份并关联原有订单/客户数据。

### 6. 运行 v40

在 SQL Editor 中完整运行：

`supabase/migration_v40_secure_rpc.sql`

最后结果应为：

- `order_secure_entry = true`
- `order_internal_impl = true`
- `inventory_secure_entry = true`
- `anon_order_execute = false`
- `authenticated_order_execute = true`

### 7. 确认所有在职账号已登录一次

在 SQL Editor 运行：

```sql
SELECT id, name, phone, role
FROM public.users
WHERE status = 'active' AND auth_user_id IS NULL;
```

必须为 0 行。如果还有人员，让该人员在新网页或新小程序登录一次；不再使用的账号由管理员禁用或删除。

### 8. 运行 v41

确认上一步为 0 行后，再运行：

`supabase/migration_v41_role_rls.sql`

该文件会主动阻止“还有在职账号未关联”的错误上线。最后结果应为：

- `pending_auth_users = 0`
- `anon_can_read_orders = false`
- `anon_can_create_order = false`
- `authenticated_can_create_order = true`

### 9. 运行 v42

在 SQL Editor 中完整运行：

`supabase/migration_v42_super_admin.sql`

首次运行会优先把手机号 `18301792268` 的启用管理员升级为超级管理员；如果该账号不存在，则升级最早创建的启用管理员。以后可由超级管理员在网页“系统管理 → 人员管理”中分配角色。

运行成功后刷新网页或重新登录一次，让页面重新读取最新角色。

最后结果中：

- `active_super_admins` 必须至少为 `1`
- 超级管理员账号应显示为 `SUPER_ADMIN`

### 10. 最终核对

运行：

`supabase/verify_launch_integrity.sql`

所有 `ready` / `blocked` 项应为 `true`，后续异常明细与宽松 RLS 策略应为 0 行。

## 账号权限

- 超级管理员：拥有全部管理员能力，可以创建账号、授予或维护超级管理员身份。
- 管理员：拥有订单、客户、库存、采购、财务、系统设置和普通人员维护能力，但不能创建账号，也不能操作超级管理员账号。
- 系统不允许禁用、删除或降级最后一名启用中的超级管理员。

## 密码重置与禁用

- 管理员重置密码时，系统会立即断开旧 Auth 身份与业务账号的关联，旧密码不再能读取业务数据。
- 用户使用新密码登录后会自动重新关联。
- 禁用/删除账号后，RLS 会立即拒绝该账号访问，历史订单、客户和财务记录仍保留。

## 紧急处理

如果 v41 报“仍有在职账号未关联”，不要删除检查句，先完成第 7 步。

如果 Edge Function 返回“云端登录配置缺失”，说明函数没有在当前 Supabase 项目中运行，重新确认 project ref 和函数部署结果。
