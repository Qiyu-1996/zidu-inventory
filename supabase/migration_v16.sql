-- =============================================
-- ZIDU v16 - Add packaging bottle SKUs
-- 精油/纯露分装瓶放入销售目录「其他」分类（系列：瓶器包材）
-- 幂等：可重复运行，不会重复创建商品/规格；已有库存不会被重置。
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

-- 自检：
-- SELECT p.code, p.name, p.series, p.channel, ps.spec, ps.price, ps.stock
-- FROM products p
-- JOIN product_specs ps ON ps.product_id = p.id
-- WHERE p.code LIKE 'ZDBTL-%'
-- ORDER BY p.code, ps.id;
