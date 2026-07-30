function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function recipeAvailableQuantity(recipe, products) {
  const components = Array.isArray(recipe?.components) ? recipe.components : [];
  if (components.length === 0) return 0;

  let available = Number.MAX_SAFE_INTEGER;
  for (const component of components) {
    const product = products.find(item => Number(item.id) === Number(component.productId));
    const spec = product?.specs?.find(item => Number(item.id) === Number(component.specId));
    const required = finiteNumber(component.quantity);
    if (!product || !spec || required <= 0) return 0;

    if (product.inventoryMode === 'MASS') {
      const density = finiteNumber(product.densityGml);
      const stockKg = Math.max(0, finiteNumber(product.baseStockKg));
      if (density <= 0) return 0;
      const availableMl = stockKg * 1000 / density;
      available = Math.min(available, Math.floor((availableMl + 1e-9) / required));
    } else {
      const stock = Math.max(0, finiteNumber(spec.stock));
      available = Math.min(available, Math.floor((stock + 1e-9) / required));
    }
  }

  return Number.isFinite(available) ? Math.max(0, available) : 0;
}

export function recipeCatalogProduct(recipe, products) {
  const stock = recipeAvailableQuantity(recipe, products);
  return {
    id: `recipe-${recipe.id}`,
    recipeId: Number(recipe.id),
    code: recipe.skuCode,
    name: recipe.name,
    series: '配方库',
    origin: recipe.ownerName || '自建配方',
    channel: 'FINISHED',
    inventoryMode: 'RECIPE',
    specs: [{
      id: `recipe-spec-${recipe.id}`,
      recipeId: Number(recipe.id),
      spec: recipe.spec,
      price: finiteNumber(recipe.price),
      cost: 0,
      stock,
      safeStock: 0
    }]
  };
}

export function activeRecipeCatalog(recipes, products) {
  return (recipes || [])
    .filter(recipe => recipe.status === 'ACTIVE')
    .map(recipe => recipeCatalogProduct(recipe, products));
}
