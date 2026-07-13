import { useState, useCallback, useEffect, useMemo } from 'react';
import { Home, ShoppingBag, ShoppingCart, Users, Package, Truck, TrendingUp, Settings, LogOut, X, Menu, ClipboardList, ClipboardCheck, Wallet, RefreshCw } from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import { useData } from './contexts/DataContext';
import { LoadingScreen, unitPriceHint } from './components/ui';
import LoginScreen from './pages/LoginScreen';
import Dashboard from './pages/Dashboard';
import { ShopCatalog, Checkout, CustomOrder, CustomerCreate } from './pages/Shop';
import { OrderList, OrderDetail } from './pages/Orders';
import { CustomerList, CustomerDetail } from './pages/Customers';
import Inventory from './pages/Inventory';
import ShippingWorkbench from './pages/Shipping';
import Analytics from './pages/Analytics';
import SettingsPage from './pages/Settings';
import { PurchaseOrderList, PurchaseOrderCreate, PurchaseOrderDetail } from './pages/PurchaseOrders';
import Tasks from './pages/Tasks';
import Finance from './pages/Finance';
import ziduLogo from './assets/zidu-logo.png';

const ROLE_LABEL = { ADMIN: "管理员", SALES: "销售", WAREHOUSE: "仓库", FINANCE: "财务" };
const PAGE_TITLE = {
  dashboard: '工作台', shop: '销售下单', orders: '订单管理', orderDetail: '订单详情',
  customers: '客户管理', customerDetail: '客户详情', tasks: '跟进任务', inventory: '库存管理',
  purchase: '采购管理', purchaseCreate: '新建采购单', purchaseEdit: '编辑采购单', purchaseDetail: '采购单详情',
  shipping: '发货管理', analytics: '数据分析', finance: '财务报表', settings: '系统管理'
};

