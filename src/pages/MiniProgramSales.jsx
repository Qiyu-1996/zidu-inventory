import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Save, Smartphone, Users, Wallet, ShoppingBag, MousePointerClick } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { Card, fmtY } from '../components/ui';
import * as api from '../lib/api';

const amount = value => Number(value || 0);
const rate = value => Math.min(100, Math.max(0, Number(value || 0)));
const roleLabel = role => ({ SUPER_ADMIN: '超级管理员', ADMIN: '管理员', SALES: '销售', FINANCE: '财务', WAREHOUSE: '仓库' }[role] || role);

export default function MiniProgramSales() {
  const { user } = useAuth();
  const isSuperAdmin = user?.isSuperAdmin === true;
  const [dashboard, setDashboard] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState(null);
  const [error, setError] = useState('');

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
  const totals = useMemo(() => enabledAccounts.reduce((sum, account) => {
    const revenue = amount(account.paid_revenue_30d);
    const commission = revenue * rate(account.miniprogram_commission_rate) / 100;
    return {
      opens: sum.opens + amount(account.opens_30d),
      orders: sum.orders + amount(account.paid_orders_30d),
      revenue: sum.revenue + revenue,
      commission: sum.commission + commission
    };
  }, { opens: 0, orders: 0, revenue: 0, commission: 0 }), [enabledAccounts]);

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

  if (!isSuperAdmin && !user?.referralEnabled) {
    return <Card className="p-8 text-center text-gray-400">尚未开通小程序销售资格</Card>;
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-lg font-semibold text-gray-800"><Smartphone size={20} className="text-purple-600" />{isSuperAdmin ? '小程序销售管理' : '我的小程序销售'}</div>
            <div className="text-sm text-gray-500 mt-1">分享归属保留 30 天，下单时固化销售，只有已支付订单计入销售额。</div>
          </div>
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 px-3 py-2 text-sm border rounded-lg text-gray-600 disabled:opacity-40"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />刷新</button>
        </div>
      </Card>

      {error && <div className="p-3 rounded-lg bg-red-50 text-sm text-red-600">{error}</div>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4"><div className="flex items-center gap-2 text-xs text-gray-500"><Users size={14} />已开通账号</div><div className="text-2xl font-semibold mt-2">{enabledAccounts.length}</div></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-xs text-gray-500"><MousePointerClick size={14} />近 30 天进入</div><div className="text-2xl font-semibold mt-2">{totals.opens}</div></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-xs text-gray-500"><ShoppingBag size={14} />近 30 天销售额</div><div className="text-2xl font-semibold mt-2 text-green-700">{fmtY(totals.revenue)}</div></Card>
        <Card className="p-4"><div className="flex items-center gap-2 text-xs text-gray-500"><Wallet size={14} />近 30 天预估提成</div><div className="text-2xl font-semibold mt-2 text-purple-700">{fmtY(totals.commission)}</div></Card>
      </div>

      {isSuperAdmin && (
        <Card>
          <div className="px-4 py-4 border-b">
            <div className="font-semibold text-gray-800">账号与提成配置</div>
            <div className="text-xs text-gray-400 mt-1">任何在职账号都可以叠加小程序销售资格；岗位权限不会改变。</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[980px]">
              <thead><tr className="border-b bg-gray-50/80">
                {['账号','岗位','小程序销售','推广码','提成比例','近 30 天订单','近 30 天销售额','预估提成','操作'].map(title => <th key={title} className={`py-2.5 px-3 text-xs text-gray-500 font-medium ${['近 30 天订单','近 30 天销售额','预估提成','操作'].includes(title) ? 'text-right' : 'text-left'}`}>{title}</th>)}
              </tr></thead>
              <tbody>{accounts.map(account => {
                const draft = drafts[account.id] || {};
                const revenue = amount(account.paid_revenue_30d);
                const commission = revenue * rate(draft.commissionRate) / 100;
                return <tr key={account.id} className="border-b last:border-0">
                  <td className="py-3 px-3"><div className="font-medium text-gray-800">{account.name}</div><div className="text-xs text-gray-400">{account.phone}</div></td>
                  <td className="py-3 px-3 text-xs text-gray-500">{roleLabel(account.role)}</td>
                  <td className="py-3 px-3"><button type="button" onClick={() => setDrafts(current => ({ ...current, [account.id]: { ...draft, referralEnabled: !draft.referralEnabled } }))} className={`px-2.5 py-1 rounded-full text-xs border ${draft.referralEnabled ? 'bg-purple-50 border-purple-300 text-purple-700' : 'bg-white border-gray-200 text-gray-400'}`}>{draft.referralEnabled ? '已开通' : '未开通'}</button></td>
                  <td className="py-3 px-3"><input value={draft.referralCode || ''} onChange={e => setDrafts(current => ({ ...current, [account.id]: { ...draft, referralCode: e.target.value.toUpperCase() } }))} placeholder="开通时自动生成" className="w-40 border rounded-lg px-2.5 py-2 text-xs font-mono" /></td>
                  <td className="py-3 px-3"><div className="flex items-center gap-1"><input type="number" min="0" max="100" step="0.1" value={draft.commissionRate ?? 0} onChange={e => setDrafts(current => ({ ...current, [account.id]: { ...draft, commissionRate: e.target.value } }))} className="w-20 border rounded-lg px-2.5 py-2 text-sm text-right" /><span className="text-gray-400">%</span></div></td>
                  <td className="py-3 px-3 text-right tabular-nums">{amount(account.paid_orders_30d)}</td>
                  <td className="py-3 px-3 text-right tabular-nums">{fmtY(revenue)}</td>
                  <td className="py-3 px-3 text-right font-medium text-purple-700 tabular-nums">{fmtY(commission)}</td>
                  <td className="py-3 px-3 text-right"><button onClick={() => saveAccount(account)} disabled={savingId === account.id} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-purple-600 text-white text-xs disabled:opacity-40"><Save size={13} />{savingId === account.id ? '保存中' : '保存'}</button></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </Card>
      )}

      {!isSuperAdmin && accounts[0] && (
        <Card className="p-5">
          <div className="font-semibold text-gray-800">我的分享信息</div>
          <div className="grid sm:grid-cols-3 gap-4 mt-4">
            <div><div className="text-xs text-gray-400">推广码</div><div className="font-mono text-lg mt-1">{accounts[0].referral_code}</div></div>
            <div><div className="text-xs text-gray-400">提成比例</div><div className="text-lg mt-1">{rate(accounts[0].miniprogram_commission_rate)}%</div></div>
            <div><div className="text-xs text-gray-400">分享入口</div><div className="font-mono text-xs mt-2 break-all">/pages/home/index?sales={accounts[0].referral_code}</div></div>
          </div>
        </Card>
      )}

      <Card>
        <div className="px-4 py-4 border-b"><div className="font-semibold text-gray-800">已支付小程序订单</div><div className="text-xs text-gray-400 mt-1">{isSuperAdmin ? '显示最近 100 笔全员归属订单' : '只显示归属于当前账号的订单'}</div></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead><tr className="border-b bg-gray-50/80">{['日期','订单号',...(isSuperAdmin ? ['归属账号'] : []),'销售额','状态'].map(title => <th key={title} className={`py-2.5 px-3 text-xs text-gray-500 font-medium ${title === '销售额' ? 'text-right' : 'text-left'}`}>{title}</th>)}</tr></thead>
            <tbody>{orders.map(order => <tr key={order.id} className="border-b last:border-0">
              <td className="py-3 px-3 text-xs text-gray-500">{String(order.created_at || '').slice(0, 10)}</td>
              <td className="py-3 px-3 font-mono text-xs">{order.order_no}</td>
              {isSuperAdmin && <td className="py-3 px-3">{order.sales_name || '未归属'}</td>}
              <td className="py-3 px-3 text-right font-medium">{fmtY(amount(order.amount))}</td>
              <td className="py-3 px-3 text-xs text-green-700">已支付</td>
            </tr>)}</tbody>
          </table>
          {!loading && !orders.length && <div className="py-10 text-center text-sm text-gray-400">暂无已支付归属订单</div>}
        </div>
      </Card>
    </div>
  );
}
