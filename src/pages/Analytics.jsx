import { useState, useMemo } from 'react';
import { ShoppingCart, TrendingUp, Package, Percent, Download, Wallet, Coins, Boxes, AlertTriangle, Lightbulb, CircleCheck } from 'lucide-react';
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
const DAY_MS = 86400000;

const num = value => Number(value || 0);
const sameId = (left, right) => left != null && right != null && String(left) === String(right);
const cleanText = value => String(value || '').trim();
const lineDate = value => {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

function buildProductAnalytics(lines, windowDays) {
  const now = Date.now();
  const currentStart = now - windowDays * DAY_MS;
  const previousStart = now - windowDays * 2 * DAY_MS;
  const grouped = new Map();

  lines.forEach(line => {
    if (!grouped.has(line.key)) {
      grouped.set(line.key, {
        key: line.key,
        productId: line.productId,
        name: line.name,
        code: line.code,
        spec: line.spec,
        series: line.series,
        product: line.product,
        qty: 0,
        rev: 0,
        orders: new Set(),
        custs: new Set(),
        periodQty: 0,
        periodRevenue: 0,
        periodOrders: new Set(),
        periodCustomers: new Set(),
        priorQty: 0,
        priorRevenue: 0,
        lastSoldAt: 0
      });
    }
    const row = grouped.get(line.key);
    row.qty += line.quantity;
    row.rev += line.revenue;
    row.orders.add(line.orderId);
    if (line.customerId != null) row.custs.add(line.customerId);
    row.lastSoldAt = Math.max(row.lastSoldAt, line.dateTs);
    if (line.dateTs >= currentStart && line.dateTs <= now + DAY_MS) {
      row.periodQty += line.quantity;
      row.periodRevenue += line.revenue;
      row.periodOrders.add(line.orderId);
      if (line.customerId != null) row.periodCustomers.add(line.customerId);
    } else if (line.dateTs >= previousStart && line.dateTs < currentStart) {
      row.priorQty += line.quantity;
      row.priorRevenue += line.revenue;
    }
  });

  const rows = [...grouped.values()].map(row => {
    const product = row.product;
    const specObj = product?.specs?.find(spec => cleanText(spec.spec) === row.spec);
    const isRaw = product?.channel === 'RAW';
    const stock = isRaw ? num(product?.baseStockKg) : num(specObj?.stock);
    const safeStock = isRaw ? num(product?.safeStockKg) : num(specObj?.safeStock);
    const trend = row.priorRevenue > 0
      ? Math.round((row.periodRevenue / row.priorRevenue - 1) * 100)
      : null;
    const periodOrderCount = row.periodOrders.size;
    const periodCustomerCount = row.periodCustomers.size;
    let momentum = '稳定动销';
    if (row.periodRevenue > 0 && row.priorRevenue === 0) momentum = '本期新增';
    else if (trend >= 50) momentum = '快速增长';
    else if (trend <= -40) momentum = '明显回落';
    else if (row.periodRevenue === 0) momentum = '本期未动销';

    let stockState = '正常';
    if (!product) stockState = '历史商品';
    else if (stock <= 0) stockState = '缺货';
    else if (safeStock > 0 && stock <= safeStock) stockState = '低库存';

    return {
      ...row,
      orderCount: row.orders.size,
      custCount: row.custs.size,
      periodOrderCount,
      periodCustomerCount,
      trend,
      momentum,
      stock,
      safeStock,
      stockState,
      stockUnit: isRaw ? 'kg' : '瓶',
      avgUnitPrice: row.periodQty > 0 ? row.periodRevenue / row.periodQty : 0,
      lastSoldDate: row.lastSoldAt ? new Date(row.lastSoldAt).toISOString().slice(0, 10) : '',
      score: 0
    };
  });

  const maxRevenue = Math.max(...rows.map(row => row.periodRevenue), 1);
  const maxQty = Math.max(...rows.map(row => row.periodQty), 1);
  const maxOrders = Math.max(...rows.map(row => row.periodOrderCount), 1);
  const maxCustomers = Math.max(...rows.map(row => row.periodCustomerCount), 1);
  rows.forEach(row => {
    row.score = Math.round((
      row.periodRevenue / maxRevenue * 0.45
      + row.periodQty / maxQty * 0.25
      + row.periodOrderCount / maxOrders * 0.15
      + row.periodCustomerCount / maxCustomers * 0.15
    ) * 100);
  });
  return rows.sort((a, b) => b.score - a.score || b.periodRevenue - a.periodRevenue || b.rev - a.rev);
}

const trendLabel = product => {
  if (product.periodRevenue > 0 && product.priorRevenue === 0) return '本期新增';
  if (product.trend == null || product.trend === 0) return '持平';
  return `${product.trend > 0 ? '+' : ''}${product.trend}%`;
};

const trendClass = product => product.trend > 0
  ? 'text-green-600'
  : product.trend < 0
    ? 'text-red-500'
    : product.periodRevenue > 0 && product.priorRevenue === 0
      ? 'text-purple-700'
      : 'text-gray-400';

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
  const vo = useMemo(() => orders.filter(o => o.status !== "CANCELLED"), [orders]);
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

  // 成品库存成本价值：原料以 kg 管理，当前销售规格成本不是 kg 成本，避免重复估值。
  const inv = useMemo(() => {
    if (!isAdmin) return null;
    let costVal = 0, missing = 0;
    products.filter(p => p.channel !== 'RAW').forEach(p => (p.specs || []).forEach(s => {
      const c = s.cost || 0;
      if (c > 0) costVal += (s.stock || 0) * c; else missing++;
    }));
    return { costVal, missing };
  }, [isAdmin, products]);

  // 折扣让利占营收
  const discRateOverall = totR + totD > 0 ? totD / (totR + totD) : 0;

  const [tab, setTab] = useState("trend");
  const [period, setPeriod] = useState("month");
  const [productWindow, setProductWindow] = useState(30);
  const tabs = [{ k: "trend", l: "趋势总览" }, { k: "customers", l: "大客户分析" }, { k: "products", l: "爆品分析" }, { k: "insights", l: "智能建议" }];

  // 订单明细是历史事实：优先使用下单时保存的商品快照，再用当前商品表补充系列和库存。
  const salesLines = useMemo(() => {
    const byId = new Map(products.map(product => [String(product.id), product]));
    const byCode = new Map(products.filter(product => cleanText(product.code)).map(product => [cleanText(product.code), product]));
    const byName = new Map(products.filter(product => cleanText(product.name)).map(product => [cleanText(product.name), product]));

    return vo.flatMap(order => (order.items || []).map((item, index) => {
      const snapshotName = cleanText(item.productName);
      const snapshotCode = cleanText(item.productCode);
      const product = byCode.get(snapshotCode)
        || byId.get(String(item.productId))
        || byName.get(snapshotName)
        || null;
      const name = snapshotName || cleanText(product?.name) || `历史商品 ${item.productId || item.id || index + 1}`;
      const code = snapshotCode || cleanText(product?.code) || '未记录编号';
      const spec = cleanText(item.spec) || '未记录规格';
      const identity = code !== '未记录编号'
        ? `code:${code}`
        : item.productId != null
          ? `id:${item.productId}`
          : `name:${name}`;
      return {
        key: `${identity}::${spec}`,
        productId: item.productId,
        product,
        name,
        code,
        spec,
        series: cleanText(product?.series) || '其他',
        quantity: num(item.quantity),
        revenue: num(item.subtotal),
        orderId: order.id,
        customerId: order.customerId,
        dateTs: lineDate(order.createdAt),
        orderDate: order.createdAt || '',
        hasSnapshot: Boolean(snapshotName && snapshotCode)
      };
    }));
  }, [vo, products]);

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
    const m = {}; salesLines.forEach(line => { m[line.series] = (m[line.series] || 0) + line.revenue; });
    return Object.entries(m).map(([n, v]) => ({ name: n.replace("系列", ""), value: v })).sort((a, b) => b.value - a.value);
  }, [salesLines]);

  const salesComp = useMemo(() => {
    if (user.role !== "ADMIN") return [];
    return users.filter(u => u.role === "SALES" && u.status === 'active').map(su => {
      const so = vo.filter(o => sameId(o.salesId, su.id));
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
      return { name: su.name, sales, count: so.length, custs: customers.filter(c => sameId(c.salesId, su.id)).length, disc, discRate, gp, margin, costed, byBiz };
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
      const co = vo.filter(o => sameId(o.customerId, c.id)); const rev = co.reduce((s, o) => s + o.total, 0);
      const lastOrder = [...co].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
      const daysSinceLast = lastOrder ? Math.max(0, Math.round((Date.now() - new Date(lastOrder.createdAt).getTime()) / DAY_MS)) : 999;
      const now = Date.now(); const d90 = 90 * DAY_MS;
      const recent = co.filter(o => now - new Date(o.createdAt).getTime() < d90).reduce((s, o) => s + o.total, 0);
      const prior = co.filter(o => { const age = now - new Date(o.createdAt).getTime(); return age >= d90 && age < d90 * 2; }).reduce((s, o) => s + o.total, 0);
      const trend = prior > 0 ? Math.round((recent / prior - 1) * 100) : null;
      const productRevenue = new Map();
      salesLines.filter(line => sameId(line.customerId, c.id)).forEach(line => {
        productRevenue.set(line.name, (productRevenue.get(line.name) || 0) + line.revenue);
      });
      const topProds = [...productRevenue.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name]) => name);
      const seller = users.find(u => sameId(u.id, c.salesId));
      return { id: c.id, name: c.name, type: c.type, seller: seller?.name || '', orders: co.length, revenue: rev, avgOrder: co.length ? Math.round(rev / co.length) : 0, daysSinceLast, trend, topProds, lastDate: lastOrder?.createdAt || '' };
    }).sort((a, b) => b.revenue - a.revenue);
  }, [customers, vo, salesLines, users]);

  // Product analytics
  const prodAnalytics = useMemo(() => buildProductAnalytics(salesLines, productWindow), [salesLines, productWindow]);
  const insightProducts = useMemo(() => buildProductAnalytics(salesLines, 30), [salesLines]);
  const activeProducts = useMemo(() => prodAnalytics.filter(product => product.periodRevenue > 0), [prodAnalytics]);
  const productSummary = useMemo(() => {
    const revenue = activeProducts.reduce((sum, product) => sum + product.periodRevenue, 0);
    const priorRevenue = prodAnalytics.reduce((sum, product) => sum + product.priorRevenue, 0);
    const customerIds = new Set();
    const start = Date.now() - productWindow * DAY_MS;
    salesLines.forEach(line => {
      if (line.dateTs >= start && line.customerId != null) customerIds.add(String(line.customerId));
    });
    return {
      revenue,
      priorRevenue,
      activeSkus: activeProducts.length,
      customers: customerIds.size,
      topShare: revenue > 0 ? Math.round((activeProducts[0]?.periodRevenue || 0) / revenue * 100) : 0,
      multiCustomerSkus: activeProducts.filter(product => product.periodCustomerCount >= 2).length
    };
  }, [activeProducts, prodAnalytics, productWindow, salesLines]);

  const inventoryNoSales = useMemo(() => {
    const currentStart = Date.now() - 30 * DAY_MS;
    const wasSold = (product, spec) => salesLines.some(line => (
      line.dateTs >= currentStart
      && line.product
      && sameId(line.product.id, product.id)
      && (!spec || line.spec === spec)
    ));
    return products.flatMap(product => {
      if (product.channel === 'RAW') {
        const stock = num(product.baseStockKg);
        const safeStock = num(product.safeStockKg);
        return safeStock > 0 && stock > safeStock * 2 && !wasSold(product)
          ? [{ name: product.name, code: product.code, spec: '原料重量', stock, safeStock, stockUnit: 'kg' }]
          : [];
      }
      return (product.specs || []).flatMap(spec => {
        const stock = num(spec.stock);
        const safeStock = num(spec.safeStock);
        return safeStock > 0 && stock > safeStock * 2 && !wasSold(product, cleanText(spec.spec))
          ? [{ name: product.name, code: product.code, spec: spec.spec, stock, safeStock, stockUnit: '瓶' }]
          : [];
      });
    }).sort((a, b) => (b.stock / b.safeStock) - (a.stock / a.safeStock));
  }, [products, salesLines]);

  // Smart insights
  const insights = useMemo(() => {
    const recs = [];
    const activeCustomers = custAnalytics.filter(customer => customer.orders > 0);
    const averageCustomerRevenue = activeCustomers.length
      ? activeCustomers.reduce((sum, customer) => sum + customer.revenue, 0) / activeCustomers.length
      : 0;
    const highValueFloor = Math.max(3000, averageCustomerRevenue);
    const dormant = activeCustomers.filter(customer => customer.revenue >= highValueFloor && customer.daysSinceLast > 60);
    if (dormant.length > 0) recs.push({
      type: 'warning',
      title: '高价值客户沉睡',
      desc: `${dormant.slice(0, 4).map(customer => customer.name).join('、')}${dormant.length > 4 ? ` 等${dormant.length}位客户` : ''}超过60天未下单。`,
      metric: `高价值门槛 ${fmtY(highValueFloor)} · ${dormant.length}位客户`,
      action: '由所属销售在3个工作日内回访，记录客户近期用量与补货计划。',
      priority: 1
    });

    const lowHot = insightProducts.filter(product => product.periodRevenue > 0 && product.product && (
      product.safeStock > 0 ? product.stock <= product.safeStock : product.stock <= 0
    ));
    if (lowHot.length > 0) recs.push({
      type: 'warning',
      title: '动销商品库存不足',
      desc: lowHot.slice(0, 4).map(product => `${product.name} ${product.spec}（${product.stock}${product.stockUnit}）`).join('、'),
      metric: `近30天已产生销售 · ${lowHot.length}个SKU达到安全线`,
      action: '优先核对实物库存和在途采购，确认后生成补货单。',
      priority: 1
    });

    const rising = insightProducts.filter(product => product.trend >= 50 && product.periodOrderCount >= 2).slice(0, 4);
    if (rising.length > 0) recs.push({
      type: 'success',
      title: '持续增长商品',
      desc: rising.map(product => `${product.name} ${product.spec}（${trendLabel(product)}）`).join('、'),
      metric: `近30天对比前30天 · ${rising.length}个SKU增长超50%`,
      action: '保持销售跟进，同时核对供应周期，避免增长期断货。',
      priority: 2
    });

    const emerging = insightProducts.filter(product => product.periodRevenue > 0 && product.priorRevenue === 0 && product.periodOrderCount >= 2 && product.periodCustomerCount >= 2).slice(0, 4);
    if (emerging.length > 0) recs.push({
      type: 'success',
      title: '新增多客户动销',
      desc: emerging.map(product => `${product.name} ${product.spec}`).join('、'),
      metric: `近30天首次动销 · 至少2笔订单且覆盖2位客户`,
      action: '继续观察下一个30天周期，暂不把单次大单误判为爆品。',
      priority: 3
    });

    const currentProducts = insightProducts.filter(product => product.periodRevenue > 0);
    const currentProductRevenue = currentProducts.reduce((sum, product) => sum + product.periodRevenue, 0);
    const leadingProduct = currentProducts[0];
    const leadingShare = currentProductRevenue > 0 ? Math.round(num(leadingProduct?.periodRevenue) / currentProductRevenue * 100) : 0;
    if (currentProducts.length >= 3 && leadingShare >= 50) recs.push({
      type: 'info',
      title: '商品销售结构集中',
      desc: `${leadingProduct.name} ${leadingProduct.spec}占近30天商品销售额的${leadingShare}%。`,
      metric: `Top 1 SKU 占比 ${leadingShare}%`,
      action: '核对该销量是持续复购还是单次集中采购，并同步培养第二梯队商品。',
      priority: 3
    });

    const declining = insightProducts.filter(product => product.trend <= -40 && product.priorRevenue >= 500).slice(0, 4);
    if (declining.length > 0) recs.push({
      type: 'info',
      title: '动销明显回落',
      desc: declining.map(product => `${product.name} ${product.spec}（${trendLabel(product)}）`).join('、'),
      metric: '近30天对比前30天 · 降幅超40%',
      action: '按客户查看是补货周期波动还是需求下降，再决定是否跟进。',
      priority: 3
    });

    if (inventoryNoSales.length > 0) recs.push({
      type: 'info',
      title: '高库存低动销',
      desc: inventoryNoSales.slice(0, 4).map(item => `${item.name} ${item.spec}（${item.stock}${item.stockUnit}）`).join('、'),
      metric: `近30天无销售 · 库存超安全线2倍 · ${inventoryNoSales.length}个SKU`,
      action: '先盘点确认库存，再减少采购或安排定向客户推荐。',
      priority: 4
    });

    if (activeCustomers.length >= 3) {
      const top3Revenue = activeCustomers.slice(0, 3).reduce((sum, customer) => sum + customer.revenue, 0);
      const ratio = totR > 0 ? Math.round(top3Revenue / totR * 100) : 0;
      if (ratio > 70) recs.push({
        type: 'info',
        title: '客户集中度偏高',
        desc: `前3位客户贡献全部历史销售额的${ratio}%。`,
        metric: `Top 3 客户占比 ${ratio}%`,
        action: '维护现有大客户的同时，为其他客户设置复购跟进任务。',
        priority: 4
      });
    }

    const recentOrders = vo.filter(order => lineDate(order.createdAt) >= Date.now() - 30 * DAY_MS);
    const recentDiscount = recentOrders.reduce((sum, order) => sum + num(order.discountAmount), 0);
    const recentNetRevenue = recentOrders.reduce((sum, order) => sum + num(order.total), 0);
    const recentDiscountRate = recentNetRevenue + recentDiscount > 0 ? recentDiscount / (recentNetRevenue + recentDiscount) : 0;
    if (recentDiscountRate >= 0.1) recs.push({
      type: 'warning',
      title: '近期折扣比例偏高',
      desc: `近30天折扣让利${fmtY(recentDiscount)}，占折前销售额的${(recentDiscountRate * 100).toFixed(1)}%。`,
      metric: `${recentOrders.length}笔订单 · 折扣率 ${(recentDiscountRate * 100).toFixed(1)}%`,
      action: '按销售和客户类型复盘大额折扣，确认是否符合经销商政策。',
      priority: 2
    });

    if (recs.length === 0 && recentOrders.length > 0) recs.push({
      type: 'success',
      title: '近期运营未见明显异常',
      desc: '当前数据未触发缺货、高折扣、大客户沉睡或销量骤降规则。',
      metric: `近30天 ${recentOrders.length}笔订单 · ${fmtY(recentNetRevenue)}销售额`,
      action: '继续保持每周复盘，随着数据增加，建议会自动更新。',
      priority: 5
    });
    return recs.sort((a, b) => a.priority - b.priority);
  }, [custAnalytics, insightProducts, inventoryNoSales, totR, vo]);

  const exportTrend = () => exportCSV(["周期","销售额","订单数","折扣额"], timeData.map(d => [d.name, d.sales, d.count, d.disc]), `趋势_${period}.csv`);
  const exportCust = () => exportCSV(["客户","类型","销售","订单数","累计金额","客单价","最近下单","趋势%","常购产品"], custAnalytics.map(c => [c.name, c.type, c.seller, c.orders, c.revenue, c.avgOrder, c.lastDate, c.trend, c.topProds.join("/")]), "客户分析.csv");
  const exportProd = () => exportCSV([
    "产品", "编码", "规格", "系列", "统计周期", "综合热度", "本期销量", "本期销售额", "上期销售额", "环比%", "本期订单数", "本期客户数", "平均单价", "历史销量", "历史销售额", "最近销售", "库存", "库存单位", "库存状态", "动销趋势"
  ], prodAnalytics.map(p => [
    p.name, p.code, p.spec, p.series, `近${productWindow}天`, p.score, p.periodQty, p.periodRevenue, p.priorRevenue, p.trend ?? '', p.periodOrderCount, p.periodCustomerCount, p.avgUnitPrice, p.qty, p.rev, p.lastSoldDate, p.stock, p.stockUnit, p.stockState, p.momentum
  ]), `产品分析_近${productWindow}天.csv`);

  const InsightCard = ({ type, title, desc, metric, action }) => {
    const styles = {
      warning: { wrap: "border-orange-200 bg-orange-50/60", icon: "text-orange-600", Icon: AlertTriangle },
      success: { wrap: "border-green-200 bg-green-50/60", icon: "text-green-700", Icon: CircleCheck },
      info: { wrap: "border-blue-200 bg-blue-50/60", icon: "text-blue-600", Icon: Lightbulb }
    };
    const style = styles[type] || styles.info;
    const Icon = style.Icon;
    return <div className={`border rounded-lg p-4 ${style.wrap}`}>
      <div className="flex items-start gap-3">
        <Icon size={18} className={`${style.icon} shrink-0 mt-0.5`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-sm font-semibold text-gray-800">{title}</div>
            {metric && <div className="text-xs font-medium text-gray-500">{metric}</div>}
          </div>
          <div className="text-sm text-gray-600 leading-relaxed mt-1">{desc}</div>
          {action && <div className="text-xs text-gray-700 mt-2 pt-2 border-t border-black/5"><span className="font-medium">建议动作：</span>{action}</div>}
        </div>
      </div>
    </div>;
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
          <StatCard label="成品库存成本价值" value={fmtY(inv.costVal)} sub={inv.missing > 0 ? `${inv.missing} 个成品 SKU 未录成本` : undefined} icon={Boxes} color="#5F7689" />
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex gap-1.5">
            {[30, 90, 180].map(days => <button key={days} onClick={() => setProductWindow(days)} className={`px-3 py-1.5 text-sm rounded-lg border ${productWindow === days ? "bg-purple-100 border-purple-300 text-purple-700 font-medium" : "bg-white text-gray-500"}`}>近{days}天</button>)}
          </div>
          <button onClick={exportProd} className="flex items-center justify-center gap-1 text-xs text-purple-700 px-3 py-2 rounded-lg border border-purple-200 hover:bg-purple-50"><Download size={13} />导出产品明细</button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Card className="p-4 min-w-0">
            <div className="text-xs text-gray-500">近{productWindow}天销售额</div>
            <div className="text-xl font-semibold text-gray-800 mt-1 truncate">{fmtY(productSummary.revenue)}</div>
            <div className={`text-xs mt-1 ${productSummary.priorRevenue > 0 ? (productSummary.revenue >= productSummary.priorRevenue ? 'text-green-600' : 'text-red-500') : 'text-gray-400'}`}>
              {productSummary.priorRevenue > 0 ? `较上期 ${productSummary.revenue >= productSummary.priorRevenue ? '+' : ''}${Math.round((productSummary.revenue / productSummary.priorRevenue - 1) * 100)}%` : '上期无可比成交'}
            </div>
          </Card>
          <Card className="p-4 min-w-0">
            <div className="text-xs text-gray-500">动销 SKU</div>
            <div className="text-xl font-semibold text-gray-800 mt-1">{productSummary.activeSkus}</div>
            <div className="text-xs text-gray-400 mt-1">覆盖 {productSummary.customers} 位客户</div>
          </Card>
          <Card className="p-4 min-w-0">
            <div className="text-xs text-gray-500">Top 1 集中度</div>
            <div className="text-xl font-semibold text-gray-800 mt-1">{productSummary.topShare}%</div>
            <div className="text-xs text-gray-400 mt-1">占本期产品销售额</div>
          </Card>
          <Card className="p-4 min-w-0">
            <div className="text-xs text-gray-500">多客户动销 SKU</div>
            <div className="text-xl font-semibold text-gray-800 mt-1">{productSummary.multiCustomerSkus}</div>
            <div className="text-xs text-gray-400 mt-1">至少 2 位客户购买</div>
          </Card>
        </div>

        {activeProducts.length > 0 ? <Card className="p-4">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <div className="text-sm font-semibold text-gray-700">综合热度 Top 10</div>
              <div className="text-xs text-gray-400 mt-1">销售额、销量、订单数与客户覆盖综合排名</div>
            </div>
            <div className="text-xs text-gray-400">近{productWindow}天</div>
          </div>
          <div className="divide-y">{activeProducts.slice(0, 10).map((product, index) => (
            <div key={product.key} className="grid grid-cols-[28px_minmax(0,1fr)_auto] lg:grid-cols-[28px_minmax(220px,1fr)_minmax(160px,0.8fr)_110px_110px] items-center gap-3 py-3">
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: index === 0 ? "#F3BD5B" : CL[index % CL.length] }}>{index + 1}</span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-800 truncate">{product.name}</div>
                <div className="text-xs text-gray-400 truncate">{product.code} · {product.spec}</div>
              </div>
              <div className="hidden lg:block min-w-0">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-purple-500 rounded-full" style={{ width: `${product.score}%` }} /></div>
                  <span className="text-xs font-medium text-purple-700 w-7 text-right">{product.score}</span>
                </div>
                <div className="text-xs text-gray-400 mt-1">{product.periodQty}件 · {product.periodOrderCount}笔 · {product.periodCustomerCount}位客户</div>
              </div>
              <div className="hidden lg:block text-right">
                <div className="text-sm font-semibold text-gray-800">{fmtY(product.periodRevenue)}</div>
                <div className="text-xs text-gray-400">平均 {fmtY(product.avgUnitPrice)}/件</div>
              </div>
              <div className="text-right">
                <div className={`text-xs font-medium ${trendClass(product)}`}>{trendLabel(product)}</div>
                <div className={`text-xs mt-1 ${product.stockState === '缺货' || product.stockState === '低库存' ? 'text-red-500' : 'text-gray-400'}`}>{product.stockState}</div>
              </div>
            </div>
          ))}</div>
        </Card> : <Card className="p-8 text-center text-sm text-gray-400">近{productWindow}天没有有效商品销售数据</Card>}

        {prodAnalytics.length > 0 && <Card className="p-4">
          <div className="text-sm font-semibold text-gray-700 mb-3">产品表现明细</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1050px]">
              <thead><tr className="border-b bg-gray-50/80">
                <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">产品 / 编号</th>
                <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">规格</th>
                <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">热度</th>
                <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">本期销售额</th>
                <th className="text-center py-2 px-3 text-xs text-gray-500 font-medium">环比</th>
                <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">销量</th>
                <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">订单 / 客户</th>
                <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">平均单价</th>
                <th className="text-right py-2 px-3 text-xs text-gray-500 font-medium">库存</th>
                <th className="text-left py-2 px-3 text-xs text-gray-500 font-medium">动销状态</th>
              </tr></thead>
              <tbody>{prodAnalytics.map(product => (
                <tr key={product.key} className="border-b last:border-0 hover:bg-gray-50/70">
                  <td className="py-2.5 px-3"><div className="font-medium text-gray-800">{product.name}</div><div className="text-xs text-gray-400">{product.code}</div></td>
                  <td className="py-2.5 px-3 text-gray-600">{product.spec}</td>
                  <td className="py-2.5 px-3 text-right font-medium text-purple-700">{product.score}</td>
                  <td className="py-2.5 px-3 text-right font-semibold text-gray-800">{fmtY(product.periodRevenue)}</td>
                  <td className={`py-2.5 px-3 text-center text-xs font-medium ${trendClass(product)}`}>{trendLabel(product)}</td>
                  <td className="py-2.5 px-3 text-right">{product.periodQty}</td>
                  <td className="py-2.5 px-3 text-right">{product.periodOrderCount} / {product.periodCustomerCount}</td>
                  <td className="py-2.5 px-3 text-right">{product.periodQty > 0 ? fmtY(product.avgUnitPrice) : '—'}</td>
                  <td className="py-2.5 px-3 text-right"><div>{product.product ? `${product.stock}${product.stockUnit}` : '—'}</div><div className={`text-xs ${product.stockState === '缺货' || product.stockState === '低库存' ? 'text-red-500' : 'text-gray-400'}`}>{product.stockState}</div></td>
                  <td className="py-2.5 px-3"><div className="text-gray-700">{product.momentum}</div><div className="text-xs text-gray-400">{product.lastSoldDate || '—'}</div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>}
      </>}

      {/* Insights */}
      {tab === "insights" && <>
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 px-1">
          <div><div className="text-sm font-semibold text-gray-700">运营建议</div><div className="text-xs text-gray-400 mt-1">基于有效订单、客户、近30天动销与当前库存实时计算</div></div>
          <div className="text-xs text-gray-400">{vo.length}笔有效订单 · {salesLines.length}条商品明细</div>
        </div>
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
