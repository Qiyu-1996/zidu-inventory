-- ═══════════════════════════════════════════════
-- ZIDU v11 Migration: 现场客户预设（展会 / 线下）
-- 在 Supabase SQL Editor 运行（幂等，可重复跑）。【可选】——小程序首次点「展会/线下」
-- 速选时会自动按需创建同名客户，跑不跑都行；这里预置只是让它们一开始就存在。
--
-- 用途：展会/线下属现场交付——下单选这两个客户即可，无需填客户信息；
--   销售点「确认收款」后订单直接「已完成」，仓库不再看到（无需发货），但照常计入营收统计。
--   小程序据 customers.type ∈ ('展会','线下') 判定为现场交付。
-- sales_id 置空=全局共享，所有销售都能用；销售归属记录在订单(orders.sales_id)上。
-- ═══════════════════════════════════════════════

INSERT INTO customers (name, type, sales_id)
SELECT v, v, NULL
FROM (VALUES ('展会'), ('线下')) AS t(v)
WHERE NOT EXISTS (
  SELECT 1 FROM customers c WHERE c.name = t.v AND c.type = t.v
);

-- 自检
-- SELECT id, name, type, sales_id FROM customers WHERE type IN ('展会','线下');
