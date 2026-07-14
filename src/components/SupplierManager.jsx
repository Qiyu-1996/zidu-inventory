import { useState } from 'react';
import { Edit2, Plus, Trash2, Truck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card } from './ui';

const EMPTY_SUPPLIER = {
  name: '', contact: '', phone: '', email: '', address: '',
  category: '', paymentTerms: '', note: '', isActive: true
};

export default function SupplierManager() {
  const { user } = useAuth();
  const { suppliers, addSupplier, editSupplier, removeSupplier } = useData();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_SUPPLIER);
  const [saving, setSaving] = useState(false);
  const canManage = user.role === 'ADMIN';

  const reset = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_SUPPLIER);
  };

  const startEdit = supplier => {
    setEditingId(supplier.id);
    setForm({ ...supplier });
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editingId) await editSupplier(editingId, form);
      else await addSupplier(form);
      reset();
    } catch (error) {
      alert(error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async supplier => {
    if (!confirm(`确定删除供应商“${supplier.name}”？历史采购单中的供应商名称会继续保留。`)) return;
    try {
      await removeSupplier(supplier.id);
    } catch (error) {
      alert(error.message);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Truck size={16} className="text-purple-600 shrink-0" />
          <div>
            <div className="text-sm font-semibold text-gray-700">供应商档案（{suppliers.length}）</div>
            <div className="text-xs text-gray-400 mt-0.5">联系人、品类、付款条款与历史采购统一维护</div>
          </div>
        </div>
        {canManage && (
          <button onClick={() => showForm ? reset() : setShowForm(true)} className="btn-primary text-sm shrink-0">
            <Plus size={15} />添加供应商
          </button>
        )}
      </div>

      {showForm && canManage && (
        <div className="border border-purple-100 bg-purple-50/50 rounded-lg p-4 mb-4 space-y-3">
          <div className="text-sm font-medium">{editingId ? '编辑供应商' : '新建供应商'}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">名称 *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">供应品类</label><input value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="如：精油原料、瓶器包材" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">联系人</label><input value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">电话</label><input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">邮箱</label><input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">付款条款</label><input value={form.paymentTerms} onChange={e => setForm({ ...form, paymentTerms: e.target.value })} placeholder="如：预付 30%，到货付清" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          </div>
          <div><label className="block text-xs text-gray-500 mb-1">地址</label><input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          <div><label className="block text-xs text-gray-500 mb-1">备注</label><textarea value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} rows="2" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          <div className="flex gap-2">
            <button onClick={reset} className="px-3 py-2 text-sm border rounded-lg">取消</button>
            <button onClick={handleSave} disabled={!form.name.trim() || saving} className="px-5 py-2 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: '#5C4B73' }}>{saving ? '保存中...' : '保存'}</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="zidu-table w-full text-sm min-w-[720px]">
          <thead><tr className="border-b bg-gray-50/80">
            <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">供应商</th>
            <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">供应品类</th>
            <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">联系人</th>
            <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">付款条款</th>
            {canManage && <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">操作</th>}
          </tr></thead>
          <tbody>{suppliers.map(supplier => (
            <tr key={supplier.id} className="border-b last:border-0 hover:bg-gray-50/70">
              <td className="py-2.5 px-3"><div className="font-medium">{supplier.name}</div><div className="text-xs text-gray-400 mt-0.5">{supplier.address || '未填写地址'}</div></td>
              <td className="py-2.5 px-3 text-xs text-gray-600">{supplier.category || '未分类'}</td>
              <td className="py-2.5 px-3 text-xs"><div>{supplier.contact || '未填写'}</div><div className="text-gray-400 mt-0.5">{supplier.phone}</div></td>
              <td className="py-2.5 px-3 text-xs text-gray-600">{supplier.paymentTerms || '未填写'}</td>
              {canManage && <td className="py-2.5 px-3"><div className="flex justify-end gap-1"><button onClick={() => startEdit(supplier)} title="编辑供应商" className="zidu-icon-button !w-8 !h-8"><Edit2 size={14} /></button><button onClick={() => handleDelete(supplier)} title="删除供应商" className="zidu-icon-button !w-8 !h-8 hover:!text-red-500"><Trash2 size={14} /></button></div></td>}
            </tr>
          ))}{suppliers.length === 0 && <tr><td colSpan={canManage ? 5 : 4} className="text-center py-12 text-gray-400 text-sm">暂无供应商</td></tr>}</tbody>
        </table>
      </div>
    </Card>
  );
}
