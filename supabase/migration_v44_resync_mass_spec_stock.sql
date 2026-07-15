-- ZIDU v44: 修复重量原料已有 kg 库存、销售规格仍显示 0 的派生库存。
-- 只重算 product_specs.stock；不会改变 products.base_stock_kg、价格或订单。

DO $$
DECLARE
  v_product RECORD;
BEGIN
  IF to_regprocedure('public.zidu_sync_mass_spec_stock(integer)') IS NULL THEN
    RAISE EXCEPTION '缺少重量库存同步函数，请先运行 migration_v19_mass_inventory.sql';
  END IF;

  FOR v_product IN
    SELECT id
    FROM public.products
    WHERE inventory_mode = 'MASS'
    ORDER BY id
  LOOP
    PERFORM public.zidu_sync_mass_spec_stock(v_product.id);
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

SELECT
  count(DISTINCT p.id) FILTER (WHERE p.inventory_mode = 'MASS') AS mass_products,
  count(*) FILTER (
    WHERE p.inventory_mode = 'MASS'
      AND public.zidu_spec_mass_kg(s.spec, p.density_g_ml) IS NOT NULL
      AND s.stock > 0
  ) AS available_mass_specs,
  count(*) FILTER (
    WHERE p.inventory_mode = 'MASS'
      AND public.zidu_spec_mass_kg(s.spec, p.density_g_ml) IS NOT NULL
      AND s.stock = 0
  ) AS unavailable_mass_specs
FROM public.products p
LEFT JOIN public.product_specs s ON s.product_id = p.id;
