import { useState } from 'react';
import { Plus, ArrowLeft, Search, X, CheckCircle, Truck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, POBadge, fmtY, today, PO_STATUS_MAP, exportCSV } from '../components/ui';

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

  return (
    <div className="space-y-4">
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
        <button onClick={() => nav('purchaseCreate')} className="flex items-center gap-1 px-4 py-2 text-white rounded-lg text-sm" style={{ background: '#4a3560' }}>
          <Plus size={16} />新建采购单
        </button>
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
                <div className="text-lg font-bold" style={{ color: '#4a3560' }}>{fmtY(po.total)}</div>
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
export function PurchaseOrderCreate({ onBack }) {
  const { user } = useAuth();
  const { products, addPurchaseOrder } = useData();
  const [supplier, setSupplier] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ productId: '', specId: '', productName: '', spec: '', quantity: 1, unitCost: 0 }]);
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
    if (!supplier.trim() || items.length === 0 || !items.every(it => it.productId && it.specId && it.quantity > 0 && it.unitCost >= 0)) return;
    setSaving(true);
    try {
      const poNo = `PO${Date.now().toString(36).toUpperCase()}`;
      await addPurchaseOrder({
        poNo, supplier: supplier.trim(), total,
        notes, createdByName: user.name,
        items: items.map(it => ({ ...it, subtotal: it.quantity * it.unitCost }))
      });
      alert('采购单创建成功');
      onBack();
    } catch (e) { alert('创建失败: ' + e.message); } finally { setSaving(false); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ArrowLeft size={16} />返回</button>
      <Card className="p-5 space-y-4">
        <div className="text-lg font-semibold">新建采购单</div>
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
              return (
                <div key={i} className="grid grid-cols-[1fr_100px_70px_90px_auto] gap-2 items-center">
                  <div className="flex gap-1">
                    <select value={it.productId} onChange={e => updateItem(i, 'productId', e.target.value)} className="border rounded px-2 py-1.5 text-sm flex-1 bg-white">
                      <option value="">产品</option>
                      {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <select value={it.specId} onChange={e => updateItem(i, 'specId', e.target.value)} className="border rounded px-2 py-1.5 text-sm w-20 bg-white">
                      <option value="">规格</option>
                      {(prod?.specs || []).map(s => <option key={s.id} value={s.id}>{s.spec}</option>)}
                    </select>
                  </div>
                  <input type="number" min="1" value={it.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)} placeholder="数量" className="border rounded px-2 py-1.5 text-sm" />
                  <input type="number" min="0" step="0.01" value={it.unitCost} onChange={e => updateItem(i, 'unitCost', e.target.value)} placeholder="单价" className="border rounded px-2 py-1.5 text-sm" />
                  <div className="text-sm text-right" style={{ color: '#4a3560' }}>{fmtY(it.quantity * it.unitCost)}</div>
                  <button onClick={() => removeItem(i)} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex justify-between items-center pt-3 border-t">
          <span className="text-sm text-gray-500">合计</span>
          <span className="text-xl font-bold" style={{ color: '#4a3560' }}>{fmtY(total)}</span>
        </div>

        <div className="flex gap-2">
          <button onClick={onBack} className="px-4 py-2 text-sm border rounded-lg">取消</button>
          <button onClick={handleSave} disabled={saving || !supplier.trim() || items.length === 0} className="flex-1 px-4 py-2 text-white rounded-lg text-sm disabled:opacity-40" style={{ background: '#4a3560' }}>
            {saving ? '创建中...' : '创建采购单'}
          </button>
        </div>
      </Card>
    </div>
  );
}

// ═══ PO DETAIL ═══
export function PurchaseOrderDetail({ poId, onBack }) {
  const { purchaseOrders, updatePOStatus, receivePOItems } = useData();
  const po = purchaseOrders.find(p => p.id === poId);
  const [receiving, setReceiving] = useState(false);
  const [receiveQtys, setReceiveQtys] = useState({});
  const [processing, setProcessing] = useState(false);

  if (!po) return <div className="text-center py-12 text-gray-400">采购单不存在</div>;

  const startReceive = () => {
    const init = {};
    po.items.forEach(it => { init[it.id] = 0; });
    setReceiveQtys(init); setReceiving(true);
  };

  const handleReceive = async () => {
    const receiveItems = po.items.map(it => {
      const receiveQty = Number(receiveQtys[it.id] || 0);
      return {
        itemId: it.id, specId: it.specId, productId: it.productId, poNo: po.poNo,
        receiveQty,
        newReceivedQty: (it.receivedQty || 0) + receiveQty
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
            <div className="text-2xl font-bold" style={{ color: '#4a3560' }}>{fmtY(po.total)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-gray-50 rounded p-3"><div className="text-xs text-gray-400">供应商</div><div className="text-sm font-medium">{po.supplier}</div></div>
          {po.notes && <div className="bg-gray-50 rounded p-3"><div className="text-xs text-gray-400">备注</div><div className="text-sm">{po.notes}</div></div>}
        </div>

        <div className="flex gap-2 pt-3 border-t">
          {po.status === 'DRAFT' && <button onClick={() => handleStatusChange('ORDERED')} className="px-4 py-2 text-white rounded-lg text-sm" style={{ background: '#4a3560' }}>标记已下单</button>}
          {(po.status === 'ORDERED' || po.status === 'PARTIAL_RECEIVED') && <button onClick={startReceive} className="px-4 py-2 text-white rounded-lg text-sm bg-green-600"><Truck size={14} className="inline mr-1" />收货入库</button>}
          {po.status !== 'CANCELLED' && po.status !== 'RECEIVED' && <button onClick={() => handleStatusChange('CANCELLED')} className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm">取消</button>}
        </div>
      </Card>

      {/* Items */}
      <Card className="p-4">
        <div className="text-sm font-semibold text-gray-700 mb-3">采购明细</div>
        <table className="w-full text-sm">
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
            return (
              <tr key={it.id} className="border-b last:border-0">
                <td className="py-2 px-3">{it.productName}</td>
                <td className="py-2 px-3 text-gray-600">{it.spec}</td>
                <td className="py-2 px-3 text-right">{it.quantity}</td>
                <td className="py-2 px-3 text-right text-green-600">{it.receivedQty || 0}</td>
                {receiving && (
                  <td className="py-2 px-3 text-right">
                    <input type="number" min="0" max={remaining} value={receiveQtys[it.id] || ''} onChange={e => setReceiveQtys(q => ({ ...q, [it.id]: e.target.value }))} className="w-20 border rounded px-2 py-1 text-sm text-right" placeholder="0" />
                  </td>
                )}
                <td className="py-2 px-3 text-right text-gray-600">{fmtY(it.unitCost)}</td>
                <td className="py-2 px-3 text-right font-medium" style={{ color: '#4a3560' }}>{fmtY(it.subtotal)}</td>
              </tr>
            );
          })}</tbody>
        </table>

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
