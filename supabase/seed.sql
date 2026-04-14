-- =============================================
-- ZIDU Business Platform - Seed Data
-- Run AFTER schema.sql in Supabase SQL Editor
-- =============================================

-- ═══ DEFAULT ADMIN USER ═══
-- Phone: 18301792268  Password: zd20262026
SELECT create_user('王俊玲', '18301792268', 'zd20262026', 'ADMIN');

-- ═══ PRODUCTS + SPECS ═══
-- Helper: insert product and return id, then insert specs

-- 1. 法国高地真正薰衣草精油
INSERT INTO products (code, name, series, origin) VALUES ('EO-LAV-01', '法国高地真正薰衣草精油', '德国进口系列', '法国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '10ml', 280, 120, 20),
  (currval('products_id_seq'), '100ml', 2200, 30, 5),
  (currval('products_id_seq'), '500g', 8800, 10, 3),
  (currval('products_id_seq'), '1kg', 15800, 5, 2);

-- 2. 那拉提高地真正薰衣草精油
INSERT INTO products (code, name, series, origin) VALUES ('EO-LAV-09', '那拉提高地真正薰衣草精油', '单方精油系列', '中国·新疆');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '10ml', 198, 350, 50),
  (currval('products_id_seq'), '100ml', 1580, 60, 10),
  (currval('products_id_seq'), '500g', 6500, 20, 5),
  (currval('products_id_seq'), '1kg', 11800, 8, 2),
  (currval('products_id_seq'), '5kg', 52000, 3, 1);

-- 3. 保加利亚玫瑰精油
INSERT INTO products (code, name, series, origin) VALUES ('EO-ROS-01', '保加利亚玫瑰精油', '德国进口系列', '保加利亚');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '5ml', 1680, 25, 10),
  (currval('products_id_seq'), '10ml', 3200, 12, 5);

-- 4. 小花茉莉精油（超临界）
INSERT INTO products (code, name, series, origin) VALUES ('CO-JAS-01', '小花茉莉精油（超临界）', '单方精油系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '5ml', 520, 80, 15),
  (currval('products_id_seq'), '10ml', 980, 40, 8);

-- 5. 茶树精油（特级）
INSERT INTO products (code, name, series, origin) VALUES ('EO-TEA-01', '茶树精油（特级）', '德国进口系列', '澳大利亚');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '10ml', 158, 200, 30),
  (currval('products_id_seq'), '100ml', 1280, 45, 8),
  (currval('products_id_seq'), '1kg', 9800, 6, 2);

-- 6. 意大利永久花精油
INSERT INTO products (code, name, series, origin) VALUES ('EO-HEL-01', '意大利永久花精油', '德国进口系列', '奥地利');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '5ml', 1280, 18, 8);

-- 7. 苦橙花精油
INSERT INTO products (code, name, series, origin) VALUES ('EO-NER-01', '苦橙花精油', '单方精油系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '5ml', 680, 35, 10),
  (currval('products_id_seq'), '10ml', 1280, 15, 5);

-- 8. 乳香精油（卡氏）
INSERT INTO products (code, name, series, origin) VALUES ('EO-FRA-01', '乳香精油（卡氏）', '单方精油系列', '索马里');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '10ml', 380, 45, 10),
  (currval('products_id_seq'), '100ml', 3200, 8, 3);

-- 9. 有机尤加利精油
INSERT INTO products (code, name, series, origin) VALUES ('OE-EUG-01', '有机尤加利精油', '德国进口系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '10ml', 128, 180, 25),
  (currval('products_id_seq'), '100ml', 980, 40, 8),
  (currval('products_id_seq'), '1kg', 7200, 5, 2);

-- 10. 桉油醇迷迭香精油（特级）
INSERT INTO products (code, name, series, origin) VALUES ('EO-RSM-01', '桉油醇迷迭香精油（特级）', '单方精油系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '10ml', 138, 160, 25),
  (currval('products_id_seq'), '100ml', 1080, 35, 8);

-- 11. 有机薄荷精油
INSERT INTO products (code, name, series, origin) VALUES ('OE-MNT-01', '有机薄荷精油', '德国进口系列', '印度');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '10ml', 148, 175, 25),
  (currval('products_id_seq'), '100ml', 1180, 30, 6);

-- 12. 丝柏精油
INSERT INTO products (code, name, series, origin) VALUES ('EO-CYP-01', '丝柏精油', '德国进口系列', '西班牙');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '10ml', 168, 130, 20);

