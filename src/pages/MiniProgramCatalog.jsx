import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, RefreshCw, Save, Search, ShoppingBag } from 'lucide-react';
import { Card, fmtY } from '../components/ui';
import * as api from '../lib/api';

const lines = value => String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);

function draftFrom(product) {
  return {
    name: product.name || '',
    category: product.cat_2c || '',
    tagline: product.copy_2c || '',
    description: product.description_2c || '',
    usage: product.usage_2c || '',
    cover: product.image_url || '',
    mainGallery: (product.main_gallery_2c || []).join('\n'),
    detailGallery: (product.detail_gallery_2c || []).join('\n'),
    onSale: Boolean(product.on_sale_2c),
    specs: (product.specs || []).map(spec => ({
      id: spec.id,
      sku: spec.sku || '',
      spec: spec.spec || '',
      price: Number(spec.price || 0),
      stock: Number(spec.stock || 0),
      onSale: Boolean(spec.on_sale_2c)
    }))
  };
}

function ImagePreview({ url, label }) {
  if (!url) return <div className="h-28 rounded-lg border border-dashed flex items-center justify-center text-xs text-gray-400">{label}</div>;
  if (!/^https:\/\//.test(url)) return <div className="h-28 rounded-lg border bg-gray-50 px-3 flex items-center text-xs text-gray-500 break-all">{url}</div>;
  return <div className="h-28 rounded-lg border bg-gray-50 overflow-hidden"><img src={url} alt={label} className="w-full h-full object-contain" /></div>;
}

export default function MiniProgramCatalog() {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (keepSelection = true) => {
    setLoading(true); setError('');
    try {
      const data = await api.fetchMiniProgramCatalogAdmin();
      setCatalog(data);
      const nextId = keepSelection && selectedId
        ? selectedId
        : (data.products?.[0]?.id || null);
      setSelectedId(nextId);
      const selected = (data.products || []).find(product => product.id === nextId);
      setDraft(selected ? draftFrom(selected) : null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { load(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const products = useMemo(() => catalog?.products || [], [catalog]);
  const filtered = useMemo(() => products.filter(product =>
    !search || `${product.code} ${product.name} ${product.cat_2c}`.toLowerCase().includes(search.toLowerCase())
  ), [products, search]);
  const selected = products.find(product => product.id === selectedId) || null;

  const choose = product => {
    setSelectedId(product.id);
    setDraft(draftFrom(product));
    setError('');
  };

  const setField = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const setSpec = (id, patch) => setDraft(current => ({
    ...current,
    specs: current.specs.map(spec => spec.id === id ? { ...spec, ...patch } : spec)
  }));

  const save = async () => {
    if (!selected || !draft || saving) return;
    setSaving(true); setError('');
    try {
      await api.updateMiniProgramCatalogProduct(selected.id, {
        name: draft.name,
        category: draft.category,
        tagline: draft.tagline,
        description: draft.description,
        usage: draft.usage,
        cover: draft.cover.trim(),
        mainGallery: lines(draft.mainGallery),
        detailGallery: lines(draft.detailGallery),
        onSale: draft.onSale,
        specs: draft.specs.map(spec => ({ id: spec.id, price: Number(spec.price), onSale: spec.onSale }))
      });
      await load(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4"><div className="text-xs text-gray-500">商品总数</div><div className="text-2xl font-semibold mt-1">{catalog?.summary?.products || 0}</div></Card>
        <Card className="p-4"><div className="text-xs text-gray-500">已上架商品</div><div className="text-2xl font-semibold mt-1 text-green-700">{catalog?.summary?.onSaleProducts || 0}</div></Card>
        <Card className="p-4"><div className="text-xs text-gray-500">已上架规格</div><div className="text-2xl font-semibold mt-1 text-purple-700">{catalog?.summary?.onSaleSpecs || 0}</div></Card>
      </div>

      {error && <div className="p-3 rounded-lg bg-red-50 text-sm text-red-600">{error}</div>}

      <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-4 items-start">
        <Card className="overflow-hidden lg:sticky lg:top-0">
          <div className="p-3 border-b flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-2.5 text-gray-400" />
              <input value={search} onChange={event => setSearch(event.target.value)} placeholder="商品名 / 编码" className="w-full border rounded-lg pl-8 pr-3 py-2 text-xs" />
            </div>
            <button onClick={() => load(true)} disabled={loading} className="w-9 h-9 rounded-lg border flex items-center justify-center text-gray-500 disabled:opacity-40"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
          </div>
          <div className="max-h-[680px] overflow-y-auto">
            {filtered.map(product => <button key={product.id} onClick={() => choose(product)} className={`w-full text-left px-3 py-3 border-b last:border-0 ${selectedId === product.id ? 'bg-purple-50' : 'hover:bg-gray-50'}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium text-sm text-gray-800 truncate">{product.name}</div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${product.on_sale_2c ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{product.on_sale_2c ? '已上架' : '已下架'}</span>
              </div>
              <div className="text-[11px] text-gray-400 mt-1">{product.code} · {(product.specs || []).filter(spec => spec.on_sale_2c).length}/{(product.specs || []).length} 规格</div>
            </button>)}
            {!loading && !filtered.length && <div className="py-10 text-center text-xs text-gray-400">没有匹配商品</div>}
          </div>
        </Card>

        {selected && draft ? <div className="space-y-4">
          <Card className="p-5">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 font-semibold text-gray-800"><ShoppingBag size={18} className="text-purple-600" />{selected.code}</div>
                <div className="text-xs text-gray-400 mt-1">保存后由发布任务自动同步到微信商城，通常在 1 小时内生效。</div>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setField('onSale', !draft.onSale)} className={`px-3 py-2 rounded-lg text-sm border ${draft.onSale ? 'bg-green-50 border-green-300 text-green-700' : 'bg-white border-gray-200 text-gray-500'}`}>{draft.onSale ? '整件已上架' : '整件已下架'}</button>
                <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 text-white text-sm disabled:opacity-40"><Save size={14} />{saving ? '保存中' : '保存发布设置'}</button>
              </div>
            </div>
          </Card>

          <Card className="p-5 space-y-4">
            <div className="font-semibold text-gray-800">商品文字</div>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="text-xs text-gray-500">商品名称<input value={draft.name} onChange={event => setField('name', event.target.value)} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800" /></label>
              <label className="text-xs text-gray-500">小程序分类<input value={draft.category} onChange={event => setField('category', event.target.value)} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800" /></label>
            </div>
            <label className="block text-xs text-gray-500">一句话说明<input value={draft.tagline} onChange={event => setField('tagline', event.target.value)} maxLength={160} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800" /></label>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="text-xs text-gray-500">商品介绍<textarea value={draft.description} onChange={event => setField('description', event.target.value)} rows={5} maxLength={1000} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800 resize-y" /></label>
              <label className="text-xs text-gray-500">使用说明<textarea value={draft.usage} onChange={event => setField('usage', event.target.value)} rows={5} maxLength={1500} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800 resize-y" /></label>
            </div>
          </Card>

          <Card className="p-5 space-y-4">
            <div className="flex items-center gap-2 font-semibold text-gray-800"><ImageIcon size={17} className="text-purple-600" />商品图片</div>
            <div className="grid sm:grid-cols-[220px_minmax(0,1fr)] gap-4">
              <ImagePreview url={draft.cover.trim()} label="尚未填写商品主图" />
              <label className="text-xs text-gray-500">商品主图链接<input value={draft.cover} onChange={event => setField('cover', event.target.value)} placeholder="https:// 或 cloud://" className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800" /><span className="block mt-2 text-[11px] text-gray-400">用于首页、选品缩略图和商品详情首图；建议使用现有腾讯云公开地址。</span></label>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="text-xs text-gray-500">详情页轮播图<textarea value={draft.mainGallery} onChange={event => setField('mainGallery', event.target.value)} rows={5} placeholder="每行一个图片地址，最多 6 张" className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm font-mono text-gray-700 resize-y" /></label>
              <label className="text-xs text-gray-500">详情页内容图<textarea value={draft.detailGallery} onChange={event => setField('detailGallery', event.target.value)} rows={5} placeholder="每行一个图片地址，按顺序展示，最多 20 张" className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm font-mono text-gray-700 resize-y" /></label>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="px-5 py-4 border-b"><div className="font-semibold text-gray-800">规格、价格与上架状态</div><div className="text-xs text-gray-400 mt-1">这里只改商城售价和是否可购买，不改库存数量与成本。</div></div>
            <div className="overflow-x-auto"><table className="w-full text-sm min-w-[620px]">
              <thead><tr className="border-b bg-gray-50/80">{['SKU','规格','当前库存','商城售价','商城状态'].map(title => <th key={title} className={`px-4 py-2.5 text-xs font-medium text-gray-500 ${['当前库存','商城售价'].includes(title) ? 'text-right' : 'text-left'}`}>{title}</th>)}</tr></thead>
              <tbody>{draft.specs.map(spec => <tr key={spec.id} className="border-b last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{spec.sku || '—'}</td>
                <td className="px-4 py-3 font-medium">{spec.spec}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">{spec.stock}</td>
                <td className="px-4 py-3"><div className="flex justify-end items-center gap-1"><span className="text-gray-400">¥</span><input type="number" min="0.01" step="0.01" value={spec.price} onChange={event => setSpec(spec.id, { price: event.target.value })} className="w-24 border rounded-lg px-2.5 py-2 text-right tabular-nums" /></div></td>
                <td className="px-4 py-3"><button type="button" onClick={() => setSpec(spec.id, { onSale: !spec.onSale })} className={`px-2.5 py-1 rounded-full text-xs border ${spec.onSale ? 'bg-purple-50 border-purple-300 text-purple-700' : 'bg-white border-gray-200 text-gray-400'}`}>{spec.onSale ? `上架 · ${fmtY(spec.price)}` : '下架'}</button></td>
              </tr>)}</tbody>
            </table></div>
          </Card>
        </div> : <Card className="p-12 text-center text-sm text-gray-400">请选择商品</Card>}
      </div>
    </div>
  );
}
