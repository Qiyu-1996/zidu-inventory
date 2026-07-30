function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function recipeYieldMl(recipe) {
  const match = String(recipe?.spec || '').trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*ml$/i);
  return match ? finiteNumber(match[1]) : 0;
}

export function recipeAvailableQuantity(recipe, products) {
  const components = Array.isArray(recipe?.components) ? recipe.components : [];
  const yieldMl = recipeYieldMl(recipe);
  if (components.length === 0 || yieldMl <= 0) return 0;

  let available = Number.MAX_SAFE_INTEGER;
  for (const component of components) {
    const product = products.find(item => Number(item.id) === Number(component.productId));
    const spec = product?.specs?.find(item => Number(item.id) === Number(component.specId));
    const required = finiteNumber(component.quantity);
    if (!product || !spec || required <= 0) return 0;
    if (!['RAW', 'BOTH'].includes(product.channel) || product.inventoryMode !== 'MASS') return 0;

    const density = finiteNumber(product.densityGml);
    const stockKg = Math.max(0, finiteNumber(product.baseStockKg));
    if (density <= 0) return 0;
    const availableMl = stockKg * 1000 / density;
    const finishedMl = availableMl * yieldMl / required;
    available = Math.min(available, Math.floor(finishedMl + 1e-9));
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
    series: '配方',
    origin: recipe.ownerName || '自建配方',
    channel: 'RAW',
    inventoryMode: 'RECIPE',
    availableMl: stock,
    specs: [{
      id: `recipe-spec-${recipe.id}`,
      recipeId: Number(recipe.id),
      spec: '1ml',
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
