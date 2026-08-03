import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronRight, MousePointerClick, PackageCheck, RefreshCw, Repeat2, Save,
  Search, ShoppingBag, Smartphone, TrendingUp, UserPlus, Users, Wallet, X
} from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { Card, fmtY } from '../components/ui';
import MiniProgramCatalog from './MiniProgramCatalog';
import * as api from '../lib/api';

const amount = value => Number(value || 0);
const rate = value => Math.min(100, Math.max(0, Number(value || 0)));
const roleLabel = role => ({ SUPER_ADMIN: '超级管理员', ADMIN: '管理员', SALES: '销售', FINANCE: '财务', WAREHOUSE: '仓库' }[role] || role);
const shortDate = value => String(value || '').slice(0, 10);
const dateTime = value => value ? String(value).slice(0, 16).replace('T', ' ') : '—';

const FULFILLMENT = {
  CONFIRMED: { label: '待发货', cls: 'bg-orange-50 text-orange-700' },
  PREPARING: { label: '备货中', cls: 'bg-amber-50 text-amber-700' },
  SHIPPED: { label: '已发货', cls: 'bg-blue-50 text-blue-700' },
  DELIVERED: { label: '已签收', cls: 'bg-green-50 text-green-700' },
  COMPLETED: { label: '已完成', cls: 'bg-green-50 text-green-700' },
  CANCELLED: { label: '已取消', cls: 'bg-gray-100 text-gray-500' }
};

