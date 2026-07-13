import { Fragment, useState, useEffect, useMemo } from 'react';
import { Search, Edit2, Download, Package, X, AlertTriangle, ClipboardCopy, Boxes, CalendarClock, SlidersHorizontal, ClipboardList, Save } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, fmtY, PRODUCT_CATEGORY_OPTIONS, matchesProductCategory, exportCSV, today } from '../components/ui';
import * as api from '../lib/api';
import { defaultDensityForProduct } from '../lib/densityDefaults';

const REASONS = {
  PURCHASE: '采购入库', RETURN: '退货入库', DAMAGE: '损耗/报废',
  CORRECTION: '盘点修正', ORDER: '销售出库', CANCEL_RESTORE: '取消订单回库', OTHER: '其他'
};
const TYPE_LABEL = { IN: '入库', OUT: '出库', CORRECTION: '修正' };
const TYPE_CLS = { IN: 'bg-green-100 text-green-700', OUT: 'bg-red-100 text-red-700', CORRECTION: 'bg-purple-100 text-purple-700' };

function level(stock, safe) {
  if (stock <= 0) return 'out';
  if (stock <= safe) return 'low';
  if (stock <= safe * 2) return 'warn';
  return 'ok';
}
function isRawProduct(product) {
  return product?.channel === 'RAW';
}
const STOCK_PILL = {
  ok: 'bg-green-50 text-green-700 border border-green-200',
  warn: 'bg-amber-50 text-amber-700 border border-amber-200',
  low: 'bg-red-50 text-red-700 border border-red-200',
  out: 'bg-red-600 text-white'
};

