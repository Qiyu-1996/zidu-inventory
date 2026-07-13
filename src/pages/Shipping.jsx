import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, Badge, now16, today, STATUS_MAP } from '../components/ui';
import * as api from '../lib/api';

const ALL_CARRIERS = ['顺丰','韵达','加运美','德邦','壹米滴答快运','中通快递','圆通速递','申通快递','京东物流','极兔速递','邮政EMS','跨越速运','其他'];

function normalizeCarrierName(name) {
  const text = String(name || '').trim();
  const map = {
    '顺丰速运': '顺丰',
    '韵达快递': '韵达',
    '德邦物流': '德邦',
    '壹米滴答': '壹米滴答快运'
  };
  return map[text] || text;
}

function uniqueCarriers(list) {
  const seen = new Set();
  return list.map(normalizeCarrierName).filter(c => {
    if (!c || seen.has(c)) return false;
    seen.add(c);
    return true;
  });
}

export default function ShippingWorkbench() {
  const { user } = useAuth();
  const { orders, customers, updateOrderStatus } = useData();
  const [sf, setSf] = useState('ALL');
  const [shippingOrderId, setShippingOrderId] = useState(null);
  const [carrier, setCarrier] = useState('顺丰');
  const [customCarrier, setCustomCarrier] = useState('');
  const [trackingNo, setTrackingNo] = useState('');
  const [updating, setUpdating] = useState(false);
  const [carriers, setCarriers] = useState(ALL_CARRIERS);

  // 按历史使用频率排序快递公司
  useEffect(() => {
    api.fetchCarriersByUsage().then(used => {
      if (used.length === 0) return;
      const normalizedUsed = uniqueCarriers(used);
      const unused = ALL_CARRIERS.filter(c => !normalizedUsed.includes(c));
      setCarriers([...normalizedUsed, ...unused]);
      setCarrier(normalizedUsed[0] || '顺丰');
    }).catch(() => {});
  }, []);

  const shippable = orders.filter(o =>
    ["CONFIRMED","PREPARING","SHIPPED"].includes(o.status) &&
    (o.paymentStatus === 'PAID' || o.status === 'SHIPPED'));
  const filtered = sf === 'ALL' ? shippable
    : sf === 'PENDING' ? shippable.filter(o => o.status !== 'SHIPPED')
      : shippable.filter(o => o.status === 'SHIPPED');

  const doAdvance = async (o, newStatus) => {
    if (newStatus === 'SHIPPED') {
      setShippingOrderId(o.id);
      setCarrier('顺丰');
      setCustomCarrier('');
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
    const carrierToSave = carrier === '其他' ? customCarrier.trim() : carrier;
    if (!carrierToSave) {
      alert('请填写快递公司');
      return;
    }
    setUpdating(true);
    try {
      await updateOrderStatus(o.id, 'SHIPPED', {
        time: now16(), user: user.name, action: `发货 ${carrierToSave} ${trackingNo}`
      }, {
        carrier: carrierToSave, trackingNo, shippedAt: today(), operator: user.name
      });
      // 记录发货通知（暂为手动通知，微信推送需单独配置订阅消息模板）
      try {
        await api.recordShipmentNotification(o.id, o.customerId, 'manual', 'PENDING', `${carrierToSave} ${trackingNo}`);
      } catch { /* ignore notification record failure */ }
      setShippingOrderId(null);
      setCustomCarrier('');
    } catch (e) {
      alert('操作失败: ' + e.message);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap">
        {[['ALL', '全部'], ['PENDING', '待发货'], ['SHIPPED', '已发货']].map(([s, label]) => (
          <button key={s} onClick={() => setSf(s)} className={`px-3 py-1.5 text-sm rounded-lg border ${sf === s ? "bg-purple-100 border-purple-300 text-purple-700" : "bg-white text-gray-600"}`}>
            {label}({s === "ALL" ? shippable.length : s === 'PENDING' ? shippable.filter(o => o.status !== 'SHIPPED').length : shippable.filter(o => o.status === s).length})
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
                  {c?.phone && (
                    <div className="text-xs mt-0.5">
	                      <span className="text-gray-700 font-medium">{c.contact ? `${c.contact} · ` : ''}{c.phone}</span>
	                      <button onClick={() => { navigator.clipboard.writeText(`${c.contact || c.name} ${c.phone}\n${(c.province ? c.province + ' ' : '') + (c.address || '')}`); alert('已复制收件信息'); }} className="text-purple-700 underline ml-1.5">复制收件信息</button>
                    </div>
                  )}
                  <div className="text-xs text-gray-400">📍 {(c?.province ? c.province + ' ' : '') + (c?.address || '')}</div>
                  <div className="text-xs text-gray-400 mt-1">{o.items.map(it => `${it.productName}(${it.spec})x${it.quantity}`).join("，")}</div>
                </div>
                <div className="flex gap-2 shrink-0">
	                  {o.status !== "SHIPPED" && <button onClick={() => doAdvance(o, "SHIPPED")} disabled={updating} className="px-3 py-1.5 text-sm rounded-lg text-white bg-green-600 disabled:opacity-40">发货</button>}
                  {o.status === "SHIPPED" && <button onClick={() => doAdvance(o, "DELIVERED")} disabled={updating} className="px-3 py-1.5 text-sm rounded-lg border text-gray-600 disabled:opacity-40">签收</button>}
                </div>
              </div>

              {shippingOrderId === o.id && (
                <div className="mt-3 pt-3 border-t flex flex-col sm:flex-row gap-2">
                  <select value={carrier} onChange={e => { setCarrier(e.target.value); setCustomCarrier(''); }} className="border rounded-lg px-3 py-2 text-sm">
                    {carriers.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {carrier === '其他' && (
                    <input placeholder="快递公司名称" value={customCarrier} onChange={e => setCustomCarrier(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
                  )}
                  <input placeholder="快递单号" value={trackingNo} onChange={e => setTrackingNo(e.target.value)} className="flex-1 border rounded-lg px-3 py-2 text-sm" />
                  <div className="flex gap-2">
                    <button onClick={() => { setShippingOrderId(null); setCustomCarrier(''); }} className="px-3 py-2 text-sm border rounded-lg">取消</button>
                    <button onClick={() => confirmShip(o)} disabled={!trackingNo || (carrier === '其他' && !customCarrier.trim()) || updating} className="px-4 py-2 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#5C4B73" }}>确认发货</button>
                  </div>
                </div>
              )}
              {o.shipment && o.status === 'SHIPPED' && (
                <div className="mt-3 pt-3 border-t bg-green-50 -mx-4 -mb-4 px-4 py-2 rounded-b-xl text-sm text-green-800 flex items-center flex-wrap gap-2">
                  <span>📦 {o.shipment.carrier} · {o.shipment.trackingNo}</span>
                  <button onClick={() => { navigator.clipboard.writeText(`${o.shipment.carrier} ${o.shipment.trackingNo}`); alert('已复制'); }} className="text-purple-700 underline">复制</button>
                  <a href={`https://www.kuaidi100.com/chaxun?nu=${encodeURIComponent(o.shipment.trackingNo)}`} target="_blank" rel="noopener noreferrer" className="text-purple-700 underline">查询物流</a>
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
