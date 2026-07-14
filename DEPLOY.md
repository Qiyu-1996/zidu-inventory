# 紫都 ZBP 业务管理平台 - 部署指南

## 架构

```
浏览器 → React 前端 (Vercel) → Supabase (数据库 + API)
```

- **前端**: React + Vite + TailwindCSS → 部署到 Vercel (免费)
- **后端**: Supabase PostgreSQL + RPC 函数 (免费 tier)
- **域名**: Vercel 自带域名，也可绑定自定义域名

---

## 第一步：创建 Supabase 项目

1. 打开 https://supabase.com 注册/登录
2. 点击 **New Project**
3. 填写：
   - Organization: 选择或创建
   - Project name: `zidu-zbp`
   - Database Password: 设置一个强密码（记住它）
   - Region: 选 **Northeast Asia (Tokyo)** 或 **Southeast Asia (Singapore)**
4. 等待项目创建完成（约1-2分钟）

## 第二步：初始化数据库

1. 进入项目，点击左侧 **SQL Editor**
2. 点击 **New Query**
3. 复制 `supabase/schema.sql` 的全部内容，粘贴并点击 **Run**
4. 确认执行成功（无红色错误）
5. 再创建一个 New Query
6. 复制 `supabase/seed.sql` 的全部内容，粘贴并点击 **Run**
7. 确认执行成功

完成后，数据库中将包含：
- 1 个管理员账号（王俊玲 / 18301792268 / zd20262026）
- 43 个产品 + 多规格
- 2 个示例客户

### 增量迁移（migration_v*.sql）⚠️ 重要

每次升级网页/小程序后，按编号顺序在 SQL Editor 跑 `supabase/migration_v*.sql`（都幂等、可重复跑）。
**升级到当前版本前，务必先跑下列迁移**，否则新功能会报错：

- `migration_v10.sql` — 产品库 channel（原料/成品）
- `migration_v11.sql` — 现场客户预设（展会/线下，可选）
- `migration_v12.sql` — **客户加 province + distributor_level（必跑）**。
  不跑会导致**所有新建客户失败**（网页、小程序新建客户、以及结账时自动建展会/线下客户），
  报错 PGRST204。跑完后可执行 `NOTIFY pgrst, 'reload schema';` 让 PostgREST 立即刷新列缓存。
- `migration_v19_mass_inventory.sql` — 原料按 kg 统一库存，ml 规格按密度换算。
- `migration_v20_user_role_and_archive.sql` — 管理员修改角色、删除归档账号。
- `migration_v21_batch_delete_and_kg_receiving.sql` — 修复批次删除外键、按 kg 批次入库。
- `migration_v22_purchase_order_crud.sql` — 采购单新增、编辑、删除及按 kg 收货。
- `migration_v25_purchase_receiving_batches.sql` — 采购收货、批次和库存流水原子关联。
- `migration_v35_fifo_batch_inventory.sql` — 批次 FIFO 出库。
- `migration_v36_manual_batch_outbound.sql` — 指定批次出库。
- `migration_v37_purchase_workflow.sql` — 采购工作台、预计到货、30 天回收站、关闭剩余采购及安全撤销收货。

迁移必须按编号顺序执行；代码 push 到 GitHub 不会自动执行 Supabase SQL。升级本次采购功能时，在 `v36` 成功后运行 `v37`。

## 第三步：获取 Supabase 密钥

1. 在 Supabase 项目中，点击左侧 **Settings** → **API**
2. 记下以下两个值：
   - **Project URL**: 类似 `https://xxxxx.supabase.co`
   https://eylrztkwmpgaawdvdcjj.supabase.co
   - **anon public key**: 以 `eyJ` 开头的长字符串 
   eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5bHJ6dGt3bXBnYWF3ZHZkY2pqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNTg2MjAsImV4cCI6MjA5MTczNDYyMH0.Hx7WuKPbBiyTp8xWmivKxJ5003JfP-bHPlYQOlbkE84

## 第四步：部署到 Vercel

### 方式一：通过 GitHub（推荐）

1. 将项目推送到 GitHub 仓库
2. 打开 https://vercel.com 登录
3. 点击 **Add New** → **Project**
4. 选择你的 GitHub 仓库
5. 在 **Environment Variables** 中添加：
   - `VITE_SUPABASE_URL` = 你的 Project URL
   - `VITE_SUPABASE_ANON_KEY` = 你的 anon public key
6. 点击 **Deploy**
7. 等待部署完成，获得访问 URL

### 方式二：通过 Vercel CLI

```bash
# 安装 Vercel CLI
npm i -g vercel

# 在项目目录下
cd zidu-inventory

# 部署
vercel

# 设置环境变量
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY

# 重新部署（使环境变量生效）
vercel --prod
```

## 第五步：验证

1. 打开 Vercel 给你的 URL
2. 使用默认管理员登录：
   - 手机号：`18301792268`
   - 密码：`zd20262026`
3. 进入系统后，在 **系统管理 → 人员管理** 中创建销售和仓库账号
4. 用新账号登录，验证功能

---

## 日常管理

### 创建员工账号
管理员登录 → 系统管理 → 人员管理 → 创建账号

### 角色权限
| 功能 | 管理员 | 销售 | 仓库 |
|------|--------|------|------|
| 工作台 | ✅ | ✅ | ✅ |
| 产品下单 | ❌ | ✅ | ❌ |
| 订单管理 | 全部 | 自己的 | 待处理 |
| 客户管理 | 全部 | 自己的 | ❌ |
| 库存查看 | ✅ | ✅(无价格) | ✅ |
| 发货管理 | ❌ | ❌ | ✅ |
| 数据分析 | ✅ | ✅ | ❌ |
| 系统管理 | ✅ | ❌ | ❌ |

### 绑定自定义域名
1. Vercel 项目 → Settings → Domains
2. 添加你的域名（如 zbp.zidu.com）
3. 按提示配置 DNS 记录

---

## 费用

| 服务 | 免费额度 | 超出后 |
|------|----------|--------|
| Supabase | 500MB 数据库, 50000 行 | $25/月 |
| Vercel | 100GB 带宽/月 | $20/月 |

对于紫都当前规模（<10用户, <1000订单/月），完全在免费额度内。

---

## 本地开发

```bash
# 复制环境变量
cp .env.example .env
# 编辑 .env 填入真实的 Supabase URL 和 Key

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```
