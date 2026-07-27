-- ZIDU 2C official essential-oil catalog, 2026-07.
-- Supabase is the management source; CloudBase receives a published read-only snapshot.
BEGIN;

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS extraction_method TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS on_sale_2c BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS oil_id TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cat_2c TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS copy_2c TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image_url TEXT DEFAULT '';
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS gallery JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.product_specs ADD COLUMN IF NOT EXISTS sku TEXT;
ALTER TABLE public.product_specs ADD COLUMN IF NOT EXISTS on_sale_2c BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_specs_sku_key') THEN
    ALTER TABLE public.product_specs ADD CONSTRAINT product_specs_sku_key UNIQUE (sku);
  END IF;
END $$;

WITH catalog(code, name, origin, extraction_method, oil_id) AS (
VALUES
  ('ZDEO-01', '甜橙', '巴西', '冷压', 'orange'),
  ('ZDEO-02', '蓝胶尤加利', '中国', '蒸馏', 'eucalyptus'),
  ('ZDEO-03', '柠檬', '南美', '冷压', 'lemon'),
  ('ZDEO-04', '柠檬草', '印度', '蒸馏', 'lemongrass'),
  ('ZDEO-05', '白兰叶', '中国 广西', '蒸馏', 'magnolia_leaf'),
  ('ZDEO-06', '桉油醇迷迭香', '中国', '蒸馏', 'rosemary'),
  ('ZDEO-07', '真正薰衣草', '中国 新疆', '蒸馏', 'lavender'),
  ('ZDEO-08', '山苍子', '中国 云南', '蒸馏', 'maychang'),
  ('ZDEO-09', '茶树', '中国', '蒸馏', 'teatree'),
  ('ZDEO-10', '澳洲茶树', '澳大利亚', '蒸馏', 'teatree_au'),
  ('ZDEO-11', '喜马拉雅雪松', '尼泊尔', '蒸馏', 'cedar'),
  ('ZDEO-12', '快乐鼠尾草', '中国', '蒸馏', 'clarysage'),
  ('ZDEO-13', '欧薄荷', '中国', '蒸馏', 'peppermint'),
  ('ZDEO-14', '冬青', '中国', '蒸馏', 'wintergreen'),
  ('ZDEO-15', '罗文莎叶', '马达加斯加', '蒸馏', 'ravintsara'),
  ('ZDEO-16', '甜罗勒', '印度', '蒸馏', 'basil'),
  ('ZDEO-17', '粉葡萄柚', '南非', '冷压', 'grapefruit'),
  ('ZDEO-18', '小黄姜', '中国 云南', '超临界', 'ginger'),
  ('ZDEO-19', '广藿香', '印尼', '蒸馏', 'patchouli'),
  ('ZDEO-20', '小青柑', '中国 广东', '蒸馏', 'greentangerine'),
  ('ZDEO-21', '佛手柑', '意大利', '冷压', 'bergamot'),
  ('ZDEO-22', '杜松', '奥地利', '蒸馏', 'juniper'),
  ('ZDEO-23', '玫瑰天竺葵', '埃及', '蒸馏', 'geranium_r'),
  ('ZDEO-24', '波旁天竺葵', '法国 留尼汪岛', '蒸馏', 'geranium_b'),
  ('ZDEO-25', '北艾草', '尼泊尔', '蒸馏', 'mugwort'),
  ('ZDEO-26', '罗马洋甘菊', '中国', '蒸馏', 'chamomile'),
  ('ZDEO-27', '完全依兰', '马达加斯加', '蒸馏', 'ylang'),
  ('ZDEO-28', '索马里乳香', '索马里', '蒸馏', 'frankincense_c'),
  ('ZDEO-29', '没药', '索马里', '蒸馏', 'myrrh'),
  ('ZDEO-30', '阿曼绿乳香', '阿曼', '蒸馏', 'frankincense'),
  ('ZDEO-31', '海地岩兰草', '海地', '蒸馏', 'vetiver'),
  ('ZDEO-32', '白兰花', '中国', '蒸馏', 'magnolia_flower'),
  ('ZDEO-33', '苦橙花', '中国', '蒸馏', 'neroli'),
  ('ZDEO-34', '德国蓝甘菊', '中国新疆', '蒸馏', 'gchamomile'),
  ('ZDEO-35', '澳洲檀香', '澳洲', '超临界', 'sandalwood'),
  ('ZDEO-36', '墨红玫瑰（待定）', '中国', '溶剂', 'darkrose'),
  ('ZDEO-37', '意大利永久花', '科西嘉', '蒸馏', 'helichrysum'),
  ('ZDEO-38', '小花茉莉', '中国', '溶剂', 'jasmine'),
  ('ZDEO-39', '大马士革玫瑰', '中国', '蒸馏', 'rose'),
  ('ZDEO-40', '东印度檀香', '印度', '蒸馏', 'sandalwood_in')
)
INSERT INTO public.products (code, name, series, origin, extraction_method, oil_id, cat_2c, on_sale_2c, channel)
SELECT code, name, '单方精油系列', origin, extraction_method, oil_id, '单方精油', TRUE, 'BOTH'
FROM catalog
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  series = EXCLUDED.series,
  origin = EXCLUDED.origin,
  extraction_method = EXCLUDED.extraction_method,
  oil_id = EXCLUDED.oil_id,
  cat_2c = EXCLUDED.cat_2c,
  on_sale_2c = TRUE;

