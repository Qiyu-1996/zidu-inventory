import { useState } from 'react';
import { Plus, UserPlus, X, Edit2, Key, UserX, UserCheck, Layers, Tag } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, fmtY, SERIES_LIST, CUSTOMER_TYPES, DEFAULT_SPEC_OPTIONS } from '../components/ui';

export default function SettingsPage() {
  const [tab, setTab] = useState("users");
  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {[
          { k: "users", l: "人员管理" },
          { k: "products", l: "产品管理" },
          { k: "pricing", l: "阶梯定价" },
          { k: "scenarios", l: "场景方案" },
          { k: "config", l: "基础设置" }
        ].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`px-4 py-2 text-sm rounded-lg border ${tab === t.k ? "bg-purple-100 border-purple-300 text-purple-700" : "bg-white text-gray-600"}`}>{t.l}</button>
        ))}
      </div>
      {tab === "users" && <UserMgmt />}
      {tab === "products" && <ProductMgmt />}
      {tab === "pricing" && <PricingMgmt />}
      {tab === "scenarios" && <ScenarioMgmt />}
      {tab === "config" && (
        <Card className="p-4 space-y-4">
          <div className="text-sm font-semibold text-gray-700">客户类型</div>
          <div className="flex flex-wrap gap-2">{CUSTOMER_TYPES.map(t => <span key={t} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700">{t}</span>)}</div>
          <div className="text-sm font-semibold text-gray-700 mt-4">产品系列</div>
          <div className="flex flex-wrap gap-2">{SERIES_LIST.map(s => <span key={s} className="text-xs px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700">{s}</span>)}</div>
        </Card>
      )}
    </div>
  );
}

