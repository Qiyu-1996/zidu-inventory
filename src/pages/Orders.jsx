import { useState } from 'react';
import { Search, ArrowLeft, Download } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, Badge, fmtY, now16, STATUS_MAP, NEXT_STATUS, exportCSV } from '../components/ui';

// ═══ ORDER LIST ═══
export function OrderList({ nav }) {
  const { user } = useAuth();
  const { orders, customers } = useData();
  const [search, setSearch] = useState('');
  const [sf, setSf] = useState('ALL');

  const myOrders = user.role === "ADMIN" ? orders : user.role === "SALES" ? orders.filter(o => o.salesId === user.id) : orders.filter(o => ["CONFIRMED","PREPARING","SHIPPED","DELIVERED"].includes(o.status));

  const filtered = myOrders.filter(o => {
    if (sf !== 'ALL' && o.status !== sf) return false;
    if (search) {
      const c = customers.find(c => c.id === o.customerId);
      if (!`${o.orderNo} ${c?.name || ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const exportAll = () => exportCSV(
    ["订单号","客户","日期","小计","折扣","应付","状态"],
    filtered.map(o => {
      const c = customers.find(c => c.id === o.customerId);
      return [o.orderNo, c?.name || '', o.createdAt, o.subtotal, o.discountAmount || 0, o.total, STATUS_MAP[o.status]?.label];
    }),
    "订单列表.csv"
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
            <input placeholder="搜索订单/客户" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 pr-3 py-2 text-sm border rounded-lg w-48 focus:outline-none focus:ring-2 focus:ring-purple-300" />
          </div>
          <select value={sf} onChange={e => setSf(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white">
            <option value="ALL">全部状态</option>
            {Object.entries(STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        <button onClick={exportAll} className="flex items-center gap-1 text-xs text-purple-700 px-3 py-2 rounded border border-purple-200 hover:bg-purple-50">
          <Download size={13} />导出
        </button>
      </div>

      <div className="space-y-2">
        {filtered.map(o => {
          const c = customers.find(c => c.id === o.customerId);
          return (
            <Card key={o.id} className="p-4 cursor-pointer hover:shadow-md transition" onClick={() => nav("orderDetail", o.id)}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-sm text-gray-600">{o.orderNo}</span>
                    <Badge status={o.status} />
                  </div>
                  <div className="text-sm text-gray-800">{c?.name || '—'}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{o.createdAt} · {o.items.length} 项商品</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold" style={{ color: "#4a3560" }}>{fmtY(o.total)}</div>
                  {o.discountAmount > 0 && <div className="text-xs text-orange-500">优惠 {fmtY(o.discountAmount)}</div>}
                </div>
              </div>
            </Card>
          );
        })}
        {filtered.length === 0 && <div className="text-center py-12 text-gray-400">暂无订单</div>}
      </div>
    </div>
  );
}

// ═══ ORDER DETAIL ═══
export function OrderDetail({ orderId, onBack }) {
  const { user } = useAuth();
  const { orders, customers, products, users, updateOrderStatus } = useData();
  const [updating, setUpdating] = useState(false);

  const order = orders.find(o => o.id === orderId);
  if (!order) return <div className="text-center py-12 text-gray-400">订单不存在</div>;

  const customer = customers.find(c => c.id === order.customerId);
  const seller = users.find(u => u.id === order.salesId);
  const nextStatuses = NEXT_STATUS[order.status] || [];

  const advance = async (ns) => {
    if (updating) return;
    setUpdating(true);
    try {
      await updateOrderStatus(order.id, ns, {
        time: now16(),
        user: user.name,
        action: ns === "CANCELLED" ? "取消订单" : `→${STATUS_MAP[ns].label}`
      });
    } catch (e) {
      alert('操作失败: ' + e.message);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft size={16} />返回
      </button>

      <Card className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg text-gray-700">{order.orderNo}</span>
              <Badge status={order.status} />
            </div>
            <div className="text-sm text-gray-500 mt-1">{order.createdAt}</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold" style={{ color: "#4a3560" }}>{fmtY(order.total)}</div>
            {order.discountAmount > 0 && <div className="text-xs text-orange-500">折扣 {fmtY(order.discountAmount)} ({order.discountPercent}%)</div>}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-400">客户</div>
            <div className="text-sm font-medium">{customer?.name || '—'}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-400">销售</div>
            <div className="text-sm font-medium">{seller?.name || '—'}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-400">地址</div>
            <div className="text-sm font-medium truncate">{customer?.address || '—'}</div>
          </div>
        </div>

        {order.notes && <div className="bg-yellow-50 rounded-lg p-3 mb-4 text-sm text-gray-700">{order.notes}</div>}

        {nextStatuses.length > 0 && (
          <div className="flex gap-2 pt-3 border-t">
            {nextStatuses.map(ns => (
              <button
                key={ns}
                onClick={() => advance(ns)}
                disabled={updating}
                className={`px-4 py-2 text-sm rounded-lg font-medium disabled:opacity-40 ${ns === "CANCELLED" ? "border border-red-200 text-red-600 hover:bg-red-50" : "text-white"}`}
                style={ns !== "CANCELLED" ? { background: "#4a3560" } : {}}
              >
                {STATUS_MAP[ns].label}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Items */}
      <Card className="p-4">
        <div className="text-sm font-semibold text-gray-700 mb-3">商品明细</div>
        <table className="w-full text-sm">
          <thead><tr className="border-b bg-gray-50/80">
            <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">产品</th>
            <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">规格</th>
            <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">单价</th>
            <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">数量</th>
            <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">小计</th>
          </tr></thead>
          <tbody>{order.items.map((it, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="py-2 px-3"><div className="text-gray-800">{it.productName}</div><div className="text-xs text-gray-400">{it.productCode}</div></td>
              <td className="py-2 px-3 text-gray-600">{it.spec}</td>
              <td className="py-2 px-3 text-right text-gray-600">{fmtY(it.unitPrice)}</td>
              <td className="py-2 px-3 text-right">{it.quantity}</td>
              <td className="py-2 px-3 text-right font-medium" style={{ color: "#4a3560" }}>{fmtY(it.subtotal)}</td>
            </tr>
          ))}</tbody>
        </table>
      </Card>

      {/* Shipment */}
      {order.shipment && (
        <Card className="p-4">
          <div className="text-sm font-semibold text-gray-700 mb-2">物流信息</div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-400">快递</span><div className="font-medium">{order.shipment.carrier}</div></div>
            <div><span className="text-gray-400">单号</span><div className="font-medium font-mono">{order.shipment.trackingNo}</div></div>
            <div><span className="text-gray-400">发货日期</span><div className="font-medium">{order.shipment.shippedAt}</div></div>
            <div><span className="text-gray-400">操作人</span><div className="font-medium">{order.shipment.operator}</div></div>
          </div>
        </Card>
      )}

      {/* Logs */}
      <Card className="p-4">
        <div className="text-sm font-semibold text-gray-700 mb-2">操作记录</div>
        <div className="space-y-2">
          {order.logs.map((l, i) => (
            <div key={i} className="flex items-center gap-3 text-sm">
              <div className="w-2 h-2 rounded-full bg-purple-400 shrink-0" />
              <div className="text-gray-600">{l.action}</div>
              <div className="text-xs text-gray-400 ml-auto">{l.user} · {l.time}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
