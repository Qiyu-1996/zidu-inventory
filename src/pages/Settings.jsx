import { useState } from 'react';
import { Plus, UserPlus, X } from 'lucide-react';
import { useData } from '../contexts/DataContext';
import { Card, fmtY, SERIES_LIST, CUSTOMER_TYPES, DEFAULT_SPEC_OPTIONS } from '../components/ui';

export default function SettingsPage() {
  const [tab, setTab] = useState("users");
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[{ k: "users", l: "人员管理" }, { k: "products", l: "产品管理" }, { k: "config", l: "基础设置" }].map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} className={`px-4 py-2 text-sm rounded-lg border ${tab === t.k ? "bg-purple-100 border-purple-300 text-purple-700" : "bg-white text-gray-600"}`}>{t.l}</button>
        ))}
      </div>
      {tab === "users" && <UserMgmt />}
      {tab === "products" && <ProductMgmt />}
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
  const { users, addUser } = useData();
  const [show, setShow] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pw, setPw] = useState('');
  const [role, setRole] = useState('SALES');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim() || !phone.trim() || !pw.trim()) return;
    setSaving(true); setError('');
    try {
      await addUser(name.trim(), phone.trim(), pw, role);
      setShow(false); setName(''); setPhone(''); setPw('');
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-gray-700">人员管理</div>
        <button onClick={() => setShow(!show)} className="flex items-center gap-1 text-sm font-medium text-purple-700">
          <UserPlus size={16} />创建账号
        </button>
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

      <table className="w-full text-sm">
        <thead><tr className="border-b bg-gray-50/80">
          <th className="text-left py-2 px-4 text-xs text-gray-500 font-medium">姓名</th>
          <th className="text-left py-2 px-4 text-xs text-gray-500 font-medium">手机号</th>
          <th className="text-left py-2 px-4 text-xs text-gray-500 font-medium">角色</th>
          <th className="text-center py-2 px-4 text-xs text-gray-500 font-medium">状态</th>
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
            <td className="py-2.5 px-4 text-center text-xs text-green-600">启用</td>
          </tr>
        ))}</tbody>
      </table>
    </Card>
  );
}

function ProductMgmt() {
  const { products, addProduct } = useData();
  const [show, setShow] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [series, setSeries] = useState('');
  const [origin, setOrigin] = useState('');
  const [specs, setSpecs] = useState([{ spec: '10ml', price: '', stock: '' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const addSpec = () => setSpecs(p => [...p, { spec: '', price: '', stock: '' }]);
  const updateSpec = (i, f, v) => setSpecs(p => p.map((s, idx) => idx === i ? { ...s, [f]: v } : s));
  const removeSpec = i => setSpecs(p => p.filter((_, idx) => idx !== i));

  const handleCreate = async () => {
    if (!code.trim() || !name.trim() || !series || specs.length === 0 || !specs.every(s => s.spec && s.price)) return;
    setSaving(true); setError('');
    try {
      await addProduct({
        code: code.trim(), name: name.trim(), series, origin: origin.trim() || '中国',
        specs: specs.map(s => ({ spec: s.spec, price: Number(s.price), stock: Number(s.stock) || 0, safeStock: 10 }))
      });
      setShow(false); setCode(''); setName(''); setSeries(''); setOrigin(''); setSpecs([{ spec: '10ml', price: '', stock: '' }]);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-gray-700">产品管理（{products.length} SKU）</div>
        <button onClick={() => setShow(!show)} className="flex items-center gap-1 text-sm font-medium text-purple-700"><Plus size={16} />添加</button>
      </div>

      {show && (
        <div className="bg-purple-50 rounded-lg p-4 mb-4 space-y-3">
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
              <label className="text-xs text-gray-500 font-medium">规格与价格</label>
              <button onClick={addSpec} className="text-xs text-purple-600 flex items-center gap-0.5"><Plus size={12} />添加规格</button>
            </div>
            {specs.map((s, i) => (
              <div key={i} className="flex gap-2 items-center mb-2">
                <select value={s.spec} onChange={e => updateSpec(i, 'spec', e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm w-24 bg-white">
                  <option value="">规格</option>{DEFAULT_SPEC_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <input type="number" value={s.price} onChange={e => updateSpec(i, 'price', e.target.value)} placeholder="价格" className="border rounded-lg px-2 py-1.5 text-sm w-20" />
                <input type="number" value={s.stock} onChange={e => updateSpec(i, 'stock', e.target.value)} placeholder="库存" className="border rounded-lg px-2 py-1.5 text-sm w-20" />
                {specs.length > 1 && <button onClick={() => removeSpec(i)} className="text-gray-400 hover:text-red-500"><X size={14} /></button>}
              </div>
            ))}
          </div>
          {error && <div className="text-sm text-red-500">{error}</div>}
          <div className="flex gap-2">
            <button onClick={() => setShow(false)} className="px-3 py-1.5 text-sm border rounded-lg">取消</button>
            <button onClick={handleCreate} disabled={!code.trim() || !name.trim() || !series || !specs.every(s => s.spec && s.price) || saving} className="px-4 py-1.5 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#4a3560" }}>
              {saving ? '添加中...' : '添加'}
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
        </tr></thead>
        <tbody>{products.map(p => (
          <tr key={p.id} className="border-b last:border-0 hover:bg-gray-50 align-top">
            <td className="py-2 px-3 font-mono text-xs text-gray-500">{p.code}</td>
            <td className="py-2 px-3 text-gray-800">{p.name}</td>
            <td className="py-2 px-3 text-xs text-gray-500 hidden md:table-cell">{p.series}</td>
            <td className="py-2 px-3"><div className="flex flex-wrap gap-1">{p.specs.map(s => <span key={s.id} className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{s.spec}={fmtY(s.price)}</span>)}</div></td>
          </tr>
        ))}</tbody></table>
      </div>
    </Card>
  );
}
