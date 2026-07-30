import { useEffect, useMemo, useState } from 'react';
import { Archive, BookOpen, ChevronRight, PackagePlus, Plus, Save, Search, ShoppingBag, Trash2, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, fmtY } from '../components/ui';
import { recipeAvailableQuantity } from '../lib/recipes';

function blankComponent() {
  return {
    rowKey: `component-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    productId: '',
    specId: '',
    quantity: ''
  };
}

function blankRecipe() {
  return {
    id: null,
    skuCode: '',
    name: '',
    spec: '',
    price: '',
    notes: '',
    status: 'ACTIVE',
    components: [blankComponent()]
  };
}

function recipeSpecMl(spec) {
  const match = String(spec || '').trim().match(/^([0-9]+(?:\.[0-9]+)?)/);
  return match ? match[1] : '';
}

function recipeForm(recipe) {
  return {
    id: recipe.id,
    skuCode: recipe.skuCode,
    name: recipe.name,
    spec: recipeSpecMl(recipe.spec),
    price: recipe.price === 0 ? '' : String(recipe.price),
    notes: recipe.notes || '',
    status: recipe.status,
    components: recipe.components.map(component => ({
      ...component,
      rowKey: `component-${component.id}`,
      productId: String(component.productId),
      specId: String(component.specId),
      quantity: String(component.quantity)
    }))
  };
}

function ComponentPicker({ value, options, excludedProductIds, onSelect }) {
  const selected = options.find(option => String(option.productId) === String(value));
  const [query, setQuery] = useState(selected?.label || '');
  const [open, setOpen] = useState(false);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return options
      .filter(option => !excludedProductIds.has(String(option.productId)) || String(option.productId) === String(value))
      .filter(option => !keyword || option.searchText.includes(keyword))
      .slice(0, 24);
  }, [excludedProductIds, options, query, value]);

  return (
    <div className="relative min-w-0">
      <Search size={15} className="absolute left-3 top-2.5 text-gray-400 pointer-events-none" />
      <input
        value={query}
        onFocus={event => { event.target.select(); setOpen(true); }}
        onChange={event => { setQuery(event.target.value); setOpen(true); }}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        placeholder="搜索原料编号 / 名称"
        className="w-full h-10 pl-9 pr-9 border rounded-lg text-sm bg-white"
      />
      {value && (
        <button
          type="button"
          onMouseDown={event => event.preventDefault()}
          onClick={() => { onSelect(null); setQuery(''); setOpen(true); }}
          title="清除选择"
          className="absolute right-2 top-2 zidu-icon-button !w-6 !h-6"
        >
          <X size={13} />
        </button>
      )}
      {open && (
        <div className="absolute left-0 right-0 top-11 z-30 max-h-64 overflow-y-auto rounded-lg border bg-white shadow-lg">
          {filtered.map(option => (
            <button
              key={option.productId}
              type="button"
              onMouseDown={event => event.preventDefault()}
              onClick={() => { onSelect(option); setQuery(option.label); setOpen(false); }}
              className="w-full px-3 py-2.5 text-left border-b last:border-0 hover:bg-purple-50"
            >
              <div className="text-sm text-gray-800">{option.productName}</div>
              <div className="mt-0.5 flex items-center justify-between gap-3 text-xs text-gray-400">
                <span>{option.productCode}</span>
                <span>{option.stockLabel}</span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <div className="px-3 py-6 text-center text-sm text-gray-400">没有匹配的原料</div>}
        </div>
      )}
    </div>
  );
}

export default function Recipes({ onOrder }) {
  const { user } = useAuth();
  const { products, recipes, saveRecipe, archiveRecipe, reloadRecipes } = useData();
  const [form, setForm] = useState(blankRecipe);
  const [selectedId, setSelectedId] = useState(null);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingError, setLoadingError] = useState('');

  useEffect(() => {
    reloadRecipes().catch(error => setLoadingError(error.message));
  }, [reloadRecipes]);

  const componentOptions = useMemo(() => products
    .filter(product => ['RAW', 'BOTH'].includes(product.channel))
    .filter(product => product.inventoryMode === 'MASS' && Number(product.densityGml || 0) > 0)
    .map(product => {
      const spec = (product.specs || [])[0];
      if (!spec) return null;
      const density = Number(product.densityGml);
      const stockMl = Number(product.baseStockKg || 0) * 1000 / density;
      const label = `${product.code} · ${product.name}`;
      return {
        productId: product.id,
        specId: spec.id,
        productCode: product.code,
        productName: product.name,
        label,
        searchText: label.toLowerCase(),
        stockLabel: `${stockMl.toFixed(1)} ml`
      };
    })
    .filter(Boolean), [products]);

  const filteredRecipes = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return recipes.filter(recipe => {
      if (!showArchived && recipe.status !== 'ACTIVE') return false;
      return !keyword || `${recipe.skuCode} ${recipe.name} ${recipe.spec} ${recipe.ownerName}`.toLowerCase().includes(keyword);
    });
  }, [recipes, search, showArchived]);

  const formRecipeForStock = useMemo(() => ({
    ...form,
    components: form.components
      .filter(component => component.specId && Number(component.quantity) > 0)
      .map(component => ({
        productId: Number(component.productId),
        specId: Number(component.specId),
        quantity: Number(component.quantity)
      }))
  }), [form]);
  const availableQuantity = recipeAvailableQuantity(formRecipeForStock, products);
  const canOrder = user.role === 'ADMIN' || user.role === 'SALES';

  const selectRecipe = recipe => {
    setSelectedId(recipe.id);
    setForm(recipeForm(recipe));
    setLoadingError('');
  };

  const startNew = () => {
    setSelectedId(null);
    setForm(blankRecipe());
    setLoadingError('');
  };

  const updateComponent = (rowKey, fields) => {
    setForm(current => ({
      ...current,
      components: current.components.map(component => component.rowKey === rowKey ? { ...component, ...fields } : component)
    }));
  };

  const removeComponent = rowKey => {
    setForm(current => {
      const remaining = current.components.filter(component => component.rowKey !== rowKey);
      return { ...current, components: remaining.length ? remaining : [blankComponent()] };
    });
  };

  const handleSave = async () => {
    const specMl = Number(form.spec);
    if (!form.name.trim() || !(specMl > 0) || !(Number(form.price) > 0)) {
      alert('请填写配方名称、成品规格和售价');
      return;
    }
    const validComponents = form.components.filter(component => component.productId && component.specId && Number(component.quantity) > 0);
    if (!validComponents.length || validComponents.length !== form.components.length) {
      alert('请完整选择组成原料并填写 ml 用量');
      return;
    }
    setSaving(true);
    try {
      const result = await saveRecipe({ ...form, spec: `${specMl}ml`, components: validComponents });
      setSelectedId(Number(result.id));
      const rows = await reloadRecipes();
      const saved = rows.find(recipe => recipe.id === Number(result.id));
      if (saved) setForm(recipeForm(saved));
      setLoadingError('');
    } catch (error) {
      alert(error.message || '保存配方失败');
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async () => {
    if (!form.id || !window.confirm(`归档配方「${form.name}」？`)) return;
    try {
      await archiveRecipe(form.id);
      startNew();
    } catch (error) {
      alert(error.message || '归档失败');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-lg font-semibold text-gray-800">配方库</div>
          <div className="text-xs text-gray-400 mt-1">{user.isSuperAdmin ? `全部配方 · ${recipes.length}` : `我的配方 · ${recipes.length}`}</div>
        </div>
        <div className="flex items-center gap-2">
          {canOrder && (
            <button onClick={onOrder} className="h-9 px-3 rounded-lg border bg-white text-sm text-purple-700 inline-flex items-center gap-1.5">
              <ShoppingBag size={15} />销售下单
            </button>
          )}
          <button onClick={startNew} className="btn-primary !h-9 !py-0 text-sm">
            <Plus size={15} />新建配方
          </button>
        </div>
      </div>

      {loadingError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{loadingError}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-4 items-start">
        <Card className="p-0 overflow-hidden lg:sticky lg:top-0">
          <div className="p-3 border-b space-y-2">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-2.5 text-gray-400" />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索配方 / SKU" className="w-full h-9 pl-9 pr-3 border rounded-lg text-sm" />
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-500">
              <input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)} />
              显示已归档
            </label>
          </div>
          <div className="max-h-[calc(100vh-250px)] overflow-y-auto">
            {filteredRecipes.map(recipe => (
              <button
                key={recipe.id}
                onClick={() => selectRecipe(recipe)}
                className={`w-full p-3 border-b last:border-0 text-left flex items-center gap-3 hover:bg-purple-50 ${selectedId === recipe.id ? 'bg-purple-50' : ''}`}
              >
                <div className="w-8 h-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0"><BookOpen size={15} /></div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-800 truncate">{recipe.name}</div>
                  <div className="text-xs text-gray-400 truncate">{recipe.skuCode} · {recipe.spec} · {fmtY(recipe.price)}</div>
                  {user.isSuperAdmin && <div className="text-[11px] text-gray-400 mt-0.5">{recipe.ownerName}</div>}
                </div>
                {recipe.status === 'ARCHIVED' ? <Archive size={14} className="text-gray-300" /> : <ChevronRight size={15} className="text-gray-300" />}
              </button>
            ))}
            {filteredRecipes.length === 0 && <div className="py-12 text-center text-sm text-gray-400">暂无配方</div>}
          </div>
        </Card>

        <Card className="p-0 overflow-visible">
          <div className="px-4 py-3 border-b flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-800">{form.id ? form.name : '新建配方'}</div>
              <div className="text-xs text-gray-400 mt-0.5">{form.skuCode || 'SKU 保存后生成'}</div>
            </div>
            {form.status === 'ARCHIVED' && <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-500">已归档</span>}
          </div>

          <div className="p-4 space-y-5">
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">配方名称 *</label>
                <input value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="如：安眠舒缓复方" className="w-full h-10 border rounded-lg px-3 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">成品规格 *</label>
                <div className="relative">
                  <input type="number" min="0.1" step="0.1" value={form.spec} onFocus={event => event.target.select()} onChange={event => setForm(current => ({ ...current, spec: event.target.value }))} placeholder="10" className="w-full h-10 border rounded-lg pl-3 pr-12 text-sm" />
                  <span className="absolute right-3 top-2.5 text-xs text-gray-400">ml</span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">售价 *</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-sm text-gray-400">¥</span>
                  <input type="number" min="0.01" step="0.01" value={form.price} onFocus={event => event.target.select()} onChange={event => setForm(current => ({ ...current, price: event.target.value }))} placeholder="0.00" className="w-full h-10 border rounded-lg pl-7 pr-3 text-sm" />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1.5">备注</label>
              <textarea value={form.notes} onChange={event => setForm(current => ({ ...current, notes: event.target.value }))} rows={2} placeholder="选填" className="w-full border rounded-lg px-3 py-2 text-sm" />
            </div>

            <div className="border-t pt-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <div>
                  <div className="text-sm font-semibold text-gray-800">组成原料</div>
                  <div className="text-xs text-gray-400 mt-0.5">当前可制作 {availableQuantity} 份</div>
                </div>
                <button type="button" onClick={() => setForm(current => ({ ...current, components: [...current.components, blankComponent()] }))} className="h-9 px-3 border rounded-lg text-sm text-purple-700 inline-flex items-center gap-1.5 self-start sm:self-auto">
                  <PackagePlus size={15} />添加原料
                </button>
              </div>

              <div className="space-y-2">
                {form.components.map((component, index) => {
                  const excludedProductIds = new Set(form.components.filter(item => item.rowKey !== component.rowKey && item.productId).map(item => String(item.productId)));
                  return (
                    <div key={component.rowKey} className="grid grid-cols-1 md:grid-cols-[34px_minmax(0,1fr)_160px_36px] gap-2 md:items-center rounded-lg border p-2.5 bg-gray-50/50">
                      <div className="w-7 h-7 rounded-md bg-white border flex items-center justify-center text-xs text-gray-500">{index + 1}</div>
                      <ComponentPicker
                        value={component.productId}
                        options={componentOptions}
                        excludedProductIds={excludedProductIds}
                        onSelect={option => updateComponent(component.rowKey, option ? {
                          productId: String(option.productId),
                          specId: String(option.specId),
                          quantity: component.quantity
                        } : { productId: '', specId: '' })}
                      />
                      <div className="relative">
                        <input
                          type="number"
                          min="0.001"
                          step="0.1"
                          value={component.quantity}
                          onFocus={event => event.target.select()}
                          onChange={event => updateComponent(component.rowKey, { quantity: event.target.value })}
                          placeholder="用量"
                          className="w-full h-10 border rounded-lg pl-3 pr-16 text-sm bg-white"
                        />
                        <span className="absolute right-3 top-2.5 text-xs text-gray-400">ml</span>
                      </div>
                      <button type="button" onClick={() => removeComponent(component.rowKey)} title="删除组成原料" className="zidu-icon-button !w-9 !h-9 text-gray-400 hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="px-4 py-3 border-t flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2 bg-gray-50/70">
            <div>
              {form.id && form.status === 'ACTIVE' && (
                <button onClick={handleArchive} className="h-9 px-3 border border-gray-200 rounded-lg text-sm text-gray-500 inline-flex items-center gap-1.5">
                  <Archive size={14} />归档
                </button>
              )}
            </div>
            <button onClick={handleSave} disabled={saving} className="btn-primary !h-9 !py-0 text-sm min-w-28">
              <Save size={15} />{saving ? '保存中...' : '保存配方'}
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
}
