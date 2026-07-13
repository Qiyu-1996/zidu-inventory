import { useState, useMemo } from 'react';
import { ShoppingCart, TrendingUp, Package, Percent, Download, Wallet, Coins, Boxes } from 'lucide-react';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, StatCard, fmtY, exportCSV, STATUS_MAP } from '../components/ui';

// Soft Wellness 配色循环
const CL = ["#5C4B73","#8D7AA6","#F3BD5B","#7B8F67","#B3A99A","#8D5F5B","#CFC6DC","#8A8178","#3F3650","#EAE3D6"];

// 图表通用色（Soft Wellness）
const C_PRIMARY = "#5C4B73";   // 主/数据主色
const C_FILL    = "#CFC6DC";   // 浅紫填充
const C_RISK    = "#8D5F5B";   // 陶土红/风险（折扣）
const C_GRID    = "#E6DECF";   // 暖灰网格线/Tooltip

// 业务类型固定顺序与配色
const BIZ_TYPES = ["院线","芳疗师","品牌定制","私人定制","其他"];
const BIZ_COLOR = { "院线": "#5C4B73", "芳疗师": "#8D7AA6", "品牌定制": "#F3BD5B", "私人定制": "#7B8F67", "其他": "#B3A99A" };
const bizTypeLabel = t => t === "OEM代工" ? "品牌定制" : t === "ODM定制" ? "私人定制" : (t || "院线");
const bizColor = t => BIZ_COLOR[t] || "#B3A99A";

// 暖色 Tooltip 样式
const TT_STYLE = {
  contentStyle: { background: "#FBF8F2", border: `1px solid ${C_GRID}`, borderRadius: 10, fontSize: 12, color: "#3F3650", boxShadow: "0 4px 16px rgba(63,54,80,0.08)" },
  labelStyle: { color: "#8A8178", fontWeight: 500, marginBottom: 2 },
  cursor: { fill: "rgba(92,75,115,0.06)" },
};

// 自定义 HTML 图例：小方块 + 标签 + 百分比
const DistLegend = ({ data, colorFn, total }) => (
  <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
    {data.map(d => {
      const pct = total > 0 ? (d.value / total * 100).toFixed(0) : 0;
      return (
        <div key={d.name} className="flex items-center gap-1.5 text-xs" style={{ color: "#8A8178" }}>
          <span className="inline-block rounded-sm shrink-0" style={{ width: 10, height: 10, background: colorFn(d) }} />
          <span style={{ color: "#3F3650" }}>{d.name}</span>
          <span style={{ color: "#8A8178" }}>{pct}%</span>
        </div>
      );
    })}
  </div>
);

