import { useState, useEffect, useMemo } from 'react';
import { Download, RefreshCw, Wallet } from 'lucide-react';
import { useData } from '../contexts/DataContext';
import { Card, fmtY, exportCSV, today } from '../components/ui';
import * as api from '../lib/api';

const METHODS = ['全部', '转账', '现金', '微信', '支付宝', '其他'];

export default function Finance() {
  const { customers, users } = useData();
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [method, setMethod] = useState('全部');

  const load = () => {
    setLoading(true); setErr('');
    api.fetchPaymentRecords()
      .then(setRecords)
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const custName = (id) => { const c = customers.find(x => x.id === id); return c ? c.name : '—'; };
  const salesName = (id) => { const u = users.find(x => x.id === id); return u ? u.name : ''; };
  const day = (iso) => (iso || '').slice(0, 10);

  // 过滤
  const filtered = useMemo(() => records.filter(r => {
    const d = day(r.createdAt);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (method !== '全部' && r.method !== method) return false;
    return true;
  }), [records, from, to, method]);

  // 汇总
  const todayStr = today();
  const monthStr = todayStr.slice(0, 7);
  const sum = (arr) => arr.reduce((s, r) => s + r.amount, 0);
  const todayRecs = records.filter(r => day(r.createdAt) === todayStr);
  const monthRecs = records.filter(r => day(r.createdAt).startsWith(monthStr));
  const rangeTotal = sum(filtered);

  // 按方式分布（当前筛选结果）
  const byMethod = useMemo(() => {
    const m = {};
    filtered.forEach(r => { const k = r.method || '其他'; m[k] = (m[k] || 0) + r.amount; });
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [filtered]);

  const exportReport = () => {
    if (!filtered.length) { alert('当前没有可导出的收款记录'); return; }
    exportCSV(
      ['收款日期', '订单号', '客户', '业务类型', '收款金额', '收款方式', '经手人', '备注'],
      filtered.map(r => [day(r.createdAt), r.orderNo, custName(r.customerId), r.businessType, r.amount, r.method, r.recordedBy, r.note]),
      `收款流水_${from || '全部'}_${to || todayStr}.csv`
    );
  };

  return (
    <div className="space-y-4">
      {/* 汇总卡 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-gray-400">今日收款</div>
          <div className="text-2xl font-medium" style={{ color: '#5C4B73' }}>{fmtY(sum(todayRecs))}</div>
          <div className="text-xs text-gray-400 mt-0.5">{todayRecs.length} 笔</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-gray-400">本月收款</div>
          <div className="text-2xl font-medium text-gray-800">{fmtY(sum(monthRecs))}</div>
          <div className="text-xs text-gray-400 mt-0.5">{monthRecs.length} 笔</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-gray-400">当前筛选合计</div>
          <div className="text-2xl font-medium text-gray-800">{fmtY(rangeTotal)}</div>
          <div className="text-xs text-gray-400 mt-0.5">{filtered.length} 笔</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-gray-400">累计收款</div>
          <div className="text-2xl font-medium text-gray-800">{fmtY(sum(records))}</div>
          <div className="text-xs text-gray-400 mt-0.5">{records.length} 笔</div>
        </Card>
      </div>

      {/* 按方式分布 */}
      {byMethod.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-medium text-gray-700 mb-2">收款方式分布（当前筛选）</div>
          <div className="flex flex-wrap gap-2">
            {byMethod.map(([m, amt]) => (
              <span key={m} className="text-xs px-3 py-1.5 rounded-full" style={{ background: '#F1EEF6', color: '#5C4B73' }}>{m} · {fmtY(amt)}</span>
            ))}
          </div>
        </Card>
      )}

      {/* 工具栏 */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
          <span className="text-gray-400 text-sm">至</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
        </div>
        <select value={method} onChange={e => setMethod(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white">
          {METHODS.map(m => <option key={m} value={m}>{m === '全部' ? '全部方式' : m}</option>)}
        </select>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border text-gray-600 hover:bg-gray-50"><RefreshCw size={14} />刷新</button>
        <button onClick={exportReport} className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg text-white" style={{ background: '#5C4B73' }}><Download size={14} />导出报表 (CSV)</button>
      </div>

      {/* 流水表 */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50/80">
              <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">收款日期</th>
              <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">订单号</th>
              <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">客户</th>
              <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium hidden md:table-cell">业务类型</th>
              <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">收款金额</th>
              <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">方式</th>
              <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium hidden md:table-cell">经手人</th>
              <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium hidden lg:table-cell">备注</th>
            </tr></thead>
            <tbody>
              {loading && <tr><td colSpan="8" className="text-center py-12 text-gray-400 text-sm">加载中...</td></tr>}
              {err && <tr><td colSpan="8" className="text-center py-12 text-red-500 text-sm">{err}</td></tr>}
              {!loading && !err && filtered.map(r => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2 px-3 text-xs text-gray-600 whitespace-nowrap">{day(r.createdAt)}</td>
                  <td className="py-2 px-3 font-mono text-xs">{r.orderNo}</td>
                  <td className="py-2 px-3">{custName(r.customerId)}</td>
                  <td className="py-2 px-3 text-xs text-gray-500 hidden md:table-cell">{r.businessType}</td>
                  <td className="py-2 px-3 text-right font-medium" style={{ color: '#5C4B73' }}>{fmtY(r.amount)}</td>
                  <td className="py-2 px-3 text-xs">{r.method}</td>
                  <td className="py-2 px-3 text-xs text-gray-500 hidden md:table-cell">{r.recordedBy}</td>
                  <td className="py-2 px-3 text-xs text-gray-400 hidden lg:table-cell">{r.note}</td>
                </tr>
              ))}
              {!loading && !err && filtered.length === 0 && <tr><td colSpan="8" className="text-center py-12 text-gray-400 text-sm">该条件下暂无收款记录</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
