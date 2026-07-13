import { useState, useMemo, useEffect } from 'react';
import { Search, Plus, Minus, X, ShoppingCart, ArrowLeft, Layers, Tag } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, fmtY, SERIES_LIST, CUSTOMER_TYPES, PROVINCES, DISTRIBUTOR_LEVELS, unitPriceHint } from '../components/ui';
import { createOrderNo, detectSourceFromCart, localDateKey, localMinuteKey } from '../lib/orderNo';
import * as api from '../lib/api';

// ═══ SHOP CATALOG ═══
export function ShopCatalog({ cart, addToCart, updateCartQty, removeFromCart, onCheckout }) {
  const { products, scenarioPackages } = useData();
  const [search, setSearch] = useState('');
  const [sf, setSf] = useState('ALL');
  const [showCart, setShowCart] = useState(false);
  const [showScenarios, setShowScenarios] = useState(false);

  const applyScenario = (pkg) => {
    let added = 0;
    pkg.items.forEach(it => {
      const p = products.find(pr => pr.id === it.productId);
      const s = p?.specs.find(sp => sp.id === it.specId);
      if (p && s) { addToCart(p, s, it.quantity); added++; }
    });
    if (added > 0) alert(`已添加【${pkg.name}】${added}件商品到购物车`);
    else alert('该方案暂未配置产品，请联系管理员');
    setShowScenarios(false);
  };

  const filtered = products.filter(p => {
    if (sf !== 'ALL' && p.series !== sf) return false;
    if (search && !`${p.code} ${p.name}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const cartTotal = cart.reduce((s, c) => s + c.unitPrice * c.quantity, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex gap-2 items-center flex-wrap">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
            <input placeholder="搜索产品" value={search} onChange={e => setSearch(e.target.value)} className="pl-9 pr-3 py-2 text-sm border rounded-lg w-48 focus:outline-none focus:ring-2 focus:ring-purple-300" />
          </div>
          <select value={sf} onChange={e => setSf(e.target.value)} className="border rounded-lg px-3 py-2 text-sm bg-white">
            <option value="ALL">全部系列</option>
            {SERIES_LIST.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {scenarioPackages?.length > 0 && (
            <button onClick={() => setShowScenarios(!showScenarios)} className="flex items-center gap-1 px-3 py-2 text-sm border rounded-lg text-purple-700 border-purple-200 hover:bg-purple-50">
              <Layers size={14} />场景方案
            </button>
          )}
        </div>
        {cart.length > 0 && (
          <button onClick={() => setShowCart(!showCart)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium shadow" style={{ background: "#5C4B73" }}>
            <ShoppingCart size={16} />
            购物车 ({cart.length}) · {fmtY(cartTotal)}
          </button>
        )}
      </div>

      {/* Scenario packages */}
      {showScenarios && scenarioPackages?.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-gray-700 flex items-center gap-2"><Layers size={16} />场景方案套餐 — 一键加购</div>
            <button onClick={() => setShowScenarios(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {scenarioPackages.filter(p => p.isActive !== false).map(pkg => (
              <div key={pkg.id} className="border rounded-lg p-3 hover:border-purple-300 cursor-pointer" onClick={() => applyScenario(pkg)}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded">{pkg.code}</span>
                  <span className="text-xs text-gray-400">{pkg.items.length}件</span>
                </div>
                <div className="font-medium text-gray-800">{pkg.name}</div>
                <div className="text-xs text-gray-500 mt-1 line-clamp-2">{pkg.description}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Cart panel */}
      {showCart && cart.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-gray-700">购物车</div>
            <button onClick={() => setShowCart(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          <div className="space-y-2">
            {cart.map(c => (
              <div key={c.key} className="flex items-center gap-3 py-2 border-b last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-800 truncate">{c.productName}</div>
                  <div className="text-xs text-gray-400">{c.productCode} · {c.spec} · {fmtY(c.unitPrice)}{(c.unitPriceHint || unitPriceHint(c.spec, c.unitPrice)) && <span className="ml-1 text-amber-700 font-medium">{c.unitPriceHint || unitPriceHint(c.spec, c.unitPrice)}</span>}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => updateCartQty(c.key, c.quantity - 1)} className="w-7 h-7 rounded-full border flex items-center justify-center hover:bg-gray-100"><Minus size={14} /></button>
                  <span className="w-8 text-center text-sm font-medium">{c.quantity}</span>
                  <button onClick={() => updateCartQty(c.key, c.quantity + 1)} className="w-7 h-7 rounded-full border flex items-center justify-center hover:bg-gray-100"><Plus size={14} /></button>
                  <button onClick={() => removeFromCart(c.key)} className="text-gray-400 hover:text-red-500 ml-1"><X size={14} /></button>
                </div>
                <div className="text-sm font-semibold w-20 text-right" style={{ color: "#5C4B73" }}>{fmtY(c.unitPrice * c.quantity)}</div>
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
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(p => (
          <Card key={p.id} className="p-4">
            <div className="mb-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-gray-800 text-sm">{p.name}</div>
                  <div className="text-xs text-gray-400">{p.code} · {p.origin}</div>
                </div>
                {p.channel === 'RAW' && (
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
                      {p.channel !== 'RAW' && s.stock <= s.safeStock && <span className="text-red-500 text-xs ml-1">库存 {s.stock} 瓶</span>}
                    </div>
                    {inCart ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => updateCartQty(inCart.key, inCart.quantity - 1)} className="w-6 h-6 rounded-full border text-xs flex items-center justify-center"><Minus size={12} /></button>
                        <span className="text-xs w-6 text-center">{inCart.quantity}</span>
                        <button onClick={() => updateCartQty(inCart.key, inCart.quantity + 1)} className="w-6 h-6 rounded-full border text-xs flex items-center justify-center"><Plus size={12} /></button>
                      </div>
                    ) : (
                      <button disabled={p.channel === 'RAW' && (Number(p.baseStockKg || 0) <= 0 || Number(s.stock || 0) <= 0)} onClick={() => addToCart(p, s)} className="text-xs px-2.5 py-1 rounded-lg border border-purple-200 text-purple-700 hover:bg-purple-50 disabled:border-gray-200 disabled:text-gray-400 disabled:bg-gray-50">
                        {p.channel === 'RAW' && (Number(p.baseStockKg || 0) <= 0 || Number(s.stock || 0) <= 0) ? '缺货' : <><Plus size={12} className="inline -mt-0.5" /> 加购</>}
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

export function Checkout({ cart, onBack, onPlaceOrder, onNewCustomer }) {
  const { user } = useAuth();
  const { customers } = useData();
  const myCustomers = user.role === "ADMIN" ? customers : customers.filter(c => c.salesId === user.id);

  const [customerId, setCustomerId] = useState('');
  const [businessType, setBusinessType] = useState('院线');
  const [discount, setDiscount] = useState(0);
  const [shippingFee, setShippingFee] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [custSearch, setCustSearch] = useState('');
  const [showCustList, setShowCustList] = useState(false);
  const [maxDiscount, setMaxDiscount] = useState(20);

  // 销售折扣上限（管理员在 基础设置 配置；管理员本人不限）
  useEffect(() => {
    if (user.role === 'ADMIN') return;
    api.fetchAppSettings().then(s => {
      const m = Number(s.max_discount_percent);
      if (!isNaN(m) && m >= 0) setMaxDiscount(m);
    }).catch(() => {});
  }, [user.role]);

  const { orders } = useData();
  // 最近使用的客户（取最近5个下过单的客户）
  const recentCustomerIds = useMemo(() => {
    const seen = new Set(); const result = [];
    const myOrders = orders.filter(o => user.role === 'ADMIN' || o.salesId === user.id);
    myOrders.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).forEach(o => {
      if (!seen.has(o.customerId)) { seen.add(o.customerId); result.push(o.customerId); }
    });
    return result.slice(0, 5);
  }, [orders, user]);

  const selectedCustomer = myCustomers.find(c => c.id === Number(customerId));
  const filteredCustomers = custSearch
    ? myCustomers.filter(c => `${c.name} ${c.contact || ''} ${c.phone || ''} ${c.type}`.toLowerCase().includes(custSearch.toLowerCase()))
    : myCustomers;
  const recentCustomers = recentCustomerIds.map(id => myCustomers.find(c => c.id === id)).filter(Boolean);

  const onSelectCustomer = (id) => {
    setCustomerId(id);
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
  const discountAmount = Math.round(subtotal * discount / 100);
  const shippingValue = Number(shippingFee);
  const shippingAmount = Number.isFinite(shippingValue)
    ? Math.max(0, Math.round((shippingValue + Number.EPSILON) * 100) / 100)
    : 0;
  const total = subtotal - discountAmount + shippingAmount;

  const handlePlace = async () => {
	    if (!customerId || submitting) return;
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
        salesId: user.id,
	        source: 'web_admin',
	        channelMeta: { productSource, shippingFee: shippingAmount },
        businessType,
        status: "SUBMITTED",
        subtotal,
        discountPercent: discount,
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
    <div className="max-w-2xl mx-auto space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft size={16} />返回购物车
      </button>

      <Card className="p-4">
        <div className="text-sm font-semibold text-gray-700 mb-3">订单商品 ({cart.length})</div>
        <div className="space-y-2">
          {cart.map(c => (
            <div key={c.key} className="flex justify-between text-sm py-1 border-b last:border-0">
              <div>
                <span className="text-gray-800">{c.productName}</span>
                <span className="text-gray-400 text-xs ml-1">({c.spec}) x{c.quantity}</span>
                {(c.unitPriceHint || unitPriceHint(c.spec, c.unitPrice)) && <span className="text-amber-700 text-xs ml-1 font-medium">{c.unitPriceHint || unitPriceHint(c.spec, c.unitPrice)}</span>}
              </div>
              <span className="font-medium" style={{ color: "#5C4B73" }}>{fmtY(c.unitPrice * c.quantity)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">选择客户 * <span className="text-gray-400">(共 {myCustomers.length} 位)</span></label>
          {!showCustList && selectedCustomer ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 border rounded-lg px-3 py-2.5 text-sm bg-purple-50 border-purple-200 flex items-center justify-between">
                <div>
                  <span className="font-medium">{selectedCustomer.name}</span>
                  <span className="text-xs text-gray-500 ml-2">{selectedCustomer.type}</span>
                  {selectedCustomer.phone && <span className="text-xs text-gray-400 ml-2">{selectedCustomer.phone}</span>}
                </div>
                <button onClick={() => { setShowCustList(true); setCustomerId(''); }} className="text-xs text-purple-600 hover:underline">更换</button>
              </div>
              <button onClick={onNewCustomer} className="px-3 py-2 text-sm border rounded-lg text-purple-700 hover:bg-purple-50 shrink-0">
                <Plus size={14} className="inline -mt-0.5" />新建
              </button>
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
                <button onClick={onNewCustomer} className="px-3 py-2 text-sm border rounded-lg text-purple-700 hover:bg-purple-50 shrink-0">
                  <Plus size={14} className="inline -mt-0.5" />新建
                </button>
              </div>

              {/* Recent customers */}
              {!custSearch && recentCustomers.length > 0 && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">🕐 最近下单</div>
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

        <div>
          <label className="block text-xs text-gray-500 mb-1.5">业务类型</label>
          <select value={businessType} onChange={e => setBusinessType(e.target.value)} className="w-40 border rounded-lg px-3 py-2 text-sm bg-white">
            {BIZ_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1.5">
            折扣 (%) {user.role !== 'ADMIN' && <span className="text-gray-300">上限 {maxDiscount}%</span>}
          </label>
          <input type="number" min="0" max={user.role === 'ADMIN' ? 100 : maxDiscount} value={discount}
            onChange={e => {
              let v = Number(e.target.value) || 0;
              if (user.role !== 'ADMIN' && v > maxDiscount) v = maxDiscount;
              setDiscount(v);
            }}
            className="w-32 border rounded-lg px-3 py-2 text-sm" />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1.5">运费</label>
          <div className="relative w-40">
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

        <div>
          <label className="block text-xs text-gray-500 mb-1.5">备注</label>
          <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="订单备注（可选）" />
        </div>
      </Card>

      <Card className="p-4">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-gray-500">小计</span><span>{fmtY(subtotal)}</span></div>
          {discountAmount > 0 && <div className="flex justify-between text-orange-600"><span>折扣 ({discount}%)</span><span>-{fmtY(discountAmount)}</span></div>}
          {shippingAmount > 0 && <div className="flex justify-between text-green-700"><span>运费</span><span>+{fmtY(shippingAmount)}</span></div>}
          <div className="flex justify-between pt-2 border-t text-base font-bold">
            <span className="text-gray-800">应付</span>
            <span style={{ color: "#5C4B73" }}>{fmtY(total)}</span>
          </div>
        </div>
        <button
          onClick={handlePlace}
          disabled={!customerId || submitting}
          className="w-full mt-4 py-3 text-white font-medium rounded-xl disabled:opacity-40"
          style={{ background: "#5C4B73" }}
        >
          {submitting ? '提交中...' : `提交订单 ${fmtY(total)}`}
        </button>
      </Card>
    </div>
  );
}

// ═══ CUSTOMER CREATE (inline) ═══
export function CustomerCreate({ onSave, onCancel }) {
  const { user } = useAuth();
  const { users } = useData();
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [type, setType] = useState(CUSTOMER_TYPES[0]);
  const [province, setProvince] = useState('');
  const [distributorLevel, setDistributorLevel] = useState(0);
  const [salesId, setSalesId] = useState(user.role === "SALES" ? user.id : 0);
  const [saving, setSaving] = useState(false);

  const salesList = users.filter(u => u.role === "SALES" && u.status === 'active');

  const handleSave = async () => {
    if (!name.trim() || saving) return;
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
        <div className="text-sm font-semibold text-gray-700">新建客户</div>
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
              <div><label className="block text-xs text-gray-500 mb-1">所属销售</label>
                <select value={salesId} onChange={e => setSalesId(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                  <option value={0}>未分配</option>
                  {salesList.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            )}
            <div><label className="block text-xs text-gray-500 mb-1">分销商等级</label>
              <select value={distributorLevel} onChange={e => setDistributorLevel(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
                {DISTRIBUTOR_LEVELS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm border rounded-lg">取消</button>
          <button onClick={handleSave} disabled={!name.trim() || saving} className="px-6 py-2 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#5C4B73" }}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </Card>
    </div>
  );
}
