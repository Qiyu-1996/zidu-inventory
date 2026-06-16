-- ═══════════════════════════════════════════════
-- ZIDU v7 Migration: 成本与利润可视
-- 在 Supabase SQL Editor 整段运行（可重复运行，幂等）
-- ═══════════════════════════════════════════════

-- ① 产品规格：标准成本（参考成本，用于估值与毛利）
ALTER TABLE product_specs ADD COLUMN IF NOT EXISTS cost NUMERIC(10,2) DEFAULT 0;

-- ② 订单明细：成本快照（下单时锁定当时成本，保证历史毛利准确）
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(10,2) DEFAULT 0;

-- ③ 一键工具：用最新批次成本回填 product_specs.cost（管理员在后台点按钮时调用）
--    取每个 spec 最近一条 received_date 的批次 unit_cost
CREATE OR REPLACE FUNCTION backfill_spec_cost_from_batches()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  n INTEGER := 0;
BEGIN
  UPDATE product_specs ps
  SET cost = b.unit_cost
  FROM (
    SELECT DISTINCT ON (spec_id) spec_id, unit_cost
    FROM product_batches
    WHERE unit_cost > 0
    ORDER BY spec_id, received_date DESC, id DESC
  ) b
  WHERE ps.id = b.spec_id AND b.unit_cost > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

-- ④ 库存估值视图（按系列汇总：库存价值 / 潜在零售额 / 潜在毛利）
CREATE OR REPLACE VIEW inventory_valuation AS
SELECT
  p.series,
  COUNT(ps.id)                                   AS sku_count,
  COALESCE(SUM(ps.stock), 0)                     AS total_units,
  COALESCE(SUM(ps.stock * ps.cost), 0)           AS stock_cost_value,
  COALESCE(SUM(ps.stock * ps.price), 0)          AS stock_retail_value,
  COALESCE(SUM(ps.stock * (ps.price - ps.cost)), 0) AS potential_margin
FROM products p
JOIN product_specs ps ON ps.product_id = p.id
GROUP BY p.series;

GRANT SELECT ON inventory_valuation TO anon;
