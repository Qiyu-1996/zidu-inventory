import { useState } from 'react';
import { Search } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, fmtY, SERIES_LIST } from '../components/ui';

export default function Inventory() {
  const { user } = useAuth();
  const { products } = useData();
  const [search, setSearch] = useState('');
  const [sf, setSf] = useState('ALL');

  const filtered = products.filter(p => {
    if (sf !== 'ALL' && p.series !== sf) return false;
    if (search && !`${p.code} ${p.name}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-4">
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

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b bg-gray-50/80">
              <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium">编号</th>
              <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium">产品</th>
              <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium hidden md:table-cell">系列</th>
              <th className="text-left py-3 px-4 text-xs text-gray-500 font-medium">规格/价格/库存</th>
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
                      <span key={s.id} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border ${s.stock <= s.safeStock ? "bg-red-50 border-red-200 text-red-700" : "bg-gray-50 border-gray-200 text-gray-700"}`}>
                        {s.spec}
                        {user.role !== "SALES" && <> · {fmtY(s.price)}</>}
                        {' '}· {s.stock}
                        {s.stock <= s.safeStock && " ⚠"}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
