-- =============================================
-- ZIDU Business Platform - Database Schema
-- Run this in Supabase SQL Editor
-- =============================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ═══ USERS ═══
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'SALES', 'WAREHOUSE')),
  password_hash TEXT NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Safe view (no password_hash)
CREATE VIEW users_safe AS
SELECT id, name, phone, role, status, created_at FROM users;

-- ═══ PRODUCTS ═══
CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  series TEXT NOT NULL,
  origin TEXT DEFAULT '中国',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE product_specs (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  spec TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  stock INTEGER DEFAULT 0,
  safe_stock INTEGER DEFAULT 10,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_product_specs_product_id ON product_specs(product_id);

-- ═══ CUSTOMERS ═══
CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  contact TEXT,
  phone TEXT,
  address TEXT,
  type TEXT,
  sales_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE customer_notes (
  id SERIAL PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  by_user TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_customer_notes_customer_id ON customer_notes(customer_id);

-- ═══ ORDERS ═══
CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  order_no TEXT UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  sales_id INTEGER REFERENCES users(id),
  status TEXT DEFAULT 'DRAFT',
  subtotal NUMERIC(10,2) DEFAULT 0,
  discount_percent NUMERIC(5,2) DEFAULT 0,
  discount_amount NUMERIC(10,2) DEFAULT 0,
  total NUMERIC(10,2) DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at DATE DEFAULT CURRENT_DATE
);

CREATE TABLE order_items (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER,
  spec_id INTEGER,
  product_name TEXT,
  product_code TEXT,
  spec TEXT,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(10,2) NOT NULL,
  subtotal NUMERIC(10,2) NOT NULL
);

CREATE INDEX idx_order_items_order_id ON order_items(order_id);

CREATE TABLE order_logs (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  time TEXT NOT NULL,
  user_name TEXT NOT NULL,
  action TEXT NOT NULL
);

CREATE INDEX idx_order_logs_order_id ON order_logs(order_id);

CREATE TABLE shipments (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  carrier TEXT,
  tracking_no TEXT,
  shipped_at DATE,
  operator TEXT
);

CREATE INDEX idx_shipments_order_id ON shipments(order_id);

-- ═══ RPC FUNCTIONS ═══

-- Login function (SECURITY DEFINER to access password_hash)
CREATE OR REPLACE FUNCTION login(p_phone TEXT, p_password TEXT)
RETURNS JSON AS $$
DECLARE
  v_user users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM users WHERE phone = p_phone AND status = 'active';
  IF v_user.id IS NULL THEN
    RETURN json_build_object('error', '账号不存在或已禁用');
  END IF;
  IF v_user.password_hash != crypt(p_password, v_user.password_hash) THEN
    RETURN json_build_object('error', '密码错误');
  END IF;
  RETURN json_build_object(
    'id', v_user.id,
    'name', v_user.name,
    'phone', v_user.phone,
    'role', v_user.role,
    'status', v_user.status
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create user function
CREATE OR REPLACE FUNCTION create_user(p_name TEXT, p_phone TEXT, p_password TEXT, p_role TEXT)
RETURNS JSON AS $$
DECLARE
  v_user users%ROWTYPE;
BEGIN
  INSERT INTO users (name, phone, password_hash, role)
  VALUES (p_name, p_phone, crypt(p_password, gen_salt('bf')), p_role)
  RETURNING * INTO v_user;
  RETURN json_build_object(
    'id', v_user.id,
    'name', v_user.name,
    'phone', v_user.phone,
    'role', v_user.role,
    'status', v_user.status
  );
EXCEPTION WHEN unique_violation THEN
  RETURN json_build_object('error', '该手机号已注册');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Change password function
CREATE OR REPLACE FUNCTION change_password(p_user_id INTEGER, p_old_password TEXT, p_new_password TEXT)
RETURNS JSON AS $$
DECLARE
  v_user users%ROWTYPE;
BEGIN
  SELECT * INTO v_user FROM users WHERE id = p_user_id;
  IF v_user.id IS NULL THEN
    RETURN json_build_object('error', '用户不存在');
  END IF;
  IF v_user.password_hash != crypt(p_old_password, v_user.password_hash) THEN
    RETURN json_build_object('error', '原密码错误');
  END IF;
  UPDATE users SET password_hash = crypt(p_new_password, gen_salt('bf')) WHERE id = p_user_id;
  RETURN json_build_object('success', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══ ROW LEVEL SECURITY ═══
-- Protect the users table (password_hash should never be directly readable)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Allow anon to call RPC functions (SECURITY DEFINER handles access)
-- But block direct table access
CREATE POLICY "Block direct user reads" ON users FOR SELECT USING (false);
CREATE POLICY "Block direct user inserts" ON users FOR INSERT WITH CHECK (false);
CREATE POLICY "Block direct user updates" ON users FOR UPDATE USING (false);
CREATE POLICY "Block direct user deletes" ON users FOR DELETE USING (false);

-- Other tables: allow full access via anon key (internal tool)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on products" ON products FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE product_specs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on product_specs" ON product_specs FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on customers" ON customers FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE customer_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on customer_notes" ON customer_notes FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on orders" ON orders FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on order_items" ON order_items FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE order_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on order_logs" ON order_logs FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on shipments" ON shipments FOR ALL USING (true) WITH CHECK (true);

-- Grant view access
GRANT SELECT ON users_safe TO anon, authenticated;