export default function Analytics() {
  const { user } = useAuth();
  const { orders, customers, products, users } = useData();

  const isAdmin = user.role === "ADMIN";
  const vo = orders.filter(o => o.status !== "CANCELLED");
  const totR = vo.reduce((s, o) => s + o.total, 0);
  const totD = vo.reduce((s, o) => s + (o.discountAmount || 0), 0);
  const avg = vo.length ? Math.round(totR / vo.length) : 0;

  // 毛利（仅 ADMIN）：单笔 cogs = Σ(qty*unitCost)，毛利 = total - cogs。
  // 只在该单 cogs>0 的订单上统计，避免历史/未录成本订单把毛利率拉到 100%。
  const profit = useMemo(() => {
    if (!isAdmin) return null;
    let gp = 0, rev = 0, costed = 0;
    vo.forEach(o => {
      const cogs = (o.items || []).reduce((s, it) => s + it.quantity * (it.unitCost || 0), 0);
      if (cogs > 0) { gp += o.total - cogs; rev += o.total; costed++; }
    });
    return { grossProfit: gp, rev, margin: rev > 0 ? gp / rev : 0, costed, totalOrders: vo.length };
  }, [isAdmin, vo]);

  // 库存成本价值：Σ(spec.stock*spec.cost)，cost=0 计 0，另统计未录成本 SKU 数。
  const inv = useMemo(() => {
    if (!isAdmin) return null;
    let costVal = 0, missing = 0;
    products.forEach(p => (p.specs || []).forEach(s => {
      const c = s.cost || 0;
      if (c > 0) costVal += (s.stock || 0) * c; else missing++;
    }));
    return { costVal, missing };
  }, [isAdmin, products]);

  // 折扣让利占营收
  const discRateOverall = totR + totD > 0 ? totD / (totR + totD) : 0;

  const [tab, setTab] = useState("trend");
  const [period, setPeriod] = useState("month");
  const tabs = [{ k: "trend", l: "趋势总览" }, { k: "customers", l: "大客户分析" }, { k: "products", l: "爆品分析" }, { k: "insights", l: "智能建议" }];

  // Time series
  const timeData = useMemo(() => {
    const now = new Date(); const d = [];
    if (period === "day") {
      for (let i = 29; i >= 0; i--) { const dt = new Date(now); dt.setDate(dt.getDate() - i); const k = dt.toISOString().slice(0, 10); const m = vo.filter(o => o.createdAt === k); d.push({ name: `${dt.getMonth() + 1}/${dt.getDate()}`, sales: m.reduce((s, o) => s + o.total, 0), count: m.length, disc: m.reduce((s, o) => s + (o.discountAmount || 0), 0) }); }
    } else if (period === "week") {
      for (let i = 11; i >= 0; i--) { const end = new Date(now); end.setDate(end.getDate() - i * 7); const start = new Date(end); start.setDate(start.getDate() - 6); const sk = start.toISOString().slice(0, 10); const ek = end.toISOString().slice(0, 10); const m = vo.filter(o => o.createdAt >= sk && o.createdAt <= ek); d.push({ name: `${start.getMonth() + 1}/${start.getDate()}`, sales: m.reduce((s, o) => s + o.total, 0), count: m.length, disc: m.reduce((s, o) => s + (o.discountAmount || 0), 0) }); }
    } else if (period === "month") {
      for (let i = 11; i >= 0; i--) { const dt = new Date(now); dt.setMonth(dt.getMonth() - i); const k = dt.toISOString().slice(0, 7); const m = vo.filter(o => o.createdAt?.startsWith(k)); d.push({ name: `${dt.getFullYear()}.${dt.getMonth() + 1}`, sales: m.reduce((s, o) => s + o.total, 0), count: m.length, disc: m.reduce((s, o) => s + (o.discountAmount || 0), 0) }); }
    } else {
      for (let i = 4; i >= 0; i--) { const y = now.getFullYear() - i; const m = vo.filter(o => o.createdAt?.startsWith(String(y))); d.push({ name: String(y), sales: m.reduce((s, o) => s + o.total, 0), count: m.length, disc: m.reduce((s, o) => s + (o.discountAmount || 0), 0) }); }
    }
    return d;
  }, [vo, period]);

  const seriesData = useMemo(() => {
    const m = {}; vo.forEach(o => o.items.forEach(it => { const p = products.find(p => p.id === it.productId); if (p) m[p.series] = (m[p.series] || 0) + it.subtotal; }));
    return Object.entries(m).map(([n, v]) => ({ name: n.replace("系列", ""), value: v })).sort((a, b) => b.value - a.value);
  }, [vo, products]);

  const salesComp = useMemo(() => {
    if (user.role !== "ADMIN") return [];
    return users.filter(u => u.role === "SALES" && u.status === 'active').map(su => {
      const so = vo.filter(o => o.salesId === su.id);
      const sales = so.reduce((s, o) => s + o.total, 0);
      const disc = so.reduce((s, o) => s + (o.discountAmount || 0), 0);
      // 折扣率 = 折扣额 / 折前金额
      const discRate = (sales + disc) > 0 ? Math.round(disc / (sales + disc) * 1000) / 10 : 0;
      // 毛利：只在该销售 cogs>0 的订单上统计
      let gp = 0, gpRev = 0, costed = 0;
      so.forEach(o => {
        const cogs = (o.items || []).reduce((s, it) => s + it.quantity * (it.unitCost || 0), 0);
        if (cogs > 0) { gp += o.total - cogs; gpRev += o.total; costed++; }
      });
      const margin = gpRev > 0 ? gp / gpRev : 0;
      // 按业务类型分组营收 Σtotal
      const bizMap = {};
      so.forEach(o => { const t = bizTypeLabel(o.businessType); bizMap[t] = (bizMap[t] || 0) + o.total; });
      const types = [...BIZ_TYPES.filter(t => bizMap[t] != null), ...Object.keys(bizMap).filter(t => !BIZ_TYPES.includes(t))];
      const byBiz = types.map(t => ({ type: t, revenue: bizMap[t] }));
      return { name: su.name, sales, count: so.length, custs: customers.filter(c => c.salesId === su.id).length, disc, discRate, gp, margin, costed, byBiz };
    });
  }, [user, vo, users, customers]);

  // 堆叠柱所需的业务类型集合（按固定顺序，含数据中出现的非标准类型）+ 每销售一行（各类型营收摊平为列）
  const bizSales = useMemo(() => {
    if (user.role !== "ADMIN") return { rows: [], types: [] };
    const seen = new Set();
    salesComp.forEach(s => s.byBiz.forEach(b => seen.add(b.type)));
    const types = [...BIZ_TYPES.filter(t => seen.has(t)), ...[...seen].filter(t => !BIZ_TYPES.includes(t))];
    const rows = salesComp.map(s => {
      const row = { name: s.name };
      types.forEach(t => { row[t] = 0; });
      s.byBiz.forEach(b => { row[b.type] = b.revenue; });
      return row;
    });
    return { rows, types };
  }, [user, salesComp]);

  // 业务类型总分布（全部 vo 按 businessType 营收占比）
  const bizDist = useMemo(() => {
    const m = {};
    vo.forEach(o => { const t = bizTypeLabel(o.businessType); m[t] = (m[t] || 0) + o.total; });
    const types = [...BIZ_TYPES.filter(t => m[t] != null), ...Object.keys(m).filter(t => !BIZ_TYPES.includes(t))];
    return types.map(t => ({ name: t, value: m[t] }));
  }, [vo]);

  // Customer analytics
  const custAnalytics = useMemo(() => {
    return customers.map(c => {
      const co = vo.filter(o => o.customerId === c.id); const rev = co.reduce((s, o) => s + o.total, 0);
      const lastOrder = co.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
      const daysSinceLast = lastOrder ? Math.round((Date.now() - new Date(lastOrder.createdAt).getTime()) / 86400000) : 999;
      const now = Date.now(); const d90 = 90 * 86400000;
      const recent = co.filter(o => now - new Date(o.createdAt).getTime() < d90).reduce((s, o) => s + o.total, 0);
      const prior = co.filter(o => { const age = now - new Date(o.createdAt).getTime(); return age >= d90 && age < d90 * 2; }).reduce((s, o) => s + o.total, 0);
      const trend = prior > 0 ? Math.round((recent / prior - 1) * 100) : recent > 0 ? 100 : 0;
      const pm = {}; co.forEach(o => o.items.forEach(it => { pm[it.productId] = (pm[it.productId] || 0) + it.subtotal; }));
      const topProds = Object.entries(pm).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([pid]) => products.find(p => p.id === Number(pid))?.name || '');
      const seller = users.find(u => u.id === c.salesId);
      return { id: c.id, name: c.name, type: c.type, seller: seller?.name || '', orders: co.length, revenue: rev, avgOrder: co.length ? Math.round(rev / co.length) : 0, daysSinceLast, trend, topProds, lastDate: lastOrder?.createdAt || '' };
    }).sort((a, b) => b.revenue - a.revenue);
  }, [customers, vo, products, users]);

  // Product analytics
  const prodAnalytics = useMemo(() => {
    const pm = {};
    vo.forEach(o => o.items.forEach(it => {
      const k = `${it.productId}-${it.spec || ''}`; if (!pm[k]) pm[k] = { pid: it.productId, spec: it.spec || '', qty: 0, rev: 0, orders: new Set(), custs: new Set() };
      pm[k].qty += it.quantity; pm[k].rev += it.subtotal; pm[k].orders.add(o.id); pm[k].custs.add(o.customerId);
    }));
    const now = Date.now(); const d30 = 30 * 86400000; const d60 = 60 * 86400000;
    return Object.values(pm).map(p => {
      const prod = products.find(pr => pr.id === p.pid); const specObj = prod?.specs.find(s => s.spec === p.spec);
      const r30 = vo.filter(o => now - new Date(o.createdAt).getTime() < d30).reduce((s, o) => s + o.items.filter(it => it.productId === p.pid && (it.spec || '') === (p.spec || '')).reduce((s2, it) => s2 + it.subtotal, 0), 0);
      const p30 = vo.filter(o => { const a = now - new Date(o.createdAt).getTime(); return a >= d30 && a < d60; }).reduce((s, o) => s + o.items.filter(it => it.productId === p.pid && (it.spec || '') === (p.spec || '')).reduce((s2, it) => s2 + it.subtotal, 0), 0);
      const trend = p30 > 0 ? Math.round((r30 / p30 - 1) * 100) : r30 > 0 ? 100 : 0;
      return { name: prod?.name || '', code: prod?.code || '', spec: p.spec, series: prod?.series || '', qty: p.qty, rev: p.rev, orderCount: p.orders.size, custCount: p.custs.size, trend, stock: specObj?.stock || 0, safeStock: specObj?.safeStock || 0, r30 };
    }).sort((a, b) => b.rev - a.rev);
  }, [vo, products]);

  // Smart insights
  const insights = useMemo(() => {
    const recs = [];
    const dormant = custAnalytics.filter(c => c.revenue > 3000 && c.daysSinceLast > 60);
    if (dormant.length > 0) recs.push({ type: "warning", title: "高价值客户流失预警", desc: `${dormant.length}位累计消费超3000的客户超过60天未下单：${dormant.slice(0, 3).map(c => c.name).join("、")}。建议主动回访。`, priority: 1 });
    const rising = prodAnalytics.filter(p => p.trend > 50 && p.r30 > 500);
    if (rising.length > 0) recs.push({ type: "success", title: "爆品趋势", desc: `${rising.slice(0, 3).map(p => `${p.name}(${p.spec})`).join("、")} 近30天环比增长超50%。建议确保库存充足。`, priority: 2 });
    const lowHot = prodAnalytics.filter(p => p.stock <= p.safeStock && p.r30 > 0);
    if (lowHot.length > 0) recs.push({ type: "warning", title: "热销品库存告急", desc: `${lowHot.slice(0, 4).map(p => `${p.name}(${p.spec}) 剩${p.stock}`).join("、")}。建议立即补货。`, priority: 1 });
    const slow = prodAnalytics.filter(p => p.stock > p.safeStock * 5 && p.r30 === 0);
    if (slow.length > 0) recs.push({ type: "info", title: "滞销库存提醒", desc: `${slow.slice(0, 3).map(p => `${p.name}(${p.spec}) 库存${p.stock}`).join("、")} 近30天零销售。建议促销清仓。`, priority: 4 });
    if (custAnalytics.length >= 5) { const top3Rev = custAnalytics.slice(0, 3).reduce((s, c) => s + c.revenue, 0); const ratio = totR > 0 ? Math.round(top3Rev / totR * 100) : 0; if (ratio > 60) recs.push({ type: "info", title: `客户集中度偏高 (Top3占${ratio}%)`, desc: `前3大客户贡献了${ratio}%的销售额。建议拓展新客户。`, priority: 3 }); }
    return recs.sort((a, b) => a.priority - b.priority);
  }, [custAnalytics, prodAnalytics, totR]);

  const exportTrend = () => exportCSV(["周期","销售额","订单数","折扣额"], timeData.map(d => [d.name, d.sales, d.count, d.disc]), `趋势_${period}.csv`);
  const exportCust = () => exportCSV(["客户","类型","销售","订单数","累计金额","客单价","最近下单","趋势%","常购产品"], custAnalytics.map(c => [c.name, c.type, c.seller, c.orders, c.revenue, c.avgOrder, c.lastDate, c.trend, c.topProds.join("/")]), "客户分析.csv");
  const exportProd = () => exportCSV(["产品","编码","规格","系列","销量","销售额","订单数","客户数","趋势%","库存"], prodAnalytics.map(p => [p.name, p.code, p.spec, p.series, p.qty, p.rev, p.orderCount, p.custCount, p.trend, p.stock]), "产品分析.csv");

  const InsightCard = ({ type, title, desc }) => {
    const styles = { warning: "border-l-4 border-l-orange-400 bg-orange-50", success: "border-l-4 border-l-green-400 bg-green-50", info: "border-l-4 border-l-blue-400 bg-blue-50" };
    return <div className={`rounded-lg p-4 ${styles[type] || styles.info}`}><div className="text-sm font-semibold text-gray-800 mb-1">{type === "warning" ? "⚠️" : type === "success" ? "📈" : "💡"} {title}</div><div className="text-sm text-gray-600 leading-relaxed">{desc}</div></div>;
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="总销售额" value={fmtY(totR)} icon={TrendingUp} color="#5C4B73" />
        <StatCard label="总订单" value={vo.length} icon={ShoppingCart} color="#5F7689" />
        <StatCard label="客单价" value={fmtY(avg)} icon={Package} color="#7B8F67" />
        <StatCard label="折扣总额" value={fmtY(totD)} icon={Percent} color="#8D5F5B" />
      </div>

      {isAdmin && profit && inv && <>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="毛利" value={fmtY(profit.grossProfit)} icon={Wallet} color="#5C4B73" />
          <StatCard label="毛利率" value={`${(profit.margin * 100).toFixed(1)}%`} icon={Coins} color="#7B8F67" />
          <StatCard label="库存成本价值" value={fmtY(inv.costVal)} sub={inv.missing > 0 ? `${inv.missing} 个 SKU 未录成本` : undefined} icon={Boxes} color="#5F7689" />
        </div>
        <div className="text-xs text-gray-400 -mt-1 px-1">
          毛利基于 {profit.costed} 笔已录成本订单（共 {profit.totalOrders} 笔）
          {totD > 0 && <span className="ml-3">折扣共让利 {fmtY(totD)}，占营收 {(discRateOverall * 100).toFixed(1)}%</span>}
        </div>
      </>}

      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {tabs.map(t => <button key={t.k} onClick={() => setTab(t.k)} className={`px-4 py-2 text-sm rounded-lg border whitespace-nowrap transition ${tab === t.k ? "bg-purple-100 border-purple-300 text-purple-700 font-medium" : "bg-white text-gray-500 hover:bg-gray-50"}`}>{t.l}</button>)}
      </div>

      {/* Trend */}
      {tab === "trend" && <>
        <Card className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div className="flex gap-1.5">{[{ k: "day", l: "日" }, { k: "week", l: "周" }, { k: "month", l: "月" }, { k: "year", l: "年" }].map(t => <button key={t.k} onClick={() => setPeriod(t.k)} className={`px-3 py-1.5 text-sm rounded-lg border ${period === t.k ? "bg-purple-100 border-purple-300 text-purple-700 font-medium" : "bg-white text-gray-500"}`}>{t.l}</button>)}</div>
            <button onClick={exportTrend} className="flex items-center gap-1 text-xs text-purple-700 px-2 py-1 rounded border border-purple-200 hover:bg-purple-50"><Download size={13} />导出</button>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={timeData}><CartesianGrid strokeDasharray="3 3" stroke={C_GRID} vertical={false} /><XAxis dataKey="name" fontSize={11} tick={{ fill: "#8A8178" }} axisLine={{ stroke: C_GRID }} tickLine={false} /><YAxis fontSize={12} tick={{ fill: "#8A8178" }} axisLine={false} tickLine={false} tickFormatter={v => v >= 10000 ? `${(v / 10000).toFixed(0)}万` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} /><Tooltip {...TT_STYLE} formatter={(v, n) => n === "count" ? v : fmtY(v)} /><Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "#8A8178" }} /><Bar dataKey="sales" name="销售额" fill={C_PRIMARY} radius={[6, 6, 0, 0]} maxBarSize={32} /><Bar dataKey="disc" name="折扣" fill={C_RISK} radius={[6, 6, 0, 0]} maxBarSize={32} /></BarChart>
          </ResponsiveContainer>
        </Card>
        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="p-4"><div className="text-sm font-semibold text-gray-700 mb-3">系列分布</div>
            {seriesData.length > 0 ? <>
              <ResponsiveContainer width="100%" height={220}><PieChart><Pie data={seriesData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={80} paddingAngle={2} stroke="#FBF8F2" strokeWidth={2}>{seriesData.map((_, i) => <Cell key={i} fill={CL[i % CL.length]} />)}</Pie><Tooltip {...TT_STYLE} formatter={v => fmtY(v)} /></PieChart></ResponsiveContainer>
              <DistLegend data={seriesData} colorFn={d => CL[seriesData.indexOf(d) % CL.length]} total={seriesData.reduce((s, x) => s + x.value, 0)} />
            </> : <div className="text-sm text-gray-400 text-center py-16">暂无数据</div>}
          </Card>
          {user.role === "ADMIN" && salesComp.length > 0 && <Card className="p-4">
            <div className="text-sm font-semibold text-gray-700 mb-3">销售业绩</div>
            <ResponsiveContainer width="100%" height={220}><BarChart data={salesComp}><CartesianGrid strokeDasharray="3 3" stroke={C_GRID} vertical={false} /><XAxis dataKey="name" fontSize={12} tick={{ fill: "#8A8178" }} axisLine={{ stroke: C_GRID }} tickLine={false} /><YAxis fontSize={12} tick={{ fill: "#8A8178" }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} /><Tooltip {...TT_STYLE} formatter={v => typeof v === "number" && v > 100 ? fmtY(v) : v} /><Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "#8A8178" }} /><Bar dataKey="sales" name="销售额" fill={C_PRIMARY} radius={[6, 6, 0, 0]} maxBarSize={32} /><Bar dataKey="disc" name="折扣额" fill={C_RISK} radius={[6, 6, 0, 0]} maxBarSize={32} /></BarChart></ResponsiveContainer>
            <table className="w-full text-sm mt-3">
              <thead><tr className="border-b bg-gray-50/80">
                <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">销售</th>
                <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">销售额</th>
                <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">订单</th>
                <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">折扣总额</th>
                <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">平均折扣率</th>
                <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">毛利</th>
                <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">毛利率</th>
              </tr></thead>
              <tbody>{salesComp.map(s => (
                <tr key={s.name} className="border-b last:border-0">
                  <td className="py-2 px-3">{s.name}</td>
                  <td className="py-2 px-3 text-right font-medium">{fmtY(s.sales)}</td>
                  <td className="py-2 px-3 text-right">{s.count}</td>
                  <td className="py-2 px-3 text-right" style={{ color: s.disc > 0 ? '#8D5F5B' : undefined }}>{s.disc > 0 ? '-' + fmtY(s.disc) : '—'}</td>
                  <td className="py-2 px-3 text-right" style={{ color: s.discRate >= 10 ? '#dc2626' : s.discRate > 0 ? '#8D5F5B' : undefined }}>{s.discRate > 0 ? s.discRate + '%' : '—'}</td>
                  <td className="py-2 px-3 text-right font-medium" style={{ color: s.costed > 0 ? '#5C4B73' : undefined }}>{s.costed > 0 ? fmtY(s.gp) : '—'}</td>
                  <td className="py-2 px-3 text-right">{s.costed > 0 ? (s.margin * 100).toFixed(1) + '%' : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
            <div className="text-xs text-gray-400 mt-2">毛利/毛利率仅基于各销售已录成本（unitCost&gt;0）的订单计算</div>
          </Card>}
        </div>

        {/* 业务类型分析（仅 ADMIN） */}
        {user.role === "ADMIN" && (bizSales.rows.length > 0 || bizDist.length > 0) && <div className="grid lg:grid-cols-2 gap-4">
          {bizSales.rows.length > 0 && bizSales.types.length > 0 && <Card className="p-4">
            <div className="text-sm font-semibold text-gray-700 mb-3">业务类型 × 销售</div>
            <ResponsiveContainer width="100%" height={Math.max(bizSales.rows.length * 44 + 60, 220)}>
              <BarChart data={bizSales.rows} layout="vertical" margin={{ left: 8, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={C_GRID} horizontal={false} />
                <XAxis type="number" fontSize={12} tick={{ fill: "#8A8178" }} axisLine={false} tickLine={false} tickFormatter={v => v >= 10000 ? `${(v / 10000).toFixed(0)}万` : v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                <YAxis type="category" dataKey="name" fontSize={12} width={64} tick={{ fill: "#8A8178" }} axisLine={{ stroke: C_GRID }} tickLine={false} />
                <Tooltip {...TT_STYLE} formatter={(v, n) => [fmtY(v), n]} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "#8A8178" }} />
                {bizSales.types.map((t, i) => (
                  <Bar key={t} dataKey={t} name={t} stackId="biz" fill={bizColor(t)} maxBarSize={28}
                    radius={i === bizSales.types.length - 1 ? [0, 6, 6, 0] : [0, 0, 0, 0]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
            <div className="text-xs text-gray-400 mt-2">每根柱为一位销售，按业务类型分段营收（排除已取消订单）</div>
          </Card>}

          {bizDist.length > 0 && <Card className="p-4">
            <div className="text-sm font-semibold text-gray-700 mb-3">业务类型总分布</div>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={bizDist} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={80} paddingAngle={2} stroke="#FBF8F2" strokeWidth={2}>
                  {bizDist.map(d => <Cell key={d.name} fill={bizColor(d.name)} />)}
                </Pie>
                <Tooltip {...TT_STYLE} formatter={v => fmtY(v)} />
              </PieChart>
            </ResponsiveContainer>
            <DistLegend data={bizDist} colorFn={d => bizColor(d.name)} total={bizDist.reduce((s, x) => s + x.value, 0)} />
            <div className="text-xs text-gray-400 mt-2">全部有效订单按业务类型营收占比</div>
          </Card>}
        </div>}
      </>}

      {/* Customers */}
      {tab === "customers" && <>
        <div className="flex justify-end"><button onClick={exportCust} className="flex items-center gap-1 text-xs text-purple-700 px-2 py-1 rounded border border-purple-200 hover:bg-purple-50"><Download size={13} />导出</button></div>
        {custAnalytics.length > 0 && <Card className="p-4">
          <div className="text-sm font-semibold text-gray-700 mb-3">客户贡献 Top 10</div>
          <ResponsiveContainer width="100%" height={Math.min(custAnalytics.slice(0, 10).length * 40 + 40, 440)}>
            <BarChart data={custAnalytics.slice(0, 10)} layout="vertical"><CartesianGrid strokeDasharray="3 3" stroke={C_GRID} horizontal={false} /><XAxis type="number" fontSize={12} tick={{ fill: "#8A8178" }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} /><YAxis type="category" dataKey="name" fontSize={12} width={120} tick={{ fill: "#8A8178" }} axisLine={{ stroke: C_GRID }} tickLine={false} /><Tooltip {...TT_STYLE} formatter={v => fmtY(v)} /><Bar dataKey="revenue" name="累计金额" radius={[0, 6, 6, 0]} maxBarSize={22}>{custAnalytics.slice(0, 10).map((_, i) => <Cell key={i} fill={i === 0 ? "#F3BD5B" : C_PRIMARY} />)}</Bar></BarChart>
          </ResponsiveContainer>
        </Card>}
        <Card className="p-4">
          <div className="text-sm font-semibold text-gray-700 mb-3">客户详细数据</div>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b bg-gray-50">
            <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">客户</th>
            <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium hidden md:table-cell">类型</th>
            <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">订单</th>
            <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">累计金额</th>
            <th className="text-center py-2 px-3 text-xs text-gray-500 font-medium">趋势</th>
            <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium hidden md:table-cell">上次下单</th>
          </tr></thead><tbody>{custAnalytics.filter(c => c.orders > 0).map(c => (
            <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50">
              <td className="py-2 px-3 font-medium text-gray-800">{c.name}</td>
              <td className="py-2 px-3 text-xs text-gray-500 hidden md:table-cell">{c.type}</td>
              <td className="py-2 px-3 text-right">{c.orders}</td>
              <td className="py-2 px-3 text-right font-semibold" style={{ color: "#5C4B73" }}>{fmtY(c.revenue)}</td>
              <td className="py-2 px-3 text-center"><span className={`text-xs font-medium ${c.trend > 0 ? "text-green-600" : c.trend < 0 ? "text-red-500" : "text-gray-400"}`}>{c.trend > 0 ? `+${c.trend}%` : c.trend < 0 ? `${c.trend}%` : "—"}</span></td>
              <td className="py-2 px-3 text-right text-xs hidden md:table-cell"><span className={c.daysSinceLast > 60 ? "text-red-500" : "text-gray-500"}>{c.lastDate}{c.daysSinceLast > 60 && " ⚠"}</span></td>
            </tr>
          ))}</tbody></table></div>
        </Card>
      </>}

      {/* Products */}
      {tab === "products" && <>
        <div className="flex justify-end"><button onClick={exportProd} className="flex items-center gap-1 text-xs text-purple-700 px-2 py-1 rounded border border-purple-200 hover:bg-purple-50"><Download size={13} />导出</button></div>
        {prodAnalytics.length > 0 && <Card className="p-4">
          <div className="text-sm font-semibold text-gray-700 mb-3">销售额 Top 10</div>
          <div className="space-y-2">{prodAnalytics.slice(0, 10).map((p, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0" style={{ background: i === 0 ? "#F3BD5B" : CL[i % CL.length] }}>{i + 1}</span>
              <div className="flex-1 min-w-0"><div className="text-sm text-gray-800 truncate">{p.name}</div><div className="text-xs text-gray-400">{p.code} · {p.spec} · {p.qty}件</div></div>
              <div className="text-right shrink-0"><div className="text-sm font-semibold" style={{ color: "#5C4B73" }}>{fmtY(p.rev)}</div><span className={`text-xs ${p.trend > 0 ? "text-green-600" : p.trend < 0 ? "text-red-500" : "text-gray-400"}`}>{p.trend > 0 ? `+${p.trend}%` : p.trend < 0 ? `${p.trend}%` : "—"}</span></div>
            </div>
          ))}</div>
        </Card>}
      </>}

      {/* Insights */}
      {tab === "insights" && <>
        {insights.length === 0 ? <Card className="p-8 text-center"><div className="text-gray-400 text-sm">订单数据不足，暂无法生成分析建议。</div></Card> :
          <div className="space-y-3">{insights.map((ins, i) => <InsightCard key={i} {...ins} />)}</div>}
        <Card className="p-4">
          <div className="text-sm font-semibold text-gray-700 mb-3">数据导出</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={exportTrend} className="flex items-center gap-1 text-sm text-purple-700 px-3 py-2 rounded-lg border border-purple-200 hover:bg-purple-50"><Download size={14} />销售趋势</button>
            <button onClick={exportCust} className="flex items-center gap-1 text-sm text-purple-700 px-3 py-2 rounded-lg border border-purple-200 hover:bg-purple-50"><Download size={14} />客户分析</button>
            <button onClick={exportProd} className="flex items-center gap-1 text-sm text-purple-700 px-3 py-2 rounded-lg border border-purple-200 hover:bg-purple-50"><Download size={14} />产品分析</button>
          </div>
        </Card>
      </>}
    </div>
  );
}
