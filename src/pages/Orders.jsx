import { useState } from 'react';
import { Search, ArrowLeft, Download, Printer, DollarSign, Trash2, ExternalLink, Copy, RotateCcw } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, Badge, PaymentBadge, fmtY, now16, STATUS_MAP, PAYMENT_STATUS_MAP, exportCSV, unitPriceHint } from '../components/ui';
import { printOrder } from '../lib/printOrder';
import * as api from '../lib/api';

// 订单录入来源标签：展示订单从哪里创建；原料/成品来源由订单号/明细识别。
const SOURCE_MAP = {
  wechat_2c: { label: '微信商城', cls: 'bg-green-100 text-green-700' },
  web_admin: { label: '后台下单', cls: 'bg-blue-100 text-blue-700' },
  sales_miniprogram: { label: '销售小程序', cls: 'bg-purple-100 text-purple-700' },
  b2b: { label: 'B2B平台', cls: 'bg-purple-100 text-purple-700' }
};
function sourceLabel(source) {
  return (SOURCE_MAP[source] || SOURCE_MAP.b2b).label;
}
function SourceBadge({ source }) {
  const s = SOURCE_MAP[source] || SOURCE_MAP.b2b;
  return <span className={`text-xs px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>;
}

// 状态推进按钮文案：用动作动词，而非状态名（避免「已确认/已取消」当按钮）
const ACTION_LABEL = {
  SUBMITTED: '提交订单',
  CONFIRMED: '确认订单',
  PREPARING: '开始备货',
  SHIPPED: '去发货',
  DELIVERED: '确认签收',
  COMPLETED: '完成订单',
  CANCELLED: '取消订单'
};

const DETAIL_NEXT = {
  DRAFT: ['CANCELLED'],
  SUBMITTED: ['CANCELLED'],
  CONFIRMED: ['CANCELLED'],
  PREPARING: ['CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: []
};

function isWalkInCustomer(customer) {
  return customer && (customer.type === '展会' || customer.type === '线下');
}

function roundMoney(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

function getOrderShippingFee(order) {
  const meta = order?.channelMeta || {};
  const fee = Number(meta.shippingFee ?? meta.freightFee ?? meta.shipping_fee ?? 0);
  return Number.isFinite(fee) ? fee : 0;
}

const AFTER_SALE_TYPE_LABEL = {
  RETURN_REFUND: '退货退款',
  REFUND_ONLY: '仅退款',
  FULL_RETURN: '整单退',
  EXCHANGE: '换货补发'
};

const AFTER_SALE_STATUS_LABEL = {
  WAREHOUSE_PENDING: { label: '待仓库处理', cls: 'bg-orange-100 text-orange-700' },
  FINANCE_PENDING: { label: '待财务处理', cls: 'bg-blue-100 text-blue-700' },
  COMPLETED: { label: '已完成', cls: 'bg-green-100 text-green-700' },
  CANCELLED: { label: '已取消', cls: 'bg-gray-100 text-gray-600' }
};

// 按角色过滤可用的下一步状态
function filterNextByRole(current, role) {
  const next = DETAIL_NEXT[current] || [];
  if (role === 'SALES') {
    return next.filter(n => n === 'CANCELLED' || n === 'DELIVERED' || n === 'COMPLETED');
  }
  if (role === 'ADMIN') {
    return next;
  }
  return [];
}

function isRefundOnlyAfterSale(afterSale) {
  return afterSale?.isRefundOnly || /^仅退款/.test(afterSale?.requestNote || '');
}

function stripAfterSaleNotePrefix(note) {
  return (note || '').replace(/^(整单退|仅退款)[:：]?\s*/, '');
}

// ═══ ORDER LIST ═══
export function OrderList({ nav }) {
  const { user } = useAuth();
  const { orders, customers, reload } = useData();
  const [search, setSearch] = useState('');
  const [sf, setSf] = useState('ALL');
  const [pf, setPf] = useState('ALL');
  const [cf, setCf] = useState('ALL');
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedOrders, setDeletedOrders] = useState([]);
  const [deletedLoading, setDeletedLoading] = useState(false);

  const myOrders = (user.role === "ADMIN" || user.role === "FINANCE") ? orders : user.role === "SALES" ? orders.filter(o => o.salesId === user.id) : orders.filter(o => ["CONFIRMED","PREPARING","SHIPPED","DELIVERED"].includes(o.status));

  const filtered = myOrders.filter(o => {
    if (sf !== 'ALL' && o.status !== sf) return false;
    if (pf !== 'ALL' && o.paymentStatus !== pf) return false;
    if (cf !== 'ALL' && (o.source || 'b2b') !== cf) return false;
    if (search) {
      const c = customers.find(c => c.id === o.customerId);
      if (!`${o.orderNo} ${c?.name || ''}`.toLowerCase().includes(search.toLowerCase())) return false;
    }
    return true;
  });

  const exportAll = () => exportCSV(
    ["订单号","来源","客户","日期","小计","折扣","运费","应付","状态"],
    filtered.map(o => {
      const c = customers.find(c => c.id === o.customerId);
      return [o.orderNo, sourceLabel(o.source), c?.name || (o.source === 'wechat_2c' ? '微信零售' : ''), o.createdAt, o.subtotal, o.discountAmount || 0, getOrderShippingFee(o), o.total, STATUS_MAP[o.status]?.label];
    }),
    "订单列表.csv"
  );

  const loadDeletedOrders = async () => {
    if (user.role !== 'ADMIN') return;
    setDeletedLoading(true);
    try {
      const rows = await api.fetchDeletedOrders();
      setDeletedOrders(rows);
      setShowDeleted(true);
    } catch (e) {
      alert(e.message || '加载删除订单库失败');
    } finally {
      setDeletedLoading(false);
    }
  };

  const restoreDeleted = async (row) => {
    if (!confirm(`恢复订单 ${row.orderNo}？\n恢复后会重新进入订单列表，并按删除时的库存恢复情况重新占用库存。`)) return;
    try {
      await api.restoreDeletedOrder(row.id, user.name);
      await loadDeletedOrders();
      await reload();
      alert('订单已恢复');
    } catch (e) {
      alert(e.message || '恢复失败');
    }
  };

  const purgeDeleted = async (row) => {
    if (!confirm(`彻底删除 ${row.orderNo}？\n删除后不可恢复。`)) return;
    try {
      await api.permanentlyDeleteDeletedOrder(row.id);
      await loadDeletedOrders();
      alert('已彻底删除');
    } catch (e) {
      alert(e.message || '删除失败');
    }
  };

  if (showDeleted && user.role === 'ADMIN') {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-gray-800">删除订单库</div>
            <div className="text-xs text-gray-400 mt-1">仅管理员可见，删除订单保留 30 天</div>
          </div>
          <button onClick={() => setShowDeleted(false)} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeft size={16} />返回订单
          </button>
        </div>

        <div className="space-y-2">
          {deletedOrders.map(row => {
            const itemText = (row.items || []).slice(0, 3).map(it => `${it.product_name}(${it.spec})x${it.quantity}`).join('，');
            const daysLeft = Math.max(0, Math.ceil((new Date(row.expiresAt).getTime() - Date.now()) / 86400000));
            return (
              <Card key={row.id} className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm text-gray-700">{row.orderNo}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600">已删除</span>
                      <span className="text-xs text-gray-400">剩 {daysLeft} 天</span>
                    </div>
                    <div className="text-sm text-gray-800 mt-1">{row.customerName || '—'}</div>
                    <div className="text-xs text-gray-400 mt-0.5">删除人：{row.deletedBy || '—'} · {row.deletedAt?.slice(0, 16).replace('T', ' ')}</div>
                    {itemText && <div className="text-xs text-gray-500 mt-2">{itemText}{(row.items || []).length > 3 ? '…' : ''}</div>}
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-bold" style={{ color: '#5C4B73' }}>{fmtY(row.total)}</div>
                    <div className="text-xs text-gray-400">已付 {fmtY(row.paidAmount)}</div>
                    <div className="flex gap-2 mt-3 justify-end">
                      <button onClick={() => restoreDeleted(row)} className="px-3 py-1.5 text-xs text-white rounded-lg" style={{ background: '#5C4B73' }}>恢复</button>
                      <button onClick={() => purgeDeleted(row)} className="px-3 py-1.5 text-xs border border-red-200 text-red-600 rounded-lg hover:bg-red-50">彻底删除</button>
                    </div>
                  </div>
                </div>
              </Card>
            );
          })}
          {deletedOrders.length === 0 && <div className="text-center py-12 text-gray-400">{deletedLoading ? '加载中...' : '暂无 30 天内删除订单'}</div>}
        </div>
      </div>
    );
  }

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
          <select value={cf} onChange={e => setCf(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white">
            <option value="ALL">全部来源</option>
            <option value="web_admin">后台下单</option>
            <option value="sales_miniprogram">销售小程序</option>
            <option value="wechat_2c">微信商城</option>
            <option value="b2b">B2B平台</option>
          </select>
        </div>
        <div className="flex gap-2">
          {user.role === 'ADMIN' && (
            <button onClick={loadDeletedOrders} className="flex items-center gap-1 text-xs text-red-600 px-3 py-2 rounded border border-red-100 hover:bg-red-50">
              <Trash2 size={13} />删除订单库
            </button>
          )}
          <button onClick={exportAll} className="flex items-center gap-1 text-xs text-purple-700 px-3 py-2 rounded border border-purple-200 hover:bg-purple-50">
            <Download size={13} />导出
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {filtered.map(o => {
          const c = customers.find(c => c.id === o.customerId);
          const shippingFee = getOrderShippingFee(o);
          return (
            <Card key={o.id} className="p-4 cursor-pointer hover:shadow-md transition" onClick={() => nav("orderDetail", o.id)}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-mono text-sm text-gray-600">{o.orderNo}</span>
                    <SourceBadge source={o.source} />
                    <Badge status={o.status} />
                    <PaymentBadge status={o.paymentStatus} />
                  </div>
                  <div className="text-sm text-gray-800">{c?.name || (o.source === 'wechat_2c' ? '微信零售' : '—')}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{o.createdAt} · {o.items.length} 项商品</div>
                </div>
                <div className="text-right">
	                  <div className="text-lg font-bold" style={{ color: "#5C4B73" }}>{fmtY(o.total)}</div>
	                  {o.discountAmount > 0 && <div className="text-xs text-orange-500">优惠 {fmtY(o.discountAmount)}</div>}
	                  {shippingFee > 0 && <div className="text-xs text-green-700">含运费 {fmtY(shippingFee)}</div>}
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
  const {
    orders, customers, users, updateOrderStatus, removeOrder, editOrderItems, recordPayment,
    createAfterSale, processAfterSaleWarehouse, completeAfterSaleFinance
  } = useData();
  const [updating, setUpdating] = useState(false);
  const [showPayForm, setShowPayForm] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('转账');
  const [payNote, setPayNote] = useState('');
  const [savingPay, setSavingPay] = useState(false);
  const canCreateAfterSaleRole = ['ADMIN', 'SALES'].includes(user.role);
  const canWarehouseAfterSaleRole = ['ADMIN', 'WAREHOUSE'].includes(user.role);
  const canFinanceAfterSaleRole = ['ADMIN', 'FINANCE'].includes(user.role);
  const [showAfterSale, setShowAfterSale] = useState(false);
  const [afterSaleType, setAfterSaleType] = useState('RETURN_REFUND');
  const [afterSaleQty, setAfterSaleQty] = useState({});
  const [restockReturned, setRestockReturned] = useState(true);
  const [deductReplacement, setDeductReplacement] = useState(true);
  const [requestedAmount, setRequestedAmount] = useState('');
  const [warehouseNote, setWarehouseNote] = useState('');
  const [financeDirection, setFinanceDirection] = useState('REFUND');
  const [financeAmount, setFinanceAmount] = useState('');
  const [financeMethod, setFinanceMethod] = useState('转账');
  const [afterSaleNote, setAfterSaleNote] = useState('');
  const [savingAfterSale, setSavingAfterSale] = useState(false);
  const [editingItems, setEditingItems] = useState(false);
  const [editItems, setEditItems] = useState([]);
  const [savingItems, setSavingItems] = useState(false);

  const order = orders.find(o => o.id === orderId);
  if (!order) return <div className="text-center py-12 text-gray-400">订单不存在</div>;

  const customer = customers.find(c => c.id === order.customerId);
  const seller = users.find(u => u.id === order.salesId);
  const nextStatuses = filterNextByRole(order.status, user.role);
  const remaining = Math.max(0, order.total - (order.paidAmount || 0));
  const shippingFee = getOrderShippingFee(order);
  const canRecordPayment = (user.role === 'ADMIN' || user.role === 'SALES' || user.role === 'FINANCE') && order.status !== 'CANCELLED' && order.paymentStatus !== 'PAID';
  const canDelete = user.role === 'ADMIN';
  const canEditItems = user.role === 'ADMIN' && order.status !== 'CANCELLED';
  const needsShipping = ['CONFIRMED', 'PREPARING'].includes(order.status) && order.paymentStatus === 'PAID' && (user.role === 'WAREHOUSE' || user.role === 'ADMIN');
  const afterSales = order.afterSales || [];
  const hasWarehouseTodo = afterSales.some(a => a.status === 'WAREHOUSE_PENDING');
  const hasFinanceTodo = afterSales.some(a => a.status === 'FINANCE_PENDING');
  const canStartAfterSale = canCreateAfterSaleRole && Number(order.paidAmount || 0) > 0;
  const canAfterSale = order.status !== 'CANCELLED' && (
    canStartAfterSale ||
    (hasWarehouseTodo && canWarehouseAfterSaleRole) ||
    (hasFinanceTodo && canFinanceAfterSaleRole) ||
    afterSales.length > 0
  );
  const selectedAfterSaleItems = order.items
    .map(it => ({ itemId: it.id, quantity: Math.min(Number(afterSaleQty[it.id] || 0), Number(it.quantity || 0)), item: it }))
    .filter(it => it.quantity > 0);
  const suggestedRefund = afterSaleType === 'REFUND_ONLY'
      ? roundMoney(Number(requestedAmount || 0))
      : roundMoney(selectedAfterSaleItems.reduce((s, it) => s + it.quantity * Number(it.item.unitPrice || 0), 0));
  const editSubtotal = roundMoney(editItems.reduce((s, it) => s + Number(it.quantity || 0) * Number(it.unitPrice || 0), 0));
  const editDiscountAmount = roundMoney(editSubtotal * Number(order.discountPercent || 0) / 100);
  const editTotal = roundMoney(editSubtotal - editDiscountAmount + shippingFee);

  const startItemEdit = () => {
    setEditItems(order.items.map(it => ({
      id: it.id,
      productId: it.productId,
      specId: it.specId,
      productName: it.productName,
      productCode: it.productCode,
      spec: it.spec,
      unitPrice: it.unitPrice,
      quantity: Number(it.quantity || 0),
      origQty: Number(it.quantity || 0)
    })));
    setEditingItems(true);
  };

  const setEditQty = (index, qty) => {
    const next = editItems.slice();
    if (!next[index]) return;
    next[index] = { ...next[index], quantity: Math.max(0, Math.floor(Number(qty) || 0)) };
    setEditItems(next);
  };

  const saveItemEdit = async () => {
    if (savingItems) return;
    if (editItems.filter(it => Number(it.quantity || 0) > 0).length === 0) {
      alert('至少保留一件商品');
      return;
    }
    const changes = editItems
      .filter(it => Number(it.quantity || 0) !== Number(it.origQty || 0))
      .map(it => ({
        itemId: it.id,
        productId: it.productId,
        specId: it.specId,
        oldQty: it.origQty,
        newQty: it.quantity,
        unitPrice: it.unitPrice
      }));
    if (changes.length === 0) {
      setEditingItems(false);
      setEditItems([]);
      return;
    }
    const desc = changes.map(ch => {
      const it = editItems.find(x => x.id === ch.itemId);
      return `${it?.productName || '商品'}(${it?.spec || ''}) ${ch.oldQty}→${ch.newQty}`;
    }).join('，');
    setSavingItems(true);
    try {
      await editOrderItems(order.id, changes, {
        subtotal: editSubtotal,
        discountAmount: editDiscountAmount,
        total: editTotal
      }, {
        time: now16(),
        user: user.name,
        action: `管理员修改明细：${desc}`
      });
      setEditingItems(false);
      setEditItems([]);
      alert('订单明细已修改');
    } catch (e) {
      alert(e.message || '保存失败');
    } finally {
      setSavingItems(false);
    }
  };

  const openAfterSale = (type = 'RETURN_REFUND') => {
    setAfterSaleType(type);
    setShowAfterSale(true);
    setAfterSaleNote('');
    if (type === 'REFUND_ONLY') {
      setAfterSaleQty({});
      setRequestedAmount('');
    } else {
      setAfterSaleQty({});
      setRequestedAmount('');
    }
  };

  const switchAfterSaleType = (type) => {
    openAfterSale(type);
  };

  const setAfterQty = (item, qty) => {
    if (afterSaleType === 'REFUND_ONLY') return;
    const max = Number(item.quantity || 0);
    const next = Math.max(0, Math.min(max, Math.floor(Number(qty) || 0)));
    setAfterSaleQty(p => ({ ...p, [item.id]: next }));
  };

  const copyTracking = () => {
    if (!order.shipment) return;
    const txt = `${order.shipment.carrier} ${order.shipment.trackingNo}`;
    navigator.clipboard.writeText(txt).then(() => alert('已复制：' + txt));
  };
  const openTracking = () => {
    if (!order.shipment?.trackingNo) return;
    const url = `https://www.kuaidi100.com/chaxun?nu=${encodeURIComponent(order.shipment.trackingNo)}`;
    // 创建新 <a> 元素点击，避免 popup 拦截
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  const handleDelete = async () => {
    if (!confirm(`确定删除订单 ${order.orderNo}？\n删除后会进入管理员“删除订单库”保留 30 天。${order.status !== 'CANCELLED' ? '\n注意：库存将恢复。' : ''}`)) return;
    try {
      await removeOrder(order.id, order.status !== 'CANCELLED', user.name);
      alert('订单已移入删除订单库');
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
    const adjustment = roundMoney(Number(payAmount || 0));
    const amount = roundMoney(Number(remaining || 0) + adjustment);
    if (!amount || amount <= 0) {
      alert('收款金额不能小于等于0');
      return;
    }
    const note = adjustment !== 0
      ? `价格调整 ${adjustment > 0 ? '+' : ''}${adjustment}${payNote ? `；${payNote}` : ''}`
      : payNote;
    setSavingPay(true);
    try {
      const result = await recordPayment(order.id, amount, payMethod, note, user.name, adjustment);
      if (result?.status === 'PAID' && ['DRAFT', 'SUBMITTED'].includes(order.status)) {
        const targetStatus = isWalkInCustomer(customer) ? 'COMPLETED' : 'CONFIRMED';
        const action = isWalkInCustomer(customer) ? '确认收款并完成（现场交付）' : '确认收款并确认订单';
        await updateOrderStatus(order.id, targetStatus, { time: now16(), user: user.name, action });
      }
      setShowPayForm(false); setPayAmount(''); setPayNote('');
    } catch (e) { alert('记录失败: ' + e.message); } finally { setSavingPay(false); }
  };

  const handleCreateAfterSale = async () => {
    if (savingAfterSale) return;
    const refundOnly = afterSaleType === 'REFUND_ONLY';
    if (!refundOnly && selectedAfterSaleItems.length === 0) {
      alert('请选择要处理的商品数量');
      return;
    }
    if (!canCreateAfterSaleRole) return;
    const amount = refundOnly
      ? roundMoney(Number(requestedAmount || 0))
      : suggestedRefund;
    if (amount <= 0) {
      alert('退款金额不能小于等于0');
      return;
    }
    if (amount > Number(order.paidAmount || 0)) {
      alert('退款金额不能大于当前已收金额');
      return;
    }
    const summary = refundOnly ? '仅退款' : selectedAfterSaleItems.map(x => `${x.item.productName}(${x.item.spec})x${x.quantity}`).join('，');
    const amountText = `\n退款金额：${fmtY(amount)}`;
    const ok = confirm(`发起售后：${AFTER_SALE_TYPE_LABEL[afterSaleType] || '售后'}：${summary}${amountText}？`);
    if (!ok) return;
    setSavingAfterSale(true);
    try {
      await createAfterSale(order.id, {
        type: 'RETURN_REFUND',
        refundOnly,
        fullReturn: false,
        items: refundOnly ? [] : selectedAfterSaleItems.map(x => ({ itemId: x.itemId, quantity: x.quantity })),
        requestedAmount: amount,
        note: afterSaleNote,
        createdBy: user.name,
        time: now16()
      });
      setShowAfterSale(false);
      setAfterSaleType('RETURN_REFUND');
      setAfterSaleQty({});
      setRequestedAmount('');
      setAfterSaleNote('');
      alert(refundOnly ? '仅退款已提交，已进入财务处理' : '退货退款已发起，已进入仓库处理');
    } catch (e) {
      alert('售后发起失败: ' + e.message);
    } finally {
      setSavingAfterSale(false);
    }
  };

  const handleWarehouseAfterSale = async (afterSale) => {
    if (savingAfterSale) return;
    setSavingAfterSale(true);
    try {
      await processAfterSaleWarehouse(afterSale.id, {
        restockReturned,
        deductReplacement,
        note: warehouseNote,
        operatorName: user.name,
        time: now16()
      });
      setWarehouseNote('');
      alert(afterSale.type === 'RETURN_REFUND' ? '仓库已处理，已转财务处理退款/补款' : '仓库已处理，售后已完成');
    } catch (e) {
      alert('仓库处理失败: ' + e.message);
    } finally {
      setSavingAfterSale(false);
    }
  };

  const handleFinanceAfterSale = async (afterSale) => {
    if (savingAfterSale) return;
    const rawAmount = roundMoney(Number(financeAmount || 0));
    if (rawAmount < 0) {
      alert('金额不能为负数');
      return;
    }
    const direction = afterSale.type === 'EXCHANGE' ? financeDirection : 'REFUND';
    const signedAmount = direction === 'REFUND' ? -rawAmount : rawAmount;
    if (signedAmount < 0 && rawAmount > Number(order.paidAmount || 0)) {
      alert('退款金额不能大于当前已收金额');
      return;
    }
    setSavingAfterSale(true);
    try {
      await completeAfterSaleFinance(afterSale.id, {
        amount: signedAmount,
        method: financeMethod,
        note: afterSaleNote,
        operatorName: user.name,
        time: now16()
      });
      setFinanceAmount('');
      setAfterSaleNote('');
      alert('财务已处理，售后已完成');
    } catch (e) {
      alert('财务处理失败: ' + e.message);
    } finally {
      setSavingAfterSale(false);
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
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-lg text-gray-700">{order.orderNo}</span>
              <SourceBadge source={order.source} />
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
            <div className="text-2xl font-bold" style={{ color: "#5C4B73" }}>{fmtY(order.total)}</div>
            {order.discountAmount > 0 && <div className="text-xs text-orange-500">折扣 {fmtY(order.discountAmount)} ({order.discountPercent}%)</div>}
            {shippingFee > 0 && <div className="text-xs text-green-700">运费 {fmtY(shippingFee)}</div>}
            {order.paidAmount > 0 && order.paymentStatus !== 'PAID' && <div className="text-xs text-yellow-600">已付 {fmtY(order.paidAmount)} / 剩 {fmtY(remaining)}</div>}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-400">客户</div>
            <div className="text-sm font-medium">{customer?.name || (order.source === 'wechat_2c' ? '微信零售' : '—')}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-400">{order.source === 'wechat_2c' ? '下单渠道' : '销售'}</div>
            <div className="text-sm font-medium">{order.source === 'wechat_2c' ? '微信小程序' : (seller?.name || '—')}</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <div className="text-xs text-gray-400">地址</div>
            <div className="text-sm font-medium truncate">{customer?.address || order.channelMeta?.address || '—'}</div>
          </div>
        </div>

        {order.notes && <div className="bg-yellow-50 rounded-lg p-3 mb-4 text-sm text-gray-700">{order.notes}</div>}

        {needsShipping && (
          <div className="pt-3 border-t bg-orange-50 -mx-5 -mb-5 px-5 py-3 rounded-b-xl">
            <div className="text-sm text-orange-700">订单已收款待发货，请仓库管理员前往“发货管理”填写快递公司和快递单号。</div>
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
                style={ns !== "CANCELLED" ? { background: "#5C4B73" } : {}}
              >
                {ACTION_LABEL[ns] || STATUS_MAP[ns].label}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Items */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-semibold text-gray-700">商品明细</div>
          {canEditItems && !editingItems && <button onClick={startItemEdit} className="text-sm text-purple-700">修改</button>}
        </div>
        {!editingItems ? (
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
                <td className="py-2 px-3 text-gray-600">
                  <div>{it.spec}</div>
                  {(it.unitPriceHint || unitPriceHint(it.spec, it.unitPrice)) && <div className="text-xs text-amber-700 font-medium mt-0.5">{it.unitPriceHint || unitPriceHint(it.spec, it.unitPrice)}</div>}
                </td>
                <td className="py-2 px-3 text-right text-gray-600">{fmtY(it.unitPrice)}</td>
                <td className="py-2 px-3 text-right">{it.quantity}</td>
                <td className="py-2 px-3 text-right font-medium" style={{ color: "#5C4B73" }}>{fmtY(it.subtotal)}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : (
          <div className="space-y-3">
            <div className="border rounded-xl overflow-hidden">
              {editItems.map((it, index) => (
                <div key={it.id} className={`flex items-center justify-between gap-3 px-3 py-2 border-b last:border-0 ${it.quantity === 0 ? 'opacity-50' : ''}`}>
                  <div className="min-w-0">
                    <div className="text-sm text-gray-800 truncate">{it.productName}</div>
                    <div className="text-xs text-gray-400">{it.spec} · {fmtY(it.unitPrice)}{(it.unitPriceHint || unitPriceHint(it.spec, it.unitPrice)) && <span className="text-amber-700 font-medium ml-1">{it.unitPriceHint || unitPriceHint(it.spec, it.unitPrice)}</span>}{it.quantity === 0 ? ' · 将移除' : ''}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => setEditQty(index, it.quantity - 1)} className="w-7 h-7 rounded-full border flex items-center justify-center">-</button>
                    <input type="number" min="0" value={it.quantity} onChange={e => setEditQty(index, e.target.value)} className="w-16 border rounded px-2 py-1 text-sm text-center" />
                    <button onClick={() => setEditQty(index, it.quantity + 1)} className="w-7 h-7 rounded-full border flex items-center justify-center">+</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid sm:grid-cols-3 gap-2 text-sm">
              <div className="bg-gray-50 rounded p-2"><div className="text-xs text-gray-400">修改后小计</div><div className="font-medium">{fmtY(editSubtotal)}</div></div>
              <div className="bg-gray-50 rounded p-2"><div className="text-xs text-gray-400">折扣</div><div className="font-medium text-orange-600">-{fmtY(editDiscountAmount)}</div></div>
              <div className="bg-purple-50 rounded p-2"><div className="text-xs text-purple-400">修改后应付</div><div className="font-medium text-purple-700">{fmtY(editTotal)}</div></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => { setEditingItems(false); setEditItems([]); }} disabled={savingItems} className="px-3 py-2 text-sm border rounded-lg">取消</button>
              <button onClick={saveItemEdit} disabled={savingItems} className="px-4 py-2 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: '#5C4B73' }}>
                {savingItems ? '保存中...' : '保存修改'}
              </button>
            </div>
            <div className="text-xs text-gray-400">数量减到 0 即移除该商品；库存会按差额自动调整，并写入操作记录。</div>
          </div>
        )}
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
        <div className="grid gap-3 mb-3 text-sm" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
          <div className="bg-gray-50 rounded p-2"><div className="text-xs text-gray-400">应付</div><div className="font-medium">{fmtY(order.total)}</div></div>
          {shippingFee > 0 && <div className="bg-gray-50 rounded p-2"><div className="text-xs text-gray-400">运费</div><div className="font-medium text-green-700">{fmtY(shippingFee)}</div></div>}
          <div className="bg-gray-50 rounded p-2"><div className="text-xs text-gray-400">已付</div><div className="font-medium text-green-600">{fmtY(order.paidAmount || 0)}</div></div>
          <div className="bg-gray-50 rounded p-2"><div className="text-xs text-gray-400">未付</div><div className="font-medium text-orange-600">{fmtY(remaining)}</div></div>
        </div>
        {showPayForm && (
          <div className="bg-purple-50 rounded-lg p-3 mb-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} placeholder="价格调整（可正可负，不填为0）" className="border rounded px-3 py-2 text-sm" />
              <select value={payMethod} onChange={e => setPayMethod(e.target.value)} className="border rounded px-3 py-2 text-sm bg-white">
                <option>转账</option><option>现金</option><option>微信</option><option>支付宝</option><option>其他</option>
              </select>
            </div>
            <div className="border rounded-lg px-3 py-2 text-sm text-purple-700 bg-white">默认收款 {fmtY(remaining)}</div>
            <input value={payNote} onChange={e => setPayNote(e.target.value)} placeholder="备注（可选）" className="w-full border rounded px-3 py-2 text-sm" />
            <div className="flex gap-2">
              <button onClick={() => setShowPayForm(false)} className="px-3 py-1.5 text-sm border rounded-lg">取消</button>
              <button onClick={handleRecordPayment} disabled={savingPay} className="px-4 py-1.5 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#5C4B73" }}>{savingPay ? '保存中...' : '确认收款'}</button>
            </div>
          </div>
        )}
        {order.payments?.length > 0 ? (
          <div className="space-y-1.5">
            {order.payments.map((p, i) => (
              <div key={i} className="flex items-center justify-between py-1.5 text-sm border-b last:border-0">
                <div><span className={`${p.amount < 0 ? 'text-red-600' : 'text-green-600'} font-medium`}>{p.amount < 0 ? '-' : '+'}{fmtY(Math.abs(p.amount))}</span><span className="text-xs text-gray-400 ml-2">{p.amount < 0 ? '退款' : p.method}</span>{p.note && <span className="text-xs text-gray-500 ml-2">· {p.note}</span>}</div>
                <div className="text-xs text-gray-400">{p.recordedBy} · {p.createdAt?.slice(0, 16).replace('T', ' ')}</div>
              </div>
            ))}
          </div>
        ) : <div className="text-sm text-gray-400 text-center py-2">暂无收款记录</div>}
      </Card>

      {canAfterSale && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <RotateCcw size={16} className="text-purple-600" />
              <span className="text-sm font-semibold text-gray-700">售后工单</span>
            </div>
            {canStartAfterSale && (
              showAfterSale ? (
                <button onClick={() => setShowAfterSale(false)} className="text-sm text-purple-700">收起</button>
              ) : (
                <div className="flex items-center gap-2">
                  <button onClick={() => openAfterSale('RETURN_REFUND')} className="text-xs px-2.5 py-1 rounded-full bg-purple-50 text-purple-700">退货退款</button>
                  <button onClick={() => openAfterSale('REFUND_ONLY')} className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">仅退款</button>
                </div>
              )
            )}
          </div>

          {afterSales.length > 0 && (
            <div className="space-y-3 mb-4">
              {afterSales.map(a => {
                const st = AFTER_SALE_STATUS_LABEL[a.status] || { label: a.status, cls: 'bg-gray-100 text-gray-600' };
                const isFullReturn = a.isFullReturn || /^整单退/.test(a.requestNote || '');
                const isRefundOnly = isRefundOnlyAfterSale(a);
                const requestNoteText = stripAfterSaleNotePrefix(a.requestNote || '');
                const typeLabel = isRefundOnly ? AFTER_SALE_TYPE_LABEL.REFUND_ONLY : isFullReturn ? AFTER_SALE_TYPE_LABEL.FULL_RETURN : (AFTER_SALE_TYPE_LABEL[a.type] || a.type);
                const itemsText = (a.items || []).map(it => `${it.productName}(${it.spec})x${it.quantity}`).join('，');
                return (
                  <div key={a.id} className="border rounded-xl p-3 bg-gray-50/60">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium text-gray-800">#{a.id} {typeLabel}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                        </div>
                        <div className="text-xs text-gray-400 mt-1">{a.createdBy} · {a.createdAt?.slice(0, 16).replace('T', ' ')}</div>
                      </div>
                      {a.requestedAmount > 0 && <div className="text-xs text-purple-700 shrink-0">退款 {fmtY(a.requestedAmount)}</div>}
                    </div>
                    {itemsText && <div className="text-xs text-gray-600 mt-2">{itemsText}</div>}
                    {requestNoteText && <div className="text-xs text-gray-500 mt-1">原因：{requestNoteText}</div>}
                    {a.warehouseBy && <div className="text-xs text-gray-500 mt-1">仓库：{a.restockReturned ? '退回入库' : '退回不入库'}{a.type === 'EXCHANGE' ? ` · ${a.deductReplacement ? '补发扣库存' : '补发不扣库存'}` : ''}{a.warehouseNote ? ` · ${a.warehouseNote}` : ''}</div>}
                    {a.financeBy && <div className="text-xs text-gray-500 mt-1">财务：{a.financeAmount < 0 ? '退款' : a.financeAmount > 0 ? '补款' : '无款项'} {fmtY(Math.abs(a.financeAmount))}{a.financeNote ? ` · ${a.financeNote}` : ''}</div>}

                    {a.status === 'WAREHOUSE_PENDING' && canWarehouseAfterSaleRole && (
                      <div className="mt-3 pt-3 border-t space-y-2">
                        <div className="grid sm:grid-cols-2 gap-3">
                          <label className="flex items-center gap-2 text-sm text-gray-600">
                            <input type="checkbox" checked={restockReturned} onChange={e => setRestockReturned(e.target.checked)} />
                            退回商品可入库
                          </label>
                          {a.type === 'EXCHANGE' && (
                            <label className="flex items-center gap-2 text-sm text-gray-600">
                              <input type="checkbox" checked={deductReplacement} onChange={e => setDeductReplacement(e.target.checked)} />
                              补发商品扣库存
                            </label>
                          )}
                        </div>
                        <input value={warehouseNote} onChange={e => setWarehouseNote(e.target.value)} placeholder="仓库备注：退回状态、补发物流等" className="w-full border rounded-lg px-3 py-2 text-sm bg-white" />
                        <button onClick={() => handleWarehouseAfterSale(a)} disabled={savingAfterSale} className="px-4 py-2 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: '#5C4B73' }}>
                          {savingAfterSale ? '处理中...' : '确认仓库处理'}
                        </button>
                      </div>
                    )}

	                    {a.status === 'FINANCE_PENDING' && canFinanceAfterSaleRole && (
	                      <div className="mt-3 pt-3 border-t space-y-2">
	                        <div className="grid sm:grid-cols-4 gap-2">
	                          <select value={a.type === 'EXCHANGE' ? financeDirection : 'REFUND'} onChange={e => setFinanceDirection(e.target.value)} disabled={a.type !== 'EXCHANGE'} className="border rounded-lg px-3 py-2 text-sm bg-white disabled:bg-gray-50">
	                            <option value="REFUND">退款</option>
	                            {a.type === 'EXCHANGE' && <option value="SUPPLEMENT">补款</option>}
	                          </select>
                          <input type="number" min="0" value={financeAmount} onChange={e => setFinanceAmount(e.target.value)} placeholder="金额" className="border rounded-lg px-3 py-2 text-sm bg-white" />
                          <select value={financeMethod} onChange={e => setFinanceMethod(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white">
                            <option>转账</option><option>现金</option><option>微信</option><option>支付宝</option><option>其他</option>
                          </select>
                          <button type="button" onClick={() => { setFinanceDirection(a.type === 'EXCHANGE' ? 'SUPPLEMENT' : 'REFUND'); setFinanceAmount(String(a.requestedAmount || suggestedRefund || 0)); }} className="border rounded-lg px-3 py-2 text-sm text-purple-700 hover:bg-purple-50">填入退款金额</button>
                        </div>
                        <input value={afterSaleNote} onChange={e => setAfterSaleNote(e.target.value)} placeholder="财务备注：退款/补款说明" className="w-full border rounded-lg px-3 py-2 text-sm bg-white" />
                        <button onClick={() => handleFinanceAfterSale(a)} disabled={savingAfterSale} className="px-4 py-2 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: '#5C4B73' }}>
                          {savingAfterSale ? '处理中...' : '确认财务处理'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {showAfterSale && canCreateAfterSaleRole && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <button onClick={() => switchAfterSaleType('RETURN_REFUND')} className={`px-3 py-1.5 text-sm rounded-lg border ${afterSaleType === 'RETURN_REFUND' ? 'bg-purple-100 border-purple-300 text-purple-700' : 'text-gray-500'}`}>退货退款</button>
                <button onClick={() => switchAfterSaleType('REFUND_ONLY')} className={`px-3 py-1.5 text-sm rounded-lg border ${afterSaleType === 'REFUND_ONLY' ? 'bg-amber-100 border-amber-300 text-amber-700' : 'text-gray-500'}`}>仅退款</button>
              </div>

              {afterSaleType === 'RETURN_REFUND' && <div className="border rounded-xl overflow-hidden">
                {order.items.filter(it => it.quantity > 0).map(it => (
                  <div key={it.id} className="flex items-center justify-between gap-3 px-3 py-2 border-b last:border-0">
                    <div className="min-w-0">
                      <div className="text-sm text-gray-800 truncate">{it.productName}</div>
                      <div className="text-xs text-gray-400">{it.spec} · 可处理 {it.quantity} · {fmtY(it.unitPrice)}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => setAfterQty(it, Number(afterSaleQty[it.id] || 0) - 1)} className="w-7 h-7 rounded-full border flex items-center justify-center">-</button>
                      <input type="number" min="0" max={it.quantity} value={afterSaleQty[it.id] || ''} onChange={e => setAfterQty(it, e.target.value)} className="w-14 border rounded px-2 py-1 text-sm text-center" />
                      <button onClick={() => setAfterQty(it, Number(afterSaleQty[it.id] || 0) + 1)} className="w-7 h-7 rounded-full border flex items-center justify-center">+</button>
                    </div>
                  </div>
                ))}
              </div>}

              {afterSaleType === 'REFUND_ONLY' ? (
                <div className="grid sm:grid-cols-2 gap-2">
                  <input type="number" min="0" value={requestedAmount} onChange={e => setRequestedAmount(e.target.value)} placeholder="退款金额" className="border rounded-lg px-3 py-2 text-sm" />
                  <div className="border rounded-lg px-3 py-2 text-sm text-amber-700 bg-amber-50">已收 {fmtY(order.paidAmount || 0)}</div>
                </div>
              ) : (
                <div className="border rounded-lg px-3 py-2 text-sm text-purple-700 bg-purple-50">商品退款 {fmtY(suggestedRefund)}</div>
              )}

              <input value={afterSaleNote} onChange={e => setAfterSaleNote(e.target.value)} placeholder="售后备注：原因、处理说明、物流单号等" className="w-full border rounded-lg px-3 py-2 text-sm" />
              <div className="flex gap-2">
                <button onClick={() => setShowAfterSale(false)} className="px-3 py-2 text-sm border rounded-lg">取消</button>
                <button onClick={handleCreateAfterSale} disabled={savingAfterSale || (afterSaleType === 'RETURN_REFUND' && selectedAfterSaleItems.length === 0) || (afterSaleType === 'REFUND_ONLY' && Number(requestedAmount || 0) <= 0)} className="px-4 py-2 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: '#5C4B73' }}>
                  {savingAfterSale ? '提交中...' : afterSaleType === 'REFUND_ONLY' ? '提交仅退款' : '发起退货退款'}
                </button>
              </div>
            </div>
          )}
        </Card>
      )}

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