WITH official(sku, code, spec, price) AS (
VALUES
  ('ZDEO-01-5ML', 'ZDEO-01', '5ml', 32),
  ('ZDEO-01-15ML', 'ZDEO-01', '15ml', 56),
  ('ZDEO-02-5ML', 'ZDEO-02', '5ml', 42),
  ('ZDEO-02-15ML', 'ZDEO-02', '15ml', 76),
  ('ZDEO-03-5ML', 'ZDEO-03', '5ml', 32),
  ('ZDEO-03-15ML', 'ZDEO-03', '15ml', 58.8),
  ('ZDEO-04-5ML', 'ZDEO-04', '5ml', 32),
  ('ZDEO-04-15ML', 'ZDEO-04', '15ml', 58.8),
  ('ZDEO-05-5ML', 'ZDEO-05', '5ml', 52),
  ('ZDEO-05-15ML', 'ZDEO-05', '15ml', 98),
  ('ZDEO-06-5ML', 'ZDEO-06', '5ml', 54),
  ('ZDEO-06-15ML', 'ZDEO-06', '15ml', 87),
  ('ZDEO-07-5ML', 'ZDEO-07', '5ml', 39),
  ('ZDEO-07-15ML', 'ZDEO-07', '15ml', 66.8),
  ('ZDEO-08-5ML', 'ZDEO-08', '5ml', 42),
  ('ZDEO-08-15ML', 'ZDEO-08', '15ml', 82),
  ('ZDEO-09-5ML', 'ZDEO-09', '5ml', 39),
  ('ZDEO-09-15ML', 'ZDEO-09', '15ml', 76),
  ('ZDEO-10-5ML', 'ZDEO-10', '5ml', 48),
  ('ZDEO-10-15ML', 'ZDEO-10', '15ml', 85),
  ('ZDEO-11-5ML', 'ZDEO-11', '5ml', 42),
  ('ZDEO-11-15ML', 'ZDEO-11', '15ml', 85),
  ('ZDEO-12-5ML', 'ZDEO-12', '5ml', 56),
  ('ZDEO-12-15ML', 'ZDEO-12', '15ml', 115),
  ('ZDEO-13-5ML', 'ZDEO-13', '5ml', 45),
  ('ZDEO-13-15ML', 'ZDEO-13', '15ml', 82),
  ('ZDEO-14-5ML', 'ZDEO-14', '5ml', 49),
  ('ZDEO-14-15ML', 'ZDEO-14', '15ml', 88),
  ('ZDEO-15-5ML', 'ZDEO-15', '5ml', 55),
  ('ZDEO-15-15ML', 'ZDEO-15', '15ml', 97),
  ('ZDEO-16-5ML', 'ZDEO-16', '5ml', 62),
  ('ZDEO-16-15ML', 'ZDEO-16', '15ml', 109),
  ('ZDEO-17-5ML', 'ZDEO-17', '5ml', 46),
  ('ZDEO-17-15ML', 'ZDEO-17', '15ml', 92),
  ('ZDEO-18-5ML', 'ZDEO-18', '5ml', 56),
  ('ZDEO-18-15ML', 'ZDEO-18', '15ml', 129),
  ('ZDEO-19-5ML', 'ZDEO-19', '5ml', 56),
  ('ZDEO-19-15ML', 'ZDEO-19', '15ml', 108),
  ('ZDEO-20-5ML', 'ZDEO-20', '5ml', 68),
  ('ZDEO-20-15ML', 'ZDEO-20', '15ml', 115),
  ('ZDEO-21-5ML', 'ZDEO-21', '5ml', 56),
  ('ZDEO-21-15ML', 'ZDEO-21', '15ml', 118),
  ('ZDEO-22-5ML', 'ZDEO-22', '5ml', 57),
  ('ZDEO-22-15ML', 'ZDEO-22', '15ml', 105),
  ('ZDEO-23-5ML', 'ZDEO-23', '5ml', 62),
  ('ZDEO-23-15ML', 'ZDEO-23', '15ml', 135),
  ('ZDEO-24-5ML', 'ZDEO-24', '5ml', 85),
  ('ZDEO-24-15ML', 'ZDEO-24', '15ml', 156),
  ('ZDEO-25-5ML', 'ZDEO-25', '5ml', 86),
  ('ZDEO-25-15ML', 'ZDEO-25', '15ml', 165),
  ('ZDEO-26-5ML', 'ZDEO-26', '5ml', 228),
  ('ZDEO-26-15ML', 'ZDEO-26', '15ml', 485),
  ('ZDEO-27-5ML', 'ZDEO-27', '5ml', 145),
  ('ZDEO-27-15ML', 'ZDEO-27', '15ml', 282),
  ('ZDEO-28-5ML', 'ZDEO-28', '5ml', 135),
  ('ZDEO-28-15ML', 'ZDEO-28', '15ml', 282),
  ('ZDEO-29-5ML', 'ZDEO-29', '5ml', 135),
  ('ZDEO-29-15ML', 'ZDEO-29', '15ml', 283),
  ('ZDEO-30-5ML', 'ZDEO-30', '5ml', 149),
  ('ZDEO-30-15ML', 'ZDEO-30', '15ml', 296),
  ('ZDEO-31-2ML', 'ZDEO-31', '2ml', 65),
  ('ZDEO-31-5ML', 'ZDEO-31', '5ml', 129),
  ('ZDEO-32-2ML', 'ZDEO-32', '2ml', 95),
  ('ZDEO-32-5ML', 'ZDEO-32', '5ml', 168),
  ('ZDEO-33-2ML', 'ZDEO-33', '2ml', 125),
  ('ZDEO-33-5ML', 'ZDEO-33', '5ml', 228),
  ('ZDEO-34-2ML', 'ZDEO-34', '2ml', 136),
  ('ZDEO-34-5ML', 'ZDEO-34', '5ml', 235),
  ('ZDEO-35-2ML', 'ZDEO-35', '2ml', 165),
  ('ZDEO-35-5ML', 'ZDEO-35', '5ml', 326),
  ('ZDEO-36-2ML', 'ZDEO-36', '2ml', 245),
  ('ZDEO-36-5ML', 'ZDEO-36', '5ml', 466),
  ('ZDEO-37-2ML', 'ZDEO-37', '2ml', 228),
  ('ZDEO-37-5ML', 'ZDEO-37', '5ml', 425),
  ('ZDEO-38-2ML', 'ZDEO-38', '2ml', 265),
  ('ZDEO-38-5ML', 'ZDEO-38', '5ml', 472),
  ('ZDEO-39-2ML', 'ZDEO-39', '2ml', 396),
  ('ZDEO-39-5ML', 'ZDEO-39', '5ml', 850),
  ('ZDEO-40-2ML', 'ZDEO-40', '2ml', 650),
  ('ZDEO-40-5ML', 'ZDEO-40', '5ml', 1290)
)
INSERT INTO public.product_specs (product_id, sku, spec, price, stock, safe_stock, on_sale_2c)
SELECT p.id, official.sku, official.spec, official.price, 0, 10, TRUE
FROM official
JOIN public.products p ON p.code = official.code
ON CONFLICT (sku) DO UPDATE SET
  product_id = EXCLUDED.product_id,
  spec = EXCLUDED.spec,
  price = EXCLUDED.price,
  on_sale_2c = TRUE;