-- 13. 佛手柑精油
INSERT INTO products (code, name, series, origin) VALUES ('EO-BER-01', '佛手柑精油', '单方精油系列', '意大利');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '10ml', 198, 120, 20);

-- 14. 有机柠檬精油
INSERT INTO products (code, name, series, origin) VALUES ('OE-LEN-01', '有机柠檬精油', '德国进口系列', '西班牙');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '10ml', 128, 200, 30);

-- 15. 有机甜橙精油
INSERT INTO products (code, name, series, origin) VALUES ('OE-ORN-01', '有机甜橙精油', '德国进口系列', '意大利');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '10ml', 88, 250, 40);

-- 16. 印度檀香精油
INSERT INTO products (code, name, series, origin) VALUES ('EO-SAN-01', '印度檀香精油', '单方精油系列', '印度');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '5ml', 1580, 15, 5),
  (currval('products_id_seq'), '10ml', 2980, 6, 2);

-- 17. 特级厚朴精油
INSERT INTO products (code, name, series, origin) VALUES ('EO-MAB-01', '特级厚朴精油', '中药精油系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '10ml', 228, 85, 15),
  (currval('products_id_seq'), '100ml', 1800, 20, 5);

-- 18. 特级龙脑精油
INSERT INTO products (code, name, series, origin) VALUES ('EO-BOR-01', '特级龙脑精油', '中药精油系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '10ml', 168, 110, 20),
  (currval('products_id_seq'), '100g', 1200, 25, 5);

-- 19. 特级川芎精油
INSERT INTO products (code, name, series, origin) VALUES ('EO-CHU-01', '特级川芎精油', '中药精油系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '10ml', 198, 95, 20);

-- 20. 特级当归精油（超临界）
INSERT INTO products (code, name, series, origin) VALUES ('CO-DON-01', '特级当归精油（超临界）', '中药精油系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '10ml', 258, 70, 15);

-- 21. 艾叶精油
INSERT INTO products (code, name, series, origin) VALUES ('EO-ARM-01', '艾叶精油', '中药精油系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '10ml', 128, 150, 25),
  (currval('products_id_seq'), '100ml', 980, 40, 8),
  (currval('products_id_seq'), '500g', 3800, 15, 3);

-- 22. 特级人参精油（超临界）
INSERT INTO products (code, name, series, origin) VALUES ('CO-GSG-01', '特级人参精油（超临界）', '中药精油系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '5ml', 580, 20, 5);

-- 23. 甜杏仁油（德国）
INSERT INTO products (code, name, series, origin) VALUES ('CA-ALM-01', '甜杏仁油（德国）', '基础油系列', '德国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '100ml', 98, 250, 40),
  (currval('products_id_seq'), '500g', 380, 60, 10),
  (currval('products_id_seq'), '1kg', 680, 30, 5),
  (currval('products_id_seq'), '5kg', 2800, 8, 2);

-- 24. 荷荷巴油（金黄色）
INSERT INTO products (code, name, series, origin) VALUES ('CA-JOJ-01', '荷荷巴油（金黄色）', '基础油系列', '阿根廷');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '100ml', 128, 180, 30),
  (currval('products_id_seq'), '500g', 520, 40, 8),
  (currval('products_id_seq'), '1kg', 950, 15, 3);

-- 25. 椰子油（清爽）
INSERT INTO products (code, name, series, origin) VALUES ('CA-COC-01', '椰子油（清爽）', '基础油系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '100ml', 68, 300, 50),
  (currval('products_id_seq'), '1kg', 480, 40, 8);

-- 26. 玫瑰果油（波兰）
INSERT INTO products (code, name, series, origin) VALUES ('CA-RHP-01', '玫瑰果油（波兰）', '基础油系列', '波兰');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '50ml', 168, 80, 15),
  (currval('products_id_seq'), '100ml', 298, 30, 5);

-- 27. 保加利亚玫瑰纯露
INSERT INTO products (code, name, series, origin) VALUES ('HY-ROS-01', '保加利亚玫瑰纯露', '纯露系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '500ml', 88, 300, 50),
  (currval('products_id_seq'), '1L', 158, 100, 20);

-- 28. 薰衣草纯露
INSERT INTO products (code, name, series, origin) VALUES ('HY-LAV-01', '薰衣草纯露', '纯露系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '500ml', 68, 350, 50),
  (currval('products_id_seq'), '1L', 118, 120, 20);

-- 29. 苦橙花纯露
INSERT INTO products (code, name, series, origin) VALUES ('HY-NER-01', '苦橙花纯露', '纯露系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '500ml', 98, 200, 30);

-- 30. 小花茉莉洁面乳
INSERT INTO products (code, name, series, origin) VALUES ('SC-PRO-01', '小花茉莉洁面乳', '专业护肤系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '120ml', 168, 100, 20);

-- 31. 特配全效修护精华油
INSERT INTO products (code, name, series, origin) VALUES ('SC-PRO-10', '特配全效修护精华油', '专业护肤系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '30ml', 368, 60, 15);

-- 32. 小花茉莉女王面霜
INSERT INTO products (code, name, series, origin) VALUES ('SC-PRO-19', '小花茉莉女王面霜', '专业护肤系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '50ml', 428, 55, 12);

-- 33. 乳香紧致提拉抗老面霜
INSERT INTO products (code, name, series, origin) VALUES ('SC-PRO-22', '乳香紧致提拉抗老面霜', '专业护肤系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '50ml', 458, 45, 10);

-- 34. 艾草与姜身体按摩油
INSERT INTO products (code, name, series, origin) VALUES ('SP-PRO-01', '艾草与姜身体按摩油', '专业水疗系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '100ml', 68, 200, 30),
  (currval('products_id_seq'), '500ml', 168, 150, 25),
  (currval('products_id_seq'), '1L', 298, 60, 10),
  (currval('products_id_seq'), '5kg', 1280, 10, 3);

-- 35. 玫瑰檀香身体按摩油
INSERT INTO products (code, name, series, origin) VALUES ('SP-PRO-02', '玫瑰檀香身体按摩油', '专业水疗系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '100ml', 78, 180, 30),
  (currval('products_id_seq'), '500ml', 198, 130, 25),
  (currval('products_id_seq'), '1L', 358, 50, 8);

-- 36. 薰衣草洋甘菊身体按摩油
INSERT INTO products (code, name, series, origin) VALUES ('SP-PRO-04', '薰衣草洋甘菊身体按摩油', '专业水疗系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '500ml', 188, 140, 25);

-- 37. 薰衣草身体按摩油
INSERT INTO products (code, name, series, origin) VALUES ('SP-PRO-07', '薰衣草身体按摩油', '专业水疗系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '500ml', 158, 180, 30);

-- 38. 姜根舒缓养护油（发热姜油）
INSERT INTO products (code, name, series, origin) VALUES ('HL-PRO-01', '姜根舒缓养护油（发热姜油）', '养生疗愈系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '100ml', 198, 100, 20);

-- 39. 肩颈舒张养护油
INSERT INTO products (code, name, series, origin) VALUES ('HL-PRO-05', '肩颈舒张养护油', '养生疗愈系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '100ml', 258, 90, 20);

-- 40. 梦境深睡养护油
INSERT INTO products (code, name, series, origin) VALUES ('HL-PRO-09', '梦境深睡养护油', '养生疗愈系列', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '100ml', 288, 75, 15);

-- 41. 净呼吸舒畅精油
INSERT INTO products (code, name, series, origin) VALUES ('BL-PRO-01', '净呼吸舒畅精油', '芳疗复配', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '10ml', 198, 85, 15);

-- 42. 睡美人安睡精油
INSERT INTO products (code, name, series, origin) VALUES ('BL-PRO-02', '睡美人安睡精油', '芳疗复配', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '10ml', 228, 110, 20);

-- 43. 薰衣草舒眠枕头喷雾
INSERT INTO products (code, name, series, origin) VALUES ('BL-PRO-05', '薰衣草舒眠枕头喷雾', '芳疗复配', '中国');
INSERT INTO product_specs (product_id, spec, price, stock, safe_stock) VALUES
  (currval('products_id_seq'), '100ml', 128, 160, 25);

-- ═══ DEFAULT CUSTOMERS ═══
INSERT INTO customers (name, contact, phone, address, type, sales_id) VALUES
  ('悦SPA水疗中心', '林小姐', '13900001111', '广州天河区体育西路101号', 'SPA水疗馆', NULL),
  ('和颐堂中医推拿', '王医生', '13900002222', '深圳南山区科技园路88号', '中医推拿馆', NULL);
