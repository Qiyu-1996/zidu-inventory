import { useMemo } from 'react';
import { ShoppingCart, AlertTriangle, Clock, ClipboardCheck, RefreshCw, Target, UserPlus, ArrowUpRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, StatCard, Badge, fmtY, STATUS_MAP } from '../components/ui';
import { calculateRestockSuggestions } from '../lib/api';
import { today } from '../components/ui';

export default function Dashboard({ nav }) {
  const { user } = useAuth();
  const { orders, customers, products, salesTasks, salesTargets } = useData();

  const canViewAllBusiness = user.role === "ADMIN" || user.role === "FINANCE";
  const myOrders = canViewAllBusiness ? orders : user.role === "SALES" ? orders.filter(o => o.salesId === user.id) : orders.filter(o => ["CONFIRMED","PREPARING","SHIPPED","DELIVERED"].includes(o.status));
  const myCustomers = canViewAllBusiness ? customers : customers.filter(c => c.salesId === user.id);
  const myTasks = useMemo(() => {
    if (user.role === "ADMIN") return salesTasks || [];
    if (user.role === "SALES") return (salesTasks || []).filter(t => t.salesId === user.id);
    return [];
  }, [salesTasks, user.id, user.role]);

  // Restock suggestions (ADMIN + WAREHOUSE)
  const restockSuggestions = useMemo(() => {
    if (user.role !== 'ADMIN' && user.role !== 'WAREHOUSE') return [];
    return calculateRestockSuggestions(products, orders).slice(0, 6);
  }, [products, orders, user.role]);

  // Upcoming tasks (SALES + ADMIN)
  const upcomingTasks = useMemo(() => {
    if (user.role !== 'ADMIN' && user.role !== 'SALES') return [];
    const t0 = today();
    return myTasks.filter(t => t.status === 'PENDING')
      .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''))
      .slice(0, 5)
      .map(t => ({ ...t, isOverdue: t.dueDate && t.dueDate < t0 }));
  }, [myTasks, user.role]);

  // Sales target progress for current month (SALES role)
  const targetProgress = useMemo(() => {
    if (user.role !== 'SALES') return null;
    const now = new Date();
    const t = (salesTargets || []).find(x => x.salesId === user.id && x.year === now.getFullYear() && x.month === now.getMonth() + 1);
    if (!t) return null;
    const mk = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const monthOrders = myOrders.filter(o => o.status !== 'CANCELLED' && o.createdAt?.startsWith(mk));
    const actual = monthOrders.reduce((s, o) => s + o.total, 0);
    const pct = t.targetAmount > 0 ? Math.round(actual / t.targetAmount * 100) : 0;
    return { target: t.targetAmount, actual, pct, commission: Math.round(actual * t.commissionRate / 100) };
  }, [salesTargets, user, myOrders]);

  const validOrders = myOrders.filter(o => o.status !== "CANCELLED");
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousMonthKey = `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, '0')}`;
  const monthOrders = validOrders.filter(o => o.createdAt?.startsWith(monthKey));
  const previousMonthOrders = validOrders.filter(o => o.createdAt?.startsWith(previousMonthKey));
  const monthRevenue = monthOrders.reduce((s, o) => s + o.total, 0);
  const previousMonthRevenue = previousMonthOrders.reduce((s, o) => s + o.total, 0);
  const revenueGrowth = previousMonthRevenue > 0 ? Math.round((monthRevenue - previousMonthRevenue) / previousMonthRevenue * 100) : null;
  const pendingOrders = myOrders.filter(o => ["DRAFT","SUBMITTED","CONFIRMED","PREPARING"].includes(o.status)).length;
  const newCustomersThisMonth = myCustomers.filter(c => c.createdAt?.startsWith(monthKey)).length;

  const lowStock = useMemo(() => {
    const items = [];
    products.forEach(p => {
      if (p.channel === 'RAW') {
        if (Number(p.baseStockKg || 0) <= Number(p.safeStockKg || 0)) items.push({ product: p.name, spec: '重量库存', stock: Number(p.baseStockKg || 0).toFixed(3), safeStock: Number(p.safeStockKg || 0).toFixed(3), unit: 'kg' });
        return;
      }
      p.specs.forEach(s => {
        if (s.stock <= s.safeStock) items.push({ product: p.name, spec: s.spec, stock: s.stock, safeStock: s.safeStock, unit: '' });
      });
    });
    return items;
  }, [products]);

  const recentOrders = myOrders.slice(0, 5);

  return (
    <div className="space-y-5">
      <div className="grid lg:grid-cols-[1.2fr_1.8fr] gap-3">
        <div className="rounded-xl p-5 md:p-6 text-[#F4ECDC] overflow-hidden relative shadow-[0_12px_28px_rgba(92,75,115,0.18)]" style={{ background: '#5C4B73' }}>
          <div className="relative z-10">
            <div className="text-xs text-[#D6CCE0]">本月销售额</div>
            <div className="text-3xl md:text-4xl font-medium mt-2 tabular-nums">{fmtY(monthRevenue)}</div>
            <div className="flex items-center gap-2 mt-3 text-xs flex-wrap">
              <span className="px-2 py-1 rounded-md text-[#5A4318] bg-[#F3BD5B]">{monthOrders.length} 笔订单</span>
              {revenueGrowth !== null && <span className={revenueGrowth >= 0 ? 'text-[#DCE8D7]' : 'text-[#F0D8D4]'}>{revenueGrowth >= 0 ? '较上月增长' : '较上月下降'} {Math.abs(revenueGrowth)}%</span>}
            </div>
          </div>
          <ArrowUpRight size={110} strokeWidth={0.8} className="absolute -right-5 -bottom-5 text-white/10" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard label="本月全部订单" value={monthOrders.length} sub={`上月 ${previousMonthOrders.length} 笔`} icon={ShoppingCart} color="#F3BD5B" />
          <StatCard label="全部待处理订单" value={pendingOrders} sub="待确认与备货" icon={Clock} color="#8D5F5B" />
          <StatCard label="本月新增客户" value={newCustomersThisMonth} sub={`客户总数 ${myCustomers.length}`} icon={UserPlus} color="#7B8F67" />
        </div>
      </div>

      {/* Sales target progress (for SALES) */}
      {targetProgress && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><Target size={16} className="text-purple-600" /><div className="text-sm font-semibold text-gray-700">本月业绩目标</div></div>
            <div className="text-xs text-gray-500">
              <span className="text-base font-bold" style={{ color: targetProgress.pct >= 100 ? '#059669' : '#5C4B73' }}>{targetProgress.pct}%</span> 完成
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-2 text-sm">
            <div><span className="text-xs text-gray-400">目标</span><div className="font-medium">{fmtY(targetProgress.target)}</div></div>
            <div><span className="text-xs text-gray-400">实际</span><div className="font-medium" style={{ color: '#5C4B73' }}>{fmtY(targetProgress.actual)}</div></div>
            <div><span className="text-xs text-gray-400">预估提成</span><div className="font-medium text-green-600">{fmtY(targetProgress.commission)}</div></div>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
            <div className={`h-full ${targetProgress.pct >= 100 ? 'bg-green-500' : targetProgress.pct >= 80 ? 'bg-blue-500' : targetProgress.pct >= 50 ? 'bg-yellow-500' : 'bg-orange-400'}`} style={{ width: `${Math.min(100, targetProgress.pct)}%` }}></div>
          </div>
        </Card>
      )}

      {/* Upcoming tasks reminder (for SALES + ADMIN) */}
      {upcomingTasks.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><ClipboardCheck size={16} className="text-purple-600" /><div className="text-sm font-semibold text-gray-700">待办跟进 ({upcomingTasks.length})</div></div>
            <button onClick={() => nav('tasks')} className="text-xs text-purple-600 hover:underline">查看全部</button>
          </div>
          <div className="space-y-2">
            {upcomingTasks.map(t => {
              const c = customers.find(c => c.id === t.customerId);
              return (
                <div key={t.id} className={`flex items-center justify-between py-1.5 text-sm ${t.isOverdue ? 'text-red-600' : 'text-gray-700'}`}>
                  <div className="flex-1 truncate">{t.title} <span className="text-xs text-gray-400">· {c?.name || '—'}</span></div>
                  <span className={`text-xs shrink-0 ml-2 ${t.isOverdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>{t.dueDate || '无'}{t.isOverdue && ' ⚠'}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Restock suggestions (ADMIN + WAREHOUSE) */}
      {restockSuggestions.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><RefreshCw size={16} className="text-purple-600" /><div className="text-sm font-semibold text-gray-700">自动补货建议</div></div>
            <button onClick={() => nav('purchase')} className="text-xs text-purple-600 hover:underline">去采购</button>
          </div>
          <div className="text-xs text-gray-500 mb-3">根据近30天销量 + 安全库存自动计算建议采购数量</div>
          <div className="space-y-2">
            {restockSuggestions.map((r, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-[#EEE6D9] last:border-0 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${r.urgency === 'HIGH' ? 'bg-red-100 text-red-700' : r.urgency === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-600'}`}>
                      {r.urgency === 'HIGH' ? '紧急' : r.urgency === 'MEDIUM' ? '关注' : '预备'}
                    </span>
                    <span className="text-gray-800 truncate">{r.productName} ({r.spec})</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    近30天销 {r.recent30} {r.unit || '件'} · 当前 {r.currentStock} / 安全 {r.safeStock} {r.unit || ''}
                    {r.trend !== 0 && <span className={r.trend > 0 ? 'text-green-600' : 'text-red-500'}> · {r.trend > 0 ? '↑' : '↓'}{Math.abs(r.trend)}%</span>}
                  </div>
                </div>
                <div className="text-right shrink-0 ml-2">
                  <div className="text-xs text-gray-400">建议采购</div>
                  <div className="text-lg font-bold" style={{ color: "#5C4B73" }}>{r.suggestedQty}<span className="text-[10px] text-gray-400 ml-1">{r.unit || '件'}</span></div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Recent orders */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-gray-700">最近订单</div>
            <button onClick={() => nav("orders")} className="text-xs text-purple-600 hover:underline">查看全部</button>
          </div>
          <div className="space-y-2">
            {recentOrders.map(o => {
              const c = customers.find(c => c.id === o.customerId);
              return (
                <div key={o.id} className="flex items-center justify-between py-2 border-b border-[#EEE6D9] last:border-0 text-sm">
                  <div>
                    <span className="font-mono text-xs text-gray-500">{o.orderNo}</span>
                    <span className="text-gray-400 mx-2">·</span>
                    <span className="text-gray-700">{c?.name || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold" style={{ color: "#5C4B73" }}>{fmtY(o.total)}</span>
                    <Badge status={o.status} />
                  </div>
                </div>
              );
            })}
            {recentOrders.length === 0 && <div className="text-sm text-gray-400 py-4 text-center">暂无订单</div>}
          </div>
        </Card>

        {/* Low stock warning */}
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-orange-500" />
              <div className="text-sm font-semibold text-gray-700">库存预警 {lowStock.length > 0 && <span className="text-xs text-red-500">({lowStock.length})</span>}</div>
            </div>
            <button onClick={() => nav("inventory")} className="text-xs text-purple-600 hover:underline">查看全部</button>
          </div>
          <div className="space-y-2">
            {lowStock.slice(0, 8).map((item, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 text-sm">
                <div className="text-gray-700 truncate flex-1 mr-2">
                  {item.product} <span className="text-xs text-gray-400">({item.spec})</span>
                </div>
                <span className="text-red-500 font-medium text-xs shrink-0">
                  剩 {item.stock}{item.unit} / 安全 {item.safeStock}{item.unit}
                </span>
              </div>
            ))}
            {lowStock.length === 0 && <div className="text-sm text-gray-400 py-4 text-center">库存正常</div>}
            {lowStock.length > 8 && (
              <button onClick={() => nav("inventory")} className="text-xs text-purple-600 hover:underline pt-1">
                还有 {lowStock.length - 8} 项...
              </button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
