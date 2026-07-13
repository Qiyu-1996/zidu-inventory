-- ═══════════════════════════════════════════════
-- ZIDU v12 Migration: 客户地区 + 分销商
-- 在 Supabase SQL Editor 整段运行（幂等，可重复跑）
--
-- 1) 客户加「省份」字段（地区统计、下单选省）
-- 2) 客户加「分销商等级」字段：NULL=非分销商 / 1=一级(自动5折) / 2=二级(自动6.5折)
--    分销商由管理员在网页后台建立、指派给销售（设 sales_id），销售即可替其下单。
--
-- 客户分级（大/中/小）不入库——由累计非取消订单金额实时算：>5万大、1万~5万中、<1万小。
-- 行业类型沿用 customers.type（前端已换成 工厂/品牌/美容院/养生馆/医疗机构/SPA馆/头疗馆/
--   足浴店/瑜伽馆/个人/零售店 + 展会/线下/其他），无需改表。
-- ═══════════════════════════════════════════════

ALTER TABLE customers ADD COLUMN IF NOT EXISTS province TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS distributor_level INT;

-- 可选自检
-- SELECT id, name, type, province, distributor_level, sales_id FROM customers ORDER BY id;
