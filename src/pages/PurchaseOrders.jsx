import { useState } from 'react';
import { Plus, ArrowLeft, Search, X, CheckCircle, Truck, Edit2, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, POBadge, fmtY, PO_STATUS_MAP } from '../components/ui';

// ═══ PO LIST ═══
export function PurchaseOrderList({ nav }) {
  const { purchaseOrders } = useData();
  const [sf, setSf] = useState('ALL');
  const [search, setSearch] = useState('');

  const filtered = purchaseOrders.filter(po => {
    if (sf !== 'ALL' && po.status !== sf) return false;
    if (search && !`${po.poNo} ${po.supplier}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });
  const draftCount = purchaseOrders.filter(po => po.status === 'DRAFT').length;
  const orderedCount = purchaseOrders.filter(po => po.status === 'ORDERED').length;
  const receivingCount = purchaseOrders.filter(po => po.status === 'PARTIAL_RECEIVED').length;
  const receivedCount = purchaseOrders.filter(po => po.status === 'RECEIVED').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div><div className="zidu-section-title">采购与到货管理</div><div className="zidu-section-sub mt-1">原料按 kg 采购 · 成品按件 · 收货自动进入库存流水</div></div>
        <button onClick={() => nav('purchaseCreate')} className="btn-primary text-sm"><Plus size={16} />新建采购单</button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['草稿', draftCount, '#8A8178'], ['待收货', orderedCount, '#5F7689'], ['部分收货', receivingCount, '#F3BD5B'], ['已收货', receivedCount, '#7B8F67']].map(([label, value, color]) => <Card key={label} className="p-3.5 relative overflow-hidden"><div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: color }} /><div className="text-xs text-gray-500">{label}</div><div className="text-xl font-medium mt-1 tabular-nums">{value}</div></Card>)}
      </div>
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
            <input placeholder="搜索采购单号/供应商" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 pr-3 py-2 text-sm border rounded-lg w-56" />
          </div>
          <select value={sf} onChange={e => setSf(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white">
            <option value="ALL">全部状态</option>
            {Object.entries(PO_STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <div className="text-xs text-gray-400">显示 {filtered.length} / {purchaseOrders.length} 单</div>
      </div>

      <div className="space-y-2">
        {filtered.map(po => (
          <Card key={po.id} className="p-4 cursor-pointer hover:shadow-md" onClick={() => nav('purchaseDetail', po.id)}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-sm text-gray-600">{po.poNo}</span>
                  <POBadge status={po.status} />
                </div>
                <div className="text-sm text-gray-800">供应商：{po.supplier}</div>
                <div className="text-xs text-gray-400 mt-0.5">{po.createdAt} · {po.items.length} 项</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-bold" style={{ color: '#5C4B73' }}>{fmtY(po.total)}</div>
              </div>
            </div>
          </Card>
        ))}
        {filtered.length === 0 && <div className="text-center py-12 text-gray-400">暂无采购单</div>}
      </div>
    </div>
  );
}

// ═══ PO CREATE ═══
export function PurchaseOrderCreate({ onBack, editPo = null }) {
  const { user } = useAuth();
  const { products, addPurchaseOrder, editPurchaseOrder } = useData();
  const [supplier, setSupplier] = useState(editPo?.supplier || '');
  const [notes, setNotes] = useState(editPo?.notes || '');
  const [items, setItems] = useState(editPo?.items?.length ? editPo.items.map(it => ({ ...it })) : [{ productId: '', specId: '', productName: '', spec: '', quantity: 1, unitCost: 0 }]);
  const [saving, setSaving] = useState(false);

  const addItem = () => setItems(p => [...p, { productId: '', specId: '', productName: '', spec: '', quantity: 1, unitCost: 0 }]);
  const removeItem = (i) => setItems(p => p.filter((_, idx) => idx !== i));
  const updateItem = (i, f, v) => setItems(p => p.map((x, idx) => {
    if (idx !== i) return x;
    if (f === 'productId') {
      const prod = products.find(p => p.id === Number(v));
      return { ...x, productId: Number(v), productName: prod?.name || '', specId: '', spec: '' };
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
      alert('请检查每一行的产品、规格、数量和单价'); return;
    }
    setSaving(true);
    try {
      const payload = {
        poNo: editPo?.poNo || `PO-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Date.now().toString(36).slice(-5).toUpperCase()}`,
        supplier: supplier.trim(), total,
        notes, createdByName: user.name,
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
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs text-gray-500 mb-1">供应商 *</label><input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="供应商名称" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
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
              const isRaw = prod?.channel === 'RAW';
              return (
                <div key={i} className="grid grid-cols-2 md:grid-cols-[1fr_110px_90px_100px_auto] gap-2 items-center border-b border-[#EEE6D9] pb-2 last:border-0">
                  <div className="flex gap-1 col-span-2 md:col-span-1">
                    <select value={it.productId} onChange={e => updateItem(i, 'productId', e.target.value)} className="border rounded px-2 py-1.5 text-sm flex-1 bg-white">
                      <option value="">产品</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <select value={it.specId} onChange={e => updateItem(i, 'specId', e.target.value)} className="border rounded px-2 py-1.5 text-sm w-20 bg-white">
                      <option value="">规格</option>
                      {(prod?.specs || []).map(s => <option key={s.id} value={s.id}>{s.spec}</option>)}
                    </select>
                  </div>
                  <div className="relative"><input type="number" min={isRaw ? '0.001' : '1'} step={isRaw ? '0.001' : '1'} value={it.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)} placeholder={isRaw ? '重量' : '数量'} className="border rounded pl-2 pr-7 py-1.5 text-sm w-full" /><span className="absolute right-2 top-2 text-xs text-gray-400">{isRaw ? 'kg' : '件'}</span></div>
                  <input type="number" min="0" step="0.01" value={it.unitCost} onChange={e => updateItem(i, 'unitCost', e.target.value)} placeholder={isRaw ? '元/kg' : '单价'} className="border rounded px-2 py-1.5 text-sm" />
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
  const { purchaseOrders, products, updatePOStatus, receivePOItems, removePurchaseOrder } = useData();
  const po = purchaseOrders.find(p => p.id === poId);
  const [receiving, setReceiving] = useState(false);
  const [receiveQtys, setReceiveQtys] = useState({});
  const [receiveDensities, setReceiveDensities] = useState({});
  const [processing, setProcessing] = useState(false);

  if (!po) return <div className="text-center py-12 text-gray-400">采购单不存在</div>;

  const startReceive = () => {
    const init = {};
    const densities = {};
    po.items.forEach(it => { init[it.id] = 0; });
    po.items.forEach(it => {
      const product = products.find(p => p.id === it.productId);
      densities[it.id] = product?.densityGml || '';
    });
    setReceiveQtys(init); setReceiveDensities(densities); setReceiving(true);
  };

  const handleReceive = async () => {
    const receiveItems = po.items.map(it => {
      const receiveQty = Number(receiveQtys[it.id] || 0);
      return {
        itemId: it.id, specId: it.specId, productId: it.productId, poNo: po.poNo,
        receiveQty,
        densityGml: receiveDensities[it.id] ? Number(receiveDensities[it.id]) : null,
        densityTemperatureC: 20
      };
    }).filter(r => r.receiveQty > 0);

    if (receiveItems.length === 0) { alert('请输入收货数量'); return; }
    setProcessing(true);
    try {
      await receivePOItems(po.id, receiveItems);
      setReceiving(false);
      alert('收货成功，库存已更新');
    } catch (e) { alert('收货失败: ' + e.message); } finally { setProcessing(false); }
  };

  const canEditOrDelete = ['DRAFT', 'ORDERED'].includes(po.status) && po.items.every(it => Number(it.receivedQty || 0) === 0);
  const handleDelete = async () => {
    if (!confirm(`确定删除采购单 ${po.poNo}？该操作不可恢复。`)) return;
    try { await removePurchaseOrder(po.id); alert('采购单已删除'); onBack(); }
    catch (e) { alert('删除失败: ' + e.message); }
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
          {po.notes && <div className="bg-gray-50 rounded p-3"><div className="text-xs text-gray-400">备注</div><div className="text-sm">{po.notes}</div></div>}
        </div>

        <div className="flex gap-2 pt-3 border-t border-[#EEE6D9] flex-wrap">
          {canEditOrDelete && <button onClick={onEdit} className="px-4 py-2 border border-purple-200 text-purple-700 rounded-lg text-sm"><Edit2 size={14} className="inline mr-1" />编辑</button>}
          {canEditOrDelete && <button onClick={handleDelete} className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm"><Trash2 size={14} className="inline mr-1" />删除</button>}
          {po.status === 'DRAFT' && <button onClick={() => handleStatusChange('ORDERED')} className="px-4 py-2 text-white rounded-lg text-sm" style={{ background: '#5C4B73' }}>标记已下单</button>}
          {(po.status === 'ORDERED' || po.status === 'PARTIAL_RECEIVED') && <button onClick={startReceive} className="px-4 py-2 text-white rounded-lg text-sm bg-green-600"><Truck size={14} className="inline mr-1" />收货入库</button>}
          {po.status !== 'CANCELLED' && po.status !== 'RECEIVED' && <button onClick={() => handleStatusChange('CANCELLED')} className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm">取消</button>}
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
            {receiving && <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">本次收货</th>}
            <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">单价</th>
            <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">小计</th>
          </tr></thead>
          <tbody>{po.items.map(it => {
            const remaining = it.quantity - (it.receivedQty || 0);
            const product = products.find(p => p.id === it.productId);
            const isRaw = product?.channel === 'RAW';
            const needsDensity = isRaw && product?.inventoryMode !== 'MASS' && product?.specs?.some(s => /(?:ml|毫升|l|升)/i.test(s.spec));
            return (
              <tr key={it.id} className="border-b last:border-0">
                <td className="py-2 px-3">{it.productName}</td>
                <td className="py-2 px-3 text-gray-600">{it.spec}</td>
                <td className="py-2 px-3 text-right">{it.quantity}{isRaw ? ' kg' : ''}</td>
                <td className="py-2 px-3 text-right text-green-600">{it.receivedQty || 0}{isRaw ? ' kg' : ''}</td>
                {receiving && (
                  <td className="py-2 px-3 text-right">
                    <div className="flex items-center justify-end gap-1"><input type="number" min="0" max={remaining} step={isRaw ? '0.001' : '1'} value={receiveQtys[it.id] || ''} onChange={e => setReceiveQtys(q => ({ ...q, [it.id]: e.target.value }))} className="w-20 border rounded px-2 py-1 text-sm text-right" placeholder="0" /><span className="text-xs text-gray-400">{isRaw ? 'kg' : '件'}</span></div>
                    {needsDensity && <input type="number" min="0.001" step="0.00001" value={receiveDensities[it.id] || ''} onChange={e => setReceiveDensities(d => ({ ...d, [it.id]: e.target.value }))} className="w-28 border rounded px-2 py-1 text-xs text-right mt-1" placeholder="密度 g/ml" />}
                  </td>
                )}
                <td className="py-2 px-3 text-right text-gray-600">{fmtY(it.unitCost)}</td>
                <td className="py-2 px-3 text-right font-medium" style={{ color: '#5C4B73' }}>{fmtY(it.subtotal)}</td>
              </tr>
            );
          })}</tbody>
        </table></div>

        {receiving && (
          <div className="flex gap-2 mt-4 pt-3 border-t">
            <button onClick={() => setReceiving(false)} className="px-3 py-2 text-sm border rounded-lg">取消</button>
            <button onClick={handleReceive} disabled={processing} className="px-4 py-2 text-white rounded-lg text-sm bg-green-600 disabled:opacity-40 flex items-center gap-1">
              <CheckCircle size={14} />{processing ? '处理中...' : '确认收货'}
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
