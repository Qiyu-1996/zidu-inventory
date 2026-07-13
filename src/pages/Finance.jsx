import { useCallback, useMemo, useState } from 'react';
import { Download, RefreshCw, Wallet, FileText, Table2, ReceiptText, Boxes } from 'lucide-react';
import { useData } from '../contexts/DataContext';
import { Card, StatCard, fmtY, exportCSV, today, STATUS_MAP, PAYMENT_STATUS_MAP } from '../components/ui';

const METHODS = ['全部', '微信', '支付宝', '对公账户转账', '对私银行账户转账', '转账', '现金', '其他'];
const TABS = [
  { key: 'orders', label: '订单汇总', icon: FileText },
  { key: 'items', label: '商品明细', icon: Table2 },
  { key: 'products', label: '产品汇总', icon: Boxes },
  { key: 'payments', label: '收款流水', icon: ReceiptText }
];

function day(v) {
  return (v || '').slice(0, 10);
}

function dateTime(v) {
  return (v || '').slice(0, 16).replace('T', ' ');
}

function roundMoney(n) {
  return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
}

function inRange(date, from, to) {
  if (!date) return false;
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

function entrySourceLabel(order) {
  if (order.source === 'wechat_2c') return '微信商城';
  if (order.source === 'web_admin') return '后台下单';
  if (order.source === 'sales_miniprogram') return '销售小程序';
  return 'B2B平台';
}

function productSourceLabel(order) {
  const no = order.orderNo || '';
  if (no.startsWith('ZDR')) return '原料';
  if (no.startsWith('ZDF')) return '成品';
  if (no.startsWith('ZDM')) return '原料+成品';
  if (no.startsWith('ZDB')) return '品牌定制';
  if (no.startsWith('ZDP')) return '私人定制';
  if (no.startsWith('OEM')) return '品牌定制';
  if (no.startsWith('ODM')) return '私人定制';
  return 'B2B平台';
}

function businessTypeLabel(type) {
  if (type === 'OEM代工') return '品牌定制';
  if (type === 'ODM定制') return '私人定制';
  return type || '院线';
}

export default function Finance() {
  const { orders, customers, users, reload } = useData();
  const [from, setFrom] = useState(() => today().slice(0, 7) + '-01');
  const [to, setTo] = useState(() => today());
  const [method, setMethod] = useState('全部');
  const [tab, setTab] = useState('orders');
  const [refreshing, setRefreshing] = useState(false);

  const cust = useCallback((id) => customers.find(x => x.id === id), [customers]);
  const userName = useCallback((id) => users.find(x => x.id === id)?.name || '', [users]);
  const statusLabel = (s) => STATUS_MAP[s]?.label || s || '';
  const payLabel = (s) => PAYMENT_STATUS_MAP[s]?.label || s || '';

  const validOrders = useMemo(() => (
    orders.filter(o => o.status !== 'CANCELLED')
  ), [orders]);

  const reportOrders = useMemo(() => (
    validOrders.filter(o => inRange(day(o.createdAt), from, to))
  ), [validOrders, from, to]);

  const orderRows = useMemo(() => reportOrders.map(o => {
    const c = cust(o.customerId);
    const paid = Number(o.paidAmount || 0);
    const remaining = Math.max(0, Number(o.total || 0) - paid);
    return {
      id: o.id,
      orderDate: day(o.createdAt),
      orderNo: o.orderNo,
      entrySource: entrySourceLabel(o),
      productSource: productSourceLabel(o),
      customer: c?.name || (o.source === 'wechat_2c' ? '微信零售' : '—'),
      customerType: c?.type || '',
      sales: userName(o.salesId),
      businessType: businessTypeLabel(o.businessType),
      status: statusLabel(o.status),
      paymentStatus: payLabel(o.paymentStatus),
      itemCount: (o.items || []).length,
      subtotal: Number(o.subtotal || 0),
      discount: Number(o.discountAmount || 0),
      receivable: Number(o.total || 0),
      paid,
      remaining,
      notes: o.notes || ''
    };
  }), [reportOrders, cust, userName]);

  const itemRows = useMemo(() => {
    const rows = [];
    reportOrders.forEach(o => {
      const c = cust(o.customerId);
      const paidRatio = Number(o.total || 0) > 0 ? Math.min(1, Number(o.paidAmount || 0) / Number(o.total || 0)) : 0;
      (o.items || []).forEach((it, idx) => {
        const lineGross = Number(it.subtotal || 0);
        const discountShare = Number(o.subtotal || 0) > 0 ? roundMoney(lineGross / Number(o.subtotal || 0) * Number(o.discountAmount || 0)) : 0;
        const netSales = roundMoney(lineGross - discountShare);
        const paidShare = roundMoney(netSales * paidRatio);
        rows.push({
          key: `${o.id}-${it.id || idx}`,
          orderDate: day(o.createdAt),
          orderNo: o.orderNo,
          entrySource: entrySourceLabel(o),
          productSource: productSourceLabel(o),
          customer: c?.name || (o.source === 'wechat_2c' ? '微信零售' : '—'),
          customerType: c?.type || '',
          sales: userName(o.salesId),
          businessType: businessTypeLabel(o.businessType),
          productCode: it.productCode || '',
          productName: it.productName || '',
          spec: it.spec || '',
          quantity: Number(it.quantity || 0),
          unitPrice: Number(it.unitPrice || 0),
          lineGross,
          discountShare,
          netSales,
          paidShare,
          outstandingShare: roundMoney(netSales - paidShare),
          status: statusLabel(o.status),
          paymentStatus: payLabel(o.paymentStatus)
        });
      });
    });
    return rows;
  }, [reportOrders, cust, userName]);

  const productRows = useMemo(() => {
    const map = new Map();
    itemRows.forEach(r => {
      const key = `${r.productCode}__${r.productName}__${r.spec}`;
      if (!map.has(key)) {
        map.set(key, {
          productCode: r.productCode,
          productName: r.productName,
          spec: r.spec,
          quantity: 0,
          lineGross: 0,
          discountShare: 0,
          netSales: 0,
          orders: new Set(),
          customers: new Set()
        });
      }
      const row = map.get(key);
      row.quantity += r.quantity;
      row.lineGross += r.lineGross;
      row.discountShare += r.discountShare;
      row.netSales += r.netSales;
      row.orders.add(r.orderNo);
      row.customers.add(r.customer);
    });
    return Array.from(map.values()).map(r => ({
      ...r,
      lineGross: roundMoney(r.lineGross),
      discountShare: roundMoney(r.discountShare),
      netSales: roundMoney(r.netSales),
      orderCount: r.orders.size,
      customerCount: r.customers.size
    })).sort((a, b) => b.netSales - a.netSales);
  }, [itemRows]);

  const paymentRows = useMemo(() => {
    const rows = [];
    validOrders.forEach(o => {
      const c = cust(o.customerId);
      (o.payments || []).forEach((p, idx) => {
        const paymentDate = day(p.createdAt);
        if (!inRange(paymentDate, from, to)) return;
        if (method !== '全部' && p.method !== method) return;
        rows.push({
          key: `${o.id}-${p.id || idx}`,
          paymentTime: dateTime(p.createdAt),
          paymentDate,
          orderDate: day(o.createdAt),
          orderNo: o.orderNo,
          entrySource: entrySourceLabel(o),
          productSource: productSourceLabel(o),
          customer: c?.name || (o.source === 'wechat_2c' ? '微信零售' : '—'),
          sales: userName(o.salesId),
          businessType: businessTypeLabel(o.businessType),
          orderTotal: Number(o.total || 0),
          amount: Number(p.amount || 0),
          method: p.method || '',
          recordedBy: p.recordedBy || '',
          note: p.note || ''
        });
      });
    });
    return rows.sort((a, b) => (b.paymentTime || '').localeCompare(a.paymentTime || ''));
  }, [validOrders, cust, userName, from, to, method]);

  const summary = useMemo(() => {
    const receivable = orderRows.reduce((s, r) => s + r.receivable, 0);
    const paid = orderRows.reduce((s, r) => s + r.paid, 0);
    const remaining = orderRows.reduce((s, r) => s + r.remaining, 0);
    const paymentTotal = paymentRows.reduce((s, r) => s + r.amount, 0);
    return { receivable, paid, remaining, paymentTotal };
  }, [orderRows, paymentRows]);

  const refresh = async () => {
    setRefreshing(true);
    try { await reload(); }
    catch (e) { alert('刷新失败：' + e.message); }
    finally { setRefreshing(false); }
  };

  const exportOrders = () => exportCSV(
    ['订单日期','订单编号','下单来源','商品来源','客户','客户类型','销售','业务类型','订单状态','付款状态','商品项数','折前金额','折扣额','应收金额','已收金额','未收金额','备注'],
    orderRows.map(r => [r.orderDate, r.orderNo, r.entrySource, r.productSource, r.customer, r.customerType, r.sales, r.businessType, r.status, r.paymentStatus, r.itemCount, r.subtotal, r.discount, r.receivable, r.paid, r.remaining, r.notes]),
    `财务_订单汇总_${from || '全部'}_${to || today()}.csv`
  );

  const exportItems = () => exportCSV(
    ['订单日期','订单编号','下单来源','商品来源','客户','客户类型','销售','业务类型','产品编号','产品名称','规格','数量','单价','行金额','分摊折扣','净销售额','已收分摊','未收分摊','订单状态','付款状态'],
    itemRows.map(r => [r.orderDate, r.orderNo, r.entrySource, r.productSource, r.customer, r.customerType, r.sales, r.businessType, r.productCode, r.productName, r.spec, r.quantity, r.unitPrice, r.lineGross, r.discountShare, r.netSales, r.paidShare, r.outstandingShare, r.status, r.paymentStatus]),
    `财务_商品明细_${from || '全部'}_${to || today()}.csv`
  );

  const exportProducts = () => exportCSV(
    ['产品编号','产品名称','规格','销量','订单数','客户数','行金额','分摊折扣','净销售额'],
    productRows.map(r => [r.productCode, r.productName, r.spec, r.quantity, r.orderCount, r.customerCount, r.lineGross, r.discountShare, r.netSales]),
    `财务_产品汇总_${from || '全部'}_${to || today()}.csv`
  );

  const exportPayments = () => exportCSV(
    ['收款时间','收款日期','订单日期','订单编号','下单来源','商品来源','客户','销售','业务类型','订单应收','收款金额','收款方式','经手人','备注'],
    paymentRows.map(r => [r.paymentTime, r.paymentDate, r.orderDate, r.orderNo, r.entrySource, r.productSource, r.customer, r.sales, r.businessType, r.orderTotal, r.amount, r.method, r.recordedBy, r.note]),
    `财务_收款流水_${from || '全部'}_${to || today()}.csv`
  );

  const exportCurrent = () => {
    if (tab === 'orders') exportOrders();
    else if (tab === 'items') exportItems();
    else if (tab === 'products') exportProducts();
    else exportPayments();
  };

  const exportFullPack = () => {
    exportOrders();
    exportItems();
    exportProducts();
    exportPayments();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="应收金额" value={fmtY(summary.receivable)} sub={`${orderRows.length} 笔订单`} icon={FileText} color="#5C4B73" />
        <StatCard label="已收金额" value={fmtY(summary.paid)} sub="按订单累计" icon={Wallet} color="#7B8F67" />
        <StatCard label="未收金额" value={fmtY(summary.remaining)} icon={ReceiptText} color="#8D5F5B" />
        <StatCard label="期间收款" value={fmtY(summary.paymentTotal)} sub={`${paymentRows.length} 笔流水`} icon={ReceiptText} color="#F3BD5B" />
      </div>

      <Card className="p-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
              <span className="text-gray-400 text-sm">至</span>
              <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
            </div>
            <select value={method} onChange={e => setMethod(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white">
              {METHODS.map(m => <option key={m} value={m}>{m === '全部' ? '全部收款方式' : m}</option>)}
            </select>
            <button onClick={refresh} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border text-gray-600 hover:bg-gray-50" disabled={refreshing}>
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />刷新
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={exportCurrent} className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border text-purple-700 border-purple-200 hover:bg-purple-50">
              <Download size={14} />导出当前
            </button>
            <button onClick={exportFullPack} className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg text-white" style={{ background: '#5C4B73' }}>
              <Download size={14} />导出完整财务包
            </button>
          </div>
        </div>
        <div className="text-xs text-gray-400 mt-3">
          订单/商品/产品按订单日期筛选；收款流水按收款日期筛选。商品明细保留产品编号、规格、数量、单价、行金额与折扣后金额。
        </div>
      </Card>

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {TABS.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)} className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg border whitespace-nowrap transition ${tab === t.key ? 'bg-purple-100 border-purple-300 text-purple-700 font-medium' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
              <Icon size={14} />{t.label}
            </button>
          );
        })}
      </div>

      {tab === 'orders' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-gray-50/80">
                {['订单日期','订单编号','客户','销售','状态','应收','已收','未收'].map(h => <th key={h} className={`py-2 px-3 text-xs text-gray-500 font-medium ${['应收','已收','未收'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {orderRows.map(r => (
                  <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 px-3 text-xs text-gray-600 whitespace-nowrap">{r.orderDate}</td>
                    <td className="py-2 px-3 font-mono text-xs whitespace-nowrap">{r.orderNo}</td>
                    <td className="py-2 px-3 min-w-36">{r.customer}<div className="text-xs text-gray-400">{r.businessType} · {r.entrySource} · {r.productSource}</div></td>
                    <td className="py-2 px-3 text-xs text-gray-500">{r.sales || '—'}</td>
                    <td className="py-2 px-3 text-xs text-gray-500">{r.status} · {r.paymentStatus}</td>
                    <td className="py-2 px-3 text-right font-medium">{fmtY(r.receivable)}</td>
                    <td className="py-2 px-3 text-right text-green-600">{fmtY(r.paid)}</td>
                    <td className="py-2 px-3 text-right text-orange-600">{fmtY(r.remaining)}</td>
                  </tr>
                ))}
                {orderRows.length === 0 && <tr><td colSpan="8" className="text-center py-12 text-gray-400">当前条件下暂无订单</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'items' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-gray-50/80">
                {['订单日期','订单编号','产品编号','产品/规格','客户','数量','单价','行金额','净销售额','已收/未收'].map(h => <th key={h} className={`py-2 px-3 text-xs text-gray-500 font-medium ${['数量','单价','行金额','净销售额','已收/未收'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {itemRows.map(r => (
                  <tr key={r.key} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 px-3 text-xs text-gray-600 whitespace-nowrap">{r.orderDate}</td>
                    <td className="py-2 px-3 font-mono text-xs whitespace-nowrap">{r.orderNo}</td>
                    <td className="py-2 px-3 font-mono text-xs">{r.productCode || '—'}</td>
                    <td className="py-2 px-3 min-w-48"><div className="font-medium text-gray-800">{r.productName}</div><div className="text-xs text-gray-400">{r.spec} · 单价 {fmtY(r.unitPrice)} · 折扣 {fmtY(r.discountShare)}</div></td>
                    <td className="py-2 px-3 min-w-32">{r.customer}<div className="text-xs text-gray-400">{r.sales || '—'}</div></td>
                    <td className="py-2 px-3 text-right">{r.quantity}</td>
                    <td className="py-2 px-3 text-right">{fmtY(r.unitPrice)}</td>
                    <td className="py-2 px-3 text-right">{fmtY(r.lineGross)}</td>
                    <td className="py-2 px-3 text-right font-medium">{fmtY(r.netSales)}</td>
                    <td className="py-2 px-3 text-right text-xs"><span className="text-green-600">{fmtY(r.paidShare)}</span><div className="text-orange-600">{fmtY(r.outstandingShare)}</div></td>
                  </tr>
                ))}
                {itemRows.length === 0 && <tr><td colSpan="10" className="text-center py-12 text-gray-400">当前条件下暂无商品明细</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'products' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-gray-50/80">
                {['产品编号','产品/规格','销量','订单','客户','行金额','分摊折扣','净销售额'].map(h => <th key={h} className={`py-2 px-3 text-xs text-gray-500 font-medium ${['销量','订单','客户','行金额','分摊折扣','净销售额'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {productRows.map(r => (
                  <tr key={`${r.productCode}-${r.spec}`} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 px-3 font-mono text-xs">{r.productCode || '—'}</td>
                    <td className="py-2 px-3 min-w-52"><div className="font-medium text-gray-800">{r.productName}</div><div className="text-xs text-gray-400">{r.spec}</div></td>
                    <td className="py-2 px-3 text-right">{r.quantity}</td>
                    <td className="py-2 px-3 text-right">{r.orderCount}</td>
                    <td className="py-2 px-3 text-right">{r.customerCount}</td>
                    <td className="py-2 px-3 text-right">{fmtY(r.lineGross)}</td>
                    <td className="py-2 px-3 text-right">{fmtY(r.discountShare)}</td>
                    <td className="py-2 px-3 text-right font-medium">{fmtY(r.netSales)}</td>
                  </tr>
                ))}
                {productRows.length === 0 && <tr><td colSpan="8" className="text-center py-12 text-gray-400">当前条件下暂无产品汇总</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'payments' && (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-gray-50/80">
                {['收款时间','订单编号','订单日期','客户','销售','订单应收','收款金额','方式','经手人','备注'].map(h => <th key={h} className={`py-2 px-3 text-xs text-gray-500 font-medium ${['订单应收','收款金额'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {paymentRows.map(r => (
                  <tr key={r.key} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 px-3 text-xs text-gray-600 whitespace-nowrap">{r.paymentTime}</td>
                    <td className="py-2 px-3 font-mono text-xs whitespace-nowrap">{r.orderNo}</td>
                    <td className="py-2 px-3 text-xs text-gray-500">{r.orderDate}</td>
                    <td className="py-2 px-3 min-w-32">{r.customer}<div className="text-xs text-gray-400">{r.businessType} · {r.entrySource} · {r.productSource}</div></td>
                    <td className="py-2 px-3 text-xs text-gray-500">{r.sales || '—'}</td>
                    <td className="py-2 px-3 text-right">{fmtY(r.orderTotal)}</td>
                    <td className={`py-2 px-3 text-right font-medium ${r.amount < 0 ? 'text-red-600' : 'text-green-600'}`}>{r.amount < 0 ? '-' : ''}{fmtY(Math.abs(r.amount))}</td>
                    <td className="py-2 px-3 text-xs">{r.method}</td>
                    <td className="py-2 px-3 text-xs text-gray-500">{r.recordedBy}</td>
                    <td className="py-2 px-3 text-xs text-gray-400 max-w-56 truncate">{r.note}</td>
                  </tr>
                ))}
                {paymentRows.length === 0 && <tr><td colSpan="10" className="text-center py-12 text-gray-400">当前条件下暂无收款记录</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
