import { createElement, useState, useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ClipboardCopy,
  Download,
  Edit2,
  FlaskConical,
  History,
  Layers,
  Package,
  Search,
  ShieldCheck,
  Sparkles,
  Tag,
  TrendingUp,
  Truck,
  Wallet,
  X
} from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, SERIES_LIST, exportCSV, fmtY, today } from '../components/ui';
import * as api from '../lib/api';

const REASONS = {
  PURCHASE: '采购入库',
  RETURN: '退货入库',
  DAMAGE: '损耗/报废',
  CORRECTION: '盘点修正',
  ORDER: '销售出库',
  CANCEL_RESTORE: '取消订单回库',
  OTHER: '其他'
};

const TYPE_LABEL = { IN: '入库', OUT: '出库', CORRECTION: '修正' };
const TYPE_TONE = {
  IN: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  OUT: 'bg-rose-50 text-rose-700 border-rose-100',
  CORRECTION: 'bg-sky-50 text-sky-700 border-sky-100'
};

const PALETTE = ['#5c4b73', '#F3BD5B', '#7B8F67', '#97725f', '#8d5f7a', '#5F7689', '#b7a66b', '#7b6ea8', '#c47f61'];

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function isDateSoon(date, days = 120) {
  if (!date) return false;
  return new Date(date).getTime() - Date.now() < days * 86400000;
}

function classNames(...parts) {
  return parts.filter(Boolean).join(' ');
}

