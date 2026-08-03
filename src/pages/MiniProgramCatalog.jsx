import { useCallback, useEffect, useMemo, useState } from 'react';
import { Image as ImageIcon, Plus, RefreshCw, Save, Search, ShoppingBag, Trash2, Upload } from 'lucide-react';
import { Card, fmtY } from '../components/ui';
import * as api from '../lib/api';

const CATEGORIES = ['单方精油', '复方精油', '基础油', '纯露'];
const lines = value => String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
let localSpecId = 0;
const newSpec = code => ({ rowKey: `new-${++localSpecId}`, id: null, sku: code ? `${code}-` : '', spec: '', price: '', stock: 0, onSale: false });

function draftFrom(product) {
  return {
    name: product.name || '',
    category: product.cat_2c || CATEGORIES[0],
    origin: product.origin || '',
    extractionMethod: product.extraction_method || '',
    oilId: product.oil_id || '',
    tagline: product.copy_2c || '',
    description: product.description_2c || '',
    usage: product.usage_2c || '',
    cover: product.image_url || '',
    mainGallery: (product.main_gallery_2c || []).join('\n'),
    detailGallery: (product.detail_gallery_2c || []).join('\n'),
    onSale: Boolean(product.on_sale_2c),
    specs: (product.specs || []).filter(spec => String(spec.sku || '').trim()).map(spec => ({
      rowKey: `spec-${spec.id}`,
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

function UploadButton({ label, multiple = false, disabled = false, onFiles }) {
  return <label className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}>
    <Upload size={13} />{label}
    <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple={multiple} disabled={disabled} className="hidden" onChange={event => {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      if (files.length) onFiles(files);
    }} />
  </label>;
}

export default function MiniProgramCatalog() {
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('全部');
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState('');
  const [creating, setCreating] = useState(false);
  const [newProduct, setNewProduct] = useState({ code: '', name: '', category: CATEGORIES[0], origin: '中国' });

  const load = useCallback(async preferredId => {
    setLoading(true); setError('');
    try {
      const data = await api.fetchMiniProgramCatalogAdmin();
      setCatalog(data);
      const products = data.products || [];
      const nextId = preferredId || (selectedId && products.some(product => product.id === selectedId) ? selectedId : products[0]?.id || null);
      setSelectedId(nextId);
      const selected = products.find(product => product.id === nextId);
      setDraft(selected ? draftFrom(selected) : null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { load(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const products = useMemo(() => catalog?.products || [], [catalog]);
  const categoryCounts = useMemo(() => Object.fromEntries(CATEGORIES.map(item => [item, products.filter(product => product.cat_2c === item).length])), [products]);
  const filtered = useMemo(() => products.filter(product =>
    (category === '全部' || product.cat_2c === category)
    && (!search || `${product.code} ${product.name} ${product.cat_2c}`.toLowerCase().includes(search.toLowerCase()))
  ), [products, search, category]);
  const selected = products.find(product => product.id === selectedId) || null;

  const choose = product => {
    setCreating(false);
    setSelectedId(product.id);
    setDraft(draftFrom(product));
    setError('');
  };
  const setField = (key, value) => setDraft(current => ({ ...current, [key]: value }));
  const setSpec = (rowKey, patch) => setDraft(current => ({
    ...current,
    specs: current.specs.map(spec => spec.rowKey === rowKey ? { ...spec, ...patch } : spec)
  }));

  const createProduct = async () => {
    if (saving) return;
    setSaving(true); setError('');
    try {
      const result = await api.createMiniProgramCatalogProduct(newProduct);
      setCreating(false);
      setCategory(newProduct.category);
      setNewProduct({ code: '', name: '', category: newProduct.category, origin: '中国' });
      await load(result.productId);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const upload = async (kind, files) => {
    if (!selected || uploading) return;
    setUploading(kind); setError('');
    try {
      const urls = [];
      for (const file of files) urls.push(await api.uploadMiniProgramCatalogImage(file, selected.code));
      if (kind === 'cover') setField('cover', urls[0]);
      if (kind === 'main') setField('mainGallery', [...lines(draft.mainGallery), ...urls].slice(0, 6).join('\n'));
      if (kind === 'detail') setField('detailGallery', [...lines(draft.detailGallery), ...urls].slice(0, 20).join('\n'));
    } catch (e) {
      setError(e.message);
    } finally {
      setUploading('');
    }
  };

  const save = async () => {
    if (!selected || !draft || saving) return;
    setSaving(true); setError('');
    try {
      await api.updateMiniProgramCatalogProduct(selected.id, {
        name: draft.name,
        category: draft.category,
        origin: draft.origin,
        extractionMethod: draft.extractionMethod,
        oilId: draft.oilId,
        tagline: draft.tagline,
        description: draft.description,
        usage: draft.usage,
        cover: draft.cover.trim(),
        mainGallery: lines(draft.mainGallery),
        detailGallery: lines(draft.detailGallery),
        onSale: draft.onSale,
        specs: draft.specs.map(spec => ({ id: spec.id, sku: spec.sku, spec: spec.spec, price: Number(spec.price), onSale: spec.onSale }))
      });
      setCategory(draft.category);
      await load(selected.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return <div className="space-y-4">
    <div className="grid grid-cols-3 gap-3">
      <Card className="p-4"><div className="text-xs text-gray-500">商品总数</div><div className="text-2xl font-semibold mt-1">{catalog?.summary?.products || 0}</div></Card>
      <Card className="p-4"><div className="text-xs text-gray-500">已上架商品</div><div className="text-2xl font-semibold mt-1 text-green-700">{catalog?.summary?.onSaleProducts || 0}</div></Card>
      <Card className="p-4"><div className="text-xs text-gray-500">已上架 SKU</div><div className="text-2xl font-semibold mt-1 text-purple-700">{catalog?.summary?.onSaleSpecs || 0}</div></Card>
    </div>

    {error && <div className="p-3 rounded-lg bg-red-50 text-sm text-red-600">{error}</div>}

    <div className="grid lg:grid-cols-[132px_270px_minmax(0,1fr)] gap-4 items-start">
      <Card className="overflow-hidden lg:sticky lg:top-0">
        <div className="px-3 py-3 border-b text-xs font-medium text-gray-500">商品分类</div>
        {['全部', ...CATEGORIES].map(item => <button key={item} onClick={() => setCategory(item)} className={`w-full px-3 py-3 flex items-center justify-between text-sm border-b last:border-0 ${category === item ? 'bg-purple-50 text-purple-700 font-medium' : 'text-gray-600 hover:bg-gray-50'}`}>
          <span>{item}</span><span className="text-[10px] text-gray-400">{item === '全部' ? products.length : categoryCounts[item] || 0}</span>
        </button>)}
        <div className="p-2"><button onClick={() => { setCreating(true); setSelectedId(null); setDraft(null); setNewProduct(current => ({ ...current, category: category === '全部' ? CATEGORIES[0] : category })); }} className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg bg-purple-600 text-white text-xs"><Plus size={13} />新增商品</button></div>
      </Card>

      <Card className="overflow-hidden lg:sticky lg:top-0">
        <div className="p-3 border-b flex gap-2">
          <div className="relative flex-1"><Search size={14} className="absolute left-3 top-2.5 text-gray-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="商品名 / 编码" className="w-full border rounded-lg pl-8 pr-3 py-2 text-xs" /></div>
          <button onClick={() => load(selectedId)} disabled={loading} className="w-9 h-9 rounded-lg border flex items-center justify-center text-gray-500 disabled:opacity-40"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
        </div>
        <div className="max-h-[680px] overflow-y-auto">
          {filtered.map(product => <button key={product.id} onClick={() => choose(product)} className={`w-full text-left px-3 py-3 border-b last:border-0 ${selectedId === product.id ? 'bg-purple-50' : 'hover:bg-gray-50'}`}>
            <div className="flex items-center justify-between gap-2"><div className="font-medium text-sm text-gray-800 truncate">{product.name}</div><span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${product.on_sale_2c ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{product.on_sale_2c ? '已上架' : '已下架'}</span></div>
            <div className="text-[11px] text-gray-400 mt-1">{product.code} · {(product.specs || []).filter(spec => spec.on_sale_2c).length}/{(product.specs || []).length} SKU</div>
          </button>)}
          {!loading && !filtered.length && <div className="py-10 text-center text-xs text-gray-400">没有匹配商品</div>}
        </div>
      </Card>

      {creating ? <Card className="p-5 space-y-5">
        <div><div className="font-semibold text-gray-800">新增小程序商品</div><div className="text-xs text-gray-400 mt-1">商品编码创建后不可修改；先建商品，再添加正式 SKU。</div></div>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="text-xs text-gray-500">商品编码<input value={newProduct.code} onChange={event => setNewProduct(current => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="例如 ZDBL-01" className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm font-mono text-gray-800" /></label>
          <label className="text-xs text-gray-500">商品名称<input value={newProduct.name} onChange={event => setNewProduct(current => ({ ...current, name: event.target.value }))} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800" /></label>
          <label className="text-xs text-gray-500">商品分类<select value={newProduct.category} onChange={event => setNewProduct(current => ({ ...current, category: event.target.value }))} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm bg-white">{CATEGORIES.map(item => <option key={item}>{item}</option>)}</select></label>
          <label className="text-xs text-gray-500">产地<input value={newProduct.origin} onChange={event => setNewProduct(current => ({ ...current, origin: event.target.value }))} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800" /></label>
        </div>
        <div className="flex gap-2"><button onClick={createProduct} disabled={saving} className="px-4 py-2 rounded-lg bg-purple-600 text-white text-sm disabled:opacity-40">{saving ? '创建中' : '创建商品'}</button><button onClick={() => setCreating(false)} className="px-4 py-2 rounded-lg border text-sm text-gray-500">取消</button></div>
      </Card> : selected && draft ? <div className="space-y-4">
        <Card className="p-5">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div><div className="flex items-center gap-2 font-semibold text-gray-800"><ShoppingBag size={18} className="text-purple-600" />{selected.code}</div><div className="text-xs text-gray-400 mt-1">保存后自动进入发布队列，通常 5 分钟内同步到微信商城。</div></div>
            <div className="flex items-center gap-2"><button type="button" onClick={() => setField('onSale', !draft.onSale)} className={`px-3 py-2 rounded-lg text-sm border ${draft.onSale ? 'bg-green-50 border-green-300 text-green-700' : 'bg-white border-gray-200 text-gray-500'}`}>{draft.onSale ? '整件已上架' : '整件已下架'}</button><button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 text-white text-sm disabled:opacity-40"><Save size={14} />{saving ? '保存中' : '保存并发布'}</button></div>
          </div>
        </Card>

        <Card className="p-5 space-y-4">
          <div className="font-semibold text-gray-800">商品内容</div>
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="text-xs text-gray-500">商品名称<input value={draft.name} onChange={event => setField('name', event.target.value)} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800" /></label>
            <label className="text-xs text-gray-500">商品分类<select value={draft.category} onChange={event => setField('category', event.target.value)} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm bg-white">{CATEGORIES.map(item => <option key={item}>{item}</option>)}</select></label>
            <label className="text-xs text-gray-500">产地<input value={draft.origin} onChange={event => setField('origin', event.target.value)} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800" /></label>
            <label className="text-xs text-gray-500">提取方式<input value={draft.extractionMethod} onChange={event => setField('extractionMethod', event.target.value)} placeholder="蒸馏 / 冷压" className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800" /></label>
          </div>
          <label className="block text-xs text-gray-500">一句话说明<input value={draft.tagline} onChange={event => setField('tagline', event.target.value)} maxLength={160} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800" /></label>
          <div className="grid sm:grid-cols-2 gap-4"><label className="text-xs text-gray-500">商品介绍<textarea value={draft.description} onChange={event => setField('description', event.target.value)} rows={5} maxLength={1000} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800 resize-y" /></label><label className="text-xs text-gray-500">使用说明<textarea value={draft.usage} onChange={event => setField('usage', event.target.value)} rows={5} maxLength={1500} className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800 resize-y" /></label></div>
        </Card>

        <Card className="p-5 space-y-4">
          <div className="flex items-center gap-2 font-semibold text-gray-800"><ImageIcon size={17} className="text-purple-600" />商品图片</div>
          <div className="grid sm:grid-cols-[220px_minmax(0,1fr)] gap-4"><ImagePreview url={draft.cover.trim()} label="尚未上传商品主图" /><div className="space-y-2"><label className="block text-xs text-gray-500">商品主图链接<input value={draft.cover} onChange={event => setField('cover', event.target.value)} placeholder="上传后自动填写，也可粘贴 https:// 地址" className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm text-gray-800" /></label><UploadButton label={uploading === 'cover' ? '上传中' : '上传主图'} disabled={Boolean(uploading)} onFiles={files => upload('cover', files.slice(0, 1))} /></div></div>
          <div className="grid sm:grid-cols-2 gap-4"><div><label className="text-xs text-gray-500">详情页轮播图<textarea value={draft.mainGallery} onChange={event => setField('mainGallery', event.target.value)} rows={5} placeholder="每行一个地址，最多 6 张" className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm font-mono text-gray-700 resize-y" /></label><div className="mt-2"><UploadButton label={uploading === 'main' ? '上传中' : '上传轮播图'} multiple disabled={Boolean(uploading)} onFiles={files => upload('main', files)} /></div></div><div><label className="text-xs text-gray-500">详情页内容图<textarea value={draft.detailGallery} onChange={event => setField('detailGallery', event.target.value)} rows={5} placeholder="每行一个地址，最多 20 张" className="mt-1.5 w-full border rounded-lg px-3 py-2.5 text-sm font-mono text-gray-700 resize-y" /></label><div className="mt-2"><UploadButton label={uploading === 'detail' ? '上传中' : '上传内容图'} multiple disabled={Boolean(uploading)} onFiles={files => upload('detail', files)} /></div></div></div>
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 py-4 border-b flex items-start justify-between gap-3"><div><div className="font-semibold text-gray-800">SKU、价格与上架状态</div><div className="text-xs text-gray-400 mt-1">商城只显示有正式编号的 SKU；移除只退出商城，不删除库存和历史记录。</div></div><button onClick={() => setField('specs', [...draft.specs, newSpec(selected.code)])} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs text-purple-700"><Plus size={13} />增加 SKU</button></div>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[760px]">
            <thead><tr className="border-b bg-gray-50/80">{['SKU 编号','规格','当前库存','商城售价','商城状态',''].map(title => <th key={title || 'actions'} className={`px-4 py-2.5 text-xs font-medium text-gray-500 ${['当前库存','商城售价'].includes(title) ? 'text-right' : 'text-left'}`}>{title}</th>)}</tr></thead>
            <tbody>{draft.specs.map(spec => <tr key={spec.rowKey} className="border-b last:border-0">
              <td className="px-4 py-3"><input value={spec.sku} onChange={event => setSpec(spec.rowKey, { sku: event.target.value.toUpperCase() })} placeholder={`${selected.code}-5ML`} className="w-36 border rounded-lg px-2.5 py-2 font-mono text-xs" /></td>
              <td className="px-4 py-3"><input value={spec.spec} onChange={event => setSpec(spec.rowKey, { spec: event.target.value })} placeholder="5ml" className="w-24 border rounded-lg px-2.5 py-2" /></td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-500">{spec.stock}</td>
              <td className="px-4 py-3"><div className="flex justify-end items-center gap-1"><span className="text-gray-400">¥</span><input type="number" min="0.01" step="0.01" value={spec.price} onChange={event => setSpec(spec.rowKey, { price: event.target.value })} className="w-24 border rounded-lg px-2.5 py-2 text-right tabular-nums" /></div></td>
              <td className="px-4 py-3"><button type="button" onClick={() => setSpec(spec.rowKey, { onSale: !spec.onSale })} className={`px-2.5 py-1 rounded-full text-xs border ${spec.onSale ? 'bg-purple-50 border-purple-300 text-purple-700' : 'bg-white border-gray-200 text-gray-400'}`}>{spec.onSale ? `上架 · ${fmtY(spec.price)}` : '下架'}</button></td>
              <td className="px-4 py-3 text-right"><button title="从商城规格中移除" onClick={() => setField('specs', draft.specs.filter(item => item.rowKey !== spec.rowKey))} className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600"><Trash2 size={14} /></button></td>
            </tr>)}{!draft.specs.length && <tr><td colSpan={6} className="py-10 text-center text-xs text-gray-400">暂无商城 SKU，请先增加正式编号规格</td></tr>}</tbody>
          </table></div>
        </Card>
      </div> : <Card className="p-12 text-center text-sm text-gray-400">请选择或新增商品</Card>}
    </div>
  </div>;
}
