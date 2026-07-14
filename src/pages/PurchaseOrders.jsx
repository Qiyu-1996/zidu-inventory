import { useEffect, useMemo, useState } from 'react';
import { Plus, ArrowLeft, Search, X, CheckCircle, Truck, Edit2, Trash2, FlaskConical, Package, Lightbulb, ClipboardList, PackageCheck, History, Users, Archive, RotateCcw, CalendarClock, Undo2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, POBadge, fmtY, PO_STATUS_MAP, today } from '../components/ui';
import { defaultDensityForProduct } from '../lib/densityDefaults';
import SupplierManager from '../components/SupplierManager';
import * as api from '../lib/api';

const PURCHASE_TABS = [
  { key: 'suggestions', label: '采购建议', icon: Lightbulb },
  { key: 'orders', label: '采购单', icon: ClipboardList },
  { key: 'pending', label: '待收货', icon: PackageCheck },
  { key: 'receipts', label: '入库记录', icon: History },
  { key: 'suppliers', label: '供应商', icon: Users }
];

const urgencyLabel = { HIGH: '优先采购', MEDIUM: '建议采购', LOW: '可补充' };
const urgencyClass = { HIGH: 'bg-red-50 text-red-700 border-red-200', MEDIUM: 'bg-amber-50 text-amber-700 border-amber-200', LOW: 'bg-gray-50 text-gray-600 border-gray-200' };
const urgencyOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString('zh-CN') : '未填写';
}