WITH official_skus(sku) AS (
VALUES
  ('ZDEO-01-5ML'),
  ('ZDEO-01-15ML'),
  ('ZDEO-02-5ML'),
  ('ZDEO-02-15ML'),
  ('ZDEO-03-5ML'),
  ('ZDEO-03-15ML'),
  ('ZDEO-04-5ML'),
  ('ZDEO-04-15ML'),
  ('ZDEO-05-5ML'),
  ('ZDEO-05-15ML'),
  ('ZDEO-06-5ML'),
  ('ZDEO-06-15ML'),
  ('ZDEO-07-5ML'),
  ('ZDEO-07-15ML'),
  ('ZDEO-08-5ML'),
  ('ZDEO-08-15ML'),
  ('ZDEO-09-5ML'),
  ('ZDEO-09-15ML'),
  ('ZDEO-10-5ML'),
  ('ZDEO-10-15ML'),
  ('ZDEO-11-5ML'),
  ('ZDEO-11-15ML'),
  ('ZDEO-12-5ML'),
  ('ZDEO-12-15ML'),
  ('ZDEO-13-5ML'),
  ('ZDEO-13-15ML'),
  ('ZDEO-14-5ML'),
  ('ZDEO-14-15ML'),
  ('ZDEO-15-5ML'),
  ('ZDEO-15-15ML'),
  ('ZDEO-16-5ML'),
  ('ZDEO-16-15ML'),
  ('ZDEO-17-5ML'),
  ('ZDEO-17-15ML'),
  ('ZDEO-18-5ML'),
  ('ZDEO-18-15ML'),
  ('ZDEO-19-5ML'),
  ('ZDEO-19-15ML'),
  ('ZDEO-20-5ML'),
  ('ZDEO-20-15ML'),
  ('ZDEO-21-5ML'),
  ('ZDEO-21-15ML'),
  ('ZDEO-22-5ML'),
  ('ZDEO-22-15ML'),
  ('ZDEO-23-5ML'),
  ('ZDEO-23-15ML'),
  ('ZDEO-24-5ML'),
  ('ZDEO-24-15ML'),
  ('ZDEO-25-5ML'),
  ('ZDEO-25-15ML'),
  ('ZDEO-26-5ML'),
  ('ZDEO-26-15ML'),
  ('ZDEO-27-5ML'),
  ('ZDEO-27-15ML'),
  ('ZDEO-28-5ML'),
  ('ZDEO-28-15ML'),
  ('ZDEO-29-5ML'),
  ('ZDEO-29-15ML'),
  ('ZDEO-30-5ML'),
  ('ZDEO-30-15ML'),
  ('ZDEO-31-2ML'),
  ('ZDEO-31-5ML'),
  ('ZDEO-32-2ML'),
  ('ZDEO-32-5ML'),
  ('ZDEO-33-2ML'),
  ('ZDEO-33-5ML'),
  ('ZDEO-34-2ML'),
  ('ZDEO-34-5ML'),
  ('ZDEO-35-2ML'),
  ('ZDEO-35-5ML'),
  ('ZDEO-36-2ML'),
  ('ZDEO-36-5ML'),
  ('ZDEO-37-2ML'),
  ('ZDEO-37-5ML'),
  ('ZDEO-38-2ML'),
  ('ZDEO-38-5ML'),
  ('ZDEO-39-2ML'),
  ('ZDEO-39-5ML'),
  ('ZDEO-40-2ML'),
  ('ZDEO-40-5ML')
)
UPDATE public.product_specs spec
SET on_sale_2c = FALSE
WHERE spec.product_id IN (SELECT id FROM public.products WHERE code LIKE 'ZDEO-%')
  AND spec.sku IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM official_skus WHERE official_skus.sku = spec.sku);

COMMIT;
