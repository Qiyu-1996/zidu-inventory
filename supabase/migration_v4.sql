-- =============================================
-- ZIDU ZBP v4.0 Migration
-- 供应商/销售任务/销售目标/审计日志
-- =============================================

-- ═══ SUPPLIERS (供应商管理) ═══
CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  category TEXT DEFAULT '',
  payment_terms TEXT DEFAULT '',
  note TEXT DEFAULT '',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on suppliers" ON suppliers FOR ALL USING (true) WITH CHECK (true);

-- 让采购单关联供应商
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id);

-- ═══ SALES TASKS (销售跟进任务) ═══
CREATE TABLE IF NOT EXISTS sales_tasks (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  sales_id INTEGER REFERENCES users(id),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  due_date DATE,
  priority TEXT DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH')),
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DONE', 'CANCELLED')),
  completed_at TIMESTAMPTZ,
  completed_note TEXT DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_sales ON sales_tasks(sales_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON sales_tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_customer ON sales_tasks(customer_id);
ALTER TABLE sales_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on sales_tasks" ON sales_tasks FOR ALL USING (true) WITH CHECK (true);

-- ═══ SALES TARGETS (销售业绩目标) ═══
CREATE TABLE IF NOT EXISTS sales_targets (
  id SERIAL PRIMARY KEY,
  sales_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  target_amount NUMERIC(12,2) NOT NULL,
  commission_rate NUMERIC(5,2) DEFAULT 0,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (sales_id, year, month)
);
CREATE INDEX IF NOT EXISTS idx_targets_sales ON sales_targets(sales_id);
CREATE INDEX IF NOT EXISTS idx_targets_ym ON sales_targets(year, month);
ALTER TABLE sales_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on sales_targets" ON sales_targets FOR ALL USING (true) WITH CHECK (true);

-- ═══ AUDIT LOGS (系统操作日志) ═══
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  user_name TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  details TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on audit_logs" ON audit_logs FOR ALL USING (true) WITH CHECK (true);

-- ═══ SHIPMENT NOTIFICATIONS (发货通知记录) ═══
CREATE TABLE IF NOT EXISTS shipment_notifications (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(id),
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  method TEXT DEFAULT 'wechat' CHECK (method IN ('wechat', 'sms', 'email', 'manual')),
  status TEXT DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  note TEXT DEFAULT ''
);
ALTER TABLE shipment_notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on shipment_notifications" ON shipment_notifications FOR ALL USING (true) WITH CHECK (true);
