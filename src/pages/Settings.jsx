import { useState, useEffect, useMemo } from 'react';
import { Plus, UserPlus, X, Edit2, Key, UserX, UserCheck, Trash2, Layers, Tag, Truck, ClipboardCheck, Target, FileText } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, fmtY, SERIES_LIST, CUSTOMER_TYPES, DEFAULT_SPEC_OPTIONS } from '../components/ui';
import * as api from '../lib/api';
import { defaultDensityForProduct } from '../lib/densityDefaults';
import SupplierManager from '../components/SupplierManager';

const CHANNEL_OPTIONS = [
  { value: 'FINISHED', label: '成品' },
  { value: 'RAW', label: '原料' },
  { value: 'BOTH', label: '原料+成品' },
];

function channelLabel(channel) {
  return CHANNEL_OPTIONS.find(o => o.value === (channel || 'BOTH'))?.label || '原料+成品';
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState("users");
  if (user.role !== 'ADMIN') return <Card className="p-8 text-center text-gray-400">仅管理员可访问系统管理</Card>;
  const tabs = [
    { k: "users", l: "人员管理", icon: UserPlus },
    { k: "products", l: "产品管理", icon: Layers },
    { k: "suppliers", l: "供应商", icon: Truck },
    { k: "targets", l: "销售目标", icon: Target },
    { k: "config", l: "基础设置", icon: ClipboardCheck },
    { k: "audit", l: "操作日志", icon: FileText }
  ];
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto pb-1">
        <div className="zidu-segment" aria-label="系统管理分类">
          {tabs.map(t => {
            const Icon = t.icon;
            return <button key={t.k} onClick={() => setTab(t.k)} className={tab === t.k ? 'active' : ''}><Icon size={14} className="inline mr-1.5" />{t.l}</button>;
          })}
        </div>
      </div>
      {tab === "users" && <UserMgmt />}
      {tab === "products" && <ProductMgmt />}
      {tab === "suppliers" && <SupplierManager />}
      {tab === "targets" && <TargetMgmt />}
      {tab === "config" && <ConfigMgmt />}
      {tab === "audit" && <AuditLogView />}
    </div>
  );
}