export default function Inventory() {
  const { user } = useAuth();
  const { products, orders, stockLog, loadStockLog, adjustStock, addBatch, removeBatch } = useData();
  const [tab, setTab] = useState('list');
  const [search, setSearch] = useState('');
  const [sf, setSf] = useState('ALL');
  const [lowOnly, setLowOnly] = useState(false);

  const [adjustFor, setAdjustFor] = useState(null);
  const [adjType, setAdjType] = useState('IN');
  const [adjReason, setAdjReason] = useState('PURCHASE');
  const [adjQty, setAdjQty] = useState('');
  const [adjNote, setAdjNote] = useState('');
  const [adjusting, setAdjusting] = useState(false);

  const [batchFor, setBatchFor] = useState(null);
  const [batchData, setBatchData] = useState({
    batchNo: '',
    gcmsNo: '',
    receivedDate: today(),
    expiryDate: '',
    quantity: '',
    unitCost: '',
    supplier: '',
    note: ''
  });
  const [savingBatch, setSavingBatch] = useState(false);
  const [batchList, setBatchList] = useState([]);
  const [loadingBatches, setLoadingBatches] = useState(false);

  useEffect(() => { if (tab === 'log') loadStockLog(); }, [tab, loadStockLog]);
  useEffect(() => {
    if (tab !== 'batches') return;
    setLoadingBatches(true);
    api.fetchBatches().then(setBatchList).finally(() => setLoadingBatches(false));
  }, [tab]);

  const canAdjust = user.role === 'ADMIN' || user.role === 'WAREHOUSE';

  const inventoryModel = useMemo(() => {
    const specs = products.flatMap(product => product.specs.map(spec => ({ product, spec })));
    const sku = specs.length;
    const totalStock = specs.reduce((sum, item) => sum + item.spec.stock, 0);
    const safeStock = specs.reduce((sum, item) => sum + item.spec.safeStock, 0);
    const low = specs.filter(item => item.spec.stock > 0 && item.spec.stock <= item.spec.safeStock);
    const out = specs.filter(item => item.spec.stock <= 0);
    const healthy = specs.filter(item => item.spec.stock > item.spec.safeStock);
    const healthScore = sku ? Math.round((healthy.length / sku) * 100) : 0;
    const coverage = safeStock ? Math.round((totalStock / safeStock) * 100) : 0;

    const filtered = products
      .filter(product => {
        if (sf !== 'ALL' && product.series !== sf) return false;
        if (search && !`${product.code} ${product.name}`.toLowerCase().includes(search.toLowerCase())) return false;
        if (lowOnly && !product.specs.some(spec => spec.stock <= spec.safeStock)) return false;
        return true;
      })
      .sort((a, b) => {
        const aLow = a.specs.some(spec => spec.stock <= spec.safeStock) ? 1 : 0;
        const bLow = b.specs.some(spec => spec.stock <= spec.safeStock) ? 1 : 0;
        return bLow - aLow || a.name.localeCompare(b.name, 'zh-Hans-CN');
      });

    const restock = specs
      .filter(item => item.spec.stock <= item.spec.safeStock)
      .map(item => {
        const suggestedQty = Math.max(item.spec.safeStock * 2 - item.spec.stock, item.spec.safeStock);
        const urgency = item.spec.stock <= 0 ? 'HIGH' : item.spec.stock <= Math.ceil(item.spec.safeStock * 0.45) ? 'MEDIUM' : 'LOW';
        return { ...item, suggestedQty, urgency };
      })
      .sort((a, b) => (a.spec.stock - a.spec.safeStock) - (b.spec.stock - b.spec.safeStock));

    const series = SERIES_LIST.map((seriesName, index) => {
      const items = specs.filter(item => item.product.series === seriesName);
      return {
        name: seriesName.replace('系列', ''),
        fullName: seriesName,
        stock: items.reduce((sum, item) => sum + item.spec.stock, 0),
        safe: items.reduce((sum, item) => sum + item.spec.safeStock, 0),
        low: items.filter(item => item.spec.stock <= item.spec.safeStock).length,
        color: PALETTE[index % PALETTE.length]
      };
    }).filter(item => item.stock || item.safe || item.low);

    const flow = orders
      .filter(order => order.status !== 'CANCELLED')
      .slice(0, 60)
      .flatMap(order => order.items || [])
      .reduce((map, item) => {
        const key = `${item.productId}-${item.spec || ''}`;
        map[key] = map[key] || { name: item.productName, spec: item.spec, qty: 0 };
        map[key].qty += item.quantity;
        return map;
      }, {});

    const hot = Object.values(flow).sort((a, b) => b.qty - a.qty).slice(0, 8);

    // 库存估值（仅 ADMIN 展示）：成本价值 Σstock*cost、零售价值 Σstock*price、潜在毛利
    // cost=0 的 SKU 不计入成本价值，并单独计数提示「未录成本 SKU 数」
    const valuationSeries = SERIES_LIST.map((seriesName, index) => {
      const items = specs.filter(item => item.product.series === seriesName);
      const costValue = items.reduce((sum, item) => sum + item.spec.stock * item.spec.cost, 0);
      const retailValue = items.reduce((sum, item) => sum + item.spec.stock * item.spec.price, 0);
      const missingCost = items.filter(item => item.spec.stock > 0 && item.spec.cost <= 0).length;
      return {
        name: seriesName.replace('系列', ''),
        fullName: seriesName,
        skuCount: items.length,
        stock: items.reduce((sum, item) => sum + item.spec.stock, 0),
        costValue,
        retailValue,
        potentialProfit: retailValue - costValue,
        missingCost,
        color: PALETTE[index % PALETTE.length]
      };
    }).filter(item => item.stock || item.costValue || item.retailValue);

    const valuation = {
      costValue: specs.reduce((sum, item) => sum + item.spec.stock * item.spec.cost, 0),
      retailValue: specs.reduce((sum, item) => sum + item.spec.stock * item.spec.price, 0),
      // 仅统计有库存却未录成本的 SKU（stock>0 且 cost<=0），避免把已清空规格也计进去
      missingCost: specs.filter(item => item.spec.stock > 0 && item.spec.cost <= 0).length,
      series: valuationSeries
    };
    valuation.potentialProfit = valuation.retailValue - valuation.costValue;

    return { sku, totalStock, safeStock, low, out, healthy, healthScore, coverage, filtered, restock, series, hot, valuation };
  }, [products, orders, sf, search, lowOnly]);

  const batchInsight = useMemo(() => {
    const expiring = batchList.filter(batch => isDateSoon(batch.expiryDate, 120) && batch.remainingQty > 0);
    const traced = batchList.filter(batch => batch.gcmsNo).length;
    const remaining = batchList.reduce((sum, batch) => sum + Number(batch.remainingQty || 0), 0);
    return { expiring, traced, remaining };
  }, [batchList]);

  const copyRestockList = () => {
    if (inventoryModel.restock.length === 0) { alert('当前无缺货品'); return; }
    const lines = inventoryModel.restock.map(({ product, spec, suggestedQty }) => (
      `${product.name} ${spec.spec} | 剩 ${spec.stock} / 安全 ${spec.safeStock} | 建议补 ${suggestedQty}`
    ));
    const text = `【紫都补货清单】${today()}\n${lines.join('\n')}`;
    navigator.clipboard.writeText(text).then(
      () => alert(`已复制 ${lines.length} 项补货清单`),
      () => alert('复制失败，请手动复制')
    );
  };

  const startAdjust = (product, spec) => {
    setAdjustFor({ product, spec });
    setAdjType('IN');
    setAdjReason('PURCHASE');
    setAdjQty('');
    setAdjNote('');
  };

  const handleAdjust = async () => {
    const qty = Number(adjQty);
    if (!qty || qty < 0) return;
    setAdjusting(true);
    try {
      await adjustStock(adjustFor.spec.id, adjustFor.product.id, adjType, adjReason, qty, adjNote);
      setAdjustFor(null);
      if (tab === 'log') await loadStockLog();
    } catch (e) {
      alert('调整失败: ' + e.message);
    } finally {
      setAdjusting(false);
    }
  };

  const startBatch = (product, spec) => {
    setBatchFor({ product, spec });
    setBatchData({
      batchNo: '',
      gcmsNo: '',
      receivedDate: today(),
      expiryDate: '',
      quantity: '',
      unitCost: '',
      supplier: '',
      note: ''
    });
  };

  const handleSaveBatch = async () => {
    const qty = Number(batchData.quantity);
    if (!batchData.batchNo || !batchData.receivedDate || !qty || qty <= 0) return;
    setSavingBatch(true);
    try {
      await addBatch({
        productId: batchFor.product.id,
        specId: batchFor.spec.id,
        batchNo: batchData.batchNo,
        gcmsNo: batchData.gcmsNo,
        receivedDate: batchData.receivedDate,
        expiryDate: batchData.expiryDate || null,
        quantity: qty,
        unitCost: Number(batchData.unitCost) || 0,
        supplier: batchData.supplier,
        note: batchData.note
      });
      setBatchFor(null);
      alert('入库成功');
      if (tab === 'batches') {
        const fresh = await api.fetchBatches();
        setBatchList(fresh);
      }
    } catch (e) {
      alert('入库失败: ' + e.message);
    } finally {
      setSavingBatch(false);
    }
  };

  const handleDeleteBatch = async (batch) => {
    if (!confirm(`确定删除批次 ${batch.batchNo}？剩余库存 ${batch.remainingQty} 将被扣除。`)) return;
    try {
      await removeBatch(batch.id, batch.productId, batch.specId, batch.remainingQty);
      const fresh = await api.fetchBatches();
      setBatchList(fresh);
    } catch (e) {
      alert(e.message);
    }
  };

  const exportLog = () => exportCSV(
    ['时间', '产品ID', '规格ID', '类型', '原因', '数量', '前库存', '后库存', '操作人', '备注'],
    stockLog.map(log => [
      log.created_at,
      log.product_id,
      log.spec_id,
      TYPE_LABEL[log.type],
      REASONS[log.reason] || log.reason,
      log.quantity,
      log.before_stock,
      log.after_stock,
      log.operator_name,
      log.note
    ]),
    `库存变动_${new Date().toISOString().slice(0, 10)}.csv`
  );

  return (
    <div className="min-h-full space-y-5">
      <InventoryVisualShowcase inventoryModel={inventoryModel} batchInsight={batchInsight} />

      <section className="relative overflow-hidden rounded-[8px] border border-[#eadfd8] bg-[#f8f1ec] p-4 shadow-sm md:p-5">
        <div className="absolute right-0 top-0 h-full w-1/3 bg-[linear-gradient(180deg,#fff8e8,#f1e7f5)] opacity-70" />
        <div className="relative grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
          <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-[#7b6a62]">ZIDU Inventory Studio</p>
                <h2 className="mt-1 text-2xl font-semibold text-[#3F3650]">紫都库存管理</h2>
                <p className="mt-1 max-w-2xl text-sm text-[#8A8178]">
                  覆盖商品规格、安全库存、批次 GC-MS、出入库流水和补货优先级。
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={copyRestockList}
                  className="inline-flex items-center gap-2 rounded-[8px] border border-[#d8c9e7] bg-white px-3 py-2 text-sm font-medium text-[#5c4b73] shadow-sm hover:bg-[#F1EEF6]"
                >
                  <ClipboardCopy size={15} />补货清单
                </button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
              <MetricTile icon={Layers} label="SKU 总数" value={inventoryModel.sku} accent="#5c4b73" />
              <MetricTile icon={Package} label="在库件数" value={inventoryModel.totalStock} accent="#7B8F67" />
              <MetricTile icon={AlertTriangle} label="需补货" value={inventoryModel.low.length + inventoryModel.out.length} accent="#d87a4a" tone="warm" />
              <MetricTile icon={ShieldCheck} label="健康度" value={`${inventoryModel.healthScore}%`} accent="#5F7689" />
            </div>
          </div>

          <Card className="relative overflow-hidden rounded-[8px] border-[#e2d5cc] bg-white/88 p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-[#3F3650]">库存状态雷达</div>
                <div className="mt-1 text-xs text-[#8A8178]">按规格数计算，适合仓库每日开场检查</div>
              </div>
              <div className="rounded-[8px] bg-[#3F3650] px-3 py-2 text-right text-white">
                <div className="text-[10px] text-white/65">覆盖率</div>
                <div className="text-lg font-semibold">{inventoryModel.coverage}%</div>
              </div>
            </div>
            <HealthStack healthy={inventoryModel.healthy.length} low={inventoryModel.low.length} out={inventoryModel.out.length} total={inventoryModel.sku} />
            <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
              <LegendPill color="#7B8F67" label="正常" value={inventoryModel.healthy.length} />
              <LegendPill color="#F3BD5B" label="临界" value={inventoryModel.low.length} />
              <LegendPill color="#8D5F5B" label="售罄" value={inventoryModel.out.length} />
            </div>
          </Card>
        </div>
      </section>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <TabButton active={tab === 'list'} icon={BarChart3} label="库存总览" onClick={() => setTab('list')} />
        <TabButton active={tab === 'batches'} icon={FlaskConical} label="批次追溯" onClick={() => setTab('batches')} />
        <TabButton active={tab === 'log'} icon={History} label="出入库流水" onClick={() => setTab('log')} />
      </div>

      {tab === 'list' && (
        <div className="mt-4 space-y-4">
          {user.role === 'ADMIN' && <ValuationCard valuation={inventoryModel.valuation} />}

          <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
            <VisualCard title="系列库存分布" subtitle="按当前库存汇总，低库存系列自动标记">
              {inventoryModel.series.length > 0 ? (
                <div className="h-[245px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={inventoryModel.series} margin={{ top: 8, right: 12, bottom: 0, left: -20 }}>
                      <CartesianGrid stroke="#ECE4D6" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#7f7478' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#7f7478' }} tickLine={false} axisLine={false} />
                      <Tooltip
                        cursor={{ fill: '#f7f0ea' }}
                        formatter={(value, name) => [value, name === 'stock' ? '当前库存' : '安全库存']}
                        labelStyle={{ color: '#3F3650' }}
                      />
                      <Bar dataKey="stock" name="当前库存" fill="#5c4b73" radius={[6, 6, 0, 0]} />
                      <Bar dataKey="safe" name="安全库存" fill="#F3BD5B" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState text="暂无系列库存数据" />
              )}
            </VisualCard>

            <VisualCard title="补货优先队列" subtitle="售罄、低于安全线和热卖品优先">
              <div className="space-y-2">
                {inventoryModel.restock.slice(0, 6).map((item, index) => (
                  <RestockRow key={`${item.product.id}-${item.spec.id}`} item={item} rank={index + 1} />
                ))}
                {inventoryModel.restock.length === 0 && <EmptyState text="库存安全，无需补货" />}
              </div>
            </VisualCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <Card className="rounded-[8px] border-[#E6DECF] bg-white p-3 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-1 flex-col gap-2 sm:flex-row">
                  <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#B3A99A]" />
                    <input
                      placeholder="搜索产品名称 / 编号"
                      value={search}
                      onChange={e => setSearch(e.target.value)}
                      className="w-full rounded-[8px] border border-[#e6ddd8] bg-[#FBF8F2] py-2.5 pl-9 pr-3 text-sm text-[#3F3650] outline-none focus:border-[#bca9d1]"
                    />
                  </div>
                  <select
                    value={sf}
                    onChange={e => setSf(e.target.value)}
                    className="rounded-[8px] border border-[#e6ddd8] bg-white px-3 py-2.5 text-sm text-[#4b4248] outline-none focus:border-[#bca9d1]"
                  >
                    <option value="ALL">全部系列</option>
                    {SERIES_LIST.map(series => <option key={series} value={series}>{series}</option>)}
                  </select>
                </div>
                <button
                  onClick={() => setLowOnly(!lowOnly)}
                  className={classNames(
                    'inline-flex items-center justify-center gap-2 rounded-[8px] border px-3 py-2.5 text-sm font-medium',
                    lowOnly ? 'border-[#F3BD5B] bg-[#fff4e6] text-[#9A7320]' : 'border-[#e6ddd8] bg-white text-[#8A8178]'
                  )}
                >
                  <AlertTriangle size={15} />仅看预警
                </button>
              </div>
            </Card>

            <Card className="rounded-[8px] border-[#E6DECF] bg-[#3F3650] p-4 text-white shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles size={16} className="text-[#f0bd6a]" />今日仓库提示
              </div>
              <p className="mt-2 text-sm leading-6 text-white/74">
                {inventoryModel.restock.length > 0
                  ? `有 ${inventoryModel.restock.length} 个规格触发安全线，建议优先处理 ${inventoryModel.restock[0].product.name} ${inventoryModel.restock[0].spec.spec}。`
                  : '库存安全线稳定，可将重点放在批次效期复核和热销品备货上。'}
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs text-white/58">
                <Truck size={14} />采购、仓库、销售共享同一份库存视图
              </div>
            </Card>
          </div>

          <ActionPanel
            batchFor={batchFor}
            batchData={batchData}
            setBatchData={setBatchData}
            setBatchFor={setBatchFor}
            handleSaveBatch={handleSaveBatch}
            savingBatch={savingBatch}
            adjustFor={adjustFor}
            adjType={adjType}
            setAdjType={setAdjType}
            adjReason={adjReason}
            setAdjReason={setAdjReason}
            adjQty={adjQty}
            setAdjQty={setAdjQty}
            adjNote={adjNote}
            setAdjNote={setAdjNote}
            setAdjustFor={setAdjustFor}
            handleAdjust={handleAdjust}
            adjusting={adjusting}
          />

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {inventoryModel.filtered.map(product => (
              <ProductInventoryCard
                key={product.id}
                product={product}
                canAdjust={canAdjust}
                startAdjust={startAdjust}
                startBatch={startBatch}
                user={user}
              />
            ))}
          </div>
          {inventoryModel.filtered.length === 0 && (
            <Card className="rounded-[8px] border-[#E6DECF] bg-white p-10">
              <EmptyState text={lowOnly ? '没有缺货产品' : '暂无产品'} />
            </Card>
          )}
        </div>
      )}

      {tab === 'batches' && (
        <div className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MetricTile icon={Archive} label="批次数" value={batchList.length} accent="#5c4b73" />
            <MetricTile icon={FlaskConical} label="GC-MS 覆盖" value={batchList.length ? `${Math.round(batchInsight.traced / batchList.length * 100)}%` : '0%'} accent="#5F7689" />
            <MetricTile icon={Package} label="批次余量" value={batchInsight.remaining} accent="#7B8F67" />
            <MetricTile icon={AlertTriangle} label="临期批次" value={batchInsight.expiring.length} accent="#F3BD5B" tone="warm" />
          </div>

          <Card className="overflow-hidden rounded-[8px] border-[#E6DECF] bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-[#ECE4D6] px-4 py-3">
              <div>
                <div className="text-sm font-semibold text-[#3F3650]">批次 / GC-MS 追溯</div>
                <div className="mt-0.5 text-xs text-[#8A8178]">按入库日期降序，临近保质期自动高亮</div>
              </div>
              <div className="text-xs text-[#8A8178]">共 {batchList.length} 个批次</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-[#ECE4D6] bg-[#FBF8F2]">
                    {['批次号', '产品 / 规格', 'GC-MS', '入库日期', '保质期', '入库 / 剩余', '供应商', canAdjust ? '操作' : ''].filter(Boolean).map(head => (
                      <th key={head} className="px-4 py-3 text-left text-xs font-medium text-[#8A8178]">{head}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loadingBatches && <tr><td colSpan="8" className="py-12 text-center text-sm text-[#8A8178]">加载中...</td></tr>}
                  {!loadingBatches && batchList.map(batch => {
                    const product = products.find(item => item.id === batch.productId);
                    const spec = product?.specs.find(item => item.id === batch.specId);
                    const expiringSoon = isDateSoon(batch.expiryDate, 120);
                    return (
                      <tr key={batch.id} className="border-b border-[#f3eeee] hover:bg-[#FBF8F2]">
                        <td className="px-4 py-3 font-mono text-xs text-[#403846]">{batch.batchNo}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-[#3F3650]">{product?.name || `ID ${batch.productId}`}</div>
                          <div className="mt-0.5 text-xs text-[#8A8178]">{spec?.spec || ''}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={classNames('rounded-[8px] border px-2 py-1 font-mono text-xs', batch.gcmsNo ? 'border-[#d8c9e7] bg-[#F1EEF6] text-[#5c4b73]' : 'border-[#eee7e2] bg-[#FBF8F2] text-[#B3A99A]')}>
                            {batch.gcmsNo || '待补'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-[#8A8178]">{batch.receivedDate}</td>
                        <td className={classNames('px-4 py-3 text-xs', expiringSoon ? 'font-medium text-[#8D5F5B]' : 'text-[#8A8178]')}>{batch.expiryDate || '-'}</td>
                        <td className="px-4 py-3 text-right text-[#3F3650]">{batch.initialQty} / <span className={batch.remainingQty === 0 ? 'text-[#aaa0a4]' : 'font-semibold'}>{batch.remainingQty}</span></td>
                        <td className="px-4 py-3 text-xs text-[#8A8178]">{batch.supplier || '-'}</td>
                        {canAdjust && (
                          <td className="px-4 py-3 text-right">
                            <button onClick={() => handleDeleteBatch(batch)} className="rounded-[8px] p-2 text-[#B3A99A] hover:bg-rose-50 hover:text-rose-600" title="删除批次">
                              <X size={15} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {!loadingBatches && batchList.length === 0 && (
                    <tr><td colSpan="8" className="py-12 text-center text-sm text-[#8A8178]">暂无批次记录。在库存总览中点击规格旁的批次按钮即可入库。</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {tab === 'log' && (
        <div className="mt-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-[#3F3650]">出入库流水</div>
              <div className="text-xs text-[#8A8178]">共 {stockLog.length} 条记录，可用于盘点复核和责任追踪</div>
            </div>
            <button onClick={exportLog} className="inline-flex items-center gap-2 rounded-[8px] border border-[#d8c9e7] bg-white px-3 py-2 text-sm font-medium text-[#5c4b73] hover:bg-[#F1EEF6]">
              <Download size={15} />导出
            </button>
          </div>

          <Card className="overflow-hidden rounded-[8px] border-[#E6DECF] bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-[#ECE4D6] bg-[#FBF8F2]">
                    {['时间', '产品', '类型', '原因', '数量', '前后', '操作人', '备注'].map(head => (
                      <th key={head} className="px-4 py-3 text-left text-xs font-medium text-[#8A8178]">{head}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stockLog.map(log => {
                    const product = products.find(item => item.id === log.product_id);
                    const spec = product?.specs.find(item => item.id === log.spec_id);
                    return (
                      <tr key={log.id} className="border-b border-[#f3eeee] hover:bg-[#FBF8F2]">
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-[#8A8178]">{log.created_at?.slice(0, 16).replace('T', ' ')}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-[#3F3650]">{product?.name || `ID ${log.product_id}`}</div>
                          <div className="mt-0.5 text-xs text-[#8A8178]">{spec?.spec || ''}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={classNames('inline-flex rounded-full border px-2 py-1 text-xs font-medium', TYPE_TONE[log.type])}>{TYPE_LABEL[log.type] || log.type}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-[#8A8178]">{REASONS[log.reason] || log.reason}</td>
                        <td className="px-4 py-3 text-right font-semibold text-[#3F3650]">{log.type === 'OUT' ? '-' : '+'}{log.quantity}</td>
                        <td className="px-4 py-3 text-right text-xs text-[#8A8178]">{log.before_stock} / {log.after_stock}</td>
                        <td className="px-4 py-3 text-xs text-[#8A8178]">{log.operator_name || '-'}</td>
                        <td className="px-4 py-3 text-xs text-[#8A8178]">{log.note || '-'}</td>
                      </tr>
                    );
                  })}
                  {stockLog.length === 0 && <tr><td colSpan="8" className="py-12 text-center text-sm text-[#8A8178]">暂无记录</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function InventoryVisualShowcase({ inventoryModel, batchInsight }) {
  const days = ['一', '二', '三', '四', '五', '六', '日'];
  const dates = ['16', '17', '18', '19', '20', '21', '22'];
  const statusBars = [
    { label: '正常', value: inventoryModel.healthy.length, color: '#7b8f67', pct: inventoryModel.sku ? inventoryModel.healthy.length / inventoryModel.sku : 0 },
    { label: '需补货', value: inventoryModel.low.length, color: '#c58a56', pct: inventoryModel.sku ? inventoryModel.low.length / inventoryModel.sku : 0 },
    { label: '售罄', value: inventoryModel.out.length, color: '#8d5f5b', pct: inventoryModel.sku ? inventoryModel.out.length / inventoryModel.sku : 0 },
    { label: '临期', value: batchInsight.expiring.length, color: '#6f6a58', pct: Math.min(1, batchInsight.expiring.length / Math.max(inventoryModel.sku, 1)) }
  ];
  const heroItem = inventoryModel.restock[0];
  const secondaryItem = inventoryModel.restock[1] || inventoryModel.restock[0];

  return (
    <section className="overflow-hidden rounded-[8px] bg-[#d9d2cf] px-4 py-8 shadow-sm md:px-8">
      <div className="mx-auto grid max-w-6xl items-center gap-8 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-[#6b5d69]">ZIDU Inventory UI Kit</p>
          <h2 className="mt-3 text-3xl font-semibold leading-tight text-[#3F3650] md:text-4xl">紫都库存管理移动视觉</h2>
          <p className="mt-3 text-sm leading-7 text-[#6f6569]">
            按你给的参考图重新做：柔和底色、手机卡片、圆角按钮、轻量图表和一眼可读的库存状态。
          </p>
          <div className="mt-6 grid grid-cols-3 gap-2">
            <VisualToken label="主色" value="#5c4b73" swatch="#5c4b73" />
            <VisualToken label="强调" value="#f3bd5b" swatch="#f3bd5b" />
            <VisualToken label="草本" value="#7b8f67" swatch="#7b8f67" />
          </div>
        </div>

        <div className="relative min-h-[650px] md:min-h-[620px]">
          <PhoneMockup className="left-0 top-0 md:absolute">
            <PhoneStatus />
            <div className="px-4 pb-5">
              <div className="mt-3 flex items-center justify-between">
                <div>
                  <div className="text-[11px] font-medium text-[#7f7478]">Hi, 紫都仓库</div>
                  <div className="mt-1 text-2xl font-semibold text-[#3F3650]">库存工作台</div>
                </div>
                <div className="grid h-11 w-11 place-items-center rounded-full bg-[#5c4b73] text-sm font-semibold text-white shadow-sm">紫</div>
              </div>

              <div className="mt-5 grid grid-cols-7 gap-2">
                {days.map((day, index) => (
                  <div key={day} className="text-center">
                    <div className="text-[10px] text-[#94898d]">{day}</div>
                    <div className={classNames('mt-2 grid h-9 w-9 place-items-center rounded-full text-sm font-semibold', index === 1 ? 'bg-[#f3bd5b] text-[#3F3650]' : 'bg-white text-[#564c51]')}>
                      {dates[index]}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 flex items-center justify-between">
                <div className="text-base font-semibold text-[#3F3650]">今日重点</div>
                <button className="text-xs font-semibold text-[#5c4b73]">全部</button>
              </div>

              <div className="mt-3 grid grid-cols-[1fr_58px] gap-2">
                <div className="overflow-hidden rounded-[8px] bg-[#ffd064] p-4">
                  <div className="text-center text-base font-semibold text-[#3F3650]">先补这一个</div>
                  <div className="mt-1 text-center text-xs leading-5 text-[#6d5833]">
                    {heroItem ? `${heroItem.product.name} ${heroItem.spec.spec}` : '库存安全，无紧急补货'}
                  </div>
                  <BottleShelf item={heroItem} />
                </div>
                <div className="grid place-items-center rounded-[8px] bg-[#cfc2b6] text-sm font-semibold text-[#5a514d] [writing-mode:vertical-rl]">
                  批次追溯
                </div>
              </div>

              <div className="mt-5 flex items-center justify-between">
                <div className="text-base font-semibold text-[#3F3650]">快捷处理</div>
                <button className="text-xs font-semibold text-[#5c4b73]">更多</button>
              </div>

              <div className="mt-3 flex gap-3 overflow-hidden">
                <QuickCard title="补货清单" text={`${inventoryModel.restock.length} 个规格`} tone="rose" />
                <QuickCard title="批次入库" text={`${batchInsight.remaining} 件余量`} tone="lilac" />
                <QuickCard title="盘点修正" text="扫码记录" tone="green" />
              </div>

              <PhoneNav />
            </div>
          </PhoneMockup>

          <PhoneMockup className="mt-6 md:absolute md:right-0 md:top-14 md:mt-0">
            <PhoneStatus />
            <div className="px-4 pb-5">
              <div className="mt-4 flex items-center justify-between">
                <button className="grid h-10 w-10 place-items-center rounded-full bg-white text-xl text-[#5c4b73]">‹</button>
                <div className="font-semibold text-[#3F3650]">库存分析</div>
                <button className="grid h-10 w-10 place-items-center rounded-full bg-white text-xl text-[#5c4b73]">...</button>
              </div>

              <div className="mt-6 text-center">
                <div className="text-6xl font-semibold tracking-tight text-[#3F3650]">{inventoryModel.totalStock}</div>
                <div className="mt-2 text-sm text-[#6f6569]">当前在库件数 · SKU {inventoryModel.sku}</div>
              </div>

              <div className="mt-6 rounded-[8px] bg-white p-4 shadow-sm">
                <div className="text-lg font-semibold text-[#3F3650]">库存状态</div>
                <div className="mt-1 text-xs text-[#8d8286]">四类核心指标，用于早会快速判断风险</div>
                <div className="mt-5 grid grid-cols-4 gap-2 border-t border-[#eee8e4] pt-4">
                  {statusBars.map(item => (
                    <div key={item.label} className="text-center">
                      <div className="relative mx-auto h-36 overflow-hidden rounded-[24px] bg-[#f0eeee]">
                        <div className="absolute bottom-0 left-0 right-0 rounded-[24px]" style={{ height: `${Math.max(18, item.pct * 100)}%`, background: item.color }} />
                        <div className="absolute bottom-3 left-0 right-0 text-xs font-semibold text-white">{item.value}</div>
                      </div>
                      <div className="mt-2 text-xs font-medium text-[#4e464a]">{item.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 rounded-[8px] bg-[#5c4b73] p-4 text-white">
                <div className="text-sm font-semibold">智能建议</div>
                <div className="mt-1 text-xs leading-5 text-white/75">
                  {secondaryItem ? `${secondaryItem.product.name} 已低于安全线，建议补 ${secondaryItem.suggestedQty}。` : '库存处于稳定状态，建议复核批次效期。'}
                </div>
              </div>

              <button className="mt-4 w-full rounded-full bg-[#f3bd5b] py-3 text-sm font-semibold text-[#3F3650] shadow-sm">
                创建补货单
              </button>
            </div>
          </PhoneMockup>
        </div>
      </div>
    </section>
  );
}

function PhoneMockup({ children, className = '' }) {
  return (
    <div className={classNames('mx-auto w-[300px] overflow-hidden rounded-[32px] border-[6px] border-[#e9e6e2] bg-[#f7f5f2] shadow-[0_24px_60px_rgba(66,54,62,0.22)]', className)}>
      {children}
    </div>
  );
}

function PhoneStatus() {
  return (
    <div className="flex h-11 items-center justify-between px-6 text-xs font-bold text-[#3F3650]">
      <span>9:41</span>
      <span className="tracking-[-0.15em]">▮▮▮ ▰</span>
    </div>
  );
}

function VisualToken({ label, value, swatch }) {
  return (
    <div className="rounded-[8px] bg-white/60 p-3">
      <div className="flex items-center gap-2">
        <span className="h-4 w-4 rounded-full" style={{ background: swatch }} />
        <span className="text-xs font-semibold text-[#3F3650]">{label}</span>
      </div>
      <div className="mt-2 font-mono text-[10px] text-[#766b70]">{value}</div>
    </div>
  );
}

function BottleShelf({ item }) {
  const label = item ? item.product.name.slice(0, 4) : '安全';
  return (
    <div className="mt-5 flex items-end justify-center gap-3">
      {[22, 34, 48, 36, 26].map((height, index) => (
        <div key={height} className="flex flex-col items-center">
          <div className="h-2 w-6 rounded-t-full bg-[#7B8F67]" />
          <div
            className="grid w-9 place-items-center rounded-t-[14px] rounded-b-[8px] border border-[#c49a46] bg-[#fff7d8] text-[9px] font-semibold text-[#5c4b2f]"
            style={{ height: height + 34 }}
          >
            {index === 2 ? label : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

function QuickCard({ title, text, tone }) {
  const styles = {
    rose: 'bg-[#ffe7e2] text-[#6d4b45]',
    lilac: 'bg-[#e8ddff] text-[#5c4b73]',
    green: 'bg-[#e7f1df] text-[#566b4c]'
  };
  return (
    <div className={classNames('w-28 shrink-0 rounded-[8px] p-3', styles[tone])}>
      <div className="text-xs font-semibold">{title}</div>
      <div className="mt-3 text-[11px] leading-4 opacity-75">{text}</div>
    </div>
  );
}

function PhoneNav() {
  const items = ['首页', '库存', '+', '批次', '我的'];
  return (
    <div className="mt-6 grid grid-cols-5 items-center rounded-full bg-white px-3 py-2 text-center text-[10px] text-[#8A8178] shadow-sm">
      {items.map(item => (
        <div key={item} className={classNames('mx-auto grid place-items-center', item === '+' ? 'h-10 w-10 rounded-full bg-[#f3bd5b] text-lg font-semibold text-[#3F3650]' : 'h-9')}>
          {item}
        </div>
      ))}
    </div>
  );
}

function ValuationCard({ valuation }) {
  const [open, setOpen] = useState(false);
  const { costValue, retailValue, potentialProfit, missingCost, series } = valuation;
  const detail = (series || []).filter(item => item.costValue || item.retailValue);

  return (
    <Card className="overflow-hidden rounded-[8px] border-[#e2d5cc] bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-[#ECE4D6] px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-[#3F3650]">
            <Wallet size={16} className="text-[#5c4b73]" />库存估值
            <span className="rounded-full bg-[#f3eef8] px-2 py-0.5 text-[10px] font-medium text-[#5c4b73]">仅管理员可见</span>
          </div>
          <div className="mt-0.5 text-xs text-[#8A8178]">基于当前库存与已录成本/售价实时计算</div>
        </div>
        {detail.length > 0 && (
          <button
            onClick={() => setOpen(!open)}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[8px] border border-[#e5ddd8] bg-white px-3 py-1.5 text-xs font-medium text-[#5c4b73] hover:bg-[#F1EEF6]"
          >
            {open ? '收起明细' : '按系列展开'}
            <ChevronDown size={14} className={classNames('transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-3">
        <ValuationTile icon={Wallet} label="库存成本价值" sub="Σ 库存 × 成本" value={fmtY(costValue)} accent="#5c4b73" />
        <ValuationTile icon={Tag} label="库存零售价值" sub="Σ 库存 × 售价" value={fmtY(retailValue)} accent="#5F7689" />
        <ValuationTile icon={TrendingUp} label="潜在毛利" sub="零售价值 − 成本价值" value={fmtY(potentialProfit)} accent="#7B8F67" />
      </div>

      {missingCost > 0 && (
        <div className="mx-4 mb-4 flex items-start gap-2 rounded-[8px] border border-[#f0d8bd] bg-[#fff9ef] px-3 py-2 text-xs text-[#9A7320]">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>有 {missingCost} 个 SKU 未录成本（成本按 0 计），成本价值与潜在毛利可能偏高，建议在产品/批次中补录成本。</span>
        </div>
      )}

      {open && detail.length > 0 && (
        <div className="border-t border-[#ECE4D6] px-4 py-3">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-[#ECE4D6] text-xs text-[#8A8178]">
                  <th className="px-2 py-2 text-left font-medium">系列</th>
                  <th className="px-2 py-2 text-right font-medium">在库件数</th>
                  <th className="px-2 py-2 text-right font-medium">成本价值</th>
                  <th className="px-2 py-2 text-right font-medium">零售价值</th>
                  <th className="px-2 py-2 text-right font-medium">潜在毛利</th>
                  <th className="px-2 py-2 text-right font-medium">未录成本</th>
                </tr>
              </thead>
              <tbody>
                {detail.map(item => (
                  <tr key={item.fullName} className="border-b border-[#f3eeee] last:border-0">
                    <td className="px-2 py-2">
                      <span className="inline-flex items-center gap-2 text-[#3F3650]">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />
                        {item.fullName}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right text-[#8A8178]">{item.stock}</td>
                    <td className="px-2 py-2 text-right text-[#3F3650]">{fmtY(item.costValue)}</td>
                    <td className="px-2 py-2 text-right text-[#3F3650]">{fmtY(item.retailValue)}</td>
                    <td className="px-2 py-2 text-right font-medium text-[#557b5a]">{fmtY(item.potentialProfit)}</td>
                    <td className="px-2 py-2 text-right">
                      {item.missingCost > 0
                        ? <span className="font-medium text-[#9A7320]">{item.missingCost}</span>
                        : <span className="text-[#aaa0a4]">0</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

function ValuationTile({ icon: Icon, label, sub, value, accent }) {
  return (
    <div className="rounded-[8px] border border-[#E6DECF] bg-[#FBF8F2] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs text-[#8A8178]">{label}</div>
          <div className="mt-1 truncate text-xl font-semibold text-[#3F3650]">{value}</div>
          <div className="mt-1 text-[10px] text-[#B3A99A]">{sub}</div>
        </div>
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px]" style={{ background: `${accent}18`, color: accent }}>
          {createElement(Icon, { size: 18 })}
        </div>
      </div>
    </div>
  );
}

function MetricTile({ icon: Icon, label, value, accent, tone }) {
  return (
    <Card className={classNames('rounded-[8px] border p-3 shadow-sm', tone === 'warm' ? 'border-[#f0d8bd] bg-[#fff9ef]' : 'border-[#E6DECF] bg-white/92')}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-xs text-[#8A8178]">{label}</div>
          <div className="mt-1 text-2xl font-semibold text-[#3F3650]">{value}</div>
        </div>
        <div className="grid h-9 w-9 place-items-center rounded-[8px]" style={{ background: `${accent}18`, color: accent }}>
          {createElement(Icon, { size: 18 })}
        </div>
      </div>
    </Card>
  );
}

function HealthStack({ healthy, low, out, total }) {
  const healthyPct = total ? healthy / total * 100 : 0;
  const lowPct = total ? low / total * 100 : 0;
  const outPct = total ? out / total * 100 : 0;
  return (
    <div className="mt-4 h-3 overflow-hidden rounded-full bg-[#efe8e4]">
      <div className="flex h-full">
        <div style={{ width: `${healthyPct}%`, background: '#7B8F67' }} />
        <div style={{ width: `${lowPct}%`, background: '#F3BD5B' }} />
        <div style={{ width: `${outPct}%`, background: '#8D5F5B' }} />
      </div>
    </div>
  );
}

function LegendPill({ color, label, value }) {
  return (
    <div className="rounded-[8px] bg-[#FBF8F2] p-2">
      <div className="flex items-center gap-1.5 text-[#8A8178]">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} />
        <span>{label}</span>
      </div>
      <div className="mt-1 font-semibold text-[#3F3650]">{value}</div>
    </div>
  );
}

function TabButton({ active, icon: Icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className={classNames(
        'inline-flex shrink-0 items-center gap-2 rounded-[8px] border px-4 py-2.5 text-sm font-medium transition',
        active ? 'border-[#5c4b73] bg-[#5c4b73] text-white shadow-sm' : 'border-[#e5ddd8] bg-white text-[#8A8178] hover:bg-[#FBF8F2]'
      )}
    >
      {createElement(Icon, { size: 16 })}{label}
    </button>
  );
}

function VisualCard({ title, subtitle, children }) {
  return (
    <Card className="rounded-[8px] border-[#E6DECF] bg-white p-4 shadow-sm">
      <div className="mb-3">
        <div className="text-sm font-semibold text-[#3F3650]">{title}</div>
        <div className="mt-0.5 text-xs text-[#8A8178]">{subtitle}</div>
      </div>
      {children}
    </Card>
  );
}

function EmptyState({ text }) {
  return (
    <div className="grid min-h-[120px] place-items-center rounded-[8px] border border-dashed border-[#e4d9d3] bg-[#FBF8F2] text-sm text-[#8A8178]">
      {text}
    </div>
  );
}

function RestockRow({ item, rank }) {
  const ratio = item.spec.safeStock ? clamp(item.spec.stock / item.spec.safeStock, 0, 1) : 1;
  const tone = item.urgency === 'HIGH' ? '#8D5F5B' : item.urgency === 'MEDIUM' ? '#F3BD5B' : '#8c7a55';
  return (
    <div className="rounded-[8px] border border-[#efe6df] bg-[#FBF8F2] p-3">
      <div className="flex items-start gap-3">
        <div className="grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-xs font-semibold text-white" style={{ background: tone }}>{rank}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-[#3F3650]">{item.product.name}</div>
          <div className="mt-0.5 text-xs text-[#8A8178]">{item.product.code} · {item.spec.spec} · 建议补 {item.suggestedQty}</div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#E6DECF]">
            <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, background: tone }} />
          </div>
        </div>
        <div className="text-right text-xs">
          <div className="font-semibold text-[#3F3650]">{item.spec.stock}</div>
          <div className="text-[#8A8178]">/ {item.spec.safeStock}</div>
        </div>
      </div>
    </div>
  );
}

function ActionPanel(props) {
  const {
    batchFor,
    batchData,
    setBatchData,
    setBatchFor,
    handleSaveBatch,
    savingBatch,
    adjustFor,
    adjType,
    setAdjType,
    adjReason,
    setAdjReason,
    adjQty,
    setAdjQty,
    adjNote,
    setAdjNote,
    setAdjustFor,
    handleAdjust,
    adjusting
  } = props;

  if (!batchFor && !adjustFor) return null;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {batchFor && (
        <Card className="rounded-[8px] border-[#cfe4d4] bg-[#f4fbf5] p-4 shadow-sm">
          <PanelHead
            icon={FlaskConical}
            title={`批次入库：${batchFor.product.name}`}
            subtitle={`${batchFor.spec.spec} · 当前库存 ${batchFor.spec.stock}`}
            onClose={() => setBatchFor(null)}
          />
          <div className="mt-4 grid grid-cols-2 gap-3">
            <FormInput label="批次号" value={batchData.batchNo} onChange={value => setBatchData({ ...batchData, batchNo: value })} placeholder="LAV202604" required />
            <FormInput label="GC-MS 编号" value={batchData.gcmsNo} onChange={value => setBatchData({ ...batchData, gcmsNo: value })} placeholder="可选" />
            <FormInput label="入库数量" value={batchData.quantity} onChange={value => setBatchData({ ...batchData, quantity: value })} type="number" required />
            <FormInput label="入库日期" value={batchData.receivedDate} onChange={value => setBatchData({ ...batchData, receivedDate: value })} type="date" required />
            <FormInput label="保质期至" value={batchData.expiryDate} onChange={value => setBatchData({ ...batchData, expiryDate: value })} type="date" />
            <FormInput label="单位成本" value={batchData.unitCost} onChange={value => setBatchData({ ...batchData, unitCost: value })} type="number" />
            <FormInput label="供应商" value={batchData.supplier} onChange={value => setBatchData({ ...batchData, supplier: value })} />
            <FormInput label="备注" value={batchData.note} onChange={value => setBatchData({ ...batchData, note: value })} />
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={() => setBatchFor(null)} className="rounded-[8px] border border-[#d9e8dc] bg-white px-3 py-2 text-sm text-[#5c6b5b]">取消</button>
            <button
              onClick={handleSaveBatch}
              disabled={!batchData.batchNo || !batchData.quantity || savingBatch}
              className="rounded-[8px] bg-[#557b5a] px-4 py-2 text-sm font-medium text-white disabled:opacity-45"
            >
              {savingBatch ? '保存中...' : '确认入库'}
            </button>
          </div>
        </Card>
      )}

      {adjustFor && (
        <Card className="rounded-[8px] border-[#D8CFE0] bg-[#f8f3fb] p-4 shadow-sm">
          <PanelHead
            icon={Edit2}
            title={`库存调整：${adjustFor.product.name}`}
            subtitle={`${adjustFor.spec.spec} · 当前库存 ${adjustFor.spec.stock}`}
            onClose={() => setAdjustFor(null)}
          />
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs text-[#8A8178]">类型</span>
              <select
                value={adjType}
                onChange={e => {
                  const next = e.target.value;
                  setAdjType(next);
                  setAdjReason(next === 'IN' ? 'PURCHASE' : next === 'OUT' ? 'DAMAGE' : 'CORRECTION');
                }}
                className="w-full rounded-[8px] border border-[#D8CFE0] bg-white px-3 py-2 text-sm outline-none"
              >
                <option value="IN">入库 (+)</option>
                <option value="OUT">出库 (-)</option>
                <option value="CORRECTION">修正</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-[#8A8178]">原因</span>
              <select value={adjReason} onChange={e => setAdjReason(e.target.value)} className="w-full rounded-[8px] border border-[#D8CFE0] bg-white px-3 py-2 text-sm outline-none">
                {adjType === 'IN' && <><option value="PURCHASE">采购入库</option><option value="RETURN">退货入库</option><option value="OTHER">其他</option></>}
                {adjType === 'OUT' && <><option value="DAMAGE">损耗/报废</option><option value="OTHER">其他</option></>}
                {adjType === 'CORRECTION' && <option value="CORRECTION">盘点修正</option>}
              </select>
            </label>
            <FormInput label={adjType === 'CORRECTION' ? '新库存值' : '数量'} value={adjQty} onChange={setAdjQty} type="number" />
            <FormInput label="备注" value={adjNote} onChange={setAdjNote} />
          </div>
          <div className="mt-4 flex gap-2">
            <button onClick={() => setAdjustFor(null)} className="rounded-[8px] border border-[#D8CFE0] bg-white px-3 py-2 text-sm text-[#5c4b73]">取消</button>
            <button onClick={handleAdjust} disabled={!adjQty || adjusting} className="rounded-[8px] bg-[#5c4b73] px-4 py-2 text-sm font-medium text-white disabled:opacity-45">
              {adjusting ? '处理中...' : '确认调整'}
            </button>
          </div>
        </Card>
      )}
    </div>
  );
}

function PanelHead({ icon: Icon, title, subtitle, onClose }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-[8px] bg-white text-[#5c4b73] shadow-sm">
          {createElement(Icon, { size: 18 })}
        </div>
        <div>
          <div className="text-sm font-semibold text-[#3F3650]">{title}</div>
          <div className="mt-0.5 text-xs text-[#8A8178]">{subtitle}</div>
        </div>
      </div>
      <button onClick={onClose} className="rounded-[8px] p-2 text-[#8A8178] hover:bg-white">
        <X size={16} />
      </button>
    </div>
  );
}

function FormInput({ label, value, onChange, type = 'text', placeholder = '', required = false }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[#8A8178]">{label}{required && <span className="text-[#8D5F5B]"> *</span>}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-[8px] border border-[#e5ddd8] bg-white px-3 py-2 text-sm text-[#3F3650] outline-none focus:border-[#bca9d1]"
      />
    </label>
  );
}

function ProductInventoryCard({ product, canAdjust, startAdjust, startBatch, user }) {
  const lowCount = product.specs.filter(spec => spec.stock <= spec.safeStock).length;
  const total = product.specs.reduce((sum, spec) => sum + spec.stock, 0);
  return (
    <Card className="overflow-hidden rounded-[8px] border-[#E6DECF] bg-white shadow-sm">
      <div className="border-b border-[#ECE4D6] bg-[#FBF8F2] p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-[#3F3650]">{product.name}</div>
            <div className="mt-1 text-xs text-[#8A8178]">{product.code} · {product.origin} · {product.series}</div>
          </div>
          <div className={classNames('shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', lowCount ? 'bg-[#fff4e6] text-[#9A7320]' : 'bg-[#f0f7f1] text-[#557b5a]')}>
            {lowCount ? `${lowCount} 预警` : '安全'}
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-[#8A8178]">
          <span>总库存 {total}</span>
          <span>{product.specs.length} 个规格</span>
        </div>
      </div>
      <div className="space-y-3 p-4">
        {product.specs.map(spec => (
          <SpecRow
            key={spec.id}
            product={product}
            spec={spec}
            canAdjust={canAdjust}
            startAdjust={startAdjust}
            startBatch={startBatch}
            user={user}
          />
        ))}
      </div>
    </Card>
  );
}

function SpecRow({ product, spec, canAdjust, startAdjust, startBatch, user }) {
  const ratio = spec.safeStock ? clamp(spec.stock / (spec.safeStock * 2), 0, 1) : 1;
  const critical = spec.stock <= 0;
  const low = spec.stock > 0 && spec.stock <= spec.safeStock;
  const barColor = critical ? '#8D5F5B' : low ? '#F3BD5B' : '#7B8F67';

  return (
    <div className="rounded-[8px] border border-[#ECE4D6] bg-[#FBF8F2] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-[#3F3650]">{spec.spec}</span>
            {user.role !== 'SALES' && <span className="text-xs text-[#8A8178]">{fmtY(spec.price)}</span>}
          </div>
          <div className="mt-1 text-xs text-[#8A8178]">安全库存 {spec.safeStock}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="mr-1 text-right">
            <div className="text-sm font-semibold text-[#3F3650]">{spec.stock}</div>
            <div className="text-[10px] text-[#8A8178]">现货</div>
          </div>
          {canAdjust && (
            <>
              <button onClick={() => startAdjust(product, spec)} title="调整库存" className="grid h-8 w-8 place-items-center rounded-[8px] border border-[#e4d9d3] bg-white text-[#5c4b73] hover:bg-[#F1EEF6]">
                <Edit2 size={14} />
              </button>
              <button onClick={() => startBatch(product, spec)} title="批次入库" className="grid h-8 w-8 place-items-center rounded-[8px] border border-[#d9e8dc] bg-white text-[#557b5a] hover:bg-[#f4fbf5]">
                <FlaskConical size={14} />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e8e0db]">
        <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, background: barColor }} />
      </div>
      {(critical || low) && (
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white px-2 py-1 text-xs font-medium" style={{ color: barColor }}>
          {critical ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
          {critical ? '已售罄，建议立即补货' : '低于安全库存'}
        </div>
      )}
    </div>
  );
}
