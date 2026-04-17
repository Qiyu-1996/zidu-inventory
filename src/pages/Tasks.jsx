import { useState, useMemo } from 'react';
import { Plus, Check, X, Calendar, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, today } from '../components/ui';

const PRIORITY_CLS = {
  HIGH: 'bg-red-100 text-red-700 border-red-200',
  NORMAL: 'bg-blue-100 text-blue-700 border-blue-200',
  LOW: 'bg-gray-100 text-gray-700 border-gray-200'
};
const PRIORITY_LABEL = { HIGH: '高', NORMAL: '中', LOW: '低' };

export default function Tasks() {
  const { user } = useAuth();
  const { customers, salesTasks, addTask, completeTask, removeTask } = useData();

  const myTasks = user.role === 'ADMIN' ? salesTasks : salesTasks.filter(t => t.salesId === user.id);
  const myCustomers = user.role === 'ADMIN' ? customers : customers.filter(c => c.salesId === user.id);

  const [filter, setFilter] = useState('PENDING');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ customerId: '', title: '', description: '', dueDate: today(), priority: 'NORMAL' });
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(null);
  const [completeNote, setCompleteNote] = useState('');

  const filtered = useMemo(() => {
    let list = myTasks;
    if (filter !== 'ALL') list = list.filter(t => t.status === filter);
    return list.sort((a, b) => {
      if (a.status !== b.status) return a.status === 'PENDING' ? -1 : 1;
      return (a.dueDate || '').localeCompare(b.dueDate || '');
    });
  }, [myTasks, filter]);

  const counts = {
    PENDING: myTasks.filter(t => t.status === 'PENDING').length,
    DONE: myTasks.filter(t => t.status === 'DONE').length,
    overdue: myTasks.filter(t => t.status === 'PENDING' && t.dueDate && t.dueDate < today()).length,
  };

  const handleCreate = async () => {
    if (!form.title.trim() || !form.customerId) return;
    setSaving(true);
    try {
      await addTask({
        customerId: Number(form.customerId), salesId: user.id,
        title: form.title.trim(), description: form.description.trim(),
        dueDate: form.dueDate, priority: form.priority
      });
      setShowForm(false);
      setForm({ customerId: '', title: '', description: '', dueDate: today(), priority: 'NORMAL' });
    } catch (e) { alert(e.message); } finally { setSaving(false); }
  };

  const handleComplete = async (taskId) => {
    try { await completeTask(taskId, completeNote); setCompleting(null); setCompleteNote(''); }
    catch (e) { alert(e.message); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4"><div className="text-xs text-gray-500">待办</div><div className="text-2xl font-bold mt-1">{counts.PENDING}</div></Card>
        <Card className="p-4"><div className="text-xs text-gray-500">已逾期</div><div className="text-2xl font-bold mt-1 text-red-500">{counts.overdue}</div></Card>
        <Card className="p-4"><div className="text-xs text-gray-500">已完成</div><div className="text-2xl font-bold mt-1 text-green-600">{counts.DONE}</div></Card>
      </div>

      <div className="flex justify-between items-center flex-wrap gap-2">
        <div className="flex gap-2">
          {[{ k: 'PENDING', l: '待办' }, { k: 'DONE', l: '已完成' }, { k: 'ALL', l: '全部' }].map(t => (
            <button key={t.k} onClick={() => setFilter(t.k)} className={`px-3 py-1.5 text-sm rounded-lg border ${filter === t.k ? 'bg-purple-100 border-purple-300 text-purple-700' : 'bg-white text-gray-600'}`}>{t.l}</button>
          ))}
        </div>
        <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 text-sm text-white rounded-lg" style={{ background: '#4a3560' }}><Plus size={14} className="inline -mt-0.5" /> 新建任务</button>
      </div>

      {showForm && (
        <Card className="p-4 bg-purple-50 border-purple-200">
          <div className="text-sm font-medium mb-3">新建跟进任务</div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1">客户 *</label>
              <select value={form.customerId} onChange={e => setForm({ ...form, customerId: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="">选择客户</option>
                {myCustomers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div><label className="block text-xs text-gray-500 mb-1">优先级</label>
              <select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                <option value="HIGH">高</option><option value="NORMAL">中</option><option value="LOW">低</option>
              </select>
            </div>
            <div className="col-span-2"><label className="block text-xs text-gray-500 mb-1">任务标题 *</label><input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder="如：电话回访询问产品反馈" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div className="col-span-2"><label className="block text-xs text-gray-500 mb-1">备注</label><textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows="2" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1">到期日期</label><input type="date" value={form.dueDate} onChange={e => setForm({ ...form, dueDate: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-sm border rounded-lg">取消</button>
            <button onClick={handleCreate} disabled={!form.title.trim() || !form.customerId || saving} className="px-4 py-1.5 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: '#4a3560' }}>{saving ? '创建中...' : '创建任务'}</button>
          </div>
        </Card>
      )}

      <div className="space-y-2">
        {filtered.map(t => {
          const c = customers.find(c => c.id === t.customerId);
          const isOverdue = t.status === 'PENDING' && t.dueDate && t.dueDate < today();
          return (
            <Card key={t.id} className={`p-4 ${isOverdue ? 'border-red-200 border-2' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${PRIORITY_CLS[t.priority]}`}>{PRIORITY_LABEL[t.priority]}</span>
                    {t.status === 'DONE' && <span className="text-xs text-green-600">✓ 已完成</span>}
                    {isOverdue && <span className="text-xs text-red-500 flex items-center gap-1"><AlertCircle size={12} /> 逾期</span>}
                    <span className="text-xs text-gray-400 flex items-center gap-1"><Calendar size={12} />{t.dueDate || '无到期'}</span>
                  </div>
                  <div className={`font-medium ${t.status === 'DONE' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{t.title}</div>
                  <div className="text-xs text-gray-500 mt-1">客户：{c?.name || '—'}</div>
                  {t.description && <div className="text-sm text-gray-600 mt-2">{t.description}</div>}
                  {t.completedNote && <div className="text-sm text-green-700 mt-2 bg-green-50 rounded p-2">完成备注：{t.completedNote}</div>}
                </div>
                <div className="flex gap-2">
                  {t.status === 'PENDING' && (
                    <>
                      <button onClick={() => setCompleting(t.id)} className="text-green-600 hover:text-green-700" title="标记完成"><Check size={18} /></button>
                      <button onClick={() => { if (confirm('删除此任务？')) removeTask(t.id); }} className="text-gray-400 hover:text-red-500" title="删除"><X size={18} /></button>
                    </>
                  )}
                </div>
              </div>
              {completing === t.id && (
                <div className="mt-3 pt-3 border-t flex gap-2">
                  <input value={completeNote} onChange={e => setCompleteNote(e.target.value)} placeholder="完成备注（可选）" className="flex-1 border rounded-lg px-3 py-2 text-sm" />
                  <button onClick={() => { setCompleting(null); setCompleteNote(''); }} className="px-3 py-2 text-sm border rounded-lg">取消</button>
                  <button onClick={() => handleComplete(t.id)} className="px-4 py-2 text-sm text-white rounded-lg" style={{ background: '#4a3560' }}>确认完成</button>
                </div>
              )}
            </Card>
          );
        })}
        {filtered.length === 0 && <Card className="p-12 text-center text-gray-400 text-sm">暂无任务</Card>}
      </div>
    </div>
  );
}