// ═══ PO LIST ═══
export function PurchaseOrderList({ nav }) {
  const { user } = useAuth();
  const { purchaseOrders, products, orders, removePurchaseOrder, reversePurchaseReceipt, reload } = useData();
  const [tab, setTab] = useState('suggestions');
  const [sf, setSf] = useState('ALL');
  const [search, setSearch] = useState('');
  const [showRecycle, setShowRecycle] = useState(false);
  const [deletedOrders, setDeletedOrders] = useState([]);
  const [recycleLoading, setRecycleLoading] = useState(false);
  const [receipts, setReceipts] = useState([]);
  const [receiptLoading, setReceiptLoading] = useState(false);
  const [receiptError, setReceiptError] = useState('');

  const filtered = purchaseOrders.filter(po => {
    if (sf !== 'ALL' && po.status !== sf) return false;
    if (search && !`${po.poNo} ${po.supplier}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const draftCount = purchaseOrders.filter(po => po.status === 'DRAFT').length;
  const orderedCount = purchaseOrders.filter(po => po.status === 'ORDERED').length;
  const receivingCount = purchaseOrders.filter(po => po.status === 'PARTIAL_RECEIVED').length;
  const receivedCount = purchaseOrders.filter(po => po.status === 'RECEIVED').length;
  const pendingOrders = purchaseOrders.filter(po => ['ORDERED', 'PARTIAL_RECEIVED'].includes(po.status));

  const inTransitBySpec = useMemo(() => {
    const totals = new Map();
    pendingOrders.forEach(po => po.items.forEach(item => {
      const remaining = Math.max(0, Number(item.quantity) - Number(item.receivedQty || 0));
      totals.set(item.specId, (totals.get(item.specId) || 0) + remaining);
    }));
    return totals;
  }, [pendingOrders]);

  const restockSuggestions = useMemo(() => {
    const calculated = api.calculateRestockSuggestions(products, orders);
    const bySpec = new Map(calculated.map(item => [item.specId, item]));
    products.forEach(product => {
      if (product.channel === 'RAW') {
        const specId = product.specs[0]?.id;
        if (!specId || bySpec.has(specId)) return;
        const gap = Math.max(0, Number(product.safeStockKg || 0) - Number(product.baseStockKg || 0));
        if (gap > 0) bySpec.set(specId, {
          productId: product.id, productName: product.name, productCode: product.code,
          specId, spec: 'kg', currentStock: Number(product.baseStockKg || 0),
          safeStock: Number(product.safeStockKg || 0), recent30: 0, trend: null,
          suggestedQty: Number(gap.toFixed(3)), urgency: 'HIGH', unit: 'kg'
        });
        return;
      }
      product.specs.forEach(spec => {
        if (bySpec.has(spec.id)) return;
        const gap = Math.max(0, Number(spec.safeStock || 0) - Number(spec.stock || 0));
        if (gap > 0) bySpec.set(spec.id, {
          productId: product.id, productName: product.name, productCode: product.code,
          specId: spec.id, spec: spec.spec, currentStock: Number(spec.stock || 0),
          safeStock: Number(spec.safeStock || 0), recent30: 0, trend: null,
          suggestedQty: Math.ceil(gap), urgency: 'HIGH', unit: '件'
        });
      });
    });
    return [...bySpec.values()].map(item => {
      const inTransit = Number(inTransitBySpec.get(item.specId) || 0);
      const suggestedQty = Math.max(0, Number(item.suggestedQty || 0) - inTransit);
      return { ...item, inTransit, suggestedQty: item.unit === 'kg' ? Number(suggestedQty.toFixed(3)) : Math.ceil(suggestedQty) };
    }).filter(item => item.suggestedQty > 0)
      .sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency] || b.suggestedQty - a.suggestedQty);
  }, [products, orders, inTransitBySpec]);

  const loadReceipts = async () => {
    setReceiptLoading(true);
    setReceiptError('');
    try { setReceipts(await api.fetchPurchaseReceipts()); }
    catch (error) { setReceiptError(error.message); }
    finally { setReceiptLoading(false); }
  };

  useEffect(() => {
    if (tab === 'receipts') loadReceipts();
  }, [tab]);

  const loadRecycle = async () => {
    setRecycleLoading(true);
    try { setDeletedOrders(await api.fetchDeletedPurchaseOrders()); }
    catch (error) { alert(error.message); }
    finally { setRecycleLoading(false); }
  };

  const toggleRecycle = async () => {
    const next = !showRecycle;
    setShowRecycle(next);
    if (next) await loadRecycle();
  };

  const deleteFromList = async (event, po) => {
    event.stopPropagation();
    if (!confirm(`将采购单 ${po.poNo} 移入回收站？30 天内可以恢复。`)) return;
    try { await removePurchaseOrder(po.id); }
    catch (error) { alert('删除失败：' + error.message); }
  };

  const restoreOrder = async po => {
    try {
      await api.restoreDeletedPurchaseOrder(po.id, user.name);
      setDeletedOrders(current => current.filter(item => item.id !== po.id));
      await reload();
    } catch (error) { alert('恢复失败：' + error.message); }
  };

  const permanentlyDelete = async po => {
    if (!confirm(`彻底删除采购单 ${po.poNo}？该操作无法恢复。`)) return;
    try {
      await api.permanentlyDeletePurchaseOrder(po.id);
      setDeletedOrders(current => current.filter(item => item.id !== po.id));
    } catch (error) { alert('删除失败：' + error.message); }
  };

  const reverseReceipt = async receipt => {
    const note = prompt(`撤销批次 ${receipt.batchNo} 的整次入库。请填写原因：`, '收货录入错误');
    if (note === null) return;
    try {
      await reversePurchaseReceipt(receipt.id, note);
      await loadReceipts();
      alert('本次收货已撤销，采购进度和库存已同步回退');
    } catch (error) { alert('撤销失败：' + error.message); }
  };

  const productName = receipt => products.find(product => product.id === receipt.productId)?.name || '产品已停用';
  const specName = receipt => products.find(product => product.id === receipt.productId)?.specs.find(spec => spec.id === receipt.specId)?.spec || '';
  const purchaseForReceipt = receipt => purchaseOrders.find(po => po.id === receipt.purchaseOrderId);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div><div className="zidu-section-title">采购工作台</div><div className="zidu-section-sub mt-1">从补货建议、采购下单到批次入库统一追踪</div></div>
        <button onClick={() => nav('purchaseCreate')} className="btn-primary text-sm"><Plus size={16} />新建采购单</button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['草稿', draftCount, '#8A8178'], ['待收货', orderedCount, '#5F7689'], ['部分收货', receivingCount, '#F3BD5B'], ['已收货', receivedCount, '#7B8F67']].map(([label, value, color]) => <Card key={label} className="p-3.5 relative overflow-hidden"><div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: color }} /><div className="text-xs text-gray-500">{label}</div><div className="text-xl font-medium mt-1 tabular-nums">{value}</div></Card>)}
      </div>
      <div className="overflow-x-auto pb-1">
        <div className="zidu-segment min-w-max" aria-label="采购工作台分类">
          {PURCHASE_TABS.map(item => { const Icon = item.icon; return <button key={item.key} onClick={() => setTab(item.key)} className={tab === item.key ? 'active' : ''}><Icon size={14} className="inline mr-1.5" />{item.label}{item.key === 'pending' && pendingOrders.length > 0 ? ` ${pendingOrders.length}` : ''}</button>; })}
        </div>
      </div>

      {tab === 'suggestions' && (
        <Card className="overflow-hidden">
          <div className="p-4 border-b border-[#EEE6D9]"><div className="text-sm font-semibold text-gray-700">建议采购清单</div><div className="text-xs text-gray-400 mt-1">按近 60 天销量、安全库存和未到货采购量动态计算；未设置安全库存的产品不会凭空建议。</div></div>
          <div className="overflow-x-auto"><table className="zidu-table w-full text-sm min-w-[850px]">
            <thead><tr className="bg-gray-50/80 border-b"><th className="text-left p-3 text-xs text-gray-500">产品</th><th className="text-left p-3 text-xs text-gray-500">规格</th><th className="text-right p-3 text-xs text-gray-500">现有库存</th><th className="text-right p-3 text-xs text-gray-500">安全库存</th><th className="text-right p-3 text-xs text-gray-500">近 30 天用量</th><th className="text-right p-3 text-xs text-gray-500">采购未到货</th><th className="text-right p-3 text-xs text-gray-500">建议采购</th><th className="text-right p-3 text-xs text-gray-500">操作</th></tr></thead>
            <tbody>{restockSuggestions.map(item => <tr key={item.specId} className="border-b last:border-0">
              <td className="p-3"><div className="font-medium text-gray-800">{item.productName}</div><div className="font-mono text-xs text-gray-400">{item.productCode}</div></td>
              <td className="p-3 text-gray-600">{item.spec}</td>
              <td className="p-3 text-right tabular-nums">{item.currentStock} {item.unit || '件'}</td>
              <td className="p-3 text-right tabular-nums">{item.safeStock} {item.unit || '件'}</td>
              <td className="p-3 text-right tabular-nums">{item.recent30 || 0} {item.unit || '件'}</td>
              <td className="p-3 text-right tabular-nums text-blue-700">{item.inTransit || 0} {item.unit || '件'}</td>
              <td className="p-3 text-right"><div className="font-semibold text-purple-800 tabular-nums">{item.suggestedQty} {item.unit || '件'}</div><span className={`inline-block mt-1 px-1.5 py-0.5 rounded border text-[10px] ${urgencyClass[item.urgency]}`}>{urgencyLabel[item.urgency]}</span></td>
              <td className="p-3 text-right"><button onClick={() => nav('purchaseCreate', { suggestion: item })} className="px-3 py-1.5 rounded-lg border border-purple-200 text-purple-700 text-xs">生成采购单</button></td>
            </tr>)}{restockSuggestions.length === 0 && <tr><td colSpan="8" className="text-center py-12 text-gray-400">当前没有需要补货的产品</td></tr>}</tbody>
          </table></div>
        </Card>
      )}

      {tab === 'orders' && <>
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
          <div className="flex gap-2 items-center flex-wrap">
            <div className="relative"><Search size={16} className="absolute left-3 top-2.5 text-gray-400" /><input placeholder="搜索采购单号/供应商" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 pr-3 py-2 text-sm border rounded-lg w-56" /></div>
            <select value={sf} onChange={e => setSf(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white"><option value="ALL">全部状态</option>{Object.entries(PO_STATUS_MAP).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select>
          </div>
          <div className="flex items-center gap-3"><span className="text-xs text-gray-400">显示 {filtered.length} / {purchaseOrders.length} 单</span>{user.role === 'ADMIN' && <button onClick={toggleRecycle} className="flex items-center gap-1 text-xs text-gray-500 hover:text-purple-700"><Archive size={14} />回收站</button>}</div>
        </div>
        {showRecycle && user.role === 'ADMIN' && <Card className="p-4 border-dashed"><div className="flex items-center justify-between mb-3"><div><div className="text-sm font-semibold">采购单回收站</div><div className="text-xs text-gray-400 mt-0.5">保留 30 天；只有从未收货的采购单才能进入回收站</div></div><button onClick={() => setShowRecycle(false)} className="zidu-icon-button"><X size={15} /></button></div>{recycleLoading ? <div className="py-8 text-center text-gray-400">读取中...</div> : <div className="space-y-2">{deletedOrders.map(po => <div key={po.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border rounded-lg p-3"><div><span className="font-mono text-sm">{po.poNo}</span><span className="text-xs text-gray-400 ml-2">{po.supplier} · 删除于 {formatDate(po.deletedAt)}</span></div><div className="flex gap-2"><button onClick={() => restoreOrder(po)} className="px-3 py-1.5 border rounded-lg text-xs text-purple-700"><RotateCcw size={13} className="inline mr-1" />恢复</button><button onClick={() => permanentlyDelete(po)} className="px-3 py-1.5 border border-red-200 rounded-lg text-xs text-red-600">彻底删除</button></div></div>)}{deletedOrders.length === 0 && <div className="py-8 text-center text-gray-400">回收站为空</div>}</div>}</Card>}
        <div className="space-y-2">{filtered.map(po => (
          <Card key={po.id} className="p-4 cursor-pointer hover:shadow-md" onClick={() => nav('purchaseDetail', po.id)}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2"><div><div className="flex items-center gap-2 mb-1"><span className="font-mono text-sm text-gray-600">{po.poNo}</span><POBadge status={po.status} /></div><div className="text-sm text-gray-800">供应商：{po.supplier}</div><div className="text-xs text-gray-400 mt-0.5">{formatDate(po.createdAt)} · {po.items.length} 项{po.expectedDate ? ` · 预计 ${formatDate(po.expectedDate)} 到货` : ''}</div></div><div className="flex items-center justify-end gap-2"><div className="text-lg font-bold" style={{ color: '#5C4B73' }}>{fmtY(po.total)}</div>{user.role === 'ADMIN' && po.items.every(item => Number(item.receivedQty || 0) === 0) && <button onClick={event => deleteFromList(event, po)} title="移入回收站" className="zidu-icon-button !w-8 !h-8 hover:!text-red-500"><Trash2 size={14} /></button>}</div></div>
          </Card>
        ))}{filtered.length === 0 && <div className="text-center py-12 text-gray-400">暂无采购单</div>}</div>
      </>}

      {tab === 'pending' && <div className="space-y-2">{pendingOrders.map(po => {
        const ordered = po.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
        const received = po.items.reduce((sum, item) => sum + Number(item.receivedQty || 0), 0);
        return <Card key={po.id} className="p-4 cursor-pointer hover:shadow-md" onClick={() => nav('purchaseDetail', po.id)}><div className="flex flex-col md:flex-row md:items-center justify-between gap-3"><div><div className="flex items-center gap-2"><span className="font-mono text-sm">{po.poNo}</span><POBadge status={po.status} /></div><div className="font-medium text-gray-800 mt-1.5">{po.supplier}</div><div className="text-xs text-gray-400 mt-1">{po.items.length} 项 · 已收 {received} / {ordered}</div></div><div className="md:text-right"><div className={`text-sm flex md:justify-end items-center gap-1 ${po.expectedDate && po.expectedDate < today() ? 'text-red-600' : 'text-gray-600'}`}><CalendarClock size={15} />预计到货：{formatDate(po.expectedDate)}</div><div className="mt-2 h-1.5 w-full md:w-52 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-green-500" style={{ width: `${ordered ? Math.min(100, received / ordered * 100) : 0}%` }} /></div></div></div></Card>;
      })}{pendingOrders.length === 0 && <Card className="p-12 text-center text-gray-400">当前没有待收货采购单</Card>}</div>}

      {tab === 'receipts' && <Card className="overflow-hidden">
        <div className="p-4 border-b border-[#EEE6D9] flex items-center justify-between"><div><div className="text-sm font-semibold">采购入库记录</div><div className="text-xs text-gray-400 mt-1">每次收货形成独立批次，可核对供应商、批次号、数量与操作人</div></div><button onClick={loadReceipts} className="text-xs text-purple-700">刷新</button></div>
        {receiptError ? <div className="p-8 text-center text-red-500 text-sm">{receiptError}</div> : receiptLoading ? <div className="p-10 text-center text-gray-400">读取中...</div> : <div className="overflow-x-auto"><table className="zidu-table w-full text-sm min-w-[980px]"><thead><tr className="bg-gray-50/80 border-b"><th className="text-left p-3 text-xs text-gray-500">到货日期</th><th className="text-left p-3 text-xs text-gray-500">采购单</th><th className="text-left p-3 text-xs text-gray-500">供应商</th><th className="text-left p-3 text-xs text-gray-500">产品 / 规格</th><th className="text-left p-3 text-xs text-gray-500">批次 / GC-MS</th><th className="text-right p-3 text-xs text-gray-500">入库数量</th><th className="text-left p-3 text-xs text-gray-500">操作人</th><th className="text-right p-3 text-xs text-gray-500">状态</th></tr></thead><tbody>{receipts.map(receipt => { const po = purchaseForReceipt(receipt); const raw = products.find(product => product.id === receipt.productId)?.channel === 'RAW'; const reversible = !receipt.receiptReversedAt && Math.abs(receipt.remainingQty - receipt.initialQty) < 0.000001; return <tr key={receipt.id} className={`border-b last:border-0 ${receipt.receiptReversedAt ? 'opacity-50' : ''}`}><td className="p-3">{formatDate(receipt.receivedDate)}</td><td className="p-3 font-mono text-xs">{po?.poNo || `#${receipt.purchaseOrderId}`}</td><td className="p-3">{receipt.supplier || po?.supplier}</td><td className="p-3"><div className="font-medium">{productName(receipt)}</div><div className="text-xs text-gray-400">{raw ? '原料重量' : specName(receipt)}</div></td><td className="p-3"><div>{receipt.batchNo}</div><div className="text-xs text-gray-400">{receipt.gcmsNo || '无 GC-MS 编号'}</div></td><td className="p-3 text-right tabular-nums">{receipt.initialQty} {raw ? 'kg' : '瓶 / 个'}</td><td className="p-3">{receipt.receivedBy || '未记录'}</td><td className="p-3 text-right">{receipt.receiptReversedAt ? <span className="text-xs text-red-600">已撤销</span> : user.role === 'ADMIN' && reversible ? <button onClick={() => reverseReceipt(receipt)} className="px-2.5 py-1.5 border border-red-200 rounded-lg text-xs text-red-600"><Undo2 size={13} className="inline mr-1" />撤销收货</button> : <span className="text-xs text-green-700">已入库</span>}</td></tr>; })}{receipts.length === 0 && <tr><td colSpan="8" className="text-center py-12 text-gray-400">暂无采购入库记录</td></tr>}</tbody></table></div>}
      </Card>}

      {tab === 'suppliers' && <SupplierManager />}
    </div>
  );
}

// ═══ PO CREATE ═══
export function PurchaseOrderCreate({ onBack, editPo = null, initialSuggestion = null }) {
  const { user } = useAuth();
  const { products, suppliers, addPurchaseOrder, editPurchaseOrder } = useData();
  const firstProductId = editPo?.items?.[0]?.productId || initialSuggestion?.productId;
  const inferredKind = firstProductId && products.find(p => p.id === firstProductId)?.channel !== 'RAW' ? 'FINISHED' : 'RAW';
  const [supplier, setSupplier] = useState(editPo?.supplier || '');
  const [notes, setNotes] = useState(editPo?.notes || '');
  const [expectedDate, setExpectedDate] = useState(editPo?.expectedDate || '');
  const [purchaseKind, setPurchaseKind] = useState(inferredKind);
  const [items, setItems] = useState(editPo?.items?.length ? editPo.items.map(it => {
    const product = products.find(p => p.id === it.productId);
    return { ...it, spec: product?.channel === 'RAW' ? 'kg' : it.spec };
  }) : initialSuggestion ? [{
    productId: initialSuggestion.productId,
    specId: initialSuggestion.specId,
    productName: initialSuggestion.productName,
    spec: initialSuggestion.unit === 'kg' ? 'kg' : initialSuggestion.spec,
    quantity: initialSuggestion.suggestedQty,
    unitCost: 0
  }] : [{ productId: '', specId: '', productName: '', spec: '', quantity: 1, unitCost: 0 }]);
  const [saving, setSaving] = useState(false);

  const addItem = () => setItems(p => [...p, { productId: '', specId: '', productName: '', spec: '', quantity: 1, unitCost: 0 }]);
  const removeItem = (i) => setItems(p => p.filter((_, idx) => idx !== i));
  const changePurchaseKind = kind => {
    if (kind === purchaseKind) return;
    if (items.some(item => item.productId) && !confirm('切换采购类型会清空当前采购明细，确定继续？')) return;
    setPurchaseKind(kind);
    setItems([{ productId: '', specId: '', productName: '', spec: '', quantity: 1, unitCost: 0 }]);
  };
  const updateItem = (i, f, v) => setItems(p => p.map((x, idx) => {
    if (idx !== i) return x;
    if (f === 'productId') {
      const prod = products.find(p => p.id === Number(v));
      const isRaw = prod?.channel === 'RAW';
      const inventorySpec = isRaw ? prod?.specs?.[0] : null;
      return {
        ...x,
        productId: Number(v),
        productName: prod?.name || '',
        specId: inventorySpec?.id || '',
        spec: isRaw ? 'kg' : ''
      };
    }
    if (f === 'specId') {
      const prod = products.find(p => p.id === x.productId);
      const sp = prod?.specs.find(s => s.id === Number(v));
      return { ...x, specId: Number(v), spec: sp?.spec || '' };
    }
    return { ...x, [f]: f === 'quantity' || f === 'unitCost' ? Number(v) || 0 : v };
  }));

  const total = items.reduce((s, it) => s + it.quantity * it.unitCost, 0);

  const handleSave = async () => {
    if (!supplier.trim()) { alert('请填写供应商'); return; }
    if (items.length === 0) { alert('请至少添加一条采购明细'); return; }
    if (!items.every(it => it.productId && it.specId && Number(it.quantity) > 0 && Number(it.unitCost) >= 0)) {
      alert('请检查每一行的产品、采购数量和单价；成品还需要选择规格'); return;
    }
    setSaving(true);
    try {
      const payload = {
        poNo: editPo?.poNo || `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString(36).slice(-5).toUpperCase()}`,
        supplier: supplier.trim(), total,
        notes, expectedDate: expectedDate || null, createdByName: user.name,
        items: items.map(it => ({ ...it, subtotal: it.quantity * it.unitCost }))
      };
      if (editPo) await editPurchaseOrder(editPo.id, payload);
      else await addPurchaseOrder(payload);
      alert(editPo ? '采购单已保存' : '采购单创建成功');
      onBack();
    } catch (e) { alert('创建失败: ' + e.message); } finally { setSaving(false); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ArrowLeft size={16} />返回</button>
      <Card className="p-5 space-y-4">
        <div className="text-lg font-semibold">{editPo ? `编辑采购单 ${editPo.poNo}` : '新建采购单'}</div>
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">采购类型 *</label>
          <div className="zidu-segment inline-flex" aria-label="采购类型">
            <button type="button" onClick={() => changePurchaseKind('RAW')} className={purchaseKind === 'RAW' ? 'active' : ''}><FlaskConical size={14} className="inline mr-1" />原料采购（kg）</button>
            <button type="button" onClick={() => changePurchaseKind('FINISHED')} className={purchaseKind === 'FINISHED' ? 'active' : ''}><Package size={14} className="inline mr-1" />成品 / 包材（瓶 / 个）</button>
          </div>
          <div className="text-[11px] text-gray-400 mt-1.5">{purchaseKind === 'RAW' ? '选择原料产品即可，采购数量和收货库存统一按 kg。' : '选择具体成品规格，采购和收货按瓶 / 个计数。'}</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><label className="block text-xs text-gray-500 mb-1">供应商 *</label><input list="purchase-supplier-options" value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="选择或输入供应商" className="w-full border rounded-lg px-3 py-2 text-sm" /><datalist id="purchase-supplier-options">{suppliers.filter(s => s.isActive !== false).map(s => <option key={s.id} value={s.name}>{s.contact || s.phone ? [s.contact, s.phone].filter(Boolean).join(' · ') : ''}</option>)}</datalist></div>
          <div><label className="block text-xs text-gray-500 mb-1">预计到货日</label><input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          <div><label className="block text-xs text-gray-500 mb-1">备注</label><input value={notes} onChange={e => setNotes(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">采购明细</span>
            <button onClick={addItem} className="text-sm text-purple-600 flex items-center gap-1"><Plus size={14} />添加行</button>
          </div>
          <div className="space-y-2">
            {items.map((it, i) => {
              const prod = products.find(p => p.id === it.productId);
              const isRaw = prod ? prod.channel === 'RAW' : purchaseKind === 'RAW';
              return (
                <div key={i} className="grid grid-cols-2 md:grid-cols-[1fr_110px_90px_100px_auto] gap-2 items-center border-b border-[#EEE6D9] pb-2 last:border-0">
                  <div className="flex gap-1 col-span-2 md:col-span-1">
                    <select value={it.productId} onChange={e => updateItem(i, 'productId', e.target.value)} className="border rounded px-2 py-1.5 text-sm flex-1 bg-white">
                      <option value="">选择{purchaseKind === 'RAW' ? '原料' : '成品 / 包材'}</option>
                      {products.filter(p => purchaseKind === 'RAW' ? p.channel === 'RAW' : p.channel !== 'RAW').map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}
                    </select>
                    {isRaw ? (
                      <div className="w-24 shrink-0 rounded border border-green-200 bg-green-50 px-2 py-1.5 text-center text-xs text-green-700">重量 · kg</div>
                    ) : (
                      <select value={it.specId} onChange={e => updateItem(i, 'specId', e.target.value)} className="border rounded px-2 py-1.5 text-sm w-24 bg-white">
                        <option value="">规格</option>
                        {(prod?.specs || []).map(s => <option key={s.id} value={s.id}>{s.spec}</option>)}
                      </select>
                    )}
                  </div>
                  <div className="relative"><input type="number" min={isRaw ? '0.001' : '1'} step={isRaw ? '0.001' : '1'} value={it.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)} placeholder={isRaw ? '重量' : '数量'} className="border rounded pl-2 pr-7 py-1.5 text-sm w-full" /><span className="absolute right-2 top-2 text-xs text-gray-400">{isRaw ? 'kg' : '件'}</span></div>
                  <input type="number" min="0" step="0.01" value={it.unitCost} onChange={e => updateItem(i, 'unitCost', e.target.value)} placeholder={isRaw ? '元/kg' : '元/件'} className="border rounded px-2 py-1.5 text-sm" />
                  <div className="text-sm text-right" style={{ color: '#5C4B73' }}>{fmtY(it.quantity * it.unitCost)}</div>
                  <button onClick={() => removeItem(i)} title="移除该行" className="zidu-icon-button !w-8 !h-8 justify-self-end"><X size={14} /></button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-between items-center pt-3 border-t">
          <span className="text-sm text-gray-500">合计</span>
          <span className="text-xl font-bold" style={{ color: '#5C4B73' }}>{fmtY(total)}</span>
        </div>

        <div className="flex gap-2">
          <button onClick={onBack} className="px-4 py-2 text-sm border rounded-lg">取消</button>
          <button onClick={handleSave} disabled={saving || !supplier.trim() || items.length === 0} className="flex-1 px-4 py-2 text-white rounded-lg text-sm disabled:opacity-40" style={{ background: '#5C4B73' }}>
            {saving ? '保存中...' : (editPo ? '保存修改' : '创建采购单')}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ═══ PO DETAIL ═══
export function PurchaseOrderDetail({ poId, onBack, onEdit }) {
  const { user } = useAuth();
  const { purchaseOrders, products, updatePOStatus, receivePOItems, removePurchaseOrder, closePurchaseOrder } = useData();
  const po = purchaseOrders.find(p => p.id === poId);
  const [receiving, setReceiving] = useState(false);
  const [receiveData, setReceiveData] = useState({});
  const [processing, setProcessing] = useState(false);

  if (!po) return <div className="text-center py-12 text-gray-400">采购单不存在</div>;

  const startReceive = () => {
    const init = {};
    po.items.forEach(it => {
      const remaining = Math.max(0, Number(it.quantity) - Number(it.receivedQty || 0));
      init[it.id] = {
        quantity: remaining > 0 ? String(remaining) : '',
        batchNo: '',
        gcmsNo: '',
        receivedDate: today(),
        expiryDate: '',
        note: ''
      };
    });
    setReceiveData(init);
    setReceiving(true);
  };

  const updateReceiveData = (itemId, field, value) => {
    setReceiveData(current => ({ ...current, [itemId]: { ...current[itemId], [field]: value } }));
  };

  const handleReceive = async () => {
    const receiveItems = po.items.map(it => {
      const row = receiveData[it.id] || {};
      const receiveQty = Number(row.quantity || 0);
      const product = products.find(p => p.id === it.productId);
      return {
        itemId: it.id, specId: it.specId, productId: it.productId, poNo: po.poNo,
        receiveQty,
        batchNo: row.batchNo?.trim() || '',
        gcmsNo: row.gcmsNo?.trim() || '',
        receivedDate: row.receivedDate || today(),
        expiryDate: row.expiryDate || null,
        note: row.note?.trim() || '',
        densityGml: product?.channel === 'RAW' ? defaultDensityForProduct(product) : null
      };
    }).filter(r => r.receiveQty > 0);

    if (receiveItems.length === 0) { alert('请输入收货数量'); return; }
    const invalidQuantity = receiveItems.find(received => {
      const line = po.items.find(item => item.id === received.itemId);
      return received.receiveQty > Number(line.quantity) - Number(line.receivedQty || 0);
    });
    if (invalidQuantity) { alert('本次收货数量不能超过待收数量'); return; }
    if (receiveItems.some(item => !item.batchNo)) { alert('请填写本次收货产品的批次号'); return; }
    setProcessing(true);
    try {
      await receivePOItems(po.id, receiveItems);
      setReceiving(false);
      alert('收货成功，采购进度、批次和库存已更新');
    } catch (e) { alert('收货失败: ' + e.message); } finally { setProcessing(false); }
  };

  const rawItemCount = po.items.filter(it => products.find(p => p.id === it.productId)?.channel === 'RAW').length;
  const finishedItemCount = po.items.length - rawItemCount;

  const hasReceived = po.items.some(it => Number(it.receivedQty || 0) > 0);
  const canEdit = user.role === 'ADMIN' && ['DRAFT', 'ORDERED'].includes(po.status) && !hasReceived;
  const canDelete = user.role === 'ADMIN' && ['DRAFT', 'ORDERED', 'CANCELLED'].includes(po.status) && !hasReceived;
  const handleDelete = async () => {
    if (!confirm(`将采购单 ${po.poNo} 移入回收站？30 天内可以恢复。`)) return;
    try { await removePurchaseOrder(po.id); alert('采购单已移入回收站'); onBack(); }
    catch (e) { alert('删除失败: ' + e.message); }
  };

  const handleCloseRemaining = async () => {
    const note = prompt('请填写关闭剩余采购的原因：', '供应商不再交付剩余数量');
    if (note === null) return;
    try { await closePurchaseOrder(po.id, note); alert('剩余采购已关闭，已收货库存保持不变'); }
    catch (error) { alert('关闭失败：' + error.message); }
  };

  const handleStatusChange = async (newStatus) => {
    if (!confirm(`确定更改状态为"${PO_STATUS_MAP[newStatus]?.label}"?`)) return;
    try { await updatePOStatus(po.id, newStatus); }
    catch (e) { alert('更新失败: ' + e.message); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ArrowLeft size={16} />返回</button>
      <Card className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg text-gray-700">{po.poNo}</span>
              <POBadge status={po.status} />
            </div>
            <div className="text-sm text-gray-500 mt-1">{po.createdAt} · {po.createdByName}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold" style={{ color: '#5C4B73' }}>{fmtY(po.total)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-gray-50 rounded p-3"><div className="text-xs text-gray-400">供应商</div><div className="text-sm font-medium">{po.supplier}</div></div>
          <div className="bg-gray-50 rounded p-3"><div className="text-xs text-gray-400">预计到货日</div><div className="text-sm font-medium">{formatDate(po.expectedDate)}</div></div>
          <div className="bg-gray-50 rounded p-3"><div className="text-xs text-gray-400">入库方式</div><div className="text-sm font-medium">{rawItemCount ? `原料 ${rawItemCount} 项按 kg` : ''}{rawItemCount && finishedItemCount ? ' · ' : ''}{finishedItemCount ? `成品 / 包材 ${finishedItemCount} 项按瓶 / 个` : ''}</div></div>
          {po.notes && <div className="bg-gray-50 rounded p-3"><div className="text-xs text-gray-400">备注</div><div className="text-sm">{po.notes}</div></div>}
          {po.status === 'CLOSED' && <div className="bg-amber-50 rounded p-3 col-span-2"><div className="text-xs text-amber-600">剩余采购已关闭</div><div className="text-sm text-amber-800 mt-0.5">{po.closeNote || '未填写原因'}{po.closedBy ? ` · ${po.closedBy}` : ''}</div></div>}
        </div>

        <div className="flex gap-2 pt-3 border-t border-[#EEE6D9] flex-wrap">
          {canEdit && <button onClick={onEdit} className="px-4 py-2 border border-purple-200 text-purple-700 rounded-lg text-sm"><Edit2 size={14} className="inline mr-1" />编辑</button>}
          {canDelete && <button onClick={handleDelete} className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm"><Trash2 size={14} className="inline mr-1" />删除</button>}
          {po.status === 'DRAFT' && <button onClick={() => handleStatusChange('ORDERED')} className="px-4 py-2 text-white rounded-lg text-sm" style={{ background: '#5C4B73' }}>标记已下单</button>}
          {(po.status === 'ORDERED' || po.status === 'PARTIAL_RECEIVED') && <button onClick={startReceive} className="px-4 py-2 text-white rounded-lg text-sm bg-green-600"><Truck size={14} className="inline mr-1" />{rawItemCount ? '原料按 kg 收货入库' : '收货入库'}</button>}
          {po.status === 'PARTIAL_RECEIVED' && user.role === 'ADMIN' && <button onClick={handleCloseRemaining} className="px-4 py-2 border border-amber-200 text-amber-700 rounded-lg text-sm">关闭剩余采购</button>}
          {['DRAFT', 'ORDERED'].includes(po.status) && !hasReceived && <button onClick={() => handleStatusChange('CANCELLED')} className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm">取消</button>}
        </div>
      </Card>

      {/* Items */}
      <Card className="p-4">
        <div className="text-sm font-semibold text-gray-700 mb-3">采购明细</div>
        <div className="overflow-x-auto"><table className="zidu-table w-full text-sm min-w-[720px]">
          <thead><tr className="border-b bg-gray-50/80">
            <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">产品</th>
            <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">规格</th>
            <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">数量</th>
            <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">已收</th>
            <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">单价</th>
            <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">小计</th>
          </tr></thead>
          <tbody>{po.items.map(it => {
            const product = products.find(p => p.id === it.productId);
            const isRaw = product?.channel === 'RAW';
            return (
              <tr key={it.id} className="border-b last:border-0">
                <td className="py-2 px-3">{it.productName}</td>
                <td className="py-2 px-3 text-gray-600">{isRaw ? '原料重量' : it.spec}</td>
                <td className="py-2 px-3 text-right">{it.quantity} {isRaw ? 'kg' : '瓶 / 个'}</td>
                <td className="py-2 px-3 text-right text-green-600">{it.receivedQty || 0} {isRaw ? 'kg' : '瓶 / 个'}</td>
                <td className="py-2 px-3 text-right text-gray-600">{fmtY(it.unitCost)}<span className="text-[10px] text-gray-400 ml-1">/{isRaw ? 'kg' : '件'}</span></td>
                <td className="py-2 px-3 text-right font-medium" style={{ color: '#5C4B73' }}>{fmtY(it.subtotal)}</td>
              </tr>
            );
          })}</tbody>
        </table></div>

        {receiving && (
          <div className="mt-4 pt-3 border-t space-y-3">
            <div>
              <div className="text-sm font-medium text-gray-700">本次到货与批次信息</div>
              <div className="text-[11px] text-gray-400 mt-0.5">供应商：<span className="text-gray-600">{po.supplier}</span> · 确认后自动写入批次档案、库存数量和出入库流水。</div>
            </div>
            {po.items.map(it => {
              const remaining = Number(it.quantity) - Number(it.receivedQty || 0);
              if (remaining <= 0) return null;
              const product = products.find(p => p.id === it.productId);
              const isRaw = product?.channel === 'RAW';
              const row = receiveData[it.id] || {};
              return (
                <div key={it.id} className="rounded-lg border border-green-200 bg-green-50/30 p-3">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div><span className="text-sm font-medium text-gray-800">{it.productName}</span><span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${isRaw ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{isRaw ? '原料 · kg' : `成品 · ${it.spec}`}</span></div>
                    <div className="text-xs text-gray-500">待收 {remaining} {isRaw ? 'kg' : '瓶 / 个'}</div>
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-6 gap-2.5">
                    <div><label className="block text-[11px] text-gray-500 mb-1">本次到货 {isRaw ? 'kg' : '数量'} *</label><input type="number" min="0" max={remaining} step={isRaw ? '0.001' : '1'} value={row.quantity || ''} onChange={e => updateReceiveData(it.id, 'quantity', e.target.value)} className="w-full border rounded-lg px-2.5 py-2 text-sm bg-white" /></div>
                    <div className="lg:col-span-2"><label className="block text-[11px] text-gray-500 mb-1">批次号 *</label><input value={row.batchNo || ''} onChange={e => updateReceiveData(it.id, 'batchNo', e.target.value)} placeholder="供应商批次 / 生产批号" className="w-full border rounded-lg px-2.5 py-2 text-sm bg-white" /></div>
                    {isRaw && <div><label className="block text-[11px] text-gray-500 mb-1">GC-MS 编号</label><input value={row.gcmsNo || ''} onChange={e => updateReceiveData(it.id, 'gcmsNo', e.target.value)} placeholder="可选" className="w-full border rounded-lg px-2.5 py-2 text-sm bg-white" /></div>}
                    <div><label className="block text-[11px] text-gray-500 mb-1">到货日期 *</label><input type="date" value={row.receivedDate || today()} onChange={e => updateReceiveData(it.id, 'receivedDate', e.target.value)} className="w-full border rounded-lg px-2.5 py-2 text-sm bg-white" /></div>
                    <div><label className="block text-[11px] text-gray-500 mb-1">保质期至</label><input type="date" value={row.expiryDate || ''} onChange={e => updateReceiveData(it.id, 'expiryDate', e.target.value)} className="w-full border rounded-lg px-2.5 py-2 text-sm bg-white" /></div>
                    <div className="col-span-2 lg:col-span-6"><label className="block text-[11px] text-gray-500 mb-1">备注</label><input value={row.note || ''} onChange={e => updateReceiveData(it.id, 'note', e.target.value)} placeholder="可选" className="w-full border rounded-lg px-2.5 py-2 text-sm bg-white" /></div>
                  </div>
                </div>
              );
            })}
            <div className="flex gap-2 pt-1">
              <button onClick={() => setReceiving(false)} className="px-3 py-2 text-sm border rounded-lg">取消</button>
              <button onClick={handleReceive} disabled={processing} className="px-4 py-2 text-white rounded-lg text-sm bg-green-600 disabled:opacity-40 flex items-center gap-1">
                <CheckCircle size={14} />{processing ? '处理中...' : '确认收货并入库'}
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
