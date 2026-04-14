import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, Badge, fmtY, now16, today, STATUS_MAP } from '../components/ui';

export default function ShippingWorkbench() {
  const { user } = useAuth();
  const { orders, customers, updateOrderStatus } = useData();
  const [sf, setSf] = useState('ALL');
  const [shippingOrderId, setShippingOrderId] = useState(null);
  const [carrier, setCarrier] = useState('顺丰速运');
  const [trackingNo, setTrackingNo] = useState('');
  const [updating, setUpdating] = useState(false);

  const shippable = orders.filter(o => ["CONFIRMED","PREPARING","SHIPPED"].includes(o.status));
  const filtered = sf === 'ALL' ? shippable : shippable.filter(o => o.status === sf);

  const doAdvance = async (o, newStatus) => {
    if (newStatus === 'SHIPPED') {
      setShippingOrderId(o.id);
      setCarrier('顺丰速运');
      setTrackingNo('');
      return;
    }
    if (updating) return;
    setUpdating(true);
    try {
      await updateOrderStatus(o.id, newStatus, {
        time: now16(), user: user.name, action: `→${STATUS_MAP[newStatus].label}`
      });
    } catch (e) {
      alert('操作失败: ' + e.message);
    } finally {
      setUpdating(false);
    }
  };

  const confirmShip = async (o) => {
    if (!trackingNo || updating) return;
    setUpdating(true);
    try {
      await updateOrderStatus(o.id, 'SHIPPED', {
        time: now16(), user: user.name, action: `发货 ${carrier} ${trackingNo}`
      }, {
        carrier, trackingNo, shippedAt: today(), operator: user.name
      });
      setShippingOrderId(null);
    } catch (e) {
      alert('操作失败: ' + e.message);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {["ALL","CONFIRMED","PREPARING","SHIPPED"].map(s => (
          <button key={s} onClick={() => setSf(s)} className={`px-3 py-1.5 text-sm rounded-lg border ${sf === s ? "bg-purple-100 border-purple-300 text-purple-700" : "bg-white text-gray-600"}`}>
            {s === "ALL" ? "全部" : STATUS_MAP[s].label}({s === "ALL" ? shippable.length : shippable.filter(o => o.status === s).length})
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.sort((a, b) => b.id - a.id).map(o => {
          const c = customers.find(c => c.id === o.customerId);
          return (
            <Card key={o.id} className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-sm text-gray-600">{o.orderNo}</span>
                    <Badge status={o.status} />
                  </div>
                  <div className="text-sm font-medium text-gray-800">{c?.name}</div>
                  <div className="text-xs text-gray-400">{c?.address}</div>
                  <div className="text-xs text-gray-400 mt-1">{o.items.map(it => `${it.productName}(${it.spec})x${it.quantity}`).join("，")}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  {o.status === "CONFIRMED" && <button onClick={() => doAdvance(o, "PREPARING")} disabled={updating} className="px-3 py-1.5 text-sm rounded-lg text-white disabled:opacity-40" style={{ background: "#4a3560" }}>备货</button>}
                  {o.status === "PREPARING" && <button onClick={() => doAdvance(o, "SHIPPED")} disabled={updating} className="px-3 py-1.5 text-sm rounded-lg text-white bg-green-600 disabled:opacity-40">发货</button>}
                  {o.status === "SHIPPED" && <button onClick={() => doAdvance(o, "DELIVERED")} disabled={updating} className="px-3 py-1.5 text-sm rounded-lg border text-gray-600 disabled:opacity-40">签收</button>}
                </div>
              </div>

              {shippingOrderId === o.id && (
                <div className="mt-3 pt-3 border-t flex flex-col sm:flex-row gap-2">
                  <select value={carrier} onChange={e => setCarrier(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
                    <option>顺丰速运</option><option>中通快递</option><option>圆通速递</option><option>韵达快递</option><option>德邦物流</option>
                  </select>
                  <input placeholder="快递单号" value={trackingNo} onChange={e => setTrackingNo(e.target.value)} className="flex-1 border rounded-lg px-3 py-2 text-sm" />
                  <div className="flex gap-2">
                    <button onClick={() => setShippingOrderId(null)} className="px-3 py-2 text-sm border rounded-lg">取消</button>
                    <button onClick={() => confirmShip(o)} disabled={!trackingNo || updating} className="px-4 py-2 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#4a3560" }}>确认发货</button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
        {filtered.length === 0 && <div className="text-center py-12 text-gray-400">暂无待处理</div>}
      </div>
    </div>
  );
}
