-- ═══════════════════════════════════════════════
-- ZIDU v10 Migration: 原料 / 成品 双产品库
-- 在 Supabase SQL Editor 整段运行（幂等，可重复跑）
--
-- 背景：商城下单需先选「原料 / 成品」两个产品库。
--   原料库(RAW)：精油/纯露/基础油等原料；成品库(FINISHED)：包装成品/复配产品。
--   两库是各自独立的商品，各用自己的 price（不需要第二套价格列）。
--
-- 机制：商品上加一个 channel 字段标明它属于哪个库。
--   RAW=只在原料库 / FINISHED=只在成品库 / BOTH=两库都显示。
-- 小程序已做优雅降级：channel 为空 → 默认 BOTH，所以没配也不报错。
-- ═══════════════════════════════════════════════

-- ① 商品增加「产品库」字段
ALTER TABLE products ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'BOTH';

-- 现有商品统一回填 BOTH（确保旧数据两个库都能看到）
UPDATE products SET channel = 'BOTH' WHERE channel IS NULL;

-- 说明：早期 v10 曾加过 product_specs.factory_price（工厂价方案，现已弃用）。
--      若你之前跑过，那一列保留无害、可忽略；新模型只用 products.channel。

-- ═══════════════════════════════════════════════
-- ② 数据归类模板（按需取消注释 / 替换为真实数据后运行）
-- ═══════════════════════════════════════════════

-- 【把某些商品划为「原料库」】按商品编号
-- UPDATE products SET channel = 'RAW' WHERE code IN ('ZD-R01', 'ZD-R02');

-- 【把某些商品划为「成品库」】
-- UPDATE products SET channel = 'FINISHED' WHERE code IN ('ZD-F01', 'ZD-F02');

-- 【按系列批量归类】示例：所有「基础油系列/纯露系列/单方精油系列」归为原料
-- UPDATE products SET channel = 'RAW'
--  WHERE series IN ('基础油系列', '纯露系列', '单方精油系列', '中药精油系列', '德国进口系列');
-- 示例：所有「专业护肤/专业水疗/养生疗愈/芳疗复配」归为成品
-- UPDATE products SET channel = 'FINISHED'
--  WHERE series IN ('专业护肤系列', '专业水疗系列', '养生疗愈系列', '芳疗复配');

-- ═══════════════════════════════════════════════
-- ③ 自检
-- ═══════════════════════════════════════════════
-- SELECT channel, COUNT(*) FROM products GROUP BY channel;
-- SELECT code, name, series, channel FROM products ORDER BY channel, id;
