-- =============================================
-- ZIDU ZBP v3.0 Migration
-- 添加：基础设置配置项 + 批次/GC-MS 追溯
-- 运行方式：在 Supabase SQL Editor 中执行
-- =============================================

-- ═══ CONFIG OPTIONS (可编辑的基础设置) ═══
CREATE TABLE IF NOT EXISTS config_options (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('CUSTOMER_TYPE', 'PRODUCT_SERIES', 'SPEC_OPTION')),
  value TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (category, value)
);
CREATE INDEX IF NOT EXISTS idx_config_category ON config_options(category);
ALTER TABLE config_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on config_options" ON config_options FOR ALL USING (true) WITH CHECK (true);

-- 初始化客户类型
INSERT INTO config_options (category, value, sort_order) VALUES
  ('CUSTOMER_TYPE', 'SPA水疗馆', 1),
  ('CUSTOMER_TYPE', '中医推拿馆', 2),
  ('CUSTOMER_TYPE', '足浴/温泉', 3),
  ('CUSTOMER_TYPE', '美容院/头皮理疗', 4),
  ('CUSTOMER_TYPE', '头疗馆', 5),
  ('CUSTOMER_TYPE', '经销商', 6),
  ('CUSTOMER_TYPE', '其他', 7)
ON CONFLICT (category, value) DO NOTHING;

-- 初始化产品系列
INSERT INTO config_options (category, value, sort_order) VALUES
  ('PRODUCT_SERIES', '德国进口系列', 1),
  ('PRODUCT_SERIES', '中药精油系列', 2),
  ('PRODUCT_SERIES', '单方精油系列', 3),
  ('PRODUCT_SERIES', '基础油系列', 4),
  ('PRODUCT_SERIES', '纯露系列', 5),
  ('PRODUCT_SERIES', '专业护肤系列', 6),
  ('PRODUCT_SERIES', '专业水疗系列', 7),
  ('PRODUCT_SERIES', '养生疗愈系列', 8),
  ('PRODUCT_SERIES', '芳疗复配', 9)
ON CONFLICT (category, value) DO NOTHING;

-- 初始化规格选项
INSERT INTO config_options (category, value, sort_order) VALUES
  ('SPEC_OPTION', '5ml', 1),
  ('SPEC_OPTION', '10ml', 2),
  ('SPEC_OPTION', '30ml', 3),
  ('SPEC_OPTION', '50ml', 4),
  ('SPEC_OPTION', '100ml', 5),
  ('SPEC_OPTION', '500ml', 6),
  ('SPEC_OPTION', '1L', 7),
  ('SPEC_OPTION', '100g', 8),
  ('SPEC_OPTION', '500g', 9),
  ('SPEC_OPTION', '1kg', 10),
  ('SPEC_OPTION', '5kg', 11)
ON CONFLICT (category, value) DO NOTHING;

-- ═══ PRODUCT BATCHES (批次/GC-MS 追溯) ═══
CREATE TABLE IF NOT EXISTS product_batches (
  id SERIAL PRIMARY KEY,
  batch_no TEXT NOT NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  spec_id INTEGER REFERENCES product_specs(id) ON DELETE CASCADE,
  gcms_no TEXT,
  received_date DATE NOT NULL,
  expiry_date DATE,
  initial_qty INTEGER NOT NULL,
  remaining_qty INTEGER NOT NULL,
  unit_cost NUMERIC(10,2) DEFAULT 0,
  supplier TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_batches_product ON product_batches(product_id);
CREATE INDEX IF NOT EXISTS idx_batches_spec ON product_batches(spec_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON product_batches(expiry_date);
ALTER TABLE product_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on product_batches" ON product_batches FOR ALL USING (true) WITH CHECK (true);

-- 库存调整记录关联批次
ALTER TABLE stock_adjustments ADD COLUMN IF NOT EXISTS batch_id INTEGER REFERENCES product_batches(id);

-- 订单商品关联批次（用于追溯销售了哪批货）
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS batch_id INTEGER REFERENCES product_batches(id);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS batch_no TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS gcms_no TEXT;
