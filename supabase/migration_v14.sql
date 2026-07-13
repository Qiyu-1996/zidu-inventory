-- =============================================
-- ZIDU v14 - After-sales workflow
-- Sales/Admin initiate; warehouse handles stock; finance records refund/supplement.
-- =============================================

CREATE TABLE IF NOT EXISTS after_sales (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('RETURN_REFUND', 'EXCHANGE')),
  status TEXT NOT NULL DEFAULT 'WAREHOUSE_PENDING'
    CHECK (status IN ('WAREHOUSE_PENDING', 'FINANCE_PENDING', 'COMPLETED', 'CANCELLED')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  requested_amount NUMERIC(10,2) DEFAULT 0,
  request_note TEXT DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  restock_returned BOOLEAN DEFAULT TRUE,
  deduct_replacement BOOLEAN DEFAULT TRUE,
  warehouse_note TEXT DEFAULT '',
  warehouse_by TEXT,
  warehouse_at TIMESTAMPTZ,
  finance_amount NUMERIC(10,2) DEFAULT 0,
  finance_method TEXT DEFAULT '转账',
  finance_note TEXT DEFAULT '',
  finance_by TEXT,
  finance_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_after_sales_order ON after_sales(order_id);
CREATE INDEX IF NOT EXISTS idx_after_sales_status ON after_sales(status);
CREATE INDEX IF NOT EXISTS idx_after_sales_created ON after_sales(created_at);

ALTER TABLE after_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on after_sales" ON after_sales FOR ALL USING (true) WITH CHECK (true);
