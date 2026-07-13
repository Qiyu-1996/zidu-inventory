import { useState, useMemo } from 'react';
import { Search, Plus, ArrowLeft, Edit2, Tag, Trash2 } from 'lucide-react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, Badge, fmtY, CUSTOMER_TYPES, PROVINCES, DISTRIBUTOR_LEVELS, customerTier, distributorLabel, distributorPriceLabel } from '../components/ui';

const CL = ["#5C4B73","#a29bfe","#5F7689","#74b9ff","#7B8F67","#fdcb6e","#8D5F5B"];

// ═══ CUSTOMER LIST ═══
export function CustomerList({ nav, onNew }) {
  const { user } = useAuth();
  const { customers, orders } = useData();
  const myCustomers = user.role === "ADMIN" ? customers : customers.filter(c => c.salesId === user.id);

  const [search, setSearch] = useState('');
  const [customerView, setCustomerView] = useState('ALL');
  const [tf, setTf] = useState('ALL');
  const [tierF, setTierF] = useState('ALL');
  const [regionF, setRegionF] = useState('ALL');

  const changeCustomerView = (view) => {
    setCustomerView(view);
    setTierF('ALL');
  };

  // 预算每个客户的累计金额与分级
  const withTier = myCustomers.map(c => {
    const co = orders.filter(o => o.customerId === c.id && o.status !== "CANCELLED");
    const tot = co.reduce((s, o) => s + o.total, 0);
    return { ...c, _total: tot, _tier: customerTier(tot, c.distributorLevel) };
  });
  const filtered = withTier.filter(c => {
    if (customerView === 'DEALER' && !Number(c.distributorLevel)) return false;
    if (tierF !== 'ALL' && c._tier !== tierF) return false;
    if (tf !== 'ALL' && c.type !== tf) return false;
    if (regionF !== 'ALL' && c.province !== regionF) return false;
    if (search && !`${c.name} ${c.contact}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="inline-flex border rounded-lg bg-gray-50 p-1">
        <button onClick={() => changeCustomerView('ALL')} className={`px-4 py-2 text-sm rounded-md ${customerView === 'ALL' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500'}`}>全部客户</button>
        <button onClick={() => changeCustomerView('DEALER')} className={`px-4 py-2 text-sm rounded-md ${customerView === 'DEALER' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500'}`}>经销商 {withTier.filter(c => Number(c.distributorLevel) > 0).length}</button>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
            <input placeholder="搜索客户" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 pr-3 py-2 text-sm border rounded-lg w-48 focus:outline-none focus:ring-2 focus:ring-purple-300" />
          </div>
          <select value={tierF} onChange={e => setTierF(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white">
            <option value="ALL">所有分级</option>
            <option value="大客户">大客户</option>
            <option value="中客户">中客户</option>
            <option value="小客户">小客户</option>
            <option value="经销商">经销商</option>
          </select>
          <select value={tf} onChange={e => setTf(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white">
            <option value="ALL">全部类型</option>
            {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={regionF} onChange={e => setRegionF(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white">
            <option value="ALL">全部地区</option>
            {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        {(customerView === 'ALL' || user.role === 'ADMIN') && (
          <button onClick={() => onNew(customerView === 'DEALER')} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-white text-sm font-medium shadow" style={{ background: "#5C4B73" }}>
            <Plus size={16} />{customerView === 'DEALER' ? '录入经销商' : '新建客户'}
          </button>
        )}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(c => {
          const co = orders.filter(o => o.customerId === c.id && o.status !== "CANCELLED");
          const tot = c._total;
          const last = co.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
          return (
            <Card key={c.id} className="p-4 cursor-pointer hover:shadow-md transition" onClick={() => nav("customerDetail", c.id)}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-medium text-gray-800">{c.name}</div>
                  <div className="text-xs text-gray-400">{c.province ? c.province + ' · ' : ''}{c.contact} · {c.phone}</div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-xs px-2 py-0.5 rounded bg-indigo-50 text-indigo-700">{c.distributorLevel ? distributorLabel(c.distributorLevel) : c._tier}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-700">{c.type}</span>
                </div>
              </div>
              <div className="flex gap-4 mt-3 pt-3 border-t text-xs text-gray-500">
                <div><span className="font-semibold text-gray-700">{co.length}</span>笔</div>
                <div>累计<span className="font-semibold" style={{ color: "#5C4B73" }}>{fmtY(tot)}</span></div>
              </div>
              {last && <div className="text-xs text-gray-400 mt-1">最近 {last.createdAt}</div>}
            </Card>
          );
        })}
        {filtered.length === 0 && <div className="col-span-full text-center py-12 text-gray-400">暂无</div>}
      </div>
    </div>
  );
}

// ═══ CUSTOMER DETAIL ═══
export function CustomerDetail({ customerId, onBack }) {
  const { user } = useAuth();
  const { customers, orders, products, users, addCustomerNote, editCustomer, removeCustomer } = useData();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);

  const customer = customers.find(c => c.id === customerId);

  const startEdit = () => {
    if (!customer) return;
    setEditData({
      name: customer.name, contact: customer.contact || '', phone: customer.phone || '',
      address: customer.address || '', type: customer.type || CUSTOMER_TYPES[0], salesId: customer.salesId,
      province: customer.province || '', distributorLevel: customer.distributorLevel || 0
    });
    setEditing(true);
  };
  const canDelete = user.role === 'ADMIN';
  const handleDeleteCustomer = async () => {
    if (!customer) return;
    if (!confirm(`确定删除客户「${customer.name}」？\n\n注意：此客户的订单记录不会被删除。此操作不可恢复。`)) return;
    try {
      await removeCustomer(customer.id);
      alert('已删除');
      onBack();
    } catch (e) { alert('删除失败: ' + e.message); }
  };

  const handleSaveEdit = async () => {
    if (!customer) return;
    setSavingEdit(true);
    try {
      await editCustomer(customer.id, editData);
      setEditing(false);
    } catch (e) { alert('保存失败: ' + e.message); } finally { setSavingEdit(false); }
  };

  const co = useMemo(() => (
    customer ? orders.filter(o => o.customerId === customer.id && o.status !== "CANCELLED") : []
  ), [customer, orders]);
  const tot = co.reduce((s, o) => s + o.total, 0);
  const seller = customer ? users.find(u => u.id === customer.salesId) : null;

  const ps = useMemo(() => {
    const m = {};
    co.forEach(o => o.items.forEach(it => {
      const k = `${it.productId}`;
      if (!m[k]) m[k] = { qty: 0, amt: 0, name: it.productName || '', code: it.productCode || '' };
      m[k].qty += it.quantity;
      m[k].amt += it.subtotal;
    }));
    return Object.values(m).sort((a, b) => b.amt - a.amt);
  }, [co]);

  const sd = useMemo(() => {
    const m = {};
    co.forEach(o => o.items.forEach(it => {
      const p = products.find(p => p.id === it.productId);
      if (p) m[p.series] = (m[p.series] || 0) + it.subtotal;
    }));
    return Object.entries(m).map(([n, v]) => ({ name: n.replace("系列", ""), value: v })).sort((a, b) => b.value - a.value);
  }, [co, products]);

  const avgI = useMemo(() => {
    if (co.length < 2) return null;
    const ds = co.map(o => new Date(o.createdAt).getTime()).sort((a, b) => a - b);
    let s = 0;
    for (let i = 1; i < ds.length; i++) s += ds[i] - ds[i - 1];
    return Math.round(s / ((ds.length - 1) * 86400000));
  }, [co]);

  if (!customer) return <div className="text-center py-12 text-gray-400">客户不存在</div>;

  const handleAddNote = async () => {
    if (!note.trim() || saving) return;
    setSaving(true);
    try {
      await addCustomerNote(customer.id, note.trim(), user.name);
      setNote('');
    } catch (e) {
      alert('添加失败: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft size={16} />返回
      </button>

      <Card className="p-5">
        {editing ? (
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-700 mb-2">编辑客户信息</div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-gray-500 mb-1">名称 *</label><input value={editData.name} onChange={e => setEditData({ ...editData, name: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">类型</label>
                <select value={editData.type} onChange={e => setEditData({ ...editData, type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                  {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div><label className="block text-xs text-gray-500 mb-1">联系人</label><input value={editData.contact} onChange={e => setEditData({ ...editData, contact: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs text-gray-500 mb-1">电话</label><input value={editData.phone} onChange={e => setEditData({ ...editData, phone: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-gray-500 mb-1">省份</label>
                <select value={editData.province || ''} onChange={e => setEditData({ ...editData, province: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                  <option value="">（不填）</option>
                  {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div><label className="block text-xs text-gray-500 mb-1">详细地址</label><input value={editData.address} onChange={e => setEditData({ ...editData, address: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            </div>
            {user.role === 'ADMIN' && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs text-gray-500 mb-1">所属销售</label>
                  <select value={editData.salesId || ''} onChange={e => setEditData({ ...editData, salesId: Number(e.target.value) || null })} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="">未分配</option>
                    {users.filter(u => u.role === 'SALES' && u.status === 'active').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </div>
                <div><label className="block text-xs text-gray-500 mb-1">经销商等级</label>
                  <select value={editData.distributorLevel || 0} onChange={e => setEditData({ ...editData, distributorLevel: Number(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                    {DISTRIBUTOR_LEVELS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-sm border rounded-lg">取消</button>
              <button onClick={handleSaveEdit} disabled={savingEdit || !editData.name.trim()} className="px-4 py-1.5 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#5C4B73" }}>
                {savingEdit ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="text-lg font-semibold text-gray-800">{customer.name}</div>
                  <button onClick={startEdit} title="编辑" className="text-gray-400 hover:text-purple-600"><Edit2 size={14} /></button>
                  {canDelete && <button onClick={handleDeleteCustomer} title="删除客户" className="text-gray-400 hover:text-red-500 ml-2"><Trash2 size={14} /></button>}
                </div>
                <div className="text-sm text-gray-500">{customer.type}</div>
                {Number(customer.distributorLevel) > 0 && (
                  <div className="mt-1 inline-flex items-center gap-1 text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                    <Tag size={12} />{distributorLabel(customer.distributorLevel)} · 下单自动{distributorPriceLabel(customer.distributorLevel)}
                  </div>
                )}
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-400">累计</div>
                <div className="text-lg font-bold" style={{ color: "#5C4B73" }}>{fmtY(tot)}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
              <div className="bg-gray-50 rounded-lg p-3"><div className="text-xs text-gray-400">联系人</div><div className="text-sm font-medium">{customer.contact}</div></div>
              <div className="bg-gray-50 rounded-lg p-3"><div className="text-xs text-gray-400">电话</div><div className="text-sm font-medium">{customer.phone}</div></div>
              <div className="bg-gray-50 rounded-lg p-3"><div className="text-xs text-gray-400">销售</div><div className="text-sm font-medium">{seller?.name || "未分配"}</div></div>
              <div className="bg-gray-50 rounded-lg p-3"><div className="text-xs text-gray-400">频率</div><div className="text-sm font-medium">{avgI ? `约${avgI}天/单` : co.length > 0 ? "1单" : "—"}</div></div>
            </div>
            <div className="bg-gray-50 rounded-lg p-3"><div className="text-xs text-gray-400">地址</div><div className="text-sm font-medium">{customer.address}</div></div>
          </>
        )}
      </Card>

      {ps.length > 0 && (
        <div className="grid md:grid-cols-2 gap-4">
          <Card className="p-4">
            <div className="text-sm font-semibold text-gray-700 mb-3">常购 Top5</div>
            <div className="space-y-2">
              {ps.slice(0, 5).map((p, i) => (
                <div key={i} className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: CL[i % 7] }}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-800 truncate">{p.name}</div>
                    <div className="text-xs text-gray-400">{p.code} · {p.qty}件</div>
                  </div>
                  <div className="text-sm font-semibold shrink-0" style={{ color: "#5C4B73" }}>{fmtY(p.amt)}</div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="p-4">
            <div className="text-sm font-semibold text-gray-700 mb-3">系列偏好</div>
            {sd.length > 0 ? (
              <ResponsiveContainer width="100%" height={180}>
                <PieChart><Pie data={sd} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} fontSize={11} labelLine>
                  {sd.map((_, i) => <Cell key={i} fill={CL[i % 7]} />)}
                </Pie><Tooltip formatter={v => fmtY(v)} /></PieChart>
              </ResponsiveContainer>
            ) : <div className="text-sm text-gray-400 text-center py-8">数据不足</div>}
          </Card>
        </div>
      )}

      {/* Orders */}
      <Card className="p-4">
        <div className="text-sm font-semibold text-gray-700 mb-2">订单（{co.length}笔）</div>
        <div className="space-y-2">
          {co.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 8).map(o => (
            <div key={o.id} className="flex items-center justify-between py-2 border-b text-sm">
              <div><span className="font-mono text-xs text-gray-500">{o.orderNo}</span><span className="text-gray-400 mx-2">·</span>{o.createdAt}</div>
              <div className="flex items-center gap-2"><span className="font-semibold" style={{ color: "#5C4B73" }}>{fmtY(o.total)}</span><Badge status={o.status} /></div>
            </div>
          ))}
          {co.length === 0 && <div className="text-sm text-gray-400 py-4 text-center">暂无</div>}
        </div>
      </Card>

      {/* Notes */}
      <Card className="p-4">
        <div className="text-sm font-semibold text-gray-700 mb-2">跟进记录</div>
        <div className="flex gap-2 mb-3">
          <input placeholder="添加备注..." value={note} onChange={e => setNote(e.target.value)} className="flex-1 border rounded-lg px-3 py-2 text-sm"
            onKeyDown={e => { if (e.key === 'Enter') handleAddNote(); }} />
          <button onClick={handleAddNote} disabled={!note.trim() || saving} className="px-4 py-2 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#5C4B73" }}>
            {saving ? '...' : '添加'}
          </button>
        </div>
        <div className="space-y-2">
          {(customer.notes || []).slice().reverse().map((n, i) => (
            <div key={i} className="bg-gray-50 rounded-lg p-3 text-sm">
              <div className="text-gray-700">{n.text}</div>
              <div className="text-xs text-gray-400 mt-1">{n.by} · {new Date(n.time).toLocaleString('zh-CN')}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