function UserMgmt() {
  const { user: currentUser } = useAuth();
  const { users, addUser, resetUserPassword, toggleUserStatus, updateUserRole, archiveUser } = useData();
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pw, setPw] = useState('');
  const [role, setRole] = useState('SALES');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [resetForUser, setResetForUser] = useState(null);
  const [newPw, setNewPw] = useState('');
  const [roleForUser, setRoleForUser] = useState(null);
  const [roleDraft, setRoleDraft] = useState('SALES');
  const canCreateAccounts = currentUser?.isSuperAdmin === true;

  const handleCreate = async () => {
    if (!canCreateAccounts) { setError('只有超级管理员可以创建账号'); return; }
    if (!name.trim() || !phone.trim() || !pw.trim()) return;
    if (pw.length < 8) { setError('密码至少需要8位'); return; }
    setSaving(true); setError('');
    try {
      await addUser(name.trim(), phone.trim(), pw, role);
      setShow(false); setName(''); setPhone(''); setPw('');
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const handleReset = async () => {
    if (!newPw.trim() || !resetForUser) return;
    if (newPw.length < 8) { alert('密码至少需要8位'); return; }
    try {
      await resetUserPassword(resetForUser.id, newPw);
      alert(`已重置 ${resetForUser.name} 的密码`);
      setResetForUser(null); setNewPw('');
    } catch (e) { alert('重置失败: ' + e.message); }
  };

  const handleToggle = async (u) => {
    const newStatus = u.status === 'active' ? 'disabled' : 'active';
    if (!confirm(`确定${newStatus === 'disabled' ? '禁用' : '启用'} ${u.name}?`)) return;
    try { await toggleUserStatus(u.id, newStatus); }
    catch (e) { alert('操作失败: ' + e.message); }
  };

  const handleRoleChange = async () => {
    if (!roleForUser || roleDraft === (roleForUser.accessRole || roleForUser.role)) { setRoleForUser(null); return; }
    try {
      await updateUserRole(roleForUser.id, roleDraft);
      setRoleForUser(null);
    } catch (e) { alert('修改失败: ' + e.message); }
  };

  const handleArchive = async (u) => {
    if (!confirm(`确定删除账号“${u.name}”吗？\n\n该账号将不能再登录，但历史订单、客户与财务记录会保留。`)) return;
    try { await archiveUser(u.id); }
    catch (e) { alert('删除失败: ' + e.message); }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-gray-700">人员管理</div>
        {canCreateAccounts ? (
          <button onClick={() => setShow(!show)} className="flex items-center gap-1 text-sm font-medium text-purple-700"><UserPlus size={16} />创建账号</button>
        ) : (
          <span className="text-xs text-gray-400">账号创建由超级管理员操作</span>
        )}
      </div>

      {show && canCreateAccounts && (
        <div className="bg-purple-50 rounded-lg p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">姓名 *</label><input value={name} onChange={e => setName(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">手机号 *</label><input value={phone} onChange={e => setPhone(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">密码 *（至少8位）</label><input type="password" value={pw} onChange={e => setPw(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">角色</label>
              <select value={role} onChange={e => setRole(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="SALES">销售</option><option value="WAREHOUSE">仓库</option><option value="FINANCE">财务</option><option value="ADMIN">管理员</option><option value="SUPER_ADMIN">超级管理员</option>
              </select>
            </div>
          </div>
          {error && <div className="text-sm text-red-500">{error}</div>}
          <div className="flex gap-2">
            <button onClick={() => setShow(false)} className="px-3 py-1.5 text-sm border rounded-lg">取消</button>
            <button onClick={handleCreate} disabled={!name.trim() || !phone.trim() || !pw.trim() || saving} className="px-4 py-1.5 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#5C4B73" }}>
              {saving ? '创建中...' : '创建'}
            </button>
          </div>
        </div>
      )}

      {resetForUser && (
        <div className="bg-yellow-50 rounded-lg p-4 mb-4 space-y-3 border border-yellow-200">
          <div className="text-sm font-medium">重置 {resetForUser.name} 的密码</div>
          <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="输入至少8位新密码" className="w-full border rounded-lg px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <button onClick={() => { setResetForUser(null); setNewPw(''); }} className="px-3 py-1.5 text-sm border rounded-lg">取消</button>
            <button onClick={handleReset} disabled={newPw.length < 8} className="px-4 py-1.5 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#5C4B73" }}>确认重置</button>
          </div>
        </div>
      )}

      {roleForUser && (
        <div className="bg-purple-50 rounded-lg p-4 mb-4 space-y-3 border border-purple-200">
          <div className="text-sm font-medium">修改 {roleForUser.name} 的角色</div>
          <select value={roleDraft} onChange={e => setRoleDraft(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
            <option value="SALES">销售</option><option value="WAREHOUSE">仓库</option><option value="FINANCE">财务</option><option value="ADMIN">管理员</option>
            {currentUser?.isSuperAdmin && <option value="SUPER_ADMIN">超级管理员</option>}
          </select>
          <div className="flex gap-2">
            <button onClick={() => setRoleForUser(null)} className="px-3 py-1.5 text-sm border rounded-lg">取消</button>
            <button onClick={handleRoleChange} className="px-4 py-1.5 text-sm text-white rounded-lg" style={{ background: '#5C4B73' }}>保存角色</button>
          </div>
        </div>
      )}

      <table className="w-full text-sm">
        <thead><tr className="border-b bg-gray-50/80">
          <th className="text-left py-2 px-4 text-xs text-gray-500 font-medium">姓名</th>
          <th className="text-left py-2 px-4 text-xs text-gray-500 font-medium">手机号</th>
          <th className="text-left py-2 px-4 text-xs text-gray-500 font-medium">角色</th>
          <th className="text-center py-2 px-4 text-xs text-gray-500 font-medium">状态</th>
          <th className="text-right py-2 px-4 text-xs text-gray-500 font-medium">操作</th>
        </tr></thead>
        <tbody>{users.filter(u => u.status !== 'deleted').map(u => (
          <tr key={u.id} className="border-b last:border-0">
            <td className="py-2.5 px-4 font-medium">{u.name}</td>
            <td className="py-2.5 px-4 font-mono text-xs text-gray-600">{u.phone}</td>
            <td className="py-2.5 px-4">
              <span className={`text-xs px-2 py-0.5 rounded-full ${u.role === "ADMIN" ? "bg-purple-100 text-purple-700" : u.role === "SALES" ? "bg-blue-100 text-blue-700" : u.role === "FINANCE" ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"}`}>
                {u.roleLabel || { ADMIN: "管理员", SALES: "销售", WAREHOUSE: "仓库", FINANCE: "财务" }[u.role]}
              </span>
            </td>
            <td className="py-2.5 px-4 text-center text-xs">
              {u.status === 'disabled' ? <span className="text-red-500">已禁用</span> : <span className="text-green-600">启用</span>}
            </td>
            <td className="py-2.5 px-4 text-right space-x-2">
              {(currentUser.isSuperAdmin || !u.isSuperAdmin) && <button onClick={() => setResetForUser(u)} title="重置密码" className="text-gray-500 hover:text-purple-600"><Key size={14} /></button>}
              {u.id !== currentUser.id && (currentUser.isSuperAdmin || !u.isSuperAdmin) && <button onClick={() => { setRoleForUser(u); setRoleDraft(u.accessRole || u.role); }} title="修改角色" className="text-gray-500 hover:text-purple-600"><Edit2 size={14} /></button>}
              {u.id !== currentUser.id && (currentUser.isSuperAdmin || !u.isSuperAdmin) && (
                <>
                  <button onClick={() => handleToggle(u)} title={u.status === 'active' ? '禁用' : '启用'} className={u.status === 'active' ? 'text-gray-500 hover:text-red-500' : 'text-gray-500 hover:text-green-600'}>
                    {u.status === 'active' ? <UserX size={14} /> : <UserCheck size={14} />}
                  </button>
                  <button onClick={() => handleArchive(u)} title="删除账号" className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                </>
              )}
            </td>
          </tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

function ProductMgmt() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const { products, addProduct, editProduct, removeProduct } = useData();
  const [show, setShow] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [series, setSeries] = useState('');
  const [origin, setOrigin] = useState('');
  const [channel, setChannel] = useState('FINISHED');
  const [inventoryMode, setInventoryMode] = useState('SKU');
  const [baseStockKg, setBaseStockKg] = useState('');
  const [safeStockKg, setSafeStockKg] = useState('');
  const [densityGml, setDensityGml] = useState('');
  const [specs, setSpecs] = useState([{ spec: '10ml', price: '', cost: '', stock: '', safeStock: 10 }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setShow(false); setEditingId(null); setCode(''); setName(''); setSeries(''); setOrigin('');
    setChannel('FINISHED');
    setInventoryMode('SKU'); setBaseStockKg(''); setSafeStockKg(''); setDensityGml('');
    setSpecs([{ spec: '10ml', price: '', cost: '', stock: '', safeStock: 10 }]);
  };

  const startEdit = (p) => {
    setEditingId(p.id); setCode(p.code); setName(p.name); setSeries(p.series); setOrigin(p.origin);
    setChannel(p.channel || 'BOTH');
    setInventoryMode(p.channel === 'RAW' ? 'MASS' : (p.inventoryMode || 'SKU')); setBaseStockKg(p.baseStockKg || '');
    setSafeStockKg(p.safeStockKg || ''); setDensityGml(p.densityGml || '');
    setSpecs(p.specs.map(s => ({ id: s.id, spec: s.spec, price: s.price, cost: s.cost ?? '', stock: s.stock, safeStock: s.safeStock })));
    setShow(true);
  };

  const addSpec = () => setSpecs(p => [...p, { spec: '', price: '', cost: '', stock: '', safeStock: 10 }]);
  const updateSpec = (i, f, v) => setSpecs(p => p.map((s, idx) => idx === i ? { ...s, [f]: v } : s));
  const removeSpec = i => setSpecs(p => p.filter((_, idx) => idx !== i));
  const usesWeightInventory = channel === 'RAW' || inventoryMode === 'MASS';
  const effectiveDensity = usesWeightInventory ? defaultDensityForProduct({ code, name, series, densityGml }) : null;

  const handleSave = async () => {
    if (!code.trim() || !name.trim() || !series || specs.length === 0 || !specs.every(s => s.spec && s.price)) return;
    setSaving(true); setError('');
    try {
      const payload = {
        code: code.trim(), name: name.trim(), series, origin: origin.trim() || '中国', channel,
        inventoryMode: channel === 'RAW' ? 'MASS' : inventoryMode,
        baseStockKg: Number(baseStockKg) || 0, safeStockKg: Number(safeStockKg) || 0,
        densityGml: effectiveDensity,
        densityTemperatureC: 20,
        densitySource: usesWeightInventory ? '系统按产品编号带入的常用密度，可由管理员修改' : '',
        densityStatus: usesWeightInventory ? 'REFERENCE' : 'UNSET',
        specs: specs.map(s => ({ id: s.id, spec: s.spec, price: Number(s.price), cost: Number(s.cost) || 0, stock: Number(s.stock) || 0, safeStock: Number(s.safeStock) || 10 }))
      };
      if (editingId) await editProduct({ ...payload, id: editingId });
      else await addProduct(payload);
      reset();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const handleDelete = async (p) => {
    if (!confirm(`确定删除产品 "${p.name}" 吗？此操作不可恢复。`)) return;
    try { await removeProduct(p.id); }
    catch (e) { alert('删除失败: ' + e.message); }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-sm font-semibold text-gray-700">产品管理（{products.length} SKU）</div>
        <div className="flex items-center gap-3">
          <button onClick={() => show ? reset() : setShow(true)} className="flex items-center gap-1 text-sm font-medium text-purple-700"><Plus size={16} />添加产品</button>
        </div>
      </div>

      {show && (
        <div className="bg-purple-50 rounded-lg p-4 mb-4 space-y-3">
          <div className="text-sm font-medium">{editingId ? '编辑产品' : '新建产品'}</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">编码 *</label><input value={code} onChange={e => setCode(e.target.value)} placeholder="EO-XXX-01" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">名称 *</label><input value={name} onChange={e => setName(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">系列 *</label>
              <select value={series} onChange={e => setSeries(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">选择</option>{SERIES_LIST.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div><label className="block text-xs text-gray-500 mb-1">产地</label><input value={origin} onChange={e => setOrigin(e.target.value)} placeholder="中国" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">归属 *</label>
              <select value={channel} onChange={e => { const next = e.target.value; setChannel(next); if (next === 'RAW') setInventoryMode('MASS'); }} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                {CHANNEL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          {(channel === 'RAW' || channel === 'BOTH') && (
            <div className="border border-purple-200 bg-white rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div><div className="text-xs font-medium text-gray-700">原料重量库存</div><div className="text-xs text-gray-400 mt-0.5">按 kg 入库；ml 规格按该原料密度自动换算扣减</div></div>
                {channel === 'RAW' ? <span className="text-xs px-2.5 py-1.5 rounded-md bg-green-50 border border-green-200 text-green-700">固定按 kg 统一库存</span> : (
                  <select value={inventoryMode} onChange={e => setInventoryMode(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="SKU">各规格独立库存</option><option value="MASS">按 kg 统一库存</option>
                  </select>
                )}
              </div>
              {inventoryMode === 'MASS' && <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div><label className="block text-xs text-gray-500 mb-1">实际库存 kg *</label><input type="number" min="0" step="0.001" value={baseStockKg} onChange={e => setBaseStockKg(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                  <div><label className="block text-xs text-gray-500 mb-1">安全库存 kg</label><input type="number" min="0" step="0.001" value={safeStockKg} onChange={e => setSafeStockKg(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
                  <div><label className="block text-xs text-gray-500 mb-1">密度 g/ml</label><input type="number" min="0" step="0.00001" value={densityGml || effectiveDensity || ''} onChange={e => setDensityGml(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /><div className="text-[11px] text-gray-400 mt-1">系统已按产品带入常用值，可直接修改</div></div>
                </div>
              </>}
            </div>
          )}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-gray-500 font-medium">可售规格</div>
              <button onClick={addSpec} className="text-xs text-purple-600 flex items-center gap-0.5"><Plus size={12} />添加规格</button>
            </div>
            <datalist id="product-spec-options">
              {DEFAULT_SPEC_OPTIONS.map(o => <option key={o} value={o} />)}
            </datalist>
            <div className="overflow-x-auto pb-1">
              <div className="min-w-[680px]">
                <div className="grid grid-cols-[minmax(150px,1.5fr)_minmax(100px,1fr)_minmax(100px,1fr)_minmax(100px,1fr)_minmax(110px,1fr)_32px] gap-2 px-0.5 mb-1.5">
                  <div className="text-xs text-gray-500">规格</div>
                  <div className="text-xs text-gray-500">售价（元）</div>
                  <div className="text-xs text-gray-500">成本（元）</div>
                  <div className="text-xs text-gray-500">库存</div>
                  <div className="text-xs text-gray-500">安全库存</div>
                  <span aria-hidden="true" />
                </div>
                {specs.map((s, i) => (
                  <div key={i} className="grid grid-cols-[minmax(150px,1.5fr)_minmax(100px,1fr)_minmax(100px,1fr)_minmax(100px,1fr)_minmax(110px,1fr)_32px] gap-2 items-center mb-2">
                    <input aria-label="规格" list="product-spec-options" value={s.spec} onChange={e => updateSpec(i, 'spec', e.target.value)} placeholder="如 10ml" className="w-full min-w-0 border rounded-lg px-3 py-2 text-sm" />
                    <input aria-label="售价" type="number" value={s.price} onChange={e => updateSpec(i, 'price', e.target.value)} placeholder="0" className="w-full min-w-0 border rounded-lg px-3 py-2 text-sm" />
                    <input aria-label="成本" type="number" value={s.cost} onChange={e => updateSpec(i, 'cost', e.target.value)} placeholder="0" className="w-full min-w-0 border rounded-lg px-3 py-2 text-sm" title="成本（留空或 0 表示未录）" />
                    <input aria-label="库存" type="number" value={s.stock} onChange={e => updateSpec(i, 'stock', e.target.value)} placeholder={channel === 'RAW' || inventoryMode === 'MASS' ? '按 kg' : '瓶 / 个'} disabled={channel === 'RAW' || inventoryMode === 'MASS'} className="w-full min-w-0 border rounded-lg px-3 py-2 text-sm disabled:bg-gray-100 disabled:text-gray-400" />
                    <input aria-label="安全库存" type="number" value={s.safeStock} onChange={e => updateSpec(i, 'safeStock', e.target.value)} placeholder="0" className="w-full min-w-0 border rounded-lg px-3 py-2 text-sm" />
                    {specs.length > 1 ? <button onClick={() => removeSpec(i)} title="删除规格" className="zidu-icon-button !w-8 !h-8 text-gray-400 hover:text-red-500"><X size={14} /></button> : <span aria-hidden="true" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
          {error && <div className="text-sm text-red-500">{error}</div>}
          <div className="flex gap-2">
            <button onClick={reset} className="px-3 py-1.5 text-sm border rounded-lg">取消</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#5C4B73" }}>
              {saving ? '保存中...' : (editingId ? '保存修改' : '添加')}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto max-h-96 overflow-y-auto">
        <table className="w-full text-sm"><thead className="sticky top-0"><tr className="border-b bg-gray-50">
          <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">编码</th>
          <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">名称</th>
          <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium hidden md:table-cell">系列</th>
          <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium hidden lg:table-cell">归属</th>
          <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">{isAdmin ? '规格/售价/成本/毛利率' : '规格/价格'}</th>
          <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">操作</th>
        </tr></thead>
        <tbody>{products.map(p => (
          <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50 align-top">
            <td className="py-2 px-3 font-mono text-xs text-gray-500">{p.code}</td>
            <td className="py-2 px-3 text-gray-800">{p.name}</td>
            <td className="py-2 px-3 text-xs text-gray-500 hidden md:table-cell">{p.series}</td>
            <td className="py-2 px-3 text-xs text-gray-500 hidden lg:table-cell">{channelLabel(p.channel)}</td>
            <td className="py-2 px-3">
              {isAdmin ? (
                <div className="flex flex-wrap gap-1.5">{p.specs.map(s => {
                  const cost = Number(s.cost) || 0;
                  const price = Number(s.price) || 0;
                  const hasCost = cost > 0;
                  const margin = hasCost && price > 0 ? (price - cost) / price : 0;
                  return (
                    <span key={s.id} className="text-xs px-1.5 py-1 rounded bg-gray-100 text-gray-600 leading-tight">
                      <span className="font-medium text-gray-700">{s.spec}</span> 售{fmtY(price)}
                      <span className="text-gray-400"> · 成本{hasCost ? fmtY(cost) : '未录'}</span>
                      {hasCost && <span className={`ml-0.5 font-medium ${margin < 0 ? 'text-red-500' : 'text-green-600'}`}>毛利{(margin * 100).toFixed(0)}%</span>}
                    </span>
                  );
                })}</div>
              ) : (
                <div className="flex flex-wrap gap-1">{p.specs.map(s => <span key={s.id} className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{s.spec}={fmtY(s.price)}</span>)}</div>
              )}
            </td>
            <td className="py-2 px-3 text-right space-x-2 whitespace-nowrap">
              <button onClick={() => startEdit(p)} title="编辑" className="text-gray-500 hover:text-purple-600"><Edit2 size={14} /></button>
              <button onClick={() => handleDelete(p)} title="删除" className="text-gray-500 hover:text-red-500"><X size={14} /></button>
            </td>
          </tr>
        ))}</tbody></table>
      </div>
    </Card>
  );
}

function PricingMgmt() {
  const { pricingTiers, updateTiers } = useData();
  const [tiers, setTiers] = useState(pricingTiers.length > 0 ? pricingTiers : [{ minSpend: 0, discount: 0, label: '' }]);
  const [saving, setSaving] = useState(false);

  const addTier = () => setTiers(t => [...t, { minSpend: 0, discount: 0, label: '' }]);
  const updateTier = (i, f, v) => setTiers(t => t.map((x, idx) => idx === i ? { ...x, [f]: f === 'label' ? v : Number(v) } : x));
  const removeTier = i => setTiers(t => t.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    setSaving(true);
    try {
      const valid = tiers.filter(t => t.label && t.minSpend >= 0);
      await updateTiers(valid.sort((a, b) => a.minSpend - b.minSpend));
      alert('保存成功');
    } catch (e) { alert('保存失败: ' + e.message); } finally { setSaving(false); }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Tag size={16} className="text-purple-600" />
        <div className="text-sm font-semibold text-gray-700">阶梯定价规则</div>
      </div>
      <div className="text-xs text-gray-500 mb-4">根据客户年度累计消费金额，自动应用对应折扣。结算时系统自动计算。</div>
      <div className="space-y-3">
        {tiers.map((t, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input placeholder="等级名称" value={t.label} onChange={e => updateTier(i, 'label', e.target.value)} className="border rounded-lg px-3 py-2 text-sm flex-1" />
            <span className="text-xs text-gray-500">年消费≥¥</span>
            <input type="number" value={t.minSpend} onChange={e => updateTier(i, 'minSpend', e.target.value)} className="border rounded-lg px-3 py-2 text-sm w-32" />
            <span className="text-xs text-gray-500">享</span>
            <input type="number" value={t.discount} onChange={e => updateTier(i, 'discount', e.target.value)} className="border rounded-lg px-3 py-2 text-sm w-20" />
            <span className="text-xs text-gray-500">%折扣</span>
            <button onClick={() => removeTier(i)} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
          </div>
        ))}
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={addTier} className="text-sm text-purple-600 flex items-center gap-1"><Plus size={14} />添加等级</button>
        <button onClick={handleSave} disabled={saving} className="ml-auto px-4 py-2 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#5C4B73" }}>
          {saving ? '保存中...' : '保存规则'}
        </button>
      </div>
    </Card>
  );
}

function ScenarioMgmt() {
  const { scenarioPackages, products, updatePackageItems } = useData();
  const [editingPkg, setEditingPkg] = useState(null);
  const [items, setItems] = useState([]);
  const [saving, setSaving] = useState(false);

  const startEdit = (pkg) => {
    setEditingPkg(pkg);
    setItems(pkg.items.map(it => {
      const p = products.find(p => p.id === it.productId);
      const s = p?.specs.find(s => s.id === it.specId);
      return { productId: it.productId, specId: it.specId, quantity: it.quantity, productName: p?.name || '', spec: s?.spec || '' };
    }));
  };

  const addItem = () => setItems(i => [...i, { productId: '', specId: '', quantity: 1 }]);
  const updateItem = (i, f, v) => setItems(it => it.map((x, idx) => {
    if (idx !== i) return x;
    if (f === 'productId') return { ...x, productId: Number(v), specId: '', productName: products.find(p => p.id === Number(v))?.name || '' };
    if (f === 'specId') {
      const p = products.find(p => p.id === x.productId);
      const s = p?.specs.find(s => s.id === Number(v));
      return { ...x, specId: Number(v), spec: s?.spec || '' };
    }
    return { ...x, [f]: Number(v) || 1 };
  }));
  const removeItem = i => setItems(it => it.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    setSaving(true);
    try {
      const valid = items.filter(it => it.productId && it.specId && it.quantity > 0);
      await updatePackageItems(editingPkg.id, valid);
      alert('保存成功');
      setEditingPkg(null); setItems([]);
    } catch (e) { alert('保存失败: ' + e.message); } finally { setSaving(false); }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Layers size={16} className="text-purple-600" />
        <div className="text-sm font-semibold text-gray-700">场景方案套餐</div>
      </div>
      <div className="text-xs text-gray-500 mb-4">配置 7 大专业方案产品组合，销售在下单时可一键加入购物车。</div>

      {editingPkg ? (
        <div className="bg-purple-50 rounded-lg p-4 space-y-3">
          <div className="text-sm font-medium">{editingPkg.code} · {editingPkg.name}</div>
          <div className="text-xs text-gray-500">{editingPkg.description}</div>
          <div className="space-y-2">
            {items.map((it, i) => {
              const p = products.find(p => p.id === it.productId);
              return (
                <div key={i} className="flex gap-2 items-center bg-white p-2 rounded">
                  <select value={it.productId} onChange={e => updateItem(i, 'productId', e.target.value)} className="border rounded px-2 py-1 text-sm flex-1 bg-white">
                    <option value="">选择产品</option>
                    {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <select value={it.specId} onChange={e => updateItem(i, 'specId', e.target.value)} className="border rounded px-2 py-1 text-sm w-24 bg-white">
                    <option value="">规格</option>
                    {(p?.specs || []).map(s => <option key={s.id} value={s.id}>{s.spec}</option>)}
                  </select>
                  <input type="number" value={it.quantity} onChange={e => updateItem(i, 'quantity', e.target.value)} className="border rounded px-2 py-1 text-sm w-16" min="1" />
                  <button onClick={() => removeItem(i)} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button onClick={addItem} className="text-sm text-purple-600 flex items-center gap-1"><Plus size={14} />添加产品</button>
            <button onClick={() => { setEditingPkg(null); setItems([]); }} className="ml-auto px-3 py-1.5 text-sm border rounded-lg">取消</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#5C4B73" }}>
              {saving ? '保存中...' : '保存方案'}
            </button>
          </div>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {scenarioPackages.map(pkg => (
            <div key={pkg.id} className="border rounded-lg p-3 hover:border-purple-300 cursor-pointer" onClick={() => startEdit(pkg)}>
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">{pkg.code}</span>
                <span className="text-xs text-gray-400">{pkg.items.length} 个产品</span>
              </div>
              <div className="font-medium text-gray-800">{pkg.name}</div>
              <div className="text-xs text-gray-500 mt-1">{pkg.description}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TargetMgmt() {
  const { users, salesTargets, orders, customers, setTarget } = useData();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [editing, setEditing] = useState({});
  const salesUsers = users.filter(u => u.role === 'SALES' && u.status === 'active');

  const monthPrefix = `${year}-${String(month).padStart(2, '0')}`;

  const monthOrders = useMemo(() => {
    return orders.filter(o => o.status !== 'CANCELLED' && (o.createdAt || '').startsWith(monthPrefix));
  }, [orders, monthPrefix]);

  const getActualAmount = (sId) => monthOrders.filter(o => o.salesId === sId).reduce((s, o) => s + o.total, 0);
  const getActualOrderCount = (sId) => monthOrders.filter(o => o.salesId === sId).length;
  const getActualNewCustomers = (sId) => customers.filter(c => c.salesId === sId && (c.createdAt || '').startsWith(monthPrefix)).length;
  const getTarget = (sId) => salesTargets.find(t => t.salesId === sId && t.year === year && t.month === month);

  const handleSave = async (sId) => {
    const data = editing[sId];
    if (!data) return;
    try {
      await setTarget({
        salesId: sId, year, month,
        targetAmount: Number(data.targetAmount) || 0,
        commissionRate: Number(data.commissionRate) || 0,
        targetNewCustomers: Number(data.targetNewCustomers) || 0,
        targetOrderCount: Number(data.targetOrderCount) || 0,
        note: data.note || ''
      });
      setEditing(e => ({ ...e, [sId]: null }));
      alert('保存成功');
    } catch (e) { alert(e.message); }
  };

  const ProgressBar = ({ pct }) => (
    <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
      <div className={`h-full ${pct >= 100 ? 'bg-green-500' : pct >= 80 ? 'bg-blue-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-orange-400'}`} style={{ width: `${Math.min(100, pct)}%` }}></div>
    </div>
  );

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2"><Target size={16} className="text-purple-600" /><div className="text-sm font-semibold text-gray-700">销售业绩目标 / KPI</div></div>
        <div className="flex gap-2 items-center text-sm">
          <select value={year} onChange={e => setYear(Number(e.target.value))} className="border rounded-lg px-3 py-1.5 bg-white">
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(y => <option key={y} value={y}>{y}年</option>)}
          </select>
          <select value={month} onChange={e => setMonth(Number(e.target.value))} className="border rounded-lg px-3 py-1.5 bg-white">
            {Array.from({ length: 12 }, (_, i) => i + 1).map(m => <option key={m} value={m}>{m}月</option>)}
          </select>
        </div>
      </div>

      <div className="text-xs text-gray-500 mb-4">
        管理员为每个销售设定月度 KPI：销售额 + 新增客户数 + 订单数。系统自动追踪完成情况。提成 = 实际销售额 × 提成比例。
      </div>

      <div className="space-y-3">
        {salesUsers.map(u => {
          const actualAmt = getActualAmount(u.id);
          const actualOrders = getActualOrderCount(u.id);
          const actualNew = getActualNewCustomers(u.id);
          const target = getTarget(u.id);
          const targetAmt = target?.targetAmount || 0;
          const targetNew = target?.targetNewCustomers || 0;
          const targetOrders = target?.targetOrderCount || 0;
          const commission = Math.round(actualAmt * (target?.commissionRate || 0) / 100);
          const pctAmt = targetAmt > 0 ? Math.round(actualAmt / targetAmt * 100) : 0;
          const pctNew = targetNew > 0 ? Math.round(actualNew / targetNew * 100) : 0;
          const pctOrders = targetOrders > 0 ? Math.round(actualOrders / targetOrders * 100) : 0;
          const ed = editing[u.id];
          return (
            <div key={u.id} className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="font-medium flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs text-white font-bold" style={{ background: '#5C4B73' }}>{u.name[0]}</div>
                  {u.name}
                </div>
                {!ed && (
                  <button onClick={() => setEditing(e => ({ ...e, [u.id]: {
                    targetAmount: targetAmt,
                    commissionRate: target?.commissionRate || 0,
                    targetNewCustomers: targetNew,
                    targetOrderCount: targetOrders
                  } }))} className="text-purple-600 text-xs flex items-center gap-1"><Edit2 size={12} /> 设定 KPI</button>
                )}
              </div>

              {ed ? (
                <div className="bg-purple-50 rounded-lg p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="block text-xs text-gray-500 mb-1">销售额目标 (¥)</label>
                      <input type="number" value={ed.targetAmount} onChange={e => setEditing(x => ({ ...x, [u.id]: { ...ed, targetAmount: e.target.value } }))} className="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                    <div><label className="block text-xs text-gray-500 mb-1">提成比例 (%)</label>
                      <input type="number" step="0.1" value={ed.commissionRate} onChange={e => setEditing(x => ({ ...x, [u.id]: { ...ed, commissionRate: e.target.value } }))} className="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                    <div><label className="block text-xs text-gray-500 mb-1">新增客户目标</label>
                      <input type="number" value={ed.targetNewCustomers} onChange={e => setEditing(x => ({ ...x, [u.id]: { ...ed, targetNewCustomers: e.target.value } }))} className="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                    <div><label className="block text-xs text-gray-500 mb-1">订单数目标</label>
                      <input type="number" value={ed.targetOrderCount} onChange={e => setEditing(x => ({ ...x, [u.id]: { ...ed, targetOrderCount: e.target.value } }))} className="w-full border rounded px-2 py-1.5 text-sm" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditing(x => ({ ...x, [u.id]: null }))} className="px-3 py-1.5 text-xs border rounded">取消</button>
                    <button onClick={() => handleSave(u.id)} className="flex-1 px-3 py-1.5 text-xs text-white rounded" style={{ background: '#5C4B73' }}>保存 KPI</button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Sales Amount KPI */}
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-500 text-xs">💰 销售额</span>
                      <span className="text-xs">{fmtY(actualAmt)} / {fmtY(targetAmt)} <span className="font-bold ml-1" style={{ color: pctAmt >= 100 ? '#059669' : '#5C4B73' }}>{pctAmt}%</span></span>
                    </div>
                    <ProgressBar pct={pctAmt} />
                  </div>
                  {/* New Customers KPI */}
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-500 text-xs">👥 新增客户</span>
                      <span className="text-xs">{actualNew} / {targetNew} <span className="font-bold ml-1" style={{ color: pctNew >= 100 ? '#059669' : '#5C4B73' }}>{pctNew}%</span></span>
                    </div>
                    <ProgressBar pct={pctNew} />
                  </div>
                  {/* Order Count KPI */}
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-gray-500 text-xs">📦 订单数</span>
                      <span className="text-xs">{actualOrders} / {targetOrders} <span className="font-bold ml-1" style={{ color: pctOrders >= 100 ? '#059669' : '#5C4B73' }}>{pctOrders}%</span></span>
                    </div>
                    <ProgressBar pct={pctOrders} />
                  </div>
                  {/* Commission */}
                  <div className="flex justify-between items-center pt-2 border-t text-xs">
                    <span className="text-gray-400">预估提成</span>
                    <span className="font-bold text-green-600">{fmtY(commission)} ({target?.commissionRate || 0}%)</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {salesUsers.length === 0 && <div className="text-center py-8 text-gray-400 text-sm">暂无销售人员，请先在"人员管理"中创建</div>}
      </div>
    </Card>
  );
}

function AuditLogView() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    api.fetchAuditLogs(500).then(setLogs).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const filtered = filter ? logs.filter(l => `${l.user_name} ${l.action} ${l.entity_type} ${l.details}`.toLowerCase().includes(filter.toLowerCase())) : logs;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2"><FileText size={16} className="text-purple-600" /><div className="text-sm font-semibold text-gray-700">系统操作日志（最近 500 条）</div></div>
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="搜索用户/操作/实体" className="border rounded-lg px-3 py-1.5 text-sm w-64" />
      </div>
      {loading && <div className="text-center py-8 text-gray-400 text-sm">加载中...</div>}
      {!loading && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50/80">
              <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">时间</th>
              <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">用户</th>
              <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">操作</th>
              <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">对象</th>
              <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">详情</th>
            </tr></thead>
            <tbody>{filtered.map(l => (
              <tr key={l.id} className="border-b last:border-0 hover:bg-gray-50">
                <td className="py-2 px-3 text-xs text-gray-500 whitespace-nowrap">{l.created_at?.slice(0, 19).replace('T', ' ')}</td>
                <td className="py-2 px-3 text-xs">{l.user_name}</td>
                <td className="py-2 px-3 text-xs"><span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded">{l.action}</span></td>
                <td className="py-2 px-3 text-xs text-gray-600">{l.entity_type}{l.entity_id ? ` #${l.entity_id}` : ''}</td>
                <td className="py-2 px-3 text-xs text-gray-500">{l.details}</td>
              </tr>
            ))}{filtered.length === 0 && <tr><td colSpan="5" className="text-center py-12 text-gray-400 text-sm">暂无日志</td></tr>}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function ConfigMgmt() {
  const { configOptions, addConfig, removeConfig } = useData();
  const [newVal, setNewVal] = useState({ CUSTOMER_TYPE: '', PRODUCT_SERIES: '', SPEC_OPTION: '', BUSINESS_TYPE: '' });
  const [saving, setSaving] = useState(null);

  // 销售折扣上限
  const [maxDisc, setMaxDisc] = useState('');
  const [savingDisc, setSavingDisc] = useState(false);
  useEffect(() => {
    api.fetchAppSettings().then(s => setMaxDisc(s.max_discount_percent ?? '20')).catch(() => setMaxDisc('20'));
  }, []);
  const saveMaxDisc = async () => {
    const v = Number(maxDisc);
    if (isNaN(v) || v < 0 || v > 100) { alert('请输入 0-100 之间的数字'); return; }
    setSavingDisc(true);
    try { await api.updateAppSetting('max_discount_percent', String(v)); alert('已保存，销售下单折扣不能超过 ' + v + '%'); }
    catch (e) { alert(e.message); } finally { setSavingDisc(false); }
  };

  const byCategory = (cat) => configOptions.filter(o => o.category === cat);

  const handleAdd = async (cat) => {
    const value = newVal[cat]?.trim();
    if (!value) return;
    setSaving(cat);
    try {
      await addConfig(cat, value);
      setNewVal(v => ({ ...v, [cat]: '' }));
    } catch (e) { alert(e.message); } finally { setSaving(null); }
  };

  const handleRemove = async (id, value) => {
    if (!confirm(`确定删除 "${value}"？已使用此值的记录不受影响。`)) return;
    try { await removeConfig(id); }
    catch (e) { alert(e.message); }
  };

  const Section = ({ title, category, placeholder, icon: Icon, className = '' }) => {
    const options = byCategory(category);
    return (
    <section className={`p-5 min-w-0 ${className}`}>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-8 h-8 shrink-0 rounded-md bg-purple-50 text-purple-700 inline-flex items-center justify-center"><Icon size={15} /></span>
          <div><div className="text-sm font-medium text-gray-800">{title}</div><div className="text-[11px] text-gray-400 mt-0.5">{options.length} 个选项</div></div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 mb-4">
        {options.map(opt => (
          <div key={opt.id} className="min-w-0 min-h-9 px-3 rounded-md border border-[#E8E0D3] bg-[#FCFBF8] text-xs text-gray-700 flex items-center justify-between gap-2">
            <span className="truncate" title={opt.value}>{opt.value}</span>
            <button onClick={() => handleRemove(opt.id, opt.value)} title={`删除${opt.value}`} className="zidu-icon-button !w-7 !h-7 !border-0 !bg-transparent shrink-0 text-gray-400 hover:text-red-500"><X size={12} /></button>
          </div>
        ))}
        {options.length === 0 && <div className="sm:col-span-2 xl:col-span-3 min-h-9 flex items-center text-xs text-gray-400">暂无选项</div>}
      </div>
      <div className="flex gap-2 max-w-lg">
        <input
          value={newVal[category]}
          onChange={e => setNewVal(v => ({ ...v, [category]: e.target.value }))}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(category); }}
          placeholder={placeholder}
          className="min-w-0 flex-1 h-9 border rounded-lg px-3 text-sm"
        />
        <button
          onClick={() => handleAdd(category)}
          disabled={!newVal[category]?.trim() || saving === category}
          className="btn-primary !h-9 !px-3 !py-0 text-sm whitespace-nowrap"
        >
          <Plus size={14} />{saving === category ? '添加中...' : '添加'}
        </button>
      </div>
    </section>
  );
  };

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 border-b border-[#EEE6D9] bg-[#FCFBF8]">
        <div className="text-sm font-medium text-gray-800">基础设置</div>
        <div className="text-[11px] text-gray-400 mt-1">管理销售权限和业务表单中的可选内容</div>
      </div>

      <section className="p-5 border-b border-[#EEE6D9]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-gray-800">销售折扣上限</div>
            <div className="text-xs text-gray-500 mt-1">限制销售下单时可填写的最高折扣，管理员不受限制。</div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative w-28">
              <input type="number" min="0" max="100" value={maxDisc} onFocus={e => e.target.select()} onChange={e => setMaxDisc(e.target.value)} aria-label="销售折扣上限" className="w-full h-9 border rounded-lg pl-3 pr-8 text-sm tabular-nums" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
            </div>
            <button onClick={saveMaxDisc} disabled={savingDisc} className="btn-primary !h-9 !py-0 text-sm">
              {savingDisc ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2">
        <Section title="客户类型" category="CUSTOMER_TYPE" placeholder="新增客户类型" icon={UserPlus} className="border-b border-[#EEE6D9] lg:border-r" />
        <Section title="产品系列" category="PRODUCT_SERIES" placeholder="新增产品系列" icon={Layers} className="border-b border-[#EEE6D9]" />
        <Section title="产品规格" category="SPEC_OPTION" placeholder="新增规格，如 200ml" icon={Tag} className="border-b lg:border-b-0 border-[#EEE6D9] lg:border-r" />
        <Section title="业务类型" category="BUSINESS_TYPE" placeholder="新增业务类型" icon={ClipboardCheck} />
      </div>
    </Card>
  );
}
