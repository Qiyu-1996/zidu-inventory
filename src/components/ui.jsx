import { Package, ShoppingCart, Users, TrendingUp, Percent } from 'lucide-react';

export const SERIES_LIST = ["德国进口系列","中药精油系列","单方精油系列","基础油系列","纯露系列","专业护肤系列","专业水疗系列","养生疗愈系列","芳疗复配"];
export const CUSTOMER_TYPES = ["SPA水疗馆","中医推拿馆","足浴/温泉","美容院/头皮理疗","头疗馆","经销商","其他"];
export const DEFAULT_SPEC_OPTIONS = ["5ml","10ml","30ml","50ml","100ml","100g","500g","1kg","5kg","500ml","1L"];

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
export const today = () => new Date().toISOString().slice(0, 10);
export const now16 = () => new Date().toISOString().slice(0, 16);

export function Badge({ status }) {
  const s = STATUS_MAP[status];
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${s?.cls}`}>{s?.label || status}</span>;
}

export function Card({ children, className = "", ...p }) {
  return <div className={`bg-white rounded-xl border border-gray-100 shadow-sm ${className}`} {...p}>{children}</div>;
}

export function StatCard({ label, value, sub, icon: I, color = "#6c5ce7" }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-gray-500 mb-1">{label}</div>
          <div className="text-xl font-bold text-gray-800">{value}</div>
          {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
        </div>
        <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: color + "15" }}>
          <I size={18} style={{ color }} />
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

export function LoadingScreen() {
  return (
    <div className="flex items-center justify-center h-screen" style={{ background: "#f5f4f7" }}>
      <div className="text-center">
        <div className="w-12 h-12 border-4 border-purple-200 border-t-purple-600 rounded-full animate-spin mx-auto mb-4" />
        <div className="text-gray-500 text-sm">加载中...</div>
      </div>
    </div>
  );
}
