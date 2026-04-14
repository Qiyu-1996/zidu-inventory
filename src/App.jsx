import { useState, useCallback } from 'react';
import { Home, ShoppingBag, ShoppingCart, Users, Package, Truck, TrendingUp, Settings, LogOut, X, Menu } from 'lucide-react';
import { useAuth } from './contexts/AuthContext';
import { useData } from './contexts/DataContext';
import { LoadingScreen } from './components/ui';
import LoginScreen from './pages/LoginScreen';
import Dashboard from './pages/Dashboard';
import { ShopCatalog, Checkout, CustomerCreate } from './pages/Shop';
import { OrderList, OrderDetail } from './pages/Orders';
import { CustomerList, CustomerDetail } from './pages/Customers';
import Inventory from './pages/Inventory';
import ShippingWorkbench from './pages/Shipping';
import Analytics from './pages/Analytics';
import SettingsPage from './pages/Settings';

export default function App() {
  const { user, logout } = useAuth();
  const { loading, addCustomer, addOrder } = useData();

  const [page, setPage] = useState("dashboard");
  const [subView, setSubView] = useState(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [cart, setCart] = useState([]);

  const nav = useCallback((p, sub) => { setPage(p); setSubView(sub ?? null); setSideOpen(false); }, []);

  // Cart operations
  const addToCart = useCallback((product, specObj, qty = 1) => {
    const key = `${product.id}-${specObj.id}`;
    setCart(prev => {
      const e = prev.find(c => c.key === key);
      if (e) return prev.map(c => c.key === key ? { ...c, quantity: c.quantity + qty } : c);
      return [...prev, { key, productId: product.id, specId: specObj.id, spec: specObj.spec, quantity: qty, unitPrice: specObj.price, productName: product.name, productCode: product.code }];
    });
  }, []);
  const updateCartQty = useCallback((key, qty) => { if (qty <= 0) setCart(p => p.filter(c => c.key !== key)); else setCart(p => p.map(c => c.key === key ? { ...c, quantity: qty } : c)); }, []);
  const removeFromCart = useCallback(key => setCart(p => p.filter(c => c.key !== key)), []);

  if (!user) return <LoginScreen />;
  if (loading) return <LoadingScreen />;

  const menuItems = [
    { key: "dashboard", icon: Home, label: "工作台" },
    ...(user.role === "SALES" ? [{ key: "shop", icon: ShoppingBag, label: "产品下单", badge: cart.length || null }] : []),
    { key: "orders", icon: ShoppingCart, label: "订单管理" },
    ...(user.role !== "WAREHOUSE" ? [{ key: "customers", icon: Users, label: "客户管理" }] : []),
    { key: "inventory", icon: Package, label: "库存查看" },
    ...(user.role === "WAREHOUSE" ? [{ key: "shipping", icon: Truck, label: "发货管理" }] : []),
    ...(user.role !== "WAREHOUSE" ? [{ key: "analytics", icon: TrendingUp, label: "数据分析" }] : []),
    ...(user.role === "ADMIN" ? [{ key: "settings", icon: Settings, label: "系统管理" }] : []),
  ];

  const handlePlaceOrder = async (order) => {
    await addOrder(order);
    setCart([]);
    nav("orders");
  };

  const handleNewCustomerFromShop = async (customer) => {
    await addCustomer(customer);
    setSubView("checkout");
  };

  const handleNewCustomerFromList = async (customer) => {
    await addCustomer(customer);
    nav("customers");
  };

  return (
    <div className="flex h-screen" style={{ fontFamily: "'Noto Sans SC',-apple-system,sans-serif", background: "#f5f4f7" }}>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-56 shrink-0" style={{ background: "#1e1a2e" }}>
        <div className="p-4 border-b border-white/10">
          <div className="text-lg font-bold text-white tracking-wide">紫都 <span className="text-purple-300 text-sm font-normal">ZBP</span></div>
          <div className="text-xs text-purple-300/60 mt-0.5">业务管理平台</div>
        </div>
        <nav className="flex-1 py-2 overflow-y-auto">
          {menuItems.map(m => (
            <button key={m.key} onClick={() => nav(m.key)} className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-all ${page === m.key ? "bg-purple-500/20 text-white border-r-2 border-purple-400" : "text-purple-200/70 hover:bg-white/5 hover:text-white"}`}>
              <m.icon size={18} />{m.label}
              {m.badge && <span className="ml-auto bg-purple-500 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">{m.badge}</span>}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white" style={{ background: "#6c5ce7" }}>{user.name[0]}</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-white truncate">{user.name}</div>
              <div className="text-xs text-purple-300/50">{{ ADMIN: "管理员", SALES: "销售", WAREHOUSE: "仓库" }[user.role]}</div>
            </div>
            <button onClick={() => { logout(); setCart([]); }} className="text-purple-300/40 hover:text-red-400"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {sideOpen && <div className="md:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setSideOpen(false)} />}
      {sideOpen && (
        <aside className="md:hidden fixed left-0 top-0 bottom-0 z-50 w-64 flex flex-col" style={{ background: "#1e1a2e" }}>
          <div className="p-4 border-b border-white/10 flex justify-between">
            <span className="text-lg font-bold text-white">紫都 ZBP</span>
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
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 shrink-0 shadow-sm">
          <button className="md:hidden" onClick={() => setSideOpen(true)}><Menu size={22} className="text-gray-600" /></button>
          <h1 className="text-base font-semibold text-gray-800 flex-1">{menuItems.find(m => m.key === page)?.label || "详情"}</h1>
          {user.role === "SALES" && (
            <button onClick={() => nav("shop")} className="relative p-2 rounded-lg hover:bg-gray-100">
              <ShoppingBag size={18} className="text-gray-500" />
              {cart.length > 0 && <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-purple-600 text-white text-xs rounded-full flex items-center justify-center">{cart.length}</span>}
            </button>
          )}
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {page === "dashboard" && <Dashboard nav={nav} />}
          {page === "shop" && !subView && <ShopCatalog cart={cart} addToCart={addToCart} updateCartQty={updateCartQty} removeFromCart={removeFromCart} onCheckout={() => setSubView("checkout")} />}
          {page === "shop" && subView === "checkout" && <Checkout cart={cart} onBack={() => setSubView(null)} onPlaceOrder={handlePlaceOrder} onNewCustomer={() => setSubView("newcust")} />}
          {page === "shop" && subView === "newcust" && <CustomerCreate onSave={handleNewCustomerFromShop} onCancel={() => setSubView("checkout")} />}
          {page === "orders" && !subView && <OrderList nav={nav} />}
          {page === "orderDetail" && <OrderDetail orderId={subView} onBack={() => nav("orders")} />}
          {page === "customers" && !subView && <CustomerList nav={nav} onNew={() => setSubView("newcust")} />}
          {page === "customers" && subView === "newcust" && <CustomerCreate onSave={handleNewCustomerFromList} onCancel={() => setSubView(null)} />}
          {page === "customerDetail" && <CustomerDetail customerId={subView} onBack={() => nav("customers")} />}
          {page === "inventory" && <Inventory />}
          {page === "shipping" && <ShippingWorkbench />}
          {page === "analytics" && <Analytics />}
          {page === "settings" && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}
