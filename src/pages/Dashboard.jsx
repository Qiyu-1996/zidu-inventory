import { useMemo } from 'react';
import { Package, ShoppingCart, Users, TrendingUp, AlertTriangle, Clock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, StatCard, Badge, fmtY, STATUS_MAP } from '../components/ui';

export default function Dashboard({ nav }) {
  const { user } = useAuth();
  const { orders, customers, products } = useData();

  const myOrders = user.role === "ADMIN" ? orders : user.role === "SALES" ? orders.filter(o => o.salesId === user.id) : orders.filter(o => ["CONFIRMED","PREPARING","SHIPPED","DELIVERED"].includes(o.status));
  const myCustomers = user.role === "ADMIN" ? customers : customers.filter(c => c.salesId === user.id);

  const validOrders = myOrders.filter(o => o.status !== "CANCELLED");
  const totalRevenue = validOrders.reduce((s, o) => s + o.total, 0);
  const pendingOrders = myOrders.filter(o => ["DRAFT","SUBMITTED","CONFIRMED","PREPARING"].includes(o.status)).length;

  const lowStock = useMemo(() => {
    const items = [];
    products.forEach(p => p.specs.forEach(s => {
      if (s.stock <= s.safeStock) items.push({ product: p.name, spec: s.spec, stock: s.stock, safeStock: s.safeStock });
    }));
    return items;
  }, [products]);

  const recentOrders = myOrders.slice(0, 5);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="总销售额" value={fmtY(totalRevenue)} icon={TrendingUp} color="#6c5ce7" />
        <StatCard label="总订单" value={validOrders.length} icon={ShoppingCart} color="#0984e3" />
        <StatCard label="客户数" value={myCustomers.length} icon={Users} color="#00b894" />
        <StatCard label="待处理" value={pendingOrders} icon={Clock} color="#e17055" />
      </div>

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
                <div key={o.id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                  <div>
                    <span className="font-mono text-xs text-gray-500">{o.orderNo}</span>
                    <span className="text-gray-400 mx-2">·</span>
                    <span className="text-gray-700">{c?.name || '—'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold" style={{ color: "#4a3560" }}>{fmtY(o.total)}</span>
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
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-orange-500" />
            <div className="text-sm font-semibold text-gray-700">库存预警</div>
          </div>
          <div className="space-y-2">
            {lowStock.slice(0, 8).map((item, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 text-sm">
                <div className="text-gray-700 truncate flex-1 mr-2">
                  {item.product} <span className="text-xs text-gray-400">({item.spec})</span>
                </div>
                <span className="text-red-500 font-medium text-xs shrink-0">
                  剩 {item.stock} / 安全 {item.safeStock}
                </span>
              </div>
            ))}
            {lowStock.length === 0 && <div className="text-sm text-gray-400 py-4 text-center">库存正常</div>}
            {lowStock.length > 8 && (
              <button onClick={() => nav("inventory")} className="text-xs text-purple-600 hover:underline">
                还有 {lowStock.length - 8} 项...
              </button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
