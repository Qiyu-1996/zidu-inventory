import { Package, ShoppingCart, Users, TrendingUp, Percent } from 'lucide-react';

export const SERIES_LIST = ["德国进口系列","中药精油系列","单方精油系列","基础油系列","纯露系列","专业护肤系列","专业水疗系列","养生疗愈系列","芳疗复配","瓶器包材","茶饮养生","身体护理","家居香氛"];
export const CUSTOMER_TYPES = ["工厂","品牌","美容院","养生馆","医疗机构","SPA馆","头疗馆","足浴店","瑜伽馆","个人","零售店","其他"];
export const PROVINCES = ["北京","天津","河北","山西","内蒙古","辽宁","吉林","黑龙江","上海","江苏","浙江","安徽","福建","江西","山东","河南","湖北","湖南","广东","广西","海南","重庆","四川","贵州","云南","西藏","陕西","甘肃","青海","宁夏","新疆","香港","澳门","台湾"];
// 分销商等级：1=一级(自动5折) 2=二级(自动6.5折)
export const DISTRIBUTOR_LEVELS = [{ value: 0, label: "非分销商" }, { value: 1, label: "一级分销商(5折)" }, { value: 2, label: "二级分销商(6.5折)" }];
export function distributorLabel(level) { return level === 1 ? "一级分销商" : level === 2 ? "二级分销商" : ""; }
// 客户分级：分销商优先，否则按累计金额 >5万大 / 1万~5万中 / <1万小
export function customerTier(totalAmount, distributorLevel) {
  if (distributorLevel === 1 || distributorLevel === 2) return "分销商";
  if (totalAmount >= 50000) return "大客户";
  if (totalAmount >= 10000) return "中客户";
  return "小客户";
}
export const DEFAULT_SPEC_OPTIONS = ["2ml","5ml","10ml","15ml","30ml","50ml","100ml","500ml","1L","100g","500g","1kg","5kg"];

export const STATUS_MAP = {
  DRAFT: { label: "草稿", cls: "bg-gray-100 text-gray-600" },
  SUBMITTED: { label: "已提交", cls: "bg-blue-100 text-blue-700" },
  CONFIRMED: { label: "已确认", cls: "bg-purple-100 text-purple-700" },
  PREPARING: { label: "备货中", cls: "bg-yellow-100 text-yellow-700" },
  SHIPPED: { label: "已发货", cls: "bg-orange-100 text-orange-700" },
  DELIVERED: { label: "已签收", cls: "bg-green-100 text-green-700" },
  COMPLETED: { label: "已完成", cls: "bg-emerald-100 text-emerald-800" },
  CANCELLED: { label: "已取消", cls: "bg-red-100 text-red-700" }
};

export const NEXT_STATUS = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["SHIPPED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: []
};

export const fmt = n => n?.toLocaleString("zh-CN") ?? "0";
export const fmtY = n => `¥${fmt(n)}`;
export function unitPriceHint(spec, price) {
  const match = String(spec || '').match(/整(排|箱)\((\d+)个\/(排|箱)\)/);
  if (!match) return '';
  const count = Number(match[2]);
  const total = Number(price || 0);
  if (!count || !total) return '';
  const unit = Math.round((total / count) * 100) / 100;
  return `¥${unit.toFixed(unit < 1 ? 2 : (unit % 1 === 0 ? 0 : 2))}/个`;
}
export const today = () => new Date().toISOString().slice(0, 10);
export const now16 = () => new Date().toISOString().slice(0, 16);

export function Badge({ status }) {
  const s = STATUS_MAP[status];
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s?.cls}`}>{s?.label || status}</span>;
}

export function Card({ children, className = "", ...p }) {
  return <div className={`bg-white rounded-xl border border-[#EFE8DB] shadow-[0_5px_18px_rgba(92,75,115,0.055)] ${className}`} {...p}>{children}</div>;
}

export function StatCard({ label, value, sub, icon: Icon, color = "#5C4B73" }) {
  return (
    <Card className="p-4 overflow-hidden relative">
      <div className="absolute left-0 right-0 top-0 h-[3px]" style={{ background: color }} />
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-gray-500 mb-1.5">{label}</div>
          <div className="text-2xl font-medium text-gray-900 tabular-nums">{value}</div>
          {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
        </div>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: color + "15" }}>
          <Icon size={18} style={{ color }} />
        </div>
      </div>
    </Card>
  );
}

export function exportCSV(headers, rows, filename) {
  const bom = "\uFEFF";
  const csv = bom + [headers.join(","), ...rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const PAYMENT_STATUS_MAP = {
  UNPAID: { label: "未付", cls: "bg-gray-100 text-gray-600" },
  PARTIAL: { label: "部分付", cls: "bg-yellow-100 text-yellow-700" },
  PAID: { label: "已付", cls: "bg-green-100 text-green-700" }
};

export const PO_STATUS_MAP = {
  DRAFT: { label: "草稿", cls: "bg-gray-100 text-gray-600" },
  ORDERED: { label: "已下单", cls: "bg-blue-100 text-blue-700" },
  PARTIAL_RECEIVED: { label: "部分收货", cls: "bg-yellow-100 text-yellow-700" },
  RECEIVED: { label: "已收货", cls: "bg-green-100 text-green-700" },
  CANCELLED: { label: "已取消", cls: "bg-red-100 text-red-700" }
};

export function PaymentBadge({ status }) {
  const s = PAYMENT_STATUS_MAP[status];
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s?.cls}`}>{s?.label || status}</span>;
}

export function POBadge({ status }) {
  const s = PO_STATUS_MAP[status];
  return <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s?.cls}`}>{s?.label || status}</span>;
}

export function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen" style={{ background: "#EFEAE2" }}>
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mx-auto mb-4" />
        <div className="text-gray-500 text-sm">加载中...</div>
      </div>
    </div>
  );
}