export default function App() {
  const { user, logout } = useAuth();
  const { loading, addCustomer, addOrder, orders, purchaseOrders, reload } = useData();

  const [page, setPage] = useState("dashboard");
  const [subView, setSubView] = useState(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [cart, setCart] = useState([]);
  const [checkoutCustomerId, setCheckoutCustomerId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // 每 30 秒自动刷新订单检查新订单
  useEffect(() => {
    if (!user) return;
    const t = setInterval(() => { reload(); }, 30000);
    return () => clearInterval(t);
  }, [user, reload]);

  // 当进入订单/发货页时，标记已读
  useEffect(() => {
    if (!user || !orders?.length) return;
    if (page === 'orders' || page === 'shipping') {
      const maxId = Math.max(...orders.map(o => o.id));
      try { localStorage.setItem('zidu_last_seen_order_id', String(maxId)); } catch { /* ignore localStorage errors */ }
    }
  }, [page, orders, user]);

  // 未完成订单数（未取消 && 未签收 && 未完成）
  const unreadOrders = useMemo(() => {
    if (!orders?.length || !user) return 0;
    const PENDING = ['DRAFT','SUBMITTED','CONFIRMED','PREPARING','SHIPPED'];
    let list = orders.filter(o => PENDING.includes(o.status));
    if (user.role === 'SALES') list = list.filter(o => o.salesId === user.id);
    if (user.role === 'WAREHOUSE') list = list.filter(o => ['CONFIRMED','PREPARING'].includes(o.status));
    return list.length;
  }, [orders, user]);

  const nav = useCallback((p, sub) => { setPage(p); setSubView(sub ?? null); setSideOpen(false); }, []);
  const refreshNow = async () => {
    setRefreshing(true);
    try { await reload(); } finally { setRefreshing(false); }
  };

  // Cart operations
  const addToCart = useCallback((product, specObj, qty = 1, catalogMode = null) => {
    const key = `${product.id}-${specObj.id}`;
    setCart(prev => {
      const e = prev.find(c => c.key === key);
      if (e) return prev.map(c => c.key === key ? { ...c, quantity: Math.min(c.quantity + qty, Number(c.availableStock || c.quantity + qty)) } : c);
      const channel = product.channel === 'BOTH' && catalogMode ? catalogMode : (product.channel || catalogMode || 'FINISHED');
      return [...prev, { key, productId: product.id, specId: specObj.id, spec: specObj.spec, quantity: qty, unitPrice: specObj.price, unitPriceHint: unitPriceHint(specObj.spec, specObj.price), unitCost: specObj.cost || 0, productName: product.name, productCode: product.code, channel, availableStock: Number(specObj.stock || 0) }];
    });
  }, []);
  const updateCartQty = useCallback((key, qty) => {
    const next = Math.max(0, Math.floor(Number(qty) || 0));
    if (next <= 0) setCart(p => p.filter(c => c.key !== key));
    else setCart(p => p.map(c => c.key === key ? { ...c, quantity: Math.min(next, Number(c.availableStock || next)) } : c));
  }, []);
  const removeFromCart = useCallback(key => setCart(p => p.filter(c => c.key !== key)), []);

  if (!user) return <LoginScreen />;
  if (loading) return <LoadingScreen />;

  const isFinance = user.role === "FINANCE";
  const canOrder = user.role === "ADMIN" || user.role === "SALES";
  const canShip = ['ADMIN', 'SALES', 'WAREHOUSE'].includes(user.role);
  const menuItems = isFinance ? [
    // 财务：只看订单 + 收款流水
    { key: "dashboard", icon: Home, label: "工作台" },
    { key: "orders", icon: ShoppingCart, label: "订单查看", badge: unreadOrders || null },
    { key: "finance", icon: Wallet, label: "财务报表" },
  ] : [
    { key: "dashboard", icon: Home, label: "工作台" },
    ...(canOrder ? [{ key: "shop", icon: ShoppingBag, label: "销售下单", badge: cart.length || null }] : []),
    { key: "orders", icon: ShoppingCart, label: "订单管理", badge: unreadOrders || null },
    ...(user.role !== "WAREHOUSE" ? [{ key: "customers", icon: Users, label: "客户管理" }] : []),
    ...(user.role !== "WAREHOUSE" ? [{ key: "tasks", icon: ClipboardCheck, label: "跟进任务" }] : []),
    { key: "inventory", icon: Package, label: "库存查看" },
    ...(user.role === "ADMIN" || user.role === "WAREHOUSE" ? [{ key: "purchase", icon: ClipboardList, label: "采购管理" }] : []),
    ...(canShip ? [{ key: "shipping", icon: Truck, label: "发货管理", badge: unreadOrders || null }] : []),
    ...(user.role !== "WAREHOUSE" ? [{ key: "analytics", icon: TrendingUp, label: "数据分析" }] : []),
    ...(user.role === "ADMIN" ? [{ key: "finance", icon: Wallet, label: "财务报表" }] : []),
    ...(user.role === "ADMIN" ? [{ key: "settings", icon: Settings, label: "系统管理" }] : []),
  ];

  const handlePlaceOrder = async (order) => {
    await addOrder(order);
    setCart([]);
    setCheckoutCustomerId(null);
    nav("orders");
  };

  const handlePlaceCustomOrder = async (order) => {
    await addOrder(order);
    nav("orders");
  };

  const handleNewCustomerFromShop = async (customer) => {
    const created = await addCustomer(customer);
    setCheckoutCustomerId(created.id);
    setSubView("checkout");
  };

  const handleNewCustomerFromList = async (customer) => {
    await addCustomer(customer);
    nav("customers");
  };

  return (
    <div className="zidu-shell flex h-screen">
      {/* Desktop sidebar */}
      <aside className="zidu-sidebar hidden md:flex flex-col w-60 shrink-0">
        <div className="px-5 py-5 border-b border-white/10">
          <img src={ziduLogo} alt="紫都 ZIDU" style={{ height: 25, filter: 'brightness(0) invert(1)', opacity: 0.96 }} />
          <div className="text-[11px] text-purple-300/55 mt-2">销售 · 客户 · 库存管理</div>
        </div>
        <nav className="flex-1 py-3 overflow-y-auto">
          {menuItems.map(m => (
            <button key={m.key} onClick={() => nav(m.key)} className={`zidu-nav-item ${page === m.key ? 'active' : ''} flex items-center gap-3 text-sm`}>
              <m.icon size={18} />{m.label}
              {m.badge && <span className="ml-auto bg-purple-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">{m.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#5C4B73" }}>{user.name[0]}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white truncate">{user.name}</div>
              <div className="text-xs text-purple-300/50">{ROLE_LABEL[user.role] || user.role}</div>
            </div>
            <button onClick={() => { logout(); setCart([]); }} className="text-purple-300/40 hover:text-red-400"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {sideOpen && <div className="md:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setSideOpen(false)} />}
      {sideOpen && (
        <aside className="zidu-sidebar md:hidden fixed left-0 top-0 bottom-0 z-50 w-64 flex flex-col">
          <div className="p-4 border-b border-white/10 flex justify-between items-center">
            <img src={ziduLogo} alt="紫都 ZIDU" style={{ height: 24, filter: 'brightness(0) invert(1)', opacity: 0.95 }} />
            <button onClick={() => setSideOpen(false)} className="text-white"><X size={20} /></button>
          </div>
          <nav className="flex-1 py-2">
            {menuItems.map(m => (
              <button key={m.key} onClick={() => nav(m.key)} className={`w-full flex items-center gap-3 px-4 py-3 text-sm ${page === m.key ? "bg-purple-500/20 text-white" : "text-purple-200/70"}`}>
                <m.icon size={18} />{m.label}
              </button>
            ))}
          </nav>
          <button onClick={() => { logout(); setCart([]); }} className="m-3 p-2 text-sm text-red-300 border border-red-300/30 rounded">退出登录</button>
        </aside>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="zidu-topbar px-6 flex items-center gap-3 shrink-0">
          <button className="md:hidden" onClick={() => setSideOpen(true)}><Menu size={22} className="text-gray-600" /></button>
          <div className="flex-1 min-w-0">
            <div className="zidu-eyebrow hidden sm:block">ZIDU BUSINESS</div>
            <h1 className="zidu-page-title truncate">{PAGE_TITLE[page] || menuItems.find(m => m.key === page)?.label || '详情'}</h1>
          </div>
          <div className="hidden lg:block text-xs text-gray-400">{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}</div>
          <button onClick={refreshNow} disabled={refreshing} className="zidu-icon-button" title="刷新云端数据"><RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} /></button>
          <div className="text-sm text-gray-500 hidden sm:flex items-center gap-2 pl-2 border-l border-gray-200">
            <span>{user.name}</span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-700">{ROLE_LABEL[user.role] || user.role}</span>
          </div>
          {canOrder && (
            <button onClick={() => nav("shop")} className="relative p-2 rounded-lg hover:bg-gray-100">
              <ShoppingBag size={18} className="text-gray-500" />
              {cart.length > 0 && <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-purple-600 text-white text-xs rounded-full flex items-center justify-center">{cart.length}</span>}
            </button>
          )}
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6"><div className="zidu-page">
          {page === "dashboard" && <Dashboard nav={nav} />}
          {page === "shop" && !subView && <ShopCatalog cart={cart} addToCart={addToCart} updateCartQty={updateCartQty} removeFromCart={removeFromCart} onCheckout={() => { setCheckoutCustomerId(null); setSubView("checkout"); }} onCustom={() => setSubView("custom")} />}
          {page === "shop" && subView === "checkout" && <Checkout cart={cart} removeFromCart={removeFromCart} initialCustomerId={checkoutCustomerId} onBack={() => setSubView(null)} onPlaceOrder={handlePlaceOrder} onNewCustomer={() => setSubView("newcust")} />}
          {page === "shop" && subView === "custom" && <CustomOrder onBack={() => setSubView(null)} onPlaceOrder={handlePlaceCustomOrder} />}
          {page === "shop" && subView === "newcust" && <CustomerCreate onSave={handleNewCustomerFromShop} onCancel={() => setSubView("checkout")} />}
          {page === "orders" && !subView && <OrderList nav={nav} />}
          {page === "orderDetail" && <OrderDetail orderId={subView} onBack={() => nav("orders")} onShipping={() => nav("shipping")} />}
          {page === "customers" && !subView && <CustomerList nav={nav} onNew={(dealerMode) => setSubView(dealerMode ? "newdealer" : "newcust")} />}
          {page === "customers" && (subView === "newcust" || subView === "newdealer") && <CustomerCreate dealerMode={subView === "newdealer"} onSave={handleNewCustomerFromList} onCancel={() => setSubView(null)} />}
          {page === "customerDetail" && <CustomerDetail customerId={subView} onBack={() => nav("customers")} />}
          {page === "tasks" && <Tasks />}
          {page === "inventory" && <Inventory nav={nav} />}
          {page === "purchase" && !subView && <PurchaseOrderList nav={nav} />}
          {page === "purchaseCreate" && <PurchaseOrderCreate onBack={() => nav('purchase')} />}
          {page === "purchaseEdit" && <PurchaseOrderCreate editPo={purchaseOrders.find(po => po.id === subView)} onBack={() => nav('purchaseDetail', subView)} />}
          {page === "purchaseDetail" && <PurchaseOrderDetail poId={subView} onBack={() => nav('purchase')} onEdit={() => nav('purchaseEdit', subView)} />}
          {page === "shipping" && canShip && <ShippingWorkbench />}
          {page === "analytics" && <Analytics />}
          {page === "finance" && <Finance />}
          {page === "settings" && <SettingsPage />}
        </div></main>
      </div>
    </div>
  );
}
