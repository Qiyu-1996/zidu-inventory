-- =============================================
-- ZIDU v15 - Deleted order library / 30-day recovery
-- Admin can review, restore, or permanently remove deleted orders.
-- =============================================

CREATE TABLE IF NOT EXISTS deleted_orders (
  id SERIAL PRIMARY KEY,
  original_order_id INTEGER,
  restored_order_id INTEGER,
  order_no TEXT NOT NULL,
  customer_id INTEGER,
  customer_name TEXT DEFAULT '',
  sales_id INTEGER,
  status TEXT DEFAULT '',
  payment_status TEXT DEFAULT '',
  total NUMERIC(10,2) DEFAULT 0,
  paid_amount NUMERIC(10,2) DEFAULT 0,
  stock_restored BOOLEAN DEFAULT TRUE,
  snapshot JSONB NOT NULL,
  deleted_by TEXT DEFAULT '',
  deleted_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
  restored_by TEXT,
  restored_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deleted_orders_deleted_at ON deleted_orders(deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_deleted_orders_expires_at ON deleted_orders(expires_at);
CREATE INDEX IF NOT EXISTS idx_deleted_orders_order_no ON deleted_orders(order_no);
CREATE INDEX IF NOT EXISTS idx_deleted_orders_restored_at ON deleted_orders(restored_at);

ALTER TABLE deleted_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on deleted_orders" ON deleted_orders FOR ALL USING (true) WITH CHECK (true);

-- Optional cleanup command for scheduled jobs or manual maintenance:
-- DELETE FROM deleted_orders WHERE restored_at IS NULL AND expires_at < NOW();
