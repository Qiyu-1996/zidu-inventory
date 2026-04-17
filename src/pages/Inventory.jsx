import { useState, useEffect } from 'react';
import { Search, Edit2, Download, Plus, Minus, Package, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, fmtY, SERIES_LIST, exportCSV, today } from '../components/ui';
import * as api from '../lib/api';

const REASONS = {
  PURCHASE: '采购入库',
  RETURN: '退货入库',
  DAMAGE: '损耗/报废',
  CORRECTION: '盘点修正',
  ORDER: '销售出库',
  CANCEL_RESTORE: '取消订单回库',
  OTHER: '其他'
};
const TYPE_LABEL = { IN: '入库', OUT: '出库', CORRECTION: '修正' };
const TYPE_CLS = { IN: 'bg-green-100 text-green-700', OUT: 'bg-red-100 text-red-700', CORRECTION: 'bg-blue-100 text-blue-700' };

export default function Inventory() {
  const { user } = useAuth();
  const { products, stockLog, loadStockLog, adjustStock, addBatch, removeBatch } = useData();
  const [tab, setTab] = useState('list');
  const [search, setSearch] = useState('');
  const [sf, setSf] = useState('ALL');

  // Adjust form state
  const [adjustFor, setAdjustFor] = useState(null);
  const [adjType, setAdjType] = useState('IN');
  const [adjReason, setAdjReason] = useState('PURCHASE');
  const [adjQty, setAdjQty] = useState('');
  const [adjNote, setAdjNote] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  // Batch form state
  const [batchFor, setBatchFor] = useState(null);
  const [batchData, setBatchData] = useState({ batchNo: '', gcmsNo: '', receivedDate: today(), expiryDate: '', quantity: '', unitCost: '', supplier: '', note: '' });
  const [savingBatch, setSavingBatch] = useState(false);
  const [batchList, setBatchList] = useState([]);
  const [loadingBatches, setLoadingBatches] = useState(false);

  useEffect(() => { if (tab === 'log') loadStockLog(); }, [tab, loadStockLog]);
  useEffect(() => { if (tab === 'batches') { setLoadingBatches(true); api.fetchBatches().then(setBatchList).finally(() => setLoadingBatches(false)); } }, [tab]);

  const canAdjust = user.role === 'ADMIN' || user.role === 'WAREHOUSE';

  const filtered = products.filter(p => {
    if (sf !== 'ALL' && p.series !== sf) return false;
    if (search && !`${p.code} ${p.name}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const startAdjust = (product, spec) => {
    setAdjustFor({ product, spec });
    setAdjType('IN'); setAdjReason('PURCHASE'); setAdjQty(''); setAdjNote('');
  };

  const handleAdjust = async () => {
    const qty = Number(adjQty);
    if (!qty || qty < 0) return;
    setAdjusting(true);
    try {
      await adjustStock(adjustFor.spec.id, adjustFor.product.id, adjType, adjReason, qty, adjNote);
      setAdjustFor(null);
      if (tab === 'log') await loadStockLog();
    } catch (e) { alert('调整失败: ' + e.message); } finally { setAdjusting(false); }
  };

  const startBatch = (product, spec) => {
    setBatchFor({ product, spec });
    setBatchData({ batchNo: '', gcmsNo: '', receivedDate: today(), expiryDate: '', quantity: '', unitCost: '', supplier: '', note: '' });
  };

  const handleSaveBatch = async () => {
    const qty = Number(batchData.quantity);
    if (!batchData.batchNo || !batchData.receivedDate || !qty || qty <= 0) return;
    setSavingBatch(true);
    try {
      await addBatch({
        productId: batchFor.product.id, specId: batchFor.spec.id,
        batchNo: batchData.batchNo, gcmsNo: batchData.gcmsNo,
        receivedDate: batchData.receivedDate, expiryDate: batchData.expiryDate || null,
        quantity: qty, unitCost: Number(batchData.unitCost) || 0,
        supplier: batchData.supplier, note: batchData.note
      });
      setBatchFor(null);
      alert('入库成功');
      if (tab === 'batches') { const fresh = await api.fetchBatches(); setBatchList(fresh); }
    } catch (e) { alert('入库失败: ' + e.message); } finally { setSavingBatch(false); }
  };

  const handleDeleteBatch = async (b) => {
    if (!confirm(`确定删除批次 ${b.batchNo}？剩余库存 ${b.remainingQty} 将被扣除。`)) return;
    try {
      await removeBatch(b.id, b.productId, b.specId, b.remainingQty);
      const fresh = await api.fetchBatches(); setBatchList(fresh);
    } catch (e) { alert(e.message); }
  };

  const exportLog = () => exportCSV(
    ['时间', '产品ID', '规格ID', '类型', '原因', '数量', '前库存', '后库存', '操作人', '备注'],
    stockLog.map(l => [l.created_at, l.product_id, l.spec_id, TYPE_LABEL[l.type], REASONS[l.reason] || l.reason, l.quantity, l.before_stock, l.after_stock, l.operator_name, l.note]),
    `库存变动_${new Date().toISOString().slice(0, 10)}.csv`
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setTab('list')} className={`px-4 py-2 text-sm rounded-lg border ${tab === 'list' ? 'bg-purple-100 border-purple-300 text-purple-700' : 'bg-white text-gray-600'}`}>库存概览</button>
        <button onClick={() => setTab('batches')} className={`px-4 py-2 text-sm rounded-lg border ${tab === 'batches' ? 'bg-purple-100 border-purple-300 text-purple-700' : 'bg-white text-gray-600'}`}>批次/GC-MS 追溯</button>
        <button onClick={() => setTab('log')} className={`px-4 py-2 text-sm rounded-lg border ${tab === 'log' ? 'bg-purple-100 border-purple-300 text-purple-700' : 'bg-white text-gray-600'}`}>出入库记录</button>
      </div>

      {tab === 'list' && (
        <>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
              <input placeholder="搜索" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 pr-3 py-2 text-sm border rounded-lg w-48 focus:outline-none focus:ring-2 focus:ring-purple-300" />
            </div>
            <select value={sf} onChange={e => setSf(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white">
              <option value="ALL">全部</option>
              {SERIES_LIST.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {batchFor && (
            <Card className="p-4 bg-green-50 border-green-200">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-medium">
                  批次入库：{batchFor.product.name} ({batchFor.spec.spec}) · 当前库存 {batchFor.spec.stock}
                </div>
                <button onClick={() => setBatchFor(null)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div><label className="block text-xs text-gray-500 mb-1">批次号 *</label><input value={batchData.batchNo} onChange={e => setBatchData({ ...batchData, batchNo: e.target.value })} placeholder="如：LAV202604" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs text-gray-500 mb-1">GC-MS 编号</label><input value={batchData.gcmsNo} onChange={e => setBatchData({ ...batchData, gcmsNo: e.target.value })} placeholder="可选" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs text-gray-500 mb-1">入库数量 *</label><input type="number" min="1" value={batchData.quantity} onChange={e => setBatchData({ ...batchData, quantity: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs text-gray-500 mb-1">入库日期 *</label><input type="date" value={batchData.receivedDate} onChange={e => setBatchData({ ...batchData, receivedDate: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs text-gray-500 mb-1">保质期至</label><input type="date" value={batchData.expiryDate} onChange={e => setBatchData({ ...batchData, expiryDate: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs text-gray-500 mb-1">单位成本</label><input type="number" min="0" step="0.01" value={batchData.unitCost} onChange={e => setBatchData({ ...batchData, unitCost: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                <div><label className="block text-xs text-gray-500 mb-1">供应商</label><input value={batchData.supplier} onChange={e => setBatchData({ ...batchData, supplier: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                <div className="col-span-2"><label className="block text-xs text-gray-500 mb-1">备注</label><input value={batchData.note} onChange={e => setBatchData({ ...batchData, note: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => setBatchFor(null)} className="px-3 py-1.5 text-sm border rounded-lg">取消</button>
                <button onClick={handleSaveBatch} disabled={!batchData.batchNo || !batchData.quantity || savingBatch} className="px-4 py-1.5 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: '#4a3560' }}>
                  {savingBatch ? '保存中...' : '确认入库'}
                </button>
              </div>
            </Card>
          )}

          {adjustFor && (
            <Card className="p-4 bg-purple-50 border-purple-200">
              <div className="text-sm font-medium mb-3">
                调整库存：{adjustFor.product.name} ({adjustFor.spec.spec}) · 当前库存 {adjustFor.spec.stock}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div><label className="block text-xs text-gray-500 mb-1">类型</label>
                  <select value={adjType} onChange={e => { setAdjType(e.target.value); setAdjReason(e.target.value === 'IN' ? 'PURCHASE' : e.target.value === 'OUT' ? 'DAMAGE' : 'CORRECTION'); }} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="IN">入库 (+)</option>
                    <option value="OUT">出库 (-)</option>
                    <option value="CORRECTION">修正 (直接设为)</option>
                  </select>
                </div>
                <div><label className="block text-xs text-gray-500 mb-1">原因</label>
                  <select value={adjReason} onChange={e => setAdjReason(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                    {adjType === 'IN' && <><option value="PURCHASE">采购入库</option><option value="RETURN">退货入库</option><option value="OTHER">其他</option></>}
                    {adjType === 'OUT' && <><option value="DAMAGE">损耗/报废</option><option value="OTHER">其他</option></>}
                    {adjType === 'CORRECTION' && <option value="CORRECTION">盘点修正</option>}
                  </select>
                </div>
                <div><label className="block text-xs text-gray-500 mb-1">{adjType === 'CORRECTION' ? '新库存值' : '数量'}</label>
                  <input type="number" min="0" value={adjQty} onChange={e => setAdjQty(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div><label className="block text-xs text-gray-500 mb-1">备注</label>
                  <input value={adjNote} onChange={e => setAdjNote(e.target.value)} placeholder="可选" className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => setAdjustFor(null)} className="px-3 py-1.5 text-sm border rounded-lg">取消</button>
                <button onClick={handleAdjust} disabled={!adjQty || adjusting} className="px-4 py-1.5 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: '#4a3560' }}>{adjusting ? '处理中...' : '确认调整'}</button>
              </div>
            </Card>
          )}

          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-gray-50/80">
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium">编号</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium">产品</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium hidden md:table-cell">系列</th>
                  <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium">规格 / 价格 / 库存</th>
                </tr></thead>
                <tbody>{filtered.map(p => (
                  <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50 align-top">
                    <td className="py-2.5 px-4 font-mono text-xs text-gray-500">{p.code}</td>
                    <td className="py-2.5 px-4">
                      <div className="text-gray-800 font-medium">{p.name}</div>
                      <div className="text-xs text-gray-400">{p.origin}</div>
                    </td>
                    <td className="py-2.5 px-4 text-xs text-gray-500 hidden md:table-cell">{p.series}</td>
                    <td className="py-2.5 px-4">
                      <div className="flex flex-wrap gap-1.5">
                        {p.specs.map(s => (
                          <div key={s.id} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${s.stock <= s.safeStock ? 'bg-red-50 border-red-200 text-red-700' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
                            <span>{s.spec}</span>
                            {user.role !== 'SALES' && <span>· {fmtY(s.price)}</span>}
                            <span>· {s.stock}</span>
                            {s.stock <= s.safeStock && <span>⚠</span>}
                            {canAdjust && (
                              <>
                                <button onClick={() => startAdjust(p, s)} title="调整库存" className="ml-1 text-purple-600 hover:text-purple-800"><Edit2 size={10} /></button>
                                <button onClick={() => startBatch(p, s)} title="批次入库" className="text-green-600 hover:text-green-800"><Package size={10} /></button>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === 'batches' && (
        <>
          <div className="text-sm text-gray-500">共 {batchList.length} 个批次 · 按入库日期降序</div>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-gray-50/80">
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
                  {!loadingBatches && batchList.map(b => {
                    const product = products.find(p => p.id === b.productId);
                    const spec = product?.specs.find(s => s.id === b.specId);
                    const expiringSoon = b.expiryDate && (new Date(b.expiryDate).getTime() - Date.now()) < 90 * 86400000;
                    return (
                      <tr key={b.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td className="py-2 px-3 font-mono text-xs">{b.batchNo}</td>
                        <td className="py-2 px-3"><div>{product?.name || `ID ${b.productId}`}</div><div className="text-xs text-gray-400">{spec?.spec || ''}</div></td>
                        <td className="py-2 px-3 text-xs font-mono text-gray-600">{b.gcmsNo || '—'}</td>
                        <td className="py-2 px-3 text-xs text-gray-600">{b.receivedDate}</td>
                        <td className={`py-2 px-3 text-xs ${expiringSoon ? 'text-red-500 font-medium' : 'text-gray-600'}`}>{b.expiryDate || '—'}{expiringSoon && ' ⚠'}</td>
                        <td className="py-2 px-3 text-right">{b.initialQty} / <span className={b.remainingQty === 0 ? 'text-gray-400' : 'font-medium'}>{b.remainingQty}</span></td>
                        <td className="py-2 px-3 text-xs text-gray-500 hidden md:table-cell">{b.supplier}</td>
                        {canAdjust && <td className="py-2 px-3 text-right"><button onClick={() => handleDeleteBatch(b)} className="text-gray-400 hover:text-red-500"><X size={14} /></button></td>}
                      </tr>
                    );
                  })}
                  {!loadingBatches && batchList.length === 0 && <tr><td colSpan="8" className="text-center py-12 text-gray-400 text-sm">暂无批次记录。在"库存概览"点产品规格旁的 📦 图标即可入库。</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === 'log' && (
        <>
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">共 {stockLog.length} 条记录</div>
            <button onClick={exportLog} className="flex items-center gap-1 text-xs text-purple-700 px-3 py-2 rounded border border-purple-200 hover:bg-purple-50"><Download size={13} />导出</button>
          </div>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-gray-50/80">
                  <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">时间</th>
                  <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">产品</th>
                  <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">类型</th>
                  <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">原因</th>
                  <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">数量</th>
                  <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">前→后</th>
                  <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium hidden md:table-cell">操作人</th>
                  <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium hidden md:table-cell">备注</th>
                </tr></thead>
                <tbody>{stockLog.map(l => {
                  const product = products.find(p => p.id === l.product_id);
                  const spec = product?.specs.find(s => s.id === l.spec_id);
                  return (
                    <tr key={l.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="py-2 px-3 text-xs text-gray-500 whitespace-nowrap">{l.created_at?.slice(0, 16).replace('T', ' ')}</td>
                      <td className="py-2 px-3"><div className="text-gray-800">{product?.name || `ID ${l.product_id}`}</div><div className="text-xs text-gray-400">{spec?.spec || ''}</div></td>
                      <td className="py-2 px-3"><span className={`text-xs px-2 py-0.5 rounded-full ${TYPE_CLS[l.type]}`}>{TYPE_LABEL[l.type]}</span></td>
                      <td className="py-2 px-3 text-xs text-gray-600">{REASONS[l.reason] || l.reason}</td>
                      <td className="py-2 px-3 text-right font-medium">{l.type === 'OUT' ? '-' : '+'}{l.quantity}</td>
                      <td className="py-2 px-3 text-right text-xs text-gray-500">{l.before_stock} → {l.after_stock}</td>
                      <td className="py-2 px-3 text-xs hidden md:table-cell">{l.operator_name}</td>
                      <td className="py-2 px-3 text-xs text-gray-500 hidden md:table-cell">{l.note}</td>
                    </tr>
                  );
                })}{stockLog.length === 0 && <tr><td colSpan="8" className="text-center py-12 text-gray-400 text-sm">暂无记录</td></tr>}</tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
