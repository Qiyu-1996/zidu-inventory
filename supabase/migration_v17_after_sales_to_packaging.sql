-- =============================================
-- ZIDU v17 - Launch latest database patch
-- 适用：如果你从「退货/售后」那块开始还没有跑 Supabase，就跑这一份。
--
-- 包含：
-- 1) v13 订单来源字段 source / channel_meta
-- 2) v14 售后工单 after_sales
-- 3) v15 删除订单库 deleted_orders（30 天可恢复）
-- 4) v16 分装瓶 ZDBTL-01 ~ ZDBTL-06，含最新整排/整箱总价
--
-- 幂等：可重复运行；已存在表/字段不会重复创建；已有库存不会被重置。
-- =============================================

-- =============================================
-- v13: Store structured order source metadata
-- =============================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'web_admin';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS channel_meta JSONB DEFAULT '{}'::jsonb;

UPDATE orders
SET source = COALESCE(source, 'web_admin'),
    channel_meta = COALESCE(channel_meta, '{}'::jsonb);


-- =============================================
-- v14: After-sales workflow
-- Sales/Admin initiate; warehouse handles stock; finance records refund.
-- 当前前端使用：
--   RETURN_REFUND = 退货退款 / 整单退
--   RETURN_REFUND + request_note 以「仅退款」开头 = 仅退款
-- EXCHANGE 保留给旧数据兼容，不作为新入口默认展示。
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'after_sales'
      AND policyname = 'Allow all on after_sales'
  ) THEN
    CREATE POLICY "Allow all on after_sales" ON after_sales FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- =============================================
-- v15: Deleted order library / 30-day recovery
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'deleted_orders'
      AND policyname = 'Allow all on deleted_orders'
  ) THEN
    CREATE POLICY "Allow all on deleted_orders" ON deleted_orders FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;


-- =============================================
-- v16: Add packaging bottle SKUs
-- 精油/纯露分装瓶放入销售目录「其他」分类（系列：瓶器包材）
-- 价格说明：
-- - 单个规格为单个价格
-- - 整排/整箱规格为总价，不是单价
-- - 前端会自动显示折算单价，方便销售说明
-- =============================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'BOTH';

DO $$
DECLARE
  product_item JSONB;
  spec_item JSONB;
  v_product_id INTEGER;
  payload JSONB := '[
    {
      "code": "ZDBTL-01",
      "name": "精油分装瓶 5ml",
      "specs": [
        { "spec": "1-100个", "price": 1.00, "stock": 999, "safe_stock": 10 },
        { "spec": "整排(255个/排)", "price": 216.75, "stock": 999, "safe_stock": 10 },
        { "spec": "整箱(765个/箱)", "price": 497.25, "stock": 999, "safe_stock": 10 }
      ]
    },
    {
      "code": "ZDBTL-02",
      "name": "精油分装瓶 10ml",
      "specs": [
        { "spec": "1-100个", "price": 1.00, "stock": 999, "safe_stock": 10 },
        { "spec": "整排(192个/排)", "price": 163.20, "stock": 999, "safe_stock": 10 },
        { "spec": "整箱(768个/箱)", "price": 499.20, "stock": 999, "safe_stock": 10 }
      ]
    },
    {
      "code": "ZDBTL-03",
      "name": "精油分装瓶 30ml",
      "specs": [
        { "spec": "1-100个", "price": 1.00, "stock": 999, "safe_stock": 10 },
        { "spec": "整排(110个/排)", "price": 93.50, "stock": 999, "safe_stock": 10 },
        { "spec": "整箱(330个/箱)", "price": 214.50, "stock": 999, "safe_stock": 10 }
      ]
    },
    {
      "code": "ZDBTL-04",
      "name": "精油分装瓶 50ml",
      "specs": [
        { "spec": "1-100个", "price": 1.50, "stock": 999, "safe_stock": 10 },
        { "spec": "整排(88个/排)", "price": 105.60, "stock": 999, "safe_stock": 10 },
        { "spec": "整箱(264个/箱)", "price": 264.00, "stock": 999, "safe_stock": 10 }
      ]
    },
    {
      "code": "ZDBTL-05",
      "name": "精油分装瓶 100ml",
      "specs": [
        { "spec": "1-100个", "price": 1.50, "stock": 999, "safe_stock": 10 },
        { "spec": "整排(70个/排)", "price": 84.00, "stock": 999, "safe_stock": 10 },
        { "spec": "整箱(140个/箱)", "price": 140.00, "stock": 999, "safe_stock": 10 }
      ]
    },
    {
      "code": "ZDBTL-06",
      "name": "纯露分装瓶 100g",
      "specs": [
        { "spec": "1-100个", "price": 5.00, "stock": 999, "safe_stock": 10 },
        { "spec": "整箱(520个/箱)", "price": 1820.00, "stock": 999, "safe_stock": 10 }
      ]
    }
  ]'::jsonb;
BEGIN
  FOR product_item IN SELECT * FROM jsonb_array_elements(payload)
  LOOP
    INSERT INTO products (code, name, series, origin, channel)
    VALUES (
      product_item->>'code',
      product_item->>'name',
      '瓶器包材',
      '中国',
      'BOTH'
    )
    ON CONFLICT (code) DO UPDATE
      SET name = EXCLUDED.name,
          series = EXCLUDED.series,
          origin = EXCLUDED.origin,
          channel = EXCLUDED.channel
    RETURNING id INTO v_product_id;

    FOR spec_item IN SELECT * FROM jsonb_array_elements(product_item->'specs')
    LOOP
      UPDATE product_specs
      SET price = (spec_item->>'price')::NUMERIC,
          safe_stock = (spec_item->>'safe_stock')::INTEGER
      WHERE product_id = v_product_id
        AND spec = spec_item->>'spec';

      IF NOT FOUND THEN
        INSERT INTO product_specs (product_id, spec, price, stock, safe_stock)
        VALUES (
          v_product_id,
          spec_item->>'spec',
          (spec_item->>'price')::NUMERIC,
          (spec_item->>'stock')::INTEGER,
          (spec_item->>'safe_stock')::INTEGER
        );
      END IF;
    END LOOP;
  END LOOP;
END $$;


-- =============================================
-- Self check
-- =============================================

SELECT 'after_sales table ready' AS check_name, COUNT(*) AS rows FROM after_sales;

SELECT 'deleted_orders table ready' AS check_name, COUNT(*) AS rows FROM deleted_orders;

SELECT
  p.code,
  p.name,
  p.series,
  p.channel,
  ps.spec,
  ps.price,
  ps.stock
FROM products p
JOIN product_specs ps ON ps.product_id = p.id
WHERE p.code LIKE 'ZDBTL-%'
ORDER BY p.code, ps.id;