function UserMgmt() {
  const { user: currentUser } = useAuth();
  const { users, addUser, resetUserPassword, toggleUserStatus } = useData();
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pw, setPw] = useState('');
  const [role, setRole] = useState('SALES');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [resetForUser, setResetForUser] = useState(null);
  const [newPw, setNewPw] = useState('');

  const handleCreate = async () => {
    if (!name.trim() || !phone.trim() || !pw.trim()) return;
    setSaving(true); setError('');
    try {
      await addUser(name.trim(), phone.trim(), pw, role);
      setShow(false); setName(''); setPhone(''); setPw('');
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  const handleReset = async () => {
    if (!newPw.trim() || !resetForUser) return;
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

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-gray-700">人员管理</div>
        <button onClick={() => setShow(!show)} className="flex items-center gap-1 text-sm font-medium text-purple-700"><UserPlus size={16} />创建账号</button>
      </div>

      {show && (
        <div className="bg-purple-50 rounded-lg p-4 mb-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">姓名 *</label><input value={name} onChange={e => setName(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">手机号 *</label><input value={phone} onChange={e => setPhone(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">密码 *</label><input type="password" value={pw} onChange={e => setPw(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">角色</label>
              <select value={role} onChange={e => setRole(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="SALES">销售</option><option value="WAREHOUSE">仓库</option><option value="ADMIN">管理员</option>
              </select>
            </div>
          </div>
          {error && <div className="text-sm text-red-500">{error}</div>}
          <div className="flex gap-2">
            <button onClick={() => setShow(false)} className="px-3 py-1.5 text-sm border rounded-lg">取消</button>
            <button onClick={handleCreate} disabled={!name.trim() || !phone.trim() || !pw.trim() || saving} className="px-4 py-1.5 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#4a3560" }}>
              {saving ? '创建中...' : '创建'}
            </button>
          </div>
        </div>
      )}

      {resetForUser && (
        <div className="bg-yellow-50 rounded-lg p-4 mb-4 space-y-3 border border-yellow-200">
          <div className="text-sm font-medium">重置 {resetForUser.name} 的密码</div>
          <input type="text" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="输入新密码" className="w-full border rounded-lg px-3 py-2 text-sm" />
          <div className="flex gap-2">
            <button onClick={() => { setResetForUser(null); setNewPw(''); }} className="px-3 py-1.5 text-sm border rounded-lg">取消</button>
            <button onClick={handleReset} disabled={!newPw.trim()} className="px-4 py-1.5 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#4a3560" }}>确认重置</button>
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
        <tbody>{users.map(u => (
          <tr key={u.id} className="border-b last:border-0">
            <td className="py-2.5 px-4 font-medium">{u.name}</td>
            <td className="py-2.5 px-4 font-mono text-xs text-gray-600">{u.phone}</td>
            <td className="py-2.5 px-4">
              <span className={`text-xs px-2 py-0.5 rounded-full ${u.role === "ADMIN" ? "bg-purple-100 text-purple-700" : u.role === "SALES" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                {{ ADMIN: "管理员", SALES: "销售", WAREHOUSE: "仓库" }[u.role]}
              </span>
            </td>
            <td className="py-2.5 px-4 text-center text-xs">
              {u.status === 'disabled' ? <span className="text-red-500">已禁用</span> : <span className="text-green-600">启用</span>}
            </td>
            <td className="py-2.5 px-4 text-right space-x-2">
              <button onClick={() => setResetForUser(u)} title="重置密码" className="text-gray-500 hover:text-purple-600"><Key size={14} /></button>
              {u.id !== currentUser.id && (
                <button onClick={() => handleToggle(u)} title={u.status === 'active' ? '禁用' : '启用'} className={u.status === 'active' ? 'text-gray-500 hover:text-red-500' : 'text-gray-500 hover:text-green-600'}>
                  {u.status === 'active' ? <UserX size={14} /> : <UserCheck size={14} />}
                </button>
              )}
            </td>
          </tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

function ProductMgmt() {
  const { products, addProduct, editProduct, removeProduct } = useData();
  const [show, setShow] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [series, setSeries] = useState('');
  const [origin, setOrigin] = useState('');
  const [specs, setSpecs] = useState([{ spec: '10ml', price: '', stock: '', safeStock: 10 }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setShow(false); setEditingId(null); setCode(''); setName(''); setSeries(''); setOrigin('');
    setSpecs([{ spec: '10ml', price: '', stock: '', safeStock: 10 }]);
  };

  const startEdit = (p) => {
    setEditingId(p.id); setCode(p.code); setName(p.name); setSeries(p.series); setOrigin(p.origin);
    setSpecs(p.specs.map(s => ({ id: s.id, spec: s.spec, price: s.price, stock: s.stock, safeStock: s.safeStock })));
    setShow(true);
  };

  const addSpec = () => setSpecs(p => [...p, { spec: '', price: '', stock: '', safeStock: 10 }]);
  const updateSpec = (i, f, v) => setSpecs(p => p.map((s, idx) => idx === i ? { ...s, [f]: v } : s));
  const removeSpec = i => setSpecs(p => p.filter((_, idx) => idx !== i));

  const handleSave = async () => {
    if (!code.trim() || !name.trim() || !series || specs.length === 0 || !specs.every(s => s.spec && s.price)) return;
    setSaving(true); setError('');
    try {
      const payload = {
        code: code.trim(), name: name.trim(), series, origin: origin.trim() || '中国',
        specs: specs.map(s => ({ id: s.id, spec: s.spec, price: Number(s.price), stock: Number(s.stock) || 0, safeStock: Number(s.safeStock) || 10 }))
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
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-gray-700">产品管理（{products.length} SKU）</div>
        <button onClick={() => show ? reset() : setShow(true)} className="flex items-center gap-1 text-sm font-medium text-purple-700"><Plus size={16} />添加产品</button>
      </div>

      {show && (
        <div className="bg-purple-50 rounded-lg p-4 mb-4 space-y-3">
          <div className="text-sm font-medium">{editingId ? '编辑产品' : '新建产品'}</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">编码 *</label><input value={code} onChange={e => setCode(e.target.value)} placeholder="EO-XXX-01" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">名称 *</label><input value={name} onChange={e => setName(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">系列 *</label>
              <select value={series} onChange={e => setSeries(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">选择</option>{SERIES_LIST.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div><label className="block text-xs text-gray-500 mb-1">产地</label><input value={origin} onChange={e => setOrigin(e.target.value)} placeholder="中国" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-500 font-medium">规格/价格/库存/安全库存</label>
              <button onClick={addSpec} className="text-xs text-purple-600 flex items-center gap-0.5"><Plus size={12} />添加规格</button>
            </div>
            {specs.map((s, i) => (
              <div key={i} className="flex gap-2 items-center mb-2">
                <select value={s.spec} onChange={e => updateSpec(i, 'spec', e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm w-24 bg-white">
                  <option value="">规格</option>{DEFAULT_SPEC_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <input type="number" value={s.price} onChange={e => updateSpec(i, 'price', e.target.value)} placeholder="价格" className="border rounded-lg px-2 py-1.5 text-sm w-20" />
                <input type="number" value={s.stock} onChange={e => updateSpec(i, 'stock', e.target.value)} placeholder="库存" className="border rounded-lg px-2 py-1.5 text-sm w-20" />
                <input type="number" value={s.safeStock} onChange={e => updateSpec(i, 'safeStock', e.target.value)} placeholder="安全" className="border rounded-lg px-2 py-1.5 text-sm w-16" />
                {specs.length > 1 && <button onClick={() => removeSpec(i)} className="text-gray-400 hover:text-red-500"><X size={14} /></button>}
              </div>
            ))}
          </div>
          {error && <div className="text-sm text-red-500">{error}</div>}
          <div className="flex gap-2">
            <button onClick={reset} className="px-3 py-1.5 text-sm border rounded-lg">取消</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#4a3560" }}>
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
          <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">规格/价格</th>
          <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">操作</th>
        </tr></thead>
        <tbody>{products.map(p => (
          <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50 align-top">
            <td className="py-2 px-3 font-mono text-xs text-gray-500">{p.code}</td>
            <td className="py-2 px-3 text-gray-800">{p.name}</td>
            <td className="py-2 px-3 text-xs text-gray-500 hidden md:table-cell">{p.series}</td>
            <td className="py-2 px-3"><div className="flex flex-wrap gap-1">{p.specs.map(s => <span key={s.id} className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{s.spec}={fmtY(s.price)}</span>)}</div></td>
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
        <button onClick={handleSave} disabled={saving} className="ml-auto px-4 py-2 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#4a3560" }}>
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
            <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#4a3560" }}>
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
