import { useState } from 'react';
import { Search, ArrowLeft, Download, Printer, DollarSign, Trash2, ExternalLink, Copy } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, Badge, PaymentBadge, fmtY, now16, STATUS_MAP, NEXT_STATUS, PAYMENT_STATUS_MAP, exportCSV } from '../components/ui';
import { printOrder } from '../lib/printOrder';
import * as api from '../lib/api';

// 按角色过滤可用的下一步状态
function filterNextByRole(current, role) {
  const next = NEXT_STATUS[current] || [];
  if (role === 'SALES') {
    // 销售只能：创建订单(DRAFT→SUBMITTED)，取消自己的订单，确认签收
    return next.filter(n => n === 'SUBMITTED' || n === 'CANCELLED' || n === 'COMPLETED');
  }
  if (role === 'ADMIN') {
    // 管理员除了"发货"必须通过发货页做，其他都能推进
    return next.filter(n => n !== 'SHIPPED');
  }
  if (role === 'WAREHOUSE') {
    // 仓库：备货、签收、取消。发货必须去发货页
    return next.filter(n => n === 'PREPARING' || n === 'DELIVERED' || n === 'CANCELLED');
  }
  return [];
}

// ═══ ORDER LIST ═══
export function OrderList({ nav }) {
  const { user } = useAuth();
  const { orders, customers } = useData();
  const [search, setSearch] = useState('');
  const [sf, setSf] = useState('ALL');
  const [pf, setPf] = useState('ALL');

  const myOrders = user.role === "ADMIN" ? orders : user.role === "SALES" ? orders.filter(o => o.salesId === user.id) : orders.filter(o => ["CONFIRMED","PREPARING","SHIPPED","DELIVERED"].includes(o.status));

  const filtered = myOrders.filter(o => {
    if (sf !== 'ALL' && o.status !== sf) return false;
    if (pf !== 'ALL' && o.paymentStatus !== pf) return false;
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
          <select value={pf} onChange={e => setPf(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white">
            <option value="ALL">付款状态</option>
            {Object.entries(PAYMENT_STATUS_MAP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
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
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-mono text-sm text-gray-600">{o.orderNo}</span>
                    <Badge status={o.status} />
                    <PaymentBadge status={o.paymentStatus} />
                  </div>
                  <div className="text-sm text-gray-800">{c?.name || '—'}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{o.createdAt} · {o.items.length} 项商品</div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold" style={{ color: "#4a3560" }}>{fmtY(o.total)}</div>
                  {o.discountAmount > 0 && <div className="text-xs text-orange-500">优惠 {fmtY(o.discountAmount)}</div>}
                  {o.paymentStatus === 'PARTIAL' && <div className="text-xs text-yellow-600">已付 {fmtY(o.paidAmount)}</div>}
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
  const { orders, customers, products, users, updateOrderStatus, removeOrder, recordPayment } = useData();
  const [updating, setUpdating] = useState(false);
  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('转账');
  const [payNote, setPayNote] = useState('');
  const [savingPay, setSavingPay] = useState(false);

  const order = orders.find(o => o.id === orderId);
  if (!order) return <div className="text-center py-12 text-gray-400">订单不存在</div>;

  const customer = customers.find(c => c.id === order.customerId);
  const seller = users.find(u => u.id === order.salesId);
  const nextStatuses = filterNextByRole(order.status, user.role);
  const remaining = order.total - (order.paidAmount || 0);
  const canRecordPayment = (user.role === 'ADMIN' || user.role === 'SALES') && order.status !== 'CANCELLED' && order.paymentStatus !== 'PAID';
  const canDelete = user.role === 'ADMIN';
  const needsShipping = order.status === 'PREPARING' && (user.role === 'WAREHOUSE' || user.role === 'ADMIN');

  const copyTracking = () => {
    if (!order.shipment) return;
    const txt = `${order.shipment.carrier} ${order.shipment.trackingNo}`;
    navigator.clipboard.writeText(txt).then(() => alert('已复制：' + txt));
  };
  const openTracking = () => {
    if (!order.shipment?.trackingNo) return;
    window.open(`https://www.kuaidi100.com/chaxun?nu=${encodeURIComponent(order.shipment.trackingNo)}`, '_blank');
  };
  const handleDelete = async () => {
    if (!confirm(`确定删除订单 ${order.orderNo}？\n此操作不可恢复。${order.status !== 'CANCELLED' ? '\n注意：库存将恢复。' : ''}`)) return;
    try {
      await removeOrder(order.id, order.status !== 'CANCELLED');
      alert('订单已删除');
      onBack();
    } catch (e) { alert('删除失败: ' + e.message); }
  };

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

  const handleRecordPayment = async () => {
    const amount = Number(payAmount);
    if (!amount || amount <= 0) return;
    setSavingPay(true);
    try {
      await recordPayment(order.id, amount, payMethod, payNote, user.name);
      setShowPayForm(false); setPayAmount(''); setPayNote('');
    } catch (e) { alert('记录失败: ' + e.message); } finally { setSavingPay(false); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft size={16} />返回
      </button>

      <Card className="p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-lg text-gray-700">{order.orderNo}</span>
              <Badge status={order.status} />
              <PaymentBadge status={order.paymentStatus} />
            </div>
            <div className="text-sm text-gray-500 mt-1">{order.createdAt}</div>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2 justify-end">
              <button onClick={() => printOrder(order, customer, seller)} title="打印订单" className="p-2 rounded hover:bg-gray-100 text-gray-500"><Printer size={16} /></button>
              {canDelete && (
                <button onClick={handleDelete} title="删除订单" className="p-2 rounded hover:bg-red-50 text-red-500"><Trash2 size={16} /></button>
              )}
            </div>
            <div className="text-2xl font-bold" style={{ color: "#4a3560" }}>{fmtY(order.total)}</div>
            {order.discountAmount > 0 && <div className="text-xs text-orange-500">折扣 {fmtY(order.discountAmount)} ({order.discountPercent}%)</div>}
            {order.paidAmount > 0 && order.paymentStatus !== 'PAID' && <div className="text-xs text-yellow-600">已付 {fmtY(order.paidAmount)} / 剩 {fmtY(remaining)}</div>}
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

        {needsShipping && (
          <div className="pt-3 border-t bg-orange-50 -mx-5 -mb-5 px-5 py-3 rounded-b-xl">
            <div className="text-sm text-orange-700">📦 订单已备货完成，请 <span className="font-semibold">仓库管理员前往"发货管理"页</span>填写快递公司和快递单号后发货。</div>
          </div>
        )}

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

      {/* Payment */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <DollarSign size={16} className="text-purple-600" />
            <span className="text-sm font-semibold text-gray-700">收款记录</span>
            <PaymentBadge status={order.paymentStatus} />
          </div>
          {canRecordPayment && <button onClick={() => setShowPayForm(!showPayForm)} className="text-sm text-purple-700">+ 记录收款</button>}
        </div>
        <div className="grid grid-cols-3 gap-3 mb-3 text-sm">
          <div className="bg-gray-50 rounded p-2"><div className="text-xs text-gray-400">应付</div><div className="font-medium">{fmtY(order.total)}</div></div>
          <div className="bg-gray-50 rounded p-2"><div className="text-xs text-gray-400">已付</div><div className="font-medium text-green-600">{fmtY(order.paidAmount || 0)}</div></div>
          <div className="bg-gray-50 rounded p-2"><div className="text-xs text-gray-400">未付</div><div className="font-medium text-orange-600">{fmtY(remaining)}</div></div>
        </div>
        {showPayForm && (
          <div className="bg-purple-50 rounded-lg p-3 mb-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="收款金额" className="border rounded px-3 py-2 text-sm" />
              <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="border rounded px-3 py-2 text-sm bg-white">
                <option>转账</option><option>现金</option><option>微信</option><option>支付宝</option><option>其他</option>
              </select>
            </div>
            <input value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="备注（可选）" className="w-full border rounded px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <button onClick={() => setShowPayForm(false)} className="px-3 py-1.5 text-sm border rounded-lg">取消</button>
              <button onClick={handleRecordPayment} disabled={!payAmount || savingPay} className="px-4 py-1.5 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#4a3560" }}>{savingPay ? '保存中...' : '确认收款'}</button>
            </div>
          </div>
        )}
        {order.payments?.length > 0 ? (
          <div className="space-y-1.5">
            {order.payments.map((p, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 text-sm border-b last:border-0">
                <div><span className="text-green-600 font-medium">+{fmtY(p.amount)}</span><span className="text-xs text-gray-400 ml-2">{p.method}</span>{p.note && <span className="text-xs text-gray-500 ml-2">· {p.note}</span>}</div>
                <div className="text-xs text-gray-400">{p.recordedBy} · {p.createdAt?.slice(0, 16).replace('T', ' ')}</div>
              </div>
            ))}
          </div>
        ) : <div className="text-sm text-gray-400 text-center py-2">暂无收款记录</div>}
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
          <div className="flex gap-2 mt-3 pt-3 border-t">
            <button onClick={copyTracking} className="flex items-center gap-1 text-sm px-3 py-1.5 border rounded-lg text-purple-700 hover:bg-purple-50"><Copy size={14} />复制快递信息</button>
            <button onClick={openTracking} className="flex items-center gap-1 text-sm px-3 py-1.5 border rounded-lg text-purple-700 hover:bg-purple-50"><ExternalLink size={14} />查询物流</button>
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