function StatusPill({ status }) {
  const item = FULFILLMENT[status] || { label: status || '已支付', cls: 'bg-gray-100 text-gray-600' };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] ${item.cls}`}>{item.label}</span>;
}

function Metric({ icon: Icon, label, value, tone = 'text-gray-900' }) {
  return <Card className="p-4">
    <div className="flex items-center gap-2 text-xs text-gray-500"><Icon size={14} />{label}</div>
    <div className={`text-2xl font-semibold mt-2 tabular-nums ${tone}`}>{value}</div>
  </Card>;
}

function CustomerDetail({ selected, detail, loading, error, onClose }) {
  const customer = detail?.customer || selected || {};
  const orders = detail?.orders || [];
  return <div className="fixed inset-0 z-50 bg-black/35 flex justify-end" onClick={onClose}>
    <div className="w-full max-w-3xl h-full bg-[#FAF9FC] shadow-2xl overflow-y-auto" onClick={event => event.stopPropagation()}>
      <div className="sticky top-0 z-10 bg-white border-b px-5 py-4 flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-lg text-gray-900">{customer.nickname || customer.customer_name || '紫都会员'}</div>
          <div className="text-sm text-gray-500 mt-1">{customer.phone || customer.phone_mask || '未绑定手机号'}</div>
        </div>
        <button onClick={onClose} className="w-9 h-9 rounded-lg border flex items-center justify-center text-gray-500"><X size={17} /></button>
      </div>

      <div className="p-5 space-y-4">
        {error && <div className="p-3 rounded-lg bg-red-50 text-sm text-red-600">{error}</div>}
        {loading ? <Card className="p-12 text-center text-sm text-gray-400">正在读取客户订单…</Card> : <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric icon={ShoppingBag} label="累计订单" value={amount(customer.order_count)} />
            <Metric icon={Wallet} label="累计实付" value={fmtY(amount(customer.total_paid))} tone="text-purple-700" />
            <Metric icon={UserPlus} label="注册时间" value={<span className="text-base">{shortDate(customer.registered_at) || '—'}</span>} />
            <Metric icon={Repeat2} label="最近购买" value={<span className="text-base">{shortDate(customer.last_order_at) || '—'}</span>} />
          </div>

          <Card className="p-4">
            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div><div className="text-xs text-gray-400">最近收件人</div><div className="mt-1 text-gray-800">{customer.recipient_name || '—'}{customer.recipient_phone ? ` · ${customer.recipient_phone}` : ''}</div></div>
              <div><div className="text-xs text-gray-400">销售归属</div><div className="mt-1 text-gray-800">{customer.sales_name || '未归属'}{customer.referral_code ? ` · ${customer.referral_code}` : ''}</div></div>
              <div className="sm:col-span-2"><div className="text-xs text-gray-400">最近收件地址</div><div className="mt-1 text-gray-800">{[customer.recipient_region, customer.recipient_address].filter(Boolean).join(' ') || '—'}</div></div>
              <div><div className="text-xs text-gray-400">首次购买</div><div className="mt-1 text-gray-800">{shortDate(customer.first_order_at) || '—'}</div></div>
              <div><div className="text-xs text-gray-400">最近登录</div><div className="mt-1 text-gray-800">{dateTime(customer.last_login_at)}</div></div>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="px-4 py-4 border-b"><div className="font-semibold text-gray-800">商城订单</div><div className="text-xs text-gray-400 mt-1">该客户在微信商城的全部回流订单</div></div>
            <div className="divide-y">{orders.map(order => <div key={order.id} className="p-4">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap"><span className="font-mono text-xs text-gray-700">{order.order_no}</span><StatusPill status={order.status} /></div>
                  <div className="text-xs text-gray-400 mt-1">{shortDate(order.created_at)} · {order.sales_name || '未归属'}</div>
                </div>
                <div className="font-semibold text-purple-700 tabular-nums">{fmtY(amount(order.amount))}</div>
              </div>
              <div className="text-sm text-gray-700 mt-3 space-y-1">{(order.items || []).map((item, index) => <div key={`${order.id}-${index}`} className="flex justify-between gap-4"><span>{item.name} · {item.spec}</span><span className="shrink-0">× {item.quantity}</span></div>)}</div>
              <div className="text-xs text-gray-500 mt-3">收件：{order.recipient_name || '—'} · {order.recipient_phone || '—'} · {[order.recipient_region, order.recipient_address].filter(Boolean).join(' ') || '—'}</div>
              {order.tracking_no && <div className="text-xs text-blue-600 mt-1">物流：{order.carrier || '快递'} · {order.tracking_no}</div>}
            </div>)}</div>
            {!orders.length && <div className="py-12 text-center text-sm text-gray-400">暂无商城订单</div>}
          </Card>
        </>}
      </div>
    </div>
  </div>;
}

export default function MiniProgramSales() {
  const { user } = useAuth();
  const isSuperAdmin = user?.isSuperAdmin === true;
  const [dashboard, setDashboard] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerDetail, setCustomerDetail] = useState(null);
  const [customerLoading, setCustomerLoading] = useState(false);
  const [customerError, setCustomerError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await api.fetchMiniProgramSalesDashboard();
      setDashboard(data);
      setDrafts(Object.fromEntries((data.accounts || []).map(account => [account.id, {
        referralEnabled: Boolean(account.referral_enabled),
        referralCode: account.referral_code || '',
        commissionRate: Number(account.miniprogram_commission_rate || 0)
      }])));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const accounts = dashboard?.accounts || [];
  const enabledAccounts = accounts.filter(account => account.referral_enabled);
  const orders = dashboard?.orders || [];
  const customers = useMemo(() => dashboard?.customers || [], [dashboard]);
  const daily = dashboard?.daily || [];
  const topProducts = dashboard?.topProducts || [];
  const fallback = useMemo(() => enabledAccounts.reduce((sum, account) => {
    const revenue = amount(account.paid_revenue_30d);
    return {
      opens: sum.opens + amount(account.opens_30d),
      orders: sum.orders + amount(account.paid_orders_30d),
      revenue: sum.revenue + revenue,
      commission: sum.commission + revenue * rate(account.miniprogram_commission_rate) / 100
    };
  }, { opens: 0, orders: 0, revenue: 0, commission: 0 }), [enabledAccounts]);
  const summary = dashboard?.summary || {};
  const revenue30d = amount(summary.paidRevenue30d ?? fallback.revenue);
  const orders30d = amount(summary.paidOrders30d ?? fallback.orders);

  const filteredCustomers = useMemo(() => customers.filter(customer => {
    const haystack = `${customer.nickname} ${customer.phone_mask} ${customer.latest_recipient} ${customer.sales_name}`.toLowerCase();
    return !customerSearch || haystack.includes(customerSearch.toLowerCase());
  }), [customers, customerSearch]);

  const saveAccount = async account => {
    const draft = drafts[account.id];
    if (!draft || savingId) return;
    setSavingId(account.id); setError('');
    try {
      await api.updateMiniProgramSales(account.id, draft);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSavingId(null);
    }
  };

  const openCustomer = async customer => {
    if (!isSuperAdmin || !customer?.member_key) return;
    setSelectedCustomer(customer);
    setCustomerDetail(null);
    setCustomerError('');
    setCustomerLoading(true);
    try {
      setCustomerDetail(await api.fetchMiniProgramCustomerOrders(customer.member_key));
    } catch (e) {
      setCustomerError(e.message);
    } finally {
      setCustomerLoading(false);
    }
  };

  if (!isSuperAdmin && !user?.referralEnabled) {
    return <Card className="p-8 text-center text-gray-400">尚未开通小程序销售资格</Card>;
  }

  const tabs = [
    ['overview', '经营概览'],
    ['customers', `商城客户 ${customers.length || ''}`],
    ['catalog', '商品管理'],
    ['attribution', '销售归属']
  ];

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-lg font-semibold text-gray-800"><Smartphone size={20} className="text-purple-600" />{isSuperAdmin ? '小程序经营' : '我的小程序销售'}</div>
            <div className="text-sm text-gray-500 mt-1">{isSuperAdmin ? '经营数据、商城客户、商品发布与销售归属集中管理。' : '分享归属保留 30 天，只有已支付订单计入销售额。'}</div>
          </div>
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg text-gray-600 disabled:opacity-40"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />刷新</button>
        </div>
        {isSuperAdmin && <div className="flex gap-1 mt-4 border-t pt-3 overflow-x-auto">{tabs.map(([key, label]) => <button key={key} onClick={() => setTab(key)} className={`px-3 py-2 rounded-lg text-sm whitespace-nowrap ${tab === key ? 'bg-purple-100 text-purple-700 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}>{label}</button>)}</div>}
      </Card>

      {error && <div className="p-3 rounded-lg bg-red-50 text-sm text-red-600">{error}</div>}

      {(!isSuperAdmin || tab === 'overview') && <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Metric icon={TrendingUp} label="近 30 天销售额" value={fmtY(revenue30d)} tone="text-green-700" />
          <Metric icon={ShoppingBag} label="近 30 天订单" value={orders30d} />
          {isSuperAdmin
            ? <><Metric icon={Users} label="商城会员" value={amount(summary.totalMembers || customers.length)} /><Metric icon={PackageCheck} label="待仓库发货" value={amount(summary.pendingShipments)} tone="text-orange-700" /></>
            : <><Metric icon={MousePointerClick} label="近 30 天进入" value={amount(summary.opens30d ?? fallback.opens)} /><Metric icon={Wallet} label="近 30 天预估提成" value={fmtY(fallback.commission)} tone="text-purple-700" /></>}
        </div>

        {!isSuperAdmin && accounts[0] && <Card className="p-5">
          <div className="font-semibold text-gray-800">我的分享信息</div>
          <div className="grid sm:grid-cols-3 gap-4 mt-4">
            <div><div className="text-xs text-gray-400">推广码</div><div className="font-mono text-lg mt-1">{accounts[0].referral_code}</div></div>
            <div><div className="text-xs text-gray-400">提成比例</div><div className="text-lg mt-1">{rate(accounts[0].miniprogram_commission_rate)}%</div></div>
            <div><div className="text-xs text-gray-400">分享入口</div><div className="font-mono text-xs mt-2 break-all">/pages/home/index?sales={accounts[0].referral_code}</div></div>
          </div>
        </Card>}

        <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)] gap-4">
          <Card className="p-4">
            <div className="font-semibold text-gray-800">近 30 天销售趋势</div>
            <div className="h-64 mt-4">
              {daily.length ? <ResponsiveContainer width="100%" height="100%"><AreaChart data={daily} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <defs><linearGradient id="salesArea" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.28} /><stop offset="95%" stopColor="#8B5CF6" stopOpacity={0.02} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ECE8F0" />
                <XAxis dataKey="date" tickFormatter={value => String(value).slice(5)} tick={{ fontSize: 11, fill: '#999' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#999' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(value, name) => [name === 'revenue' ? fmtY(value) : value, name === 'revenue' ? '销售额' : '订单']} labelFormatter={value => shortDate(value)} />
                <Area type="monotone" dataKey="revenue" stroke="#8B5CF6" strokeWidth={2} fill="url(#salesArea)" />
              </AreaChart></ResponsiveContainer> : <div className="h-full flex items-center justify-center text-sm text-gray-400">暂无趋势数据</div>}
            </div>
          </Card>
          <Card className="p-4">
            <div className="font-semibold text-gray-800">热销商品</div>
            <div className="mt-3 divide-y">{topProducts.map((product, index) => <div key={`${product.name}-${product.spec}`} className="py-3 flex items-center gap-3">
              <div className="w-6 h-6 rounded-full bg-purple-50 text-purple-700 flex items-center justify-center text-xs font-medium">{index + 1}</div>
              <div className="flex-1 min-w-0"><div className="text-sm text-gray-800 truncate">{product.name}</div><div className="text-xs text-gray-400">{product.spec} · {amount(product.quantity)} 件</div></div>
              <div className="text-sm font-medium tabular-nums">{fmtY(amount(product.revenue))}</div>
            </div>)}</div>
            {!topProducts.length && <div className="py-16 text-center text-sm text-gray-400">暂无成交商品</div>}
          </Card>
        </div>

        <Card className="overflow-hidden">
          <div className="px-4 py-4 border-b flex items-center justify-between"><div><div className="font-semibold text-gray-800">微信商城订单</div><div className="text-xs text-gray-400 mt-1">已付款订单自动进入仓库待发货队列</div></div>{isSuperAdmin && <div className="text-xs text-gray-400">最近 200 笔</div>}</div>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[880px]">
            <thead><tr className="border-b bg-gray-50/80">{['日期','订单号','客户','商品','归属账号','销售额','履约'].map(title => <th key={title} className={`py-2.5 px-3 text-xs text-gray-500 font-medium ${title === '销售额' ? 'text-right' : 'text-left'}`}>{title}</th>)}</tr></thead>
            <tbody>{orders.map(order => <tr key={order.id} className={`border-b last:border-0 ${isSuperAdmin && order.member_key ? 'cursor-pointer hover:bg-purple-50/40' : ''}`} onClick={() => openCustomer({ member_key: order.member_key, nickname: order.customer_name, phone_mask: order.phone_mask })}>
              <td className="py-3 px-3 text-xs text-gray-500">{shortDate(order.created_at)}</td>
              <td className="py-3 px-3 font-mono text-xs">{order.order_no}</td>
              <td className="py-3 px-3"><div>{order.customer_name || order.recipient_name || '紫都会员'}</div><div className="text-xs text-gray-400">{order.phone_mask || '未绑定手机号'}</div></td>
              <td className="py-3 px-3 max-w-[260px]"><div className="truncate text-xs text-gray-600">{order.item_summary || `${amount(order.item_count)} 件商品`}</div></td>
              <td className="py-3 px-3">{order.sales_name || '未归属'}</td>
              <td className="py-3 px-3 text-right font-medium">{fmtY(amount(order.amount))}</td>
              <td className="py-3 px-3"><StatusPill status={order.status} /></td>
            </tr>)}</tbody>
          </table></div>
          {!loading && !orders.length && <div className="py-12 text-center text-sm text-gray-400">暂无已支付商城订单</div>}
        </Card>
      </>}

      {isSuperAdmin && tab === 'customers' && <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Metric icon={Users} label="商城会员" value={amount(summary.totalMembers || customers.length)} />
          <Metric icon={UserPlus} label="近 30 天新增" value={amount(summary.newMembers30d)} tone="text-purple-700" />
          <Metric icon={Repeat2} label="复购客户" value={amount(summary.repeatBuyers)} />
          <Metric icon={Wallet} label="累计实付" value={fmtY(amount(summary.paidRevenueTotal))} tone="text-green-700" />
        </div>
        <Card className="overflow-hidden">
          <div className="px-4 py-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div><div className="font-semibold text-gray-800">商城客户</div><div className="text-xs text-gray-400 mt-1">列表脱敏；点开后仅超级管理员可查看完整联系方式与订单</div></div>
            <div className="relative"><Search size={15} className="absolute left-3 top-2.5 text-gray-400" /><input value={customerSearch} onChange={event => setCustomerSearch(event.target.value)} placeholder="昵称 / 手机 / 收件人 / 销售" className="w-64 max-w-full border rounded-lg pl-9 pr-3 py-2 text-sm" /></div>
          </div>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[820px]">
            <thead><tr className="border-b bg-gray-50/80">{['客户','注册时间','订单数','累计实付','销售归属','最近购买',''].map(title => <th key={title} className={`py-2.5 px-3 text-xs text-gray-500 font-medium ${['订单数','累计实付'].includes(title) ? 'text-right' : 'text-left'}`}>{title}</th>)}</tr></thead>
            <tbody>{filteredCustomers.map(customer => <tr key={customer.member_key} onClick={() => openCustomer(customer)} className="border-b last:border-0 cursor-pointer hover:bg-purple-50/40">
              <td className="py-3 px-3"><div className="font-medium text-gray-800">{customer.nickname || '紫都会员'}</div><div className="text-xs text-gray-400">{customer.phone_mask || '未绑定手机号'}{customer.latest_recipient ? ` · ${customer.latest_recipient}` : ''}</div></td>
              <td className="py-3 px-3 text-xs text-gray-500">{shortDate(customer.registered_at) || '—'}</td>
              <td className="py-3 px-3 text-right tabular-nums">{amount(customer.order_count)}</td>
              <td className="py-3 px-3 text-right font-medium tabular-nums">{fmtY(amount(customer.total_paid))}</td>
              <td className="py-3 px-3">{customer.sales_name || '未归属'}</td>
              <td className="py-3 px-3 text-xs text-gray-500">{shortDate(customer.last_order_at) || '尚未购买'}</td>
              <td className="py-3 px-3 text-right"><ChevronRight size={16} className="inline text-gray-400" /></td>
            </tr>)}</tbody>
          </table></div>
          {!loading && !filteredCustomers.length && <div className="py-12 text-center text-sm text-gray-400">暂无匹配客户</div>}
        </Card>
      </>}

      {isSuperAdmin && tab === 'catalog' && <MiniProgramCatalog />}

      {isSuperAdmin && tab === 'attribution' && <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Metric icon={Users} label="已开通账号" value={enabledAccounts.length} />
          <Metric icon={MousePointerClick} label="近 30 天进入" value={amount(summary.opens30d ?? fallback.opens)} />
          <Metric icon={TrendingUp} label="已归属销售额" value={fmtY(amount(summary.attributedRevenue30d))} tone="text-green-700" />
          <Metric icon={Wallet} label="未归属销售额" value={fmtY(amount(summary.unattributedRevenue30d))} tone="text-orange-700" />
        </div>
        <Card className="overflow-hidden">
          <div className="px-4 py-4 border-b"><div className="font-semibold text-gray-800">账号与提成配置</div><div className="text-xs text-gray-400 mt-1">岗位权限与小程序销售资格分开；只有这里开通的手机号才能看到个人销售工作台。</div></div>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[980px]">
            <thead><tr className="border-b bg-gray-50/80">{['账号','岗位','小程序销售','推广码','提成比例','近 30 天订单','近 30 天销售额','预估提成','操作'].map(title => <th key={title} className={`py-2.5 px-3 text-xs text-gray-500 font-medium ${['近 30 天订单','近 30 天销售额','预估提成','操作'].includes(title) ? 'text-right' : 'text-left'}`}>{title}</th>)}</tr></thead>
            <tbody>{accounts.map(account => {
              const draft = drafts[account.id] || {};
              const revenue = amount(account.paid_revenue_30d);
              const commission = revenue * rate(draft.commissionRate) / 100;
              return <tr key={account.id} className="border-b last:border-0">
                <td className="py-3 px-3"><div className="font-medium text-gray-800">{account.name}</div><div className="text-xs text-gray-400">{account.phone}</div></td>
                <td className="py-3 px-3 text-xs text-gray-500">{roleLabel(account.role)}</td>
                <td className="py-3 px-3"><button type="button" onClick={() => setDrafts(current => ({ ...current, [account.id]: { ...draft, referralEnabled: !draft.referralEnabled } }))} className={`px-2.5 py-1 rounded-full text-xs border ${draft.referralEnabled ? 'bg-purple-50 border-purple-300 text-purple-700' : 'bg-white border-gray-200 text-gray-400'}`}>{draft.referralEnabled ? '已开通' : '未开通'}</button></td>
                <td className="py-3 px-3"><input value={draft.referralCode || ''} onChange={event => setDrafts(current => ({ ...current, [account.id]: { ...draft, referralCode: event.target.value.toUpperCase() } }))} placeholder="开通时自动生成" className="w-40 border rounded-lg px-2.5 py-2 text-xs font-mono" /></td>
                <td className="py-3 px-3"><div className="flex items-center gap-1"><input type="number" min="0" max="100" step="0.1" value={draft.commissionRate ?? 0} onChange={event => setDrafts(current => ({ ...current, [account.id]: { ...draft, commissionRate: event.target.value } }))} className="w-20 border rounded-lg px-2.5 py-2 text-sm text-right" /><span className="text-gray-400">%</span></div></td>
                <td className="py-3 px-3 text-right tabular-nums">{amount(account.paid_orders_30d)}</td>
                <td className="py-3 px-3 text-right tabular-nums">{fmtY(revenue)}</td>
                <td className="py-3 px-3 text-right font-medium text-purple-700 tabular-nums">{fmtY(commission)}</td>
                <td className="py-3 px-3 text-right"><button onClick={() => saveAccount(account)} disabled={savingId === account.id} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-purple-600 text-white text-xs disabled:opacity-40"><Save size={13} />{savingId === account.id ? '保存中' : '保存'}</button></td>
              </tr>;
            })}</tbody>
          </table></div>
        </Card>
      </>}

      {selectedCustomer && <CustomerDetail selected={selectedCustomer} detail={customerDetail} loading={customerLoading} error={customerError} onClose={() => { setSelectedCustomer(null); setCustomerDetail(null); setCustomerError(''); }} />}
    </div>
  );
}
