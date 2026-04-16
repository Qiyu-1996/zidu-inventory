-- =============================================
-- ZIDU ZBP v2.0 Migration
-- Run in Supabase SQL Editor AFTER schema.sql + seed.sql
-- =============================================

-- ═══ STOCK ADJUSTMENTS (出入库记录) ═══
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id SERIAL PRIMARY KEY,
  spec_id INTEGER REFERENCES product_specs(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  type TEXT NOT NULL CHECK (type IN ('IN', 'OUT', 'CORRECTION')),
  reason TEXT NOT NULL CHECK (reason IN ('PURCHASE', 'RETURN', 'DAMAGE', 'CORRECTION', 'ORDER', 'CANCEL_RESTORE', 'OTHER')),
  quantity INTEGER NOT NULL,
  before_stock INTEGER NOT NULL,
  after_stock INTEGER NOT NULL,
  note TEXT DEFAULT '',
  operator_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_adj_spec ON stock_adjustments(spec_id);
CREATE INDEX IF NOT EXISTS idx_stock_adj_created ON stock_adjustments(created_at);
ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on stock_adjustments" ON stock_adjustments FOR ALL USING (true) WITH CHECK (true);

-- ═══ PAYMENT RECORDS (付款记录) ═══
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'UNPAID' CHECK (payment_status IN ('UNPAID', 'PARTIAL', 'PAID'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(10,2) DEFAULT 0;

CREATE TABLE IF NOT EXISTS payment_records (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL,
  method TEXT DEFAULT '转账',
  note TEXT DEFAULT '',
  recorded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_records_order ON payment_records(order_id);
ALTER TABLE payment_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on payment_records" ON payment_records FOR ALL USING (true) WITH CHECK (true);

-- ═══ PURCHASE ORDERS (采购管理) ═══
CREATE TABLE IF NOT EXISTS purchase_orders (
  id SERIAL PRIMARY KEY,
  po_no TEXT UNIQUE NOT NULL,
  supplier TEXT NOT NULL,
  status TEXT DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ORDERED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CANCELLED')),
  total NUMERIC(10,2) DEFAULT 0,
  notes TEXT DEFAULT '',
  created_by_name TEXT NOT NULL,
  created_at DATE DEFAULT CURRENT_DATE
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id SERIAL PRIMARY KEY,
  po_id INTEGER REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  spec_id INTEGER REFERENCES product_specs(id),
  product_name TEXT,
  spec TEXT,
  quantity INTEGER NOT NULL,
  received_qty INTEGER DEFAULT 0,
  unit_cost NUMERIC(10,2) NOT NULL,
  subtotal NUMERIC(10,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_po_items_po ON purchase_order_items(po_id);
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on purchase_orders" ON purchase_orders FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on purchase_order_items" ON purchase_order_items FOR ALL USING (true) WITH CHECK (true);

-- ═══ PRICING TIERS (阶梯定价) ═══
CREATE TABLE IF NOT EXISTS pricing_tiers (
  id SERIAL PRIMARY KEY,
  min_annual_spend NUMERIC(12,2) NOT NULL,
  discount_percent NUMERIC(5,2) NOT NULL,
  label TEXT NOT NULL
);
ALTER TABLE pricing_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on pricing_tiers" ON pricing_tiers FOR ALL USING (true) WITH CHECK (true);

INSERT INTO pricing_tiers (min_annual_spend, discount_percent, label) VALUES
  (30000, 5, '银牌客户'),
  (80000, 10, '金牌客户'),
  (200000, 15, '钻石客户')
ON CONFLICT DO NOTHING;

-- ═══ SCENARIO PACKAGES (场景方案) ═══
CREATE TABLE IF NOT EXISTS scenario_packages (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scenario_package_items (
  id SERIAL PRIMARY KEY,
  package_id INTEGER REFERENCES scenario_packages(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  spec_id INTEGER REFERENCES product_specs(id),
  quantity INTEGER DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_scenario_items_pkg ON scenario_package_items(package_id);
ALTER TABLE scenario_packages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on scenario_packages" ON scenario_packages FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE scenario_package_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on scenario_package_items" ON scenario_package_items FOR ALL USING (true) WITH CHECK (true);

INSERT INTO scenario_packages (code, name, description, sort_order) VALUES
  ('S1', '深度睡眠方案', '薰衣草+洋甘菊，针对失眠/浅眠客群的专业精油方案', 1),
  ('S2', '释放紧张方案', '迷迭香+薄荷，针对压力大/肌肉紧张客群', 2),
  ('S3', '头皮护理方案', '茶树+迷迭香，针对头皮问题/脱发客群', 3),
  ('S4', '身体排毒方案', '杜松+柠檬，针对亚健康/排毒需求客群', 4),
  ('S5', '东方经络方案', '艾草+川芎+当归，中医经络疏通养护方案', 5),
  ('S6', '呼吸顺畅方案', '尤加利+薄荷，针对鼻炎/呼吸系统客群', 6),
  ('S7', '暖宫养护方案', '玫瑰+乳香，针对宫寒/经期不适客群', 7)
ON CONFLICT (code) DO NOTHING;

-- ═══ USER MANAGEMENT RPC FUNCTIONS ═══
CREATE OR REPLACE FUNCTION admin_reset_password(p_admin_id INTEGER, p_target_user_id INTEGER, p_new_password TEXT)
RETURNS JSON AS $$
DECLARE
  v_admin users%ROWTYPE;
BEGIN
  SELECT * INTO v_admin FROM users WHERE id = p_admin_id AND role = 'ADMIN';
  IF v_admin.id IS NULL THEN
    RETURN json_build_object('error', '无权限');
  END IF;
  UPDATE users SET password_hash = crypt(p_new_password, gen_salt('bf')) WHERE id = p_target_user_id;
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION toggle_user_status(p_admin_id INTEGER, p_target_user_id INTEGER, p_new_status TEXT)
RETURNS JSON AS $$
DECLARE
  v_admin users%ROWTYPE;
BEGIN
  SELECT * INTO v_admin FROM users WHERE id = p_admin_id AND role = 'ADMIN';
  IF v_admin.id IS NULL THEN
    RETURN json_build_object('error', '无权限');
  END IF;
  IF p_admin_id = p_target_user_id THEN
    RETURN json_build_object('error', '不能禁用自己');
  END IF;
  UPDATE users SET status = p_new_status WHERE id = p_target_user_id;
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