export default function Inventory({ nav }) {
  const { user } = useAuth();
  const { products, stockLog, loadStockLog, adjustStock, adjustRawStock, addBatch, removeBatch } = useData();
  const isAdmin = user.role === 'ADMIN';
  const canAdjust = user.role === 'ADMIN' || user.role === 'WAREHOUSE';

  const [tab, setTab] = useState('list');
  const [search, setSearch] = useState('');
  const [stockKind, setStockKind] = useState('RAW');
  const [sf, setSf] = useState('ALL');
  const [lowOnly, setLowOnly] = useState(false);

  const [adjustFor, setAdjustFor] = useState(null);
  const [adjType, setAdjType] = useState('IN');
  const [adjReason, setAdjReason] = useState('PURCHASE');
  const [adjQty, setAdjQty] = useState('');
  const [adjNote, setAdjNote] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [rawStockDrafts, setRawStockDrafts] = useState({});
  const [savingRawId, setSavingRawId] = useState(null);

  const [batchFor, setBatchFor] = useState(null);
  const [batchData, setBatchData] = useState({ batchNo: '', gcmsNo: '', receivedDate: today(), expiryDate: '', quantity: '', unitCost: '', supplier: '', note: '' });
  const [savingBatch, setSavingBatch] = useState(false);
  const [batchList, setBatchList] = useState([]);
  const [loadingBatches, setLoadingBatches] = useState(false);

  useEffect(() => { if (tab === 'log') loadStockLog(); }, [tab, loadStockLog]);
  useEffect(() => {
    setLoadingBatches(true);
    api.fetchBatches().then(setBatchList).finally(() => setLoadingBatches(false));
  }, []);

  const filtered = products
    .filter(p => {
      if (stockKind === 'RAW' && !isRawProduct(p)) return false;
      if (stockKind === 'FINISHED' && isRawProduct(p)) return false;
      if (!matchesProductCategory(p.series, sf)) return false;
      if (search && !`${p.code} ${p.name}`.toLowerCase().includes(search.toLowerCase())) return false;
      if (lowOnly && !(isRawProduct(p) ? Number(p.baseStockKg || 0) <= Number(p.safeStockKg || 0) : p.specs.some(s => s.stock <= s.safeStock))) return false;
      return true;
    })
    .sort((a, b) => {
      const aLow = isRawProduct(a) ? Number(a.baseStockKg || 0) <= Number(a.safeStockKg || 0) : a.specs.some(s => s.stock <= s.safeStock);
      const bLow = isRawProduct(b) ? Number(b.baseStockKg || 0) <= Number(b.safeStockKg || 0) : b.specs.some(s => s.stock <= s.safeStock);
      return Number(bLow) - Number(aLow);
    });
  const belongsToStockKind = product => stockKind === 'RAW' ? isRawProduct(product) : !isRawProduct(product);
  const visibleBatches = batchList.filter(b => belongsToStockKind(products.find(p => p.id === b.productId)));
  const visibleStockLog = stockLog.filter(l => belongsToStockKind(products.find(p => p.id === l.product_id)));
  const viewStats = useMemo(() => {
    const currentProducts = products.filter(p => stockKind === 'RAW' ? isRawProduct(p) : !isRawProduct(p));
    const currentBatches = batchList.filter(b => {
      const product = products.find(p => p.id === b.productId);
      return stockKind === 'RAW' ? isRawProduct(product) : !isRawProduct(product);
    });
    const now = Date.now();
    const expiring = currentBatches.filter(b => b.expiryDate && new Date(b.expiryDate).getTime() >= now && new Date(b.expiryDate).getTime() - now < 90 * 86400000).length;
    const expired = currentBatches.filter(b => b.expiryDate && new Date(b.expiryDate).getTime() < now && Number(b.remainingQty || 0) > 0).length;
    if (stockKind === 'RAW') {
      return {
        products: currentProducts.length,
        specs: currentProducts.reduce((sum, p) => sum + p.specs.length, 0),
        quantity: currentProducts.reduce((sum, p) => sum + Number(p.baseStockKg || 0), 0),
        low: currentProducts.filter(p => Number(p.baseStockKg || 0) <= Number(p.safeStockKg || 0)).length,
        out: currentProducts.filter(p => Number(p.baseStockKg || 0) <= 0).length,
        expiring, expired
      };
    }
    const specs = currentProducts.flatMap(p => p.specs);
    return {
      products: currentProducts.length,
      specs: specs.length,
      quantity: specs.reduce((sum, s) => sum + Number(s.stock || 0), 0),
      low: specs.filter(s => s.stock <= s.safeStock).length,
      out: specs.filter(s => s.stock <= 0).length,
      expiring, expired
    };
  }, [products, batchList, stockKind]);

  const copyRestockList = () => {
    const lines = [];
    products.filter(p => stockKind === 'RAW' ? isRawProduct(p) : !isRawProduct(p)).forEach(p => {
      if (isRawProduct(p)) {
        const stock = Number(p.baseStockKg || 0);
        const safe = Number(p.safeStockKg || 0);
        if (stock <= safe) lines.push(`${p.name} 实际${stock.toFixed(3)}kg/安全${safe.toFixed(3)}kg${stock <= 0 ? '（售罄）' : ''}`);
        return;
      }
      p.specs.forEach(s => {
        if (s.stock <= s.safeStock) lines.push(`${p.name} ${s.spec} 剩${s.stock}/安全${s.safeStock}${s.stock <= 0 ? '（售罄）' : ''}`);
      });
    });
    if (!lines.length) { alert('当前无缺货品'); return; }
    navigator.clipboard.writeText(`【紫都补货清单】${today()}\n${lines.join('\n')}`).then(
      () => alert(`已复制 ${lines.length} 项补货清单`), () => alert('复制失败，请手动复制'));
  };

  const startAdjust = (product, spec) => {
    setBatchFor(null);
    setAdjustFor({ product, spec });
    setAdjType('IN'); setAdjReason('PURCHASE'); setAdjQty(''); setAdjNote('');
  };
  const handleAdjust = async () => {
    const qty = Number(adjQty);
    if (qty < 0 || (adjType !== 'CORRECTION' && !qty)) return;
    setAdjusting(true);
    try {
      if (isRawProduct(adjustFor.product)) {
        await adjustRawStock(adjustFor.product.id, adjType, adjReason, qty, adjNote, defaultDensityForProduct(adjustFor.product));
      } else {
        await adjustStock(adjustFor.spec.id, adjustFor.product.id, adjType, adjReason, qty, adjNote);
      }
      setAdjustFor(null);
      if (tab === 'log') await loadStockLog();
    } catch (e) { alert('调整失败: ' + e.message); } finally { setAdjusting(false); }
  };

  const saveRawStock = async product => {
    const draft = rawStockDrafts[product.id];
    if (draft === undefined) return;
    const quantity = Number(draft);
    if (String(draft).trim() === '' || !Number.isFinite(quantity) || quantity < 0) {
      alert('请输入正确的重量库存');
      return;
    }
    if (quantity === Number(product.baseStockKg || 0)) return;
    setSavingRawId(product.id);
    try {
      await adjustRawStock(
        product.id,
        'CORRECTION',
        'CORRECTION',
        quantity,
        '库存页直接修改重量库存',
        defaultDensityForProduct(product)
      );
      setRawStockDrafts(current => {
        const next = { ...current };
        delete next[product.id];
        return next;
      });
    } catch (e) {
      alert('保存失败: ' + e.message);
    } finally {
      setSavingRawId(null);
    }
  };

  const startBatch = (product, spec) => {
    setAdjustFor(null);
    setBatchFor({ product, spec });
    setBatchData({ batchNo: '', gcmsNo: '', receivedDate: today(), expiryDate: '', quantity: '', unitCost: '', supplier: '', note: '' });
  };
  const handleSaveBatch = async () => {
    const qty = Number(batchData.quantity);
    if (!batchData.batchNo || !batchData.receivedDate || !qty || qty <= 0) return;
    setSavingBatch(true);
    try {
      await addBatch({
        productId: batchFor.product.id, specId: batchFor.spec.id, batchNo: batchData.batchNo, gcmsNo: batchData.gcmsNo,
        receivedDate: batchData.receivedDate, expiryDate: batchData.expiryDate || null, quantity: qty,
        unitCost: Number(batchData.unitCost) || 0, supplier: batchData.supplier, note: batchData.note,
        densityGml: isRawProduct(batchFor.product) ? defaultDensityForProduct(batchFor.product) : null
      });
      setBatchFor(null); alert('入库成功');
      if (tab === 'batches') { const fresh = await api.fetchBatches(); setBatchList(fresh); }
    } catch (e) { alert('入库失败: ' + e.message); } finally { setSavingBatch(false); }
  };
  const handleDeleteBatch = async (b) => {
    if (!confirm(`确定删除批次 ${b.batchNo}？剩余库存 ${b.remainingQty} 将被扣除。`)) return;
    try { await removeBatch(b.id, b.productId, b.specId, b.remainingQty); const fresh = await api.fetchBatches(); setBatchList(fresh); }
    catch (e) { alert(e.message); }
  };

  const exportLog = () => exportCSV(
    ['时间', '产品ID', '规格ID', '类型', '原因', '规格数量', '前库存', '后库存', '变动kg', '前kg', '后kg', '操作人', '备注'],
    visibleStockLog.map(l => [l.created_at, l.product_id, l.spec_id, TYPE_LABEL[l.type], REASONS[l.reason] || l.reason, l.quantity, l.before_stock, l.after_stock, l.quantity_kg, l.before_stock_kg, l.after_stock_kg, l.operator_name, l.note]),
    `${stockKind === 'RAW' ? '原料kg' : '成品瓶数'}库存变动_${today()}.csv`);

  const batchEditor = batchFor && (
    <div className="rounded-lg border border-green-200 bg-[#FCFDF9] p-4">
      <div className="flex items-center justify-between mb-3">
        <div><div className="text-sm font-medium">批次入库 · {batchFor.product.name}</div><div className="text-[11px] text-gray-400 mt-0.5">{isRawProduct(batchFor.product) ? `按 kg 入库 · 当前 ${Number(batchFor.product.baseStockKg || 0).toFixed(3)} kg` : `${batchFor.spec.spec} · 当前 ${batchFor.spec.stock} 瓶 / 个`}</div></div>
        <button onClick={() => setBatchFor(null)} className="zidu-icon-button"><X size={15} /></button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div><label className="block text-xs text-gray-500 mb-1">批次号 *</label><input value={batchData.batchNo} onChange={e => setBatchData({ ...batchData, batchNo: e.target.value })} placeholder="如 LAV202604" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">GC-MS 编号</label><input value={batchData.gcmsNo} onChange={e => setBatchData({ ...batchData, gcmsNo: e.target.value })} placeholder="可选" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">{isRawProduct(batchFor.product) ? '入库重量 kg *' : '入库数量 *'}</label><input type="number" min={isRawProduct(batchFor.product) ? '0.001' : '1'} step={isRawProduct(batchFor.product) ? '0.001' : '1'} value={batchData.quantity} onChange={e => setBatchData({ ...batchData, quantity: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">入库日期 *</label><input type="date" value={batchData.receivedDate} onChange={e => setBatchData({ ...batchData, receivedDate: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">保质期至</label><input type="date" value={batchData.expiryDate} onChange={e => setBatchData({ ...batchData, expiryDate: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">单位成本</label><input type="number" min="0" step="0.01" value={batchData.unitCost} onChange={e => setBatchData({ ...batchData, unitCost: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">供应商</label><input value={batchData.supplier} onChange={e => setBatchData({ ...batchData, supplier: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
        <div className="col-span-2"><label className="block text-xs text-gray-500 mb-1">备注</label><input value={batchData.note} onChange={e => setBatchData({ ...batchData, note: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={() => setBatchFor(null)} className="px-3 py-2 text-sm border rounded-lg bg-white">取消</button>
        <button onClick={handleSaveBatch} disabled={!batchData.batchNo || !batchData.quantity || savingBatch} className="btn-primary text-sm">{savingBatch ? '保存中...' : '确认入库'}</button>
      </div>
    </div>
  );

  const adjustmentEditor = adjustFor && (
    <div className="rounded-lg border border-purple-200 bg-[#FBF9FD] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium">调整库存 · {adjustFor.product.name}{!isRawProduct(adjustFor.product) && `（${adjustFor.spec.spec}）`} · 当前 {isRawProduct(adjustFor.product) ? `${Number(adjustFor.product.baseStockKg || 0).toFixed(3)} kg` : `${adjustFor.spec.stock} 瓶 / 个`}</div>
        <button onClick={() => setAdjustFor(null)} className="zidu-icon-button"><X size={15} /></button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div><label className="block text-xs text-gray-500 mb-1">类型</label>
          <select value={adjType} onChange={e => { setAdjType(e.target.value); setAdjReason(e.target.value === 'IN' ? 'PURCHASE' : e.target.value === 'OUT' ? 'DAMAGE' : 'CORRECTION'); }} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
            <option value="IN">入库 (+)</option><option value="OUT">出库 (-)</option><option value="CORRECTION">修正 (直接设为)</option>
          </select></div>
        <div><label className="block text-xs text-gray-500 mb-1">原因</label>
          <select value={adjReason} onChange={e => setAdjReason(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
            {adjType === 'IN' && <><option value="PURCHASE">采购入库</option><option value="RETURN">退货入库</option><option value="OTHER">其他</option></>}
            {adjType === 'OUT' && <><option value="DAMAGE">损耗/报废</option><option value="OTHER">其他</option></>}
            {adjType === 'CORRECTION' && <option value="CORRECTION">盘点修正</option>}
          </select></div>
        <div><label className="block text-xs text-gray-500 mb-1">{isRawProduct(adjustFor.product) ? (adjType === 'CORRECTION' ? '实际库存 kg' : '重量 kg') : (adjType === 'CORRECTION' ? '实际数量' : '数量')}</label><input type="number" min="0" step={isRawProduct(adjustFor.product) ? '0.001' : '1'} value={adjQty} onChange={e => setAdjQty(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">备注</label><input value={adjNote} onChange={e => setAdjNote(e.target.value)} placeholder="可选" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
      </div>
      <div className="flex gap-2 mt-3">
        <button onClick={() => setAdjustFor(null)} className="px-3 py-2 text-sm border rounded-lg bg-white">取消</button>
        <button onClick={handleAdjust} disabled={(!adjQty && adjType !== 'CORRECTION') || adjusting} className="btn-primary text-sm">{adjusting ? '处理中...' : '确认调整'}</button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="zidu-section-title">库存运营工作台</div>
          <div className="zidu-section-sub mt-1">原料按 kg · 成品按瓶 / 个 · 批次与出入库全程追溯</div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto max-w-full pb-1"><div className="zidu-segment">
        {[['list', '库存概览'], ['batches', '批次 / GC-MS 追溯'], ['log', '出入库记录']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={tab === k ? 'active' : ''}>{l}</button>
        ))}
        </div>{canAdjust && <button onClick={() => nav?.('purchase')} className="h-10 px-3 rounded-lg border border-purple-200 text-purple-700 bg-white text-xs flex items-center gap-1.5 hover:bg-purple-50 shrink-0 whitespace-nowrap"><ClipboardList size={14} />采购管理</button>}</div>
      </div>

      <div className="zidu-segment self-start" aria-label="库存管理分类">
        <button onClick={() => { setStockKind('RAW'); setSf('ALL'); setAdjustFor(null); setBatchFor(null); }} className={stockKind === 'RAW' ? 'active' : ''}>原料库存（kg） · {products.filter(isRawProduct).length}</button>
        <button onClick={() => { setStockKind('FINISHED'); setSf('ALL'); setAdjustFor(null); setBatchFor(null); }} className={stockKind === 'FINISHED' ? 'active' : ''}>成品库存（瓶 / 个） · {products.filter(p => !isRawProduct(p)).length}</button>
      </div>

      <div className={`grid grid-cols-2 md:grid-cols-3 gap-3 ${stockKind === 'RAW' ? 'xl:grid-cols-3' : 'xl:grid-cols-5'}`}>
        <Card className="p-4"><div className="flex items-center justify-between"><div><div className="text-xs text-gray-500">{stockKind === 'RAW' ? '原料产品' : '成品 / 包材'}</div><div className="text-2xl font-medium mt-1 tabular-nums">{viewStats.products}</div><div className="text-[11px] text-gray-400 mt-1">{viewStats.specs} 个销售规格</div></div><div className="w-9 h-9 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center"><Boxes size={18} /></div></div></Card>
        {stockKind === 'FINISHED' && <Card className="p-4"><div className="flex items-center justify-between"><div><div className="text-xs text-gray-500">成品库存</div><div className="text-2xl font-medium mt-1 tabular-nums">{viewStats.quantity.toLocaleString()}<span className="text-xs text-gray-400 ml-1">瓶 / 个</span></div><div className="text-[11px] text-gray-400 mt-1">各规格数量合计</div></div><div className="w-9 h-9 rounded-lg bg-green-50 text-green-700 flex items-center justify-center"><Package size={18} /></div></div></Card>}
        <Card className={viewStats.low ? 'p-4 border-amber-200' : 'p-4'}><div className="flex items-center justify-between"><div><div className="text-xs text-gray-500">需要补货</div><div className={`text-2xl font-medium mt-1 tabular-nums ${viewStats.low ? 'text-amber-700' : ''}`}>{viewStats.low}</div><div className="text-[11px] text-gray-400 mt-1">{viewStats.out} {stockKind === 'RAW' ? '项售罄' : '个规格售罄'}</div></div><div className="w-9 h-9 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center"><AlertTriangle size={18} /></div></div></Card>
        {stockKind === 'FINISHED' && <Card className="p-4"><div className="flex items-center justify-between"><div><div className="text-xs text-gray-500">库存规格</div><div className="text-2xl font-medium mt-1 tabular-nums">{viewStats.specs}</div><div className="text-[11px] text-gray-400 mt-1">分别盘点瓶数 / 个数</div></div><div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-700 flex items-center justify-center"><Package size={18} /></div></div></Card>}
        <Card className={(viewStats.expiring || viewStats.expired) ? 'p-4 border-orange-200 col-span-2 md:col-span-1' : 'p-4 col-span-2 md:col-span-1'}><div className="flex items-center justify-between"><div><div className="text-xs text-gray-500">批次效期</div><div className="text-2xl font-medium mt-1 tabular-nums">{viewStats.expiring + viewStats.expired}</div><div className="text-[11px] text-gray-400 mt-1">临期 {viewStats.expiring} · 过期 {viewStats.expired}</div></div><div className="w-9 h-9 rounded-lg bg-orange-50 text-orange-700 flex items-center justify-center"><CalendarClock size={18} /></div></div></Card>
      </div>

      {tab === 'list' && (
        <>
          <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative flex-1 sm:flex-none">
              <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
              <input placeholder="搜索产品名 / 编码" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 pr-3 py-2 text-sm border rounded-lg w-full sm:w-56 bg-white" />
            </div>
            <select value={sf} onChange={e => setSf(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white">
              {PRODUCT_CATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <button onClick={() => setLowOnly(!lowOnly)} className={`flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-lg border ${lowOnly ? 'bg-red-600 border-red-600 text-white' : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100'}`}><AlertTriangle size={14} />仅看缺货</button>
            </div>
            <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 hidden xl:inline"><SlidersHorizontal size={13} className="inline mr-1" />显示 {filtered.length} / {products.filter(p => stockKind === 'RAW' ? isRawProduct(p) : !isRawProduct(p)).length} 项</span>
            {viewStats.low > 0 && <button onClick={copyRestockList} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-purple-200 text-purple-700 hover:bg-purple-50"><ClipboardCopy size={14} />复制补货清单</button>}
            </div>
          </div>

          <Card>
            <div className="overflow-x-auto">
              <table className="zidu-table w-full text-sm">
                <thead><tr className="border-b">
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium">编号</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium">产品</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium">库存基准</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium">{stockKind === 'RAW' ? (canAdjust ? '更改重量库存' : '重量库存') : `可售规格 · 价格${isAdmin ? ' / 成本' : ''}`}</th>
                </tr></thead>
                <tbody>{filtered.map(p => (
                  <Fragment key={p.id}>
                  <tr className="border-b last:border-0 align-top">
                    <td className="py-2.5 px-4 font-mono text-xs text-gray-500">{p.code}</td>
                    <td className="py-2.5 px-4 min-w-40"><div className="text-gray-800 font-medium">{p.name}</div><div className="text-xs text-gray-400 mt-0.5">{p.origin} · {p.series}</div></td>
                    <td className="py-2.5 px-4 min-w-44">
                      {isRawProduct(p) ? <>
                        <div className="flex items-baseline gap-1"><span className="text-lg font-medium text-purple-700 tabular-nums">{Number(p.baseStockKg || 0).toFixed(3)}</span><span className="text-xs text-gray-400">kg</span></div>
                        <div className="text-[11px] text-gray-400 mt-0.5">按 kg 管理</div>
                        {canAdjust && p.specs[0] && <div className="flex gap-1 mt-2">
                          <button onClick={() => startBatch(p, p.specs[0])} className="h-7 px-2 rounded-md border border-green-200 text-green-700 text-[11px] inline-flex items-center gap-1"><Package size={11} />批次入库</button>
                        </div>}
                      </> : <><div className="text-xs font-medium text-gray-600">独立规格瓶数</div><div className="text-[11px] text-gray-400 mt-1">2ml / 5ml / 15ml 等各自入库扣减</div></>}
                    </td>
                    <td className="py-2.5 px-4">
                      {isRawProduct(p) ? (
                        <div className="max-w-lg">
                          <div className="flex items-center gap-2">
                            <div className="relative min-w-44 flex-1">
                              <input
                                type="number"
                                min="0"
                                step="0.001"
                                aria-label={`${p.name}重量库存 kg`}
                                value={rawStockDrafts[p.id] ?? Number(p.baseStockKg || 0).toFixed(3)}
                                onFocus={e => e.target.select()}
                                onChange={e => setRawStockDrafts(current => ({ ...current, [p.id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter' && canAdjust && rawStockDrafts[p.id] !== undefined) saveRawStock(p); }}
                                disabled={!canAdjust || savingRawId === p.id}
                                className="w-full h-9 rounded-lg border border-gray-200 bg-white pl-3 pr-9 text-sm tabular-nums focus:border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-100 disabled:bg-gray-50 disabled:text-gray-500"
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">kg</span>
                            </div>
                            {canAdjust && (
                              <button
                                onClick={() => saveRawStock(p)}
                                disabled={savingRawId === p.id || rawStockDrafts[p.id] === undefined || String(rawStockDrafts[p.id]).trim() === '' || Number(rawStockDrafts[p.id]) === Number(p.baseStockKg || 0)}
                                className="h-9 px-3 rounded-lg bg-purple-700 text-white text-xs inline-flex items-center gap-1.5 hover:bg-purple-800 disabled:bg-gray-200 disabled:text-gray-400 disabled:cursor-not-allowed"
                              >
                                <Save size={13} />{savingRawId === p.id ? '保存中' : '保存'}
                              </button>
                            )}
                          </div>
                          <div className="text-[11px] text-gray-400 mt-1.5">直接设置当前总重量，保存后记入盘点修正流水</div>
                          <div className="text-[11px] text-gray-400 mt-1 truncate" title={p.specs.map(s => s.spec).join(' / ')}>销售规格：{p.specs.map(s => s.spec).join(' / ')}</div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {p.specs.map(s => (
                            <div key={s.id} className={`inline-flex items-center gap-1 text-xs px-2 py-1.5 rounded-md ${STOCK_PILL[level(s.stock, s.safeStock)]}`}>
                              <span>{s.spec}</span>
                              {user.role !== 'SALES' && <span>· {fmtY(s.price)}</span>}
                              {isAdmin && <span className="opacity-70">/{s.cost ? fmtY(s.cost) : '未录'}</span>}
                              <span>· {s.stock} 瓶</span>
                              {canAdjust && (<>
                                <button onClick={() => startAdjust(p, s)} title="调整库存" className="ml-1 w-5 h-5 inline-flex items-center justify-center rounded hover:bg-white/60 text-purple-600"><Edit2 size={11} /></button>
                                <button onClick={() => startBatch(p, s)} title="批次入库" className="w-5 h-5 inline-flex items-center justify-center rounded hover:bg-white/60 text-green-700"><Package size={11} /></button>
                              </>)}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                  {(batchFor?.product.id === p.id || adjustFor?.product.id === p.id) && (
                    <tr className="border-b bg-[#FAF8F4]">
                      <td colSpan="4" className="p-3">
                        {batchFor?.product.id === p.id ? batchEditor : adjustmentEditor}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
                {filtered.length === 0 && <tr><td colSpan="4" className="text-center py-12 text-gray-400 text-sm">{lowOnly ? '没有缺货产品 👍' : '暂无产品'}</td></tr>}</tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === 'batches' && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div><div className="text-sm text-gray-600">共 {visibleBatches.length} 个{stockKind === 'RAW' ? '原料' : '成品'}批次</div><div className="text-[11px] text-gray-400 mt-0.5">按入库日期降序 · 批次删除会同步回退对应剩余库存</div></div>
            <div className="flex items-center gap-3 text-xs"><span className="text-amber-700">临期 {viewStats.expiring}</span><span className="text-red-600">过期 {viewStats.expired}</span></div>
          </div>
          <Card>
            <div className="overflow-x-auto">
              <table className="zidu-table w-full text-sm">
                <thead><tr className="border-b">
                  <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">批次号</th>
                  <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">产品/规格</th>
                  <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">GC-MS</th>
                  <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">入库日期</th>
                  <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">保质期</th>
                  <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">入库/剩余</th>
                  <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium hidden md:table-cell">供应商</th>
                  {canAdjust && <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">操作</th>}
                </tr></thead>
                <tbody>
                  {loadingBatches && <tr><td colSpan="8" className="text-center py-12 text-gray-400 text-sm">加载中...</td></tr>}
                  {!loadingBatches && visibleBatches.map(b => {
                    const product = products.find(p => p.id === b.productId);
                    const spec = product?.specs.find(s => s.id === b.specId);
                    const expiryTime = b.expiryDate ? new Date(b.expiryDate).getTime() : null;
                    const expired = expiryTime && expiryTime < Date.now() && Number(b.remainingQty || 0) > 0;
                    const expiringSoon = expiryTime && !expired && expiryTime - Date.now() < 90 * 86400000;
                    const unit = product?.inventoryMode === 'MASS' || product?.channel === 'RAW' ? ' kg' : '';
                    return (
                      <tr key={b.id} className="border-b last:border-0">
                        <td className="py-2 px-3 font-mono text-xs">{b.batchNo}</td>
                        <td className="py-2 px-3"><div>{product?.name || `ID ${b.productId}`}</div><div className="text-xs text-gray-400">{spec?.spec || ''}</div></td>
                        <td className="py-2 px-3 text-xs font-mono text-gray-600">{b.gcmsNo || '—'}</td>
                        <td className="py-2 px-3 text-xs text-gray-600">{b.receivedDate}</td>
                        <td className="py-2 px-3 text-xs"><span className={expired ? 'text-red-600 font-medium' : expiringSoon ? 'text-amber-700 font-medium' : 'text-gray-600'}>{b.expiryDate || '—'}</span>{expired && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-600">已过期</span>}{expiringSoon && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700">临期</span>}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{b.initialQty}{unit} / <span className={Number(b.remainingQty) === 0 ? 'text-gray-400' : 'font-medium'}>{b.remainingQty}{unit}</span></td>
                        <td className="py-2 px-3 text-xs text-gray-500 hidden md:table-cell">{b.supplier}</td>
                        {canAdjust && <td className="py-2 px-3 text-right"><button onClick={() => handleDeleteBatch(b)} title="删除批次并回退库存" className="zidu-icon-button !w-7 !h-7 text-gray-400 hover:text-red-500"><X size={13} /></button></td>}
                      </tr>
                    );
                  })}
                  {!loadingBatches && visibleBatches.length === 0 && <tr><td colSpan="8" className="text-center py-12 text-gray-400 text-sm">当前分类暂无批次记录，请在「库存概览」发起批次入库。</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === 'log' && (
        <>
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">共 {visibleStockLog.length} 条{stockKind === 'RAW' ? '原料 kg' : '成品瓶数'}记录</div>
            <button onClick={exportLog} className="flex items-center gap-1 text-xs text-purple-700 px-3 py-2 rounded border border-purple-200 hover:bg-purple-50"><Download size={13} />导出</button>
          </div>
          <Card>
            <div className="overflow-x-auto">
              <table className="zidu-table w-full text-sm">
                <thead><tr className="border-b">
                  <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">时间</th>
                  <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">产品</th>
                  <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">类型</th>
                  <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">原因</th>
                  <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">数量</th>
                  <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">前→后</th>
                  <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">kg 变动</th>
                  <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium hidden md:table-cell">操作人</th>
                </tr></thead>
                <tbody>{visibleStockLog.map(l => {
                  const product = products.find(p => p.id === l.product_id);
                  const spec = product?.specs.find(s => s.id === l.spec_id);
                  return (
                    <tr key={l.id} className="border-b last:border-0">
                      <td className="py-2 px-3 text-xs text-gray-500 whitespace-nowrap">{l.created_at?.slice(0, 16).replace('T', ' ')}</td>
                      <td className="py-2 px-3"><div className="text-gray-800">{product?.name || `ID ${l.product_id}`}</div><div className="text-xs text-gray-400">{spec?.spec || ''}</div></td>
                      <td className="py-2 px-3"><span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_CLS[l.type]}`}>{TYPE_LABEL[l.type]}</span></td>
                      <td className="py-2 px-3 text-xs text-gray-600">{REASONS[l.reason] || l.reason}</td>
                      <td className="py-2 px-3 text-right font-medium">{l.type === 'OUT' ? '-' : '+'}{l.quantity}</td>
                      <td className="py-2 px-3 text-right text-xs text-gray-500">{l.before_stock} → {l.after_stock}</td>
                      <td className="py-2 px-3 text-right text-xs tabular-nums">{l.quantity_kg != null ? <><span className={l.type === 'OUT' ? 'text-red-600' : 'text-green-700'}>{l.type === 'OUT' ? '-' : '+'}{Number(l.quantity_kg).toFixed(3)}</span><div className="text-[10px] text-gray-400">{l.before_stock_kg} → {l.after_stock_kg}</div></> : <span className="text-gray-300">—</span>}</td>
                      <td className="py-2 px-3 text-xs hidden md:table-cell">{l.operator_name}</td>
                    </tr>
                  );
                })}{visibleStockLog.length === 0 && <tr><td colSpan="8" className="text-center py-12 text-gray-400 text-sm">当前分类暂无库存记录</td></tr>}</tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
