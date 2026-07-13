import { useState, useMemo, useEffect } from 'react';
import { Search, Plus, Minus, X, ShoppingCart, ArrowLeft, Package, FlaskConical, Sparkles, Trash2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, fmtY, PRODUCT_CATEGORY_OPTIONS, matchesProductCategory, CUSTOMER_TYPES, PROVINCES, DISTRIBUTOR_LEVELS, distributorDiscount, distributorLabel, distributorPriceLabel, unitPriceHint } from '../components/ui';
import { createOrderNo, detectSourceFromCart, localDateKey, localMinuteKey } from '../lib/orderNo';
import * as api from '../lib/api';

// ═══ SHOP CATALOG ═══
function channelLabel(channel) {
  return channel === 'RAW' ? '原料' : '成品';
}

export function ShopCatalog({ cart, addToCart, updateCartQty, removeFromCart, onCheckout, onCustom }) {
  const { products } = useData();
  const [search, setSearch] = useState('');
  const [sf, setSf] = useState('ALL');
  const [catalogMode, setCatalogMode] = useState('FINISHED');
  const [showCart, setShowCart] = useState(false);

  const filtered = products.filter(p => {
    const channel = p.channel || 'BOTH';
    if (channel !== 'BOTH' && channel !== catalogMode) return false;
    if (!matchesProductCategory(p.series, sf)) return false;
    if (search && !`${p.code} ${p.name}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const cartTotal = cart.reduce((s, c) => s + c.unitPrice * c.quantity, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between">
        <div className="flex gap-2 items-center flex-wrap min-w-0">
          <div className="zidu-segment" aria-label="下单商品类型">
            <button type="button" onClick={() => { setCatalogMode('FINISHED'); setSf('ALL'); }} className={catalogMode === 'FINISHED' ? 'active' : ''}><Package size={14} className="inline mr-1" />成品</button>
            <button type="button" onClick={() => { setCatalogMode('RAW'); setSf('ALL'); }} className={catalogMode === 'RAW' ? 'active' : ''}><FlaskConical size={14} className="inline mr-1" />原料</button>
          </div>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
            <input placeholder="搜索产品名 / 编号" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 pr-3 py-2 text-sm border rounded-lg w-56 max-w-full" />
          </div>
          <select value={sf} onChange={e => setSf(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white">
            {PRODUCT_CATEGORY_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>
        <div className="flex gap-2 items-center shrink-0">
          {catalogMode === 'RAW' && <button onClick={onCustom} className="h-9 px-3 rounded-lg border border-purple-200 bg-white text-purple-700 text-sm inline-flex items-center gap-1.5"><Sparkles size={15} />定制业务</button>}
          {cart.length > 0 && (
            <button onClick={() => setShowCart(!showCart)} className="btn-primary !h-9 !py-0 text-sm">
              <ShoppingCart size={16} />购物车 ({cart.reduce((sum, item) => sum + item.quantity, 0)}) · {fmtY(cartTotal)}
            </button>
          )}
        </div>
      </div>

      {/* Cart panel */}
      {showCart && cart.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-gray-700">购物车</div>
            <button onClick={() => setShowCart(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          <div className="space-y-2">
            {cart.map(c => (
              <div key={c.key} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 py-2 border-b last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2"><span className="text-sm text-gray-800 truncate">{c.productName}</span><span className={`text-[10px] px-1.5 py-0.5 rounded ${c.channel === 'RAW' ? 'bg-green-50 text-green-700' : 'bg-purple-50 text-purple-700'}`}>{channelLabel(c.channel)}</span></div>
                  <div className="text-xs text-gray-400">{c.productCode} · {c.spec} · {fmtY(c.unitPrice)}{(c.unitPriceHint || unitPriceHint(c.spec, c.unitPrice)) && <span className="ml-1 text-amber-700 font-medium">{c.unitPriceHint || unitPriceHint(c.spec, c.unitPrice)}</span>}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => updateCartQty(c.key, c.quantity - 1)} title="减少" className="zidu-icon-button !w-8 !h-8"><Minus size={13} /></button>
                  <input type="number" min="1" max={c.availableStock || undefined} value={c.quantity} onFocus={e => e.target.select()} onChange={e => updateCartQty(c.key, e.target.value)} aria-label={`${c.productName}数量`} className="w-16 h-8 border rounded-lg px-2 text-center text-sm tabular-nums" />
                  <button onClick={() => updateCartQty(c.key, c.quantity + 1)} disabled={c.availableStock > 0 && c.quantity >= c.availableStock} title="增加" className="zidu-icon-button !w-8 !h-8"><Plus size={13} /></button>
                  <button onClick={() => removeFromCart(c.key)} title="移出购物车" className="zidu-icon-button !w-8 !h-8 text-gray-400 hover:text-red-500"><Trash2 size={13} /></button>
                </div>
                <div className="text-sm font-medium w-24 text-right" style={{ color: "#5C4B73" }}>{fmtY(c.unitPrice * c.quantity)}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between mt-4 pt-3 border-t">
            <div className="text-sm text-gray-500">共 {cart.reduce((s, c) => s + c.quantity, 0)} 件</div>
            <button onClick={onCheckout} className="px-6 py-2.5 text-white text-sm font-medium rounded-lg shadow" style={{ background: "#5C4B73" }}>
              去结算 {fmtY(cartTotal)}
            </button>
          </div>
        </Card>
      )}

      {/* Product grid */}
      <div className="flex items-center justify-between"><div className="text-sm text-gray-600">{catalogMode === 'RAW' ? '原料' : '成品'} · {filtered.length} 项</div><div className="text-xs text-gray-400">库存与价格来自云端</div></div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map(p => (
          <Card key={p.id} className="p-4">
            <div className="mb-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-gray-800 text-sm">{p.name}</div>
                  <div className="text-xs text-gray-400">{p.code} · {p.origin}</div>
                </div>
                {catalogMode === 'RAW' && (
                  <div className="text-right shrink-0 text-green-700">
                    <div className="text-sm font-medium tabular-nums">{Number(p.baseStockKg || 0).toFixed(3)} kg</div>
                    <div className="text-[10px]">原料余量</div>
                  </div>
                )}
              </div>
              <span className="text-xs px-2 py-0.5 rounded bg-purple-50 text-purple-600 mt-1 inline-block">{p.series}</span>
            </div>
            <div className="space-y-1.5 mt-3">
              {p.specs.map(s => {
                const inCart = cart.find(c => c.key === `${p.id}-${s.id}`);
                return (
                  <div key={s.id} className="flex items-center justify-between text-sm py-1">
                    <div>
                      <span className="text-gray-700">{s.spec}</span>
                      <span className="text-gray-400 mx-1">·</span>
                      <span className="font-medium" style={{ color: "#5C4B73" }}>{fmtY(s.price)}</span>
                      {unitPriceHint(s.spec, s.price) && <span className="text-amber-700 text-xs ml-1 font-medium">{unitPriceHint(s.spec, s.price)}</span>}
                      {catalogMode !== 'RAW' && s.stock <= s.safeStock && <span className="text-red-500 text-xs ml-1">库存 {s.stock} 瓶 / 个</span>}
                    </div>
                    {inCart ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => updateCartQty(inCart.key, inCart.quantity - 1)} className="zidu-icon-button !w-7 !h-7"><Minus size={12} /></button>
                        <input type="number" min="1" max={s.stock || undefined} value={inCart.quantity} onFocus={e => e.target.select()} onChange={e => updateCartQty(inCart.key, e.target.value)} aria-label={`${p.name} ${s.spec}数量`} className="w-12 h-7 border rounded-md text-center text-xs tabular-nums" />
                        <button onClick={() => updateCartQty(inCart.key, inCart.quantity + 1)} disabled={inCart.quantity >= Number(s.stock || 0)} className="zidu-icon-button !w-7 !h-7"><Plus size={12} /></button>
                      </div>
                    ) : (
                      <button disabled={Number(s.stock || 0) <= 0 || (catalogMode === 'RAW' && Number(p.baseStockKg || 0) <= 0)} onClick={() => addToCart(p, s, 1, catalogMode)} className="text-xs px-2.5 py-1 rounded-lg border border-purple-200 text-purple-700 hover:bg-purple-50 disabled:border-gray-200 disabled:text-gray-400 disabled:bg-gray-50">
                        {Number(s.stock || 0) <= 0 || (catalogMode === 'RAW' && Number(p.baseStockKg || 0) <= 0) ? '缺货' : <><Plus size={12} className="inline -mt-0.5" /> 加购</>}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
        {filtered.length === 0 && <div className="col-span-full text-center py-12 text-gray-400">暂无产品</div>}
      </div>
    </div>
  );
}

// ═══ CHECKOUT ═══
const BIZ_TYPES = ['院线', '芳疗师', '其他'];

export function Checkout({ cart, initialCustomerId = null, onBack, onPlaceOrder, onNewCustomer }) {
  const { user } = useAuth();
  const { customers, orders, users, configOptions, addCustomer } = useData();
  const myCustomers = user.role === "ADMIN" ? customers : customers.filter(c => c.salesId === user.id);

  const [customerId, setCustomerId] = useState(initialCustomerId ? String(initialCustomerId) : '');
  const [businessType, setBusinessType] = useState('院线');
  const [discount, setDiscount] = useState('');
  const [shippingFee, setShippingFee] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [creatingPreset, setCreatingPreset] = useState(false);
  const [custSearch, setCustSearch] = useState('');
  const [showCustList, setShowCustList] = useState(!initialCustomerId);
  const [customerMode, setCustomerMode] = useState('ALL');
  const [maxDiscount, setMaxDiscount] = useState(20);
  const [orderSalesId, setOrderSalesId] = useState(user.role === 'ADMIN' ? String(user.id) : String(user.id));

  // 销售折扣上限（管理员在 基础设置 配置；管理员本人不限）
  useEffect(() => {
    if (user.role === 'ADMIN') return;
    api.fetchAppSettings().then(s => {
      const m = Number(s.max_discount_percent);
      if (!isNaN(m) && m >= 0) setMaxDiscount(m);
    }).catch(() => {});
  }, [user.role]);

  // 最近使用的客户（取最近5个下过单的客户）
  const recentCustomerIds = useMemo(() => {
    const seen = new Set(); const result = [];
    const myOrders = orders.filter(o => user.role === 'ADMIN' || o.salesId === user.id);
    myOrders.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).forEach(o => {
      if (!seen.has(o.customerId)) { seen.add(o.customerId); result.push(o.customerId); }
    });
    return result.slice(0, 5);
  }, [orders, user]);

  const selectedCustomer = customers.find(c => c.id === Number(customerId));
  const dealerCustomers = myCustomers.filter(c => Number(c.distributorLevel) > 0);
  const customerPool = customerMode === 'DEALER' ? dealerCustomers : myCustomers;
  const filteredCustomers = custSearch
    ? customerPool.filter(c => `${c.name} ${c.contact || ''} ${c.phone || ''} ${c.type}`.toLowerCase().includes(custSearch.toLowerCase()))
    : customerPool;
  const recentCustomers = recentCustomerIds.map(id => customerPool.find(c => c.id === id)).filter(Boolean);
  const dealerDiscount = distributorDiscount(selectedCustomer?.distributorLevel);
  const effectiveDiscount = dealerDiscount || Number(discount) || 0;
  const businessTypes = configOptions.filter(option => option.category === 'BUSINESS_TYPE').map(option => option.value);
  const availableBusinessTypes = businessTypes.length ? businessTypes : BIZ_TYPES;
  const orderOwners = [
    { id: user.id, name: `${user.name}（管理员）` },
    ...users.filter(u => u.role === 'SALES' && u.status === 'active' && u.id !== user.id).map(u => ({ id: u.id, name: u.name }))
  ];

  useEffect(() => {
    if (user.role === 'ADMIN' && selectedCustomer?.salesId) setOrderSalesId(String(selectedCustomer.salesId));
  }, [selectedCustomer?.salesId, user.role]);

  const onSelectCustomer = (id) => {
    const customer = myCustomers.find(c => c.id === Number(id));
    setCustomerId(id);
    setDiscount(distributorDiscount(customer?.distributorLevel) || '');
    if (user.role === 'ADMIN' && customer?.salesId) setOrderSalesId(String(customer.salesId));
    setShowCustList(false);
    setCustSearch('');
  };

  const changeCustomerMode = (mode) => {
    if (mode === customerMode) return;
    setCustomerMode(mode);
    setCustomerId('');
    setCustSearch('');
    setShowCustList(true);
    setDiscount('');
  };

  const quickPickPreset = async (label) => {
    let preset = customers.find(c => c.name === label);
    if (!preset) {
      if (creatingPreset) return;
      setCreatingPreset(true);
      try {
        preset = await addCustomer({ name: label, contact: '', phone: '', address: `${label}现场`, type: label, salesId: null });
      } catch (e) {
        alert('创建现场客户失败: ' + e.message);
        return;
      } finally {
        setCreatingPreset(false);
      }
    }
    setCustomerId(String(preset.id));
    setDiscount('');
    setShowCustList(false);
    setCustSearch('');
  };

  const handleShippingFeeChange = (value) => {
    if (value === '') {
      setShippingFee('');
      return;
    }
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    setShippingFee(n < 0 ? '0' : value);
  };

  const subtotal = cart.reduce((s, c) => s + c.unitPrice * c.quantity, 0);
  const discountAmount = Math.round(subtotal * effectiveDiscount / 100);
  const shippingValue = Number(shippingFee);
  const shippingAmount = Number.isFinite(shippingValue)
    ? Math.max(0, Math.round((shippingValue + Number.EPSILON) * 100) / 100)
    : 0;
  const total = subtotal - discountAmount + shippingAmount;

  const handlePlace = async () => {
		    if (!customerId || cart.length === 0 || !orderSalesId || submitting) return;
	    setSubmitting(true);
	    try {
	      const now = new Date();
	      const productSource = detectSourceFromCart(cart, 'FINISHED');
	      const orderNo = createOrderNo({
	        source: productSource,
	        customer: selectedCustomer,
	        now
	      });
	      await onPlaceOrder({
	        orderNo,
        customerId: Number(customerId),
	        salesId: Number(orderSalesId),
		        source: 'web_admin',
		        channelMeta: { productSource, shippingFee: shippingAmount, enteredBy: { id: user.id, name: user.name, role: user.role } },
        businessType,
        status: "SUBMITTED",
        subtotal,
        discountPercent: effectiveDiscount,
        discountAmount,
        total,
        notes,
	        createdAt: localDateKey(now),
        items: cart.map(c => ({
          productId: c.productId,
          specId: c.specId,
          productName: c.productName,
          productCode: c.productCode,
          spec: c.spec,
          quantity: c.quantity,
          unitPrice: c.unitPrice,
          unitCost: c.unitCost || 0,
          subtotal: c.unitPrice * c.quantity
        })),
	        logs: [{ time: localMinuteKey(now), user: user.name, action: "创建订单并提交" }]
	      });
    } catch (e) {
      alert('下单失败: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft size={16} />返回购物车
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
      <div className="space-y-4 min-w-0">
      <Card className="p-4">
        <div className="text-sm font-semibold text-gray-700 mb-3">订单商品 ({cart.length})</div>
        <div className="space-y-2">
          {cart.map(c => (
            <div key={c.key} className="flex justify-between gap-3 text-sm py-2 border-b last:border-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap"><span className="text-gray-800">{c.productName}</span><span className={`text-[10px] px-1.5 py-0.5 rounded ${c.channel === 'RAW' ? 'bg-green-50 text-green-700' : 'bg-purple-50 text-purple-700'}`}>{channelLabel(c.channel)}</span></div>
                <span className="text-gray-400 text-xs">{c.productCode} · {c.spec} · {fmtY(c.unitPrice)} × {c.quantity}</span>
                {(c.unitPriceHint || unitPriceHint(c.spec, c.unitPrice)) && <span className="text-amber-700 text-xs ml-1 font-medium">{c.unitPriceHint || unitPriceHint(c.spec, c.unitPrice)}</span>}
              </div>
              <span className="font-medium shrink-0" style={{ color: "#5C4B73" }}>{fmtY(c.unitPrice * c.quantity)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <label className="block text-xs text-gray-500">选择客户 * <span className="text-gray-400">(共 {customerPool.length} 位)</span></label>
            <div className="zidu-segment">
              <button type="button" onClick={() => changeCustomerMode('ALL')} className={`px-3 py-1.5 text-xs rounded-md ${customerMode === 'ALL' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500'}`}>全部客户</button>
              <button type="button" onClick={() => changeCustomerMode('DEALER')} className={`px-3 py-1.5 text-xs rounded-md ${customerMode === 'DEALER' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500'}`}>经销商 {dealerCustomers.length}</button>
            </div>
          </div>
          {customerMode === 'ALL' && !selectedCustomer && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs text-gray-400">现场客户</span>
              <button type="button" onClick={() => quickPickPreset('展会')} disabled={creatingPreset} className="h-8 px-3 text-xs rounded-md border border-[#E4DBCD] bg-[#FBF8F2] text-gray-700">展会</button>
              <button type="button" onClick={() => quickPickPreset('线下')} disabled={creatingPreset} className="h-8 px-3 text-xs rounded-md border border-[#E4DBCD] bg-[#FBF8F2] text-gray-700">线下</button>
            </div>
          )}
          {!showCustList && selectedCustomer ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 border rounded-lg px-3 py-2.5 text-sm bg-purple-50 border-purple-200 flex items-center justify-between">
                <div className="min-w-0">
                  <div><span className="font-medium">{selectedCustomer.name}</span><span className="text-xs text-gray-500 ml-2">{selectedCustomer.type}</span>{dealerDiscount > 0 && <span className="text-xs text-purple-700 ml-2">{distributorLabel(selectedCustomer.distributorLevel)} · {distributorPriceLabel(selectedCustomer.distributorLevel)}</span>}</div>
                  <div className="text-xs text-gray-400 mt-1 truncate">{[selectedCustomer.contact, selectedCustomer.phone, selectedCustomer.address].filter(Boolean).join(' · ') || '未填写联系信息'}</div>
                </div>
                <button onClick={() => { setShowCustList(true); setCustomerId(''); }} className="text-xs text-purple-600 hover:underline">更换</button>
              </div>
              {customerMode === 'ALL' && <button onClick={onNewCustomer} className="px-3 py-2 text-sm border rounded-lg text-purple-700 hover:bg-purple-50 shrink-0">
                <Plus size={14} className="inline -mt-0.5" />新建
              </button>}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search size={14} className="absolute left-3 top-3 text-gray-400" />
                  <input
                    type="text"
                    value={custSearch}
                    onChange={e => { setCustSearch(e.target.value); setShowCustList(true); }}
                    onFocus={() => setShowCustList(true)}
                    placeholder="搜索客户名、联系人、电话、类型..."
                    className="w-full pl-9 pr-3 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
                    autoFocus
                  />
                </div>
                {customerMode === 'ALL' && <button onClick={onNewCustomer} className="px-3 py-2 text-sm border rounded-lg text-purple-700 hover:bg-purple-50 shrink-0">
                  <Plus size={14} className="inline -mt-0.5" />新建
                </button>}
              </div>

              {/* Recent customers */}
              {!custSearch && recentCustomers.length > 0 && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">最近下单</div>
                  <div className="flex flex-wrap gap-1.5">
                    {recentCustomers.map(c => (
                      <button
                        key={c.id}
                        onClick={() => onSelectCustomer(c.id)}
                        className="text-xs px-3 py-1.5 rounded-lg border border-purple-200 text-purple-700 hover:bg-purple-50 transition"
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Customer list */}
              <div className="border rounded-lg max-h-64 overflow-y-auto bg-white">
                {filteredCustomers.length === 0 ? (
                  <div className="text-center py-6 text-sm text-gray-400">没有匹配的客户</div>
                ) : (
                  filteredCustomers.slice(0, 50).map(c => (
                    <div
                      key={c.id}
                      onClick={() => onSelectCustomer(c.id)}
                      className="px-3 py-2.5 border-b last:border-0 hover:bg-purple-50 cursor-pointer text-sm flex items-center justify-between"
                    >
                      <div>
                        <div className="font-medium text-gray-800">{c.name}</div>
                        <div className="text-xs text-gray-400">{c.type} · {c.contact || '无联系人'} {c.phone && `· ${c.phone}`}</div>
                        {Number(c.distributorLevel) > 0 && <div className="text-xs text-purple-600 mt-0.5">{distributorLabel(c.distributorLevel)} · {distributorPriceLabel(c.distributorLevel)}</div>}
                      </div>
                      <span className="text-xs text-purple-600">选择 →</span>
                    </div>
                  ))
                )}
                {filteredCustomers.length > 50 && (
                  <div className="text-center text-xs text-gray-400 py-2 bg-gray-50">还有 {filteredCustomers.length - 50} 位客户，请继续搜索缩小范围</div>
                )}
              </div>
            </div>
          )}
        </div>

        {user.role === 'ADMIN' && (
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">订单归属销售 *</label>
            <select value={orderSalesId} onChange={e => setOrderSalesId(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
              {orderOwners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">业务类型</label>
            <select value={businessType} onChange={e => setBusinessType(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
              {availableBusinessTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
          <label className="block text-xs text-gray-500 mb-1.5">
            {dealerDiscount > 0 ? `经销商折扣（固定 ${distributorPriceLabel(selectedCustomer.distributorLevel)}）` : <>折扣 (%) {user.role !== 'ADMIN' && <span className="text-gray-300">上限 {maxDiscount}%</span>}</>}
          </label>
          <input type="number" min="0" max={user.role === 'ADMIN' ? 100 : maxDiscount} value={dealerDiscount > 0 ? dealerDiscount : discount} disabled={dealerDiscount > 0}
            onFocus={e => { if (!dealerDiscount && Number(discount || 0) === 0) { setDiscount(''); e.target.select(); } }}
            onChange={e => {
              if (e.target.value === '') { setDiscount(''); return; }
              let v = Number(e.target.value) || 0;
              if (user.role !== 'ADMIN' && v > maxDiscount) v = maxDiscount;
              setDiscount(v);
            }}
            placeholder="0"
            className="w-full border rounded-lg px-3 py-2 text-sm disabled:bg-purple-50 disabled:text-purple-700 disabled:border-purple-200" />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1.5">运费</label>
            <div className="relative">
            <span className="absolute left-3 top-2 text-sm text-gray-400">¥</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={shippingFee}
              onChange={e => handleShippingFeeChange(e.target.value)}
              className="w-full border rounded-lg pl-7 pr-3 py-2 text-sm"
              placeholder="选填"
            />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1.5">备注</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="订单备注（可选）" />
        </div>
      </Card>

      </div>
      <div className="lg:sticky lg:top-0">
      <Card className="p-4">
        <div className="text-sm font-medium text-gray-800 mb-3">订单金额</div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">小计</span><span>{fmtY(subtotal)}</span></div>
          {discountAmount > 0 && <div className="flex justify-between text-orange-600"><span>折扣 ({effectiveDiscount}%)</span><span>-{fmtY(discountAmount)}</span></div>}
          {shippingAmount > 0 && <div className="flex justify-between text-green-700"><span>运费</span><span>+{fmtY(shippingAmount)}</span></div>}
          <div className="flex justify-between pt-2 border-t text-base font-bold">
            <span className="text-gray-800">应付</span>
            <span style={{ color: "#5C4B73" }}>{fmtY(total)}</span>
          </div>
        </div>
        <button
          onClick={handlePlace}
          disabled={!customerId || !orderSalesId || cart.length === 0 || submitting}
          className="btn-primary w-full mt-4 text-sm"
        >
          {submitting ? '提交中...' : `提交订单 ${fmtY(total)}`}
        </button>
      </Card>
      </div>
      </div>
    </div>
  );
}

function blankCustomItem() {
  return { name: '', quantity: '', specMl: '' };
}

function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

// ═══ CUSTOM ORDER ═══
export function CustomOrder({ onBack, onPlaceOrder }) {
  const { user } = useAuth();
  const { customers, users } = useData();
  const customerPool = user.role === 'ADMIN' ? customers : customers.filter(c => c.salesId === user.id);
  const [customType, setCustomType] = useState('品牌定制');
  const [customerId, setCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showCustomers, setShowCustomers] = useState(true);
  const [items, setItems] = useState([blankCustomItem()]);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [orderSalesId, setOrderSalesId] = useState(String(user.id));

  const selectedCustomer = customers.find(c => c.id === Number(customerId));
  const filteredCustomers = customerSearch
    ? customerPool.filter(c => `${c.name} ${c.contact || ''} ${c.phone || ''}`.toLowerCase().includes(customerSearch.toLowerCase()))
    : customerPool;
  const orderOwners = [
    { id: user.id, name: `${user.name}（管理员）` },
    ...users.filter(u => u.role === 'SALES' && u.status === 'active' && u.id !== user.id).map(u => ({ id: u.id, name: u.name }))
  ];
  const totalQuantity = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  const selectCustomer = (customer) => {
    setCustomerId(String(customer.id));
    setCustomerSearch('');
    setShowCustomers(false);
    if (user.role === 'ADMIN' && customer.salesId) setOrderSalesId(String(customer.salesId));
  };
  const updateItem = (index, field, value) => setItems(current => current.map((item, i) => i === index ? { ...item, [field]: value } : item));
  const removeItem = index => setItems(current => current.length > 1 ? current.filter((_, i) => i !== index) : current);

  const submitCustomOrder = async () => {
    if (!selectedCustomer || !orderSalesId || submitting) return;
    const normalizedItems = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const name = item.name.trim();
      const quantity = Math.floor(Number(item.quantity) || 0);
      const specMl = Number(item.specMl) || 0;
      if (!name && !quantity && !specMl) continue;
      if (!name || quantity <= 0 || specMl <= 0) {
        alert(`请完整填写第 ${i + 1} 行的产品名称、数量和规格`);
        return;
      }
      normalizedItems.push({ name, quantity, quantityUnit: '个/瓶', specMl, spec: `${specMl}ml` });
    }
    const totalAmount = roundMoney(amount);
    if (!normalizedItems.length) { alert('请至少填写一项定制产品'); return; }
    if (totalAmount <= 0) { alert('请填写有效的订单总金额'); return; }

    setSubmitting(true);
    try {
      const now = new Date();
      const productSource = customType === '私人定制' ? 'PRIVATE_CUSTOM' : 'BRAND_CUSTOM';
      const quantitySum = normalizedItems.reduce((sum, item) => sum + item.quantity, 0);
      const baseUnitPrice = roundMoney(totalAmount / quantitySum);
      let allocated = 0;
      const orderItems = normalizedItems.map((item, index) => {
        const subtotal = index === normalizedItems.length - 1 ? roundMoney(totalAmount - allocated) : roundMoney(baseUnitPrice * item.quantity);
        allocated = roundMoney(allocated + subtotal);
        return {
          productId: null,
          specId: null,
          productName: item.name,
          productCode: customType,
          spec: item.spec,
          quantity: item.quantity,
          unitPrice: roundMoney(subtotal / item.quantity),
          unitCost: 0,
          subtotal
        };
      });
      await onPlaceOrder({
        orderNo: createOrderNo({ source: productSource, customer: selectedCustomer, now }),
        customerId: selectedCustomer.id,
        salesId: Number(orderSalesId),
        source: 'web_admin',
        channelMeta: {
          productSource,
          customType,
          customItems: normalizedItems,
          enteredBy: { id: user.id, name: user.name, role: user.role }
        },
        businessType: customType,
        status: 'SUBMITTED',
        subtotal: totalAmount,
        discountPercent: 0,
        discountAmount: 0,
        total: totalAmount,
        notes,
        createdAt: localDateKey(now),
        items: orderItems,
        logs: [{ time: localMinuteKey(now), user: user.name, action: `创建${customType}订单` }]
      });
    } catch (e) {
      alert('提交失败: ' + e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ArrowLeft size={16} />返回商品目录</button>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-4 items-start">
        <Card className="p-5 space-y-5 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <div><div className="text-base font-medium text-gray-800">定制业务下单</div><div className="text-xs text-gray-400 mt-1">填写定制品名称、瓶数、单瓶规格和订单总金额</div></div>
            <Sparkles size={20} className="text-purple-600" />
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1.5">定制类型</label>
            <div className="zidu-segment">
              {['品牌定制', '私人定制'].map(type => <button type="button" key={type} onClick={() => setCustomType(type)} className={customType === type ? 'active' : ''}>{type}</button>)}
            </div>
          </div>

          <div>
            <label className="block text-xs text-gray-500 mb-1.5">客户 *</label>
            {!showCustomers && selectedCustomer ? (
              <div className="border border-purple-200 bg-purple-50 rounded-lg px-3 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0"><div className="text-sm font-medium text-gray-800">{selectedCustomer.name}</div><div className="text-xs text-gray-400 truncate">{[selectedCustomer.type, selectedCustomer.contact, selectedCustomer.phone].filter(Boolean).join(' · ')}</div></div>
                <button type="button" onClick={() => { setShowCustomers(true); setCustomerId(''); }} className="text-xs text-purple-700">更换</button>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="relative"><Search size={14} className="absolute left-3 top-3 text-gray-400" /><input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} placeholder="搜索客户名、联系人或电话" className="w-full border rounded-lg pl-9 pr-3 py-2.5 text-sm" /></div>
                <div className="border rounded-lg max-h-56 overflow-y-auto bg-white">
                  {filteredCustomers.slice(0, 60).map(customer => <button type="button" key={customer.id} onClick={() => selectCustomer(customer)} className="w-full px-3 py-2.5 border-b last:border-0 text-left hover:bg-purple-50 flex items-center justify-between gap-3"><span><span className="block text-sm text-gray-800">{customer.name}</span><span className="block text-xs text-gray-400">{[customer.type, customer.contact, customer.phone].filter(Boolean).join(' · ')}</span></span><span className="text-xs text-purple-700">选择</span></button>)}
                  {filteredCustomers.length === 0 && <div className="text-center py-6 text-sm text-gray-400">没有匹配的客户</div>}
                </div>
              </div>
            )}
          </div>

          {user.role === 'ADMIN' && <div><label className="block text-xs text-gray-500 mb-1.5">订单归属销售 *</label><select value={orderSalesId} onChange={e => setOrderSalesId(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">{orderOwners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select></div>}

          <div>
            <div className="flex items-center justify-between gap-3 mb-2"><label className="text-xs text-gray-500">定制产品 *</label><button type="button" onClick={() => setItems(current => [...current, blankCustomItem()])} className="text-sm text-purple-700 inline-flex items-center gap-1"><Plus size={14} />添加产品</button></div>
            <div className="overflow-x-auto">
              <div className="min-w-[620px]">
                <div className="grid grid-cols-[minmax(220px,1fr)_130px_130px_34px] gap-2 mb-1.5 px-0.5 text-xs text-gray-500"><span>产品名称</span><span>数量（瓶 / 个）</span><span>规格（ml）</span><span /></div>
                {items.map((item, index) => <div key={index} className="grid grid-cols-[minmax(220px,1fr)_130px_130px_34px] gap-2 items-center mb-2"><input value={item.name} onChange={e => updateItem(index, 'name', e.target.value)} placeholder="定制产品名称" className="w-full border rounded-lg px-3 py-2 text-sm" /><input type="number" min="1" step="1" value={item.quantity} onChange={e => updateItem(index, 'quantity', e.target.value)} placeholder="数量" className="w-full border rounded-lg px-3 py-2 text-sm" /><input type="number" min="0.01" step="0.01" value={item.specMl} onChange={e => updateItem(index, 'specMl', e.target.value)} placeholder="ml" className="w-full border rounded-lg px-3 py-2 text-sm" />{items.length > 1 ? <button type="button" onClick={() => removeItem(index)} title="删除此行" className="zidu-icon-button !w-8 !h-8 text-gray-400 hover:text-red-500"><Trash2 size={13} /></button> : <span />}</div>)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-500 mb-1.5">订单总金额（元）*</label><input type="number" min="0.01" step="0.01" value={amount} onFocus={e => e.target.select()} onChange={e => setAmount(e.target.value)} placeholder="请输入总金额" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-gray-500 mb-1.5">备注</label><input value={notes} onChange={e => setNotes(e.target.value)} placeholder="定制要求、交期或报价说明" className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          </div>
        </Card>

        <Card className="p-4 lg:sticky lg:top-0">
          <div className="text-sm font-medium text-gray-800 mb-3">定制单摘要</div>
          <div className="space-y-2.5 text-sm"><div className="flex justify-between"><span className="text-gray-500">类型</span><span>{customType}</span></div><div className="flex justify-between"><span className="text-gray-500">客户</span><span className="max-w-40 truncate">{selectedCustomer?.name || '未选择'}</span></div><div className="flex justify-between"><span className="text-gray-500">产品项</span><span>{items.filter(item => item.name.trim()).length}</span></div><div className="flex justify-between"><span className="text-gray-500">总数量</span><span>{totalQuantity} 瓶 / 个</span></div><div className="flex justify-between pt-3 border-t text-base"><span className="text-gray-800">订单金额</span><span className="font-medium text-purple-700">{fmtY(Number(amount) || 0)}</span></div></div>
          <button type="button" onClick={submitCustomOrder} disabled={!selectedCustomer || !orderSalesId || submitting} className="btn-primary w-full mt-4 text-sm">{submitting ? '提交中...' : '提交定制单'}</button>
        </Card>
      </div>
    </div>
  );
}

// ═══ CUSTOMER CREATE (inline) ═══
export function CustomerCreate({ onSave, onCancel, dealerMode = false }) {
  const { user } = useAuth();
  const { users } = useData();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [type, setType] = useState(CUSTOMER_TYPES[0]);
  const [province, setProvince] = useState('');
  const [distributorLevel, setDistributorLevel] = useState(dealerMode ? 1 : 0);
  const [salesId, setSalesId] = useState(user.role === "SALES" ? user.id : 0);
  const [saving, setSaving] = useState(false);

  const salesList = users.filter(u => u.role === "SALES" && u.status === 'active');

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    if (dealerMode && !salesId) {
      alert('请选择所属销售');
      return;
    }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), contact: contact.trim(), phone: phone.trim(), address: address.trim(), type, province, distributorLevel: distributorLevel || null, salesId: salesId || null });
    } catch (e) {
      alert('保存失败: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <button onClick={onCancel} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft size={16} />返回
      </button>
      <Card className="p-5 space-y-4">
        <div className="text-sm font-semibold text-gray-700">{dealerMode ? '录入经销商' : '新建客户'}</div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs text-gray-500 mb-1">客户名称 *</label><input value={name} onChange={e => setName(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          <div><label className="block text-xs text-gray-500 mb-1">联系人</label><input value={contact} onChange={e => setContact(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs text-gray-500 mb-1">电话</label><input value={phone} onChange={e => setPhone(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
          <div><label className="block text-xs text-gray-500 mb-1">类型</label>
            <select value={type} onChange={e => setType(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
              {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs text-gray-500 mb-1">省份</label>
            <select value={province} onChange={e => setProvince(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">（不填）</option>
              {PROVINCES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div><label className="block text-xs text-gray-500 mb-1">详细地址</label><input value={address} onChange={e => setAddress(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
        </div>
        {user.role === "ADMIN" && (
          <div className="grid grid-cols-2 gap-3">
            {salesList.length > 0 && (
              <div><label className="block text-xs text-gray-500 mb-1">所属销售{dealerMode ? ' *' : ''}</label>
                <select value={salesId} onChange={e => setSalesId(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                  <option value={0}>未分配</option>
                  {salesList.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}
            <div><label className="block text-xs text-gray-500 mb-1">经销商等级</label>
              <select value={distributorLevel} onChange={e => setDistributorLevel(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                {DISTRIBUTOR_LEVELS.filter(d => !dealerMode || d.value > 0).map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm border rounded-lg">取消</button>
          <button onClick={handleSave} disabled={!name.trim() || saving || (dealerMode && !salesId)} className="px-6 py-2 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#5C4B73" }}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </Card>
    </div>
  );
}
