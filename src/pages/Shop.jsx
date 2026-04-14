import { useState, useMemo } from 'react';
import { Search, Plus, Minus, X, ShoppingCart, ArrowLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Card, fmtY, today, now16, SERIES_LIST, CUSTOMER_TYPES } from '../components/ui';

// ═══ SHOP CATALOG ═══
export function ShopCatalog({ cart, addToCart, updateCartQty, removeFromCart, onCheckout }) {
  const { products } = useData();
  const [search, setSearch] = useState('');
  const [sf, setSf] = useState('ALL');
  const [showCart, setShowCart] = useState(false);

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
        </div>
        {cart.length > 0 && (
          <button onClick={() => setShowCart(!showCart)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium shadow" style={{ background: "#4a3560" }}>
            <ShoppingCart size={16} />
            购物车 ({cart.length}) · {fmtY(cartTotal)}
          </button>
        )}
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
              <div key={c.key} className="flex items-center gap-3 py-2 border-b last:border-0">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-800 truncate">{c.productName}</div>
                  <div className="text-xs text-gray-400">{c.productCode} · {c.spec} · {fmtY(c.unitPrice)}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => updateCartQty(c.key, c.quantity - 1)} className="w-7 h-7 rounded-full border flex items-center justify-center hover:bg-gray-100"><Minus size={14} /></button>
                  <span className="w-8 text-center text-sm font-medium">{c.quantity}</span>
                  <button onClick={() => updateCartQty(c.key, c.quantity + 1)} className="w-7 h-7 rounded-full border flex items-center justify-center hover:bg-gray-100"><Plus size={14} /></button>
                  <button onClick={() => removeFromCart(c.key)} className="text-gray-400 hover:text-red-500 ml-1"><X size={14} /></button>
                </div>
                <div className="text-sm font-semibold w-20 text-right" style={{ color: "#4a3560" }}>{fmtY(c.unitPrice * c.quantity)}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between mt-4 pt-3 border-t">
            <div className="text-sm text-gray-500">共 {cart.reduce((s, c) => s + c.quantity, 0)} 件</div>
            <button onClick={onCheckout} className="px-6 py-2.5 text-white text-sm font-medium rounded-lg shadow" style={{ background: "#4a3560" }}>
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
              <div className="font-medium text-gray-800 text-sm">{p.name}</div>
              <div className="text-xs text-gray-400">{p.code} · {p.origin}</div>
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
                      <span className="font-medium" style={{ color: "#4a3560" }}>{fmtY(s.price)}</span>
                      {s.stock <= s.safeStock && <span className="text-red-500 text-xs ml-1">库存{s.stock}</span>}
                    </div>
                    {inCart ? (
                      <div className="flex items-center gap-1">
                        <button onClick={() => updateCartQty(inCart.key, inCart.quantity - 1)} className="w-6 h-6 rounded-full border text-xs flex items-center justify-center"><Minus size={12} /></button>
                        <span className="text-xs w-6 text-center">{inCart.quantity}</span>
                        <button onClick={() => updateCartQty(inCart.key, inCart.quantity + 1)} className="w-6 h-6 rounded-full border text-xs flex items-center justify-center"><Plus size={12} /></button>
                      </div>
                    ) : (
                      <button onClick={() => addToCart(p, s)} className="text-xs px-2.5 py-1 rounded-lg border border-purple-200 text-purple-700 hover:bg-purple-50">
                        <Plus size={12} className="inline -mt-0.5" /> 加购
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
export function Checkout({ cart, onBack, onPlaceOrder, onNewCustomer }) {
  const { user } = useAuth();
  const { customers } = useData();
  const myCustomers = user.role === "ADMIN" ? customers : customers.filter(c => c.salesId === user.id);

  const [customerId, setCustomerId] = useState('');
  const [discount, setDiscount] = useState(0);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const subtotal = cart.reduce((s, c) => s + c.unitPrice * c.quantity, 0);
  const discountAmount = Math.round(subtotal * discount / 100);
  const total = subtotal - discountAmount;

  const handlePlace = async () => {
    if (!customerId || submitting) return;
    setSubmitting(true);
    try {
      const orderNo = `ZD${Date.now().toString(36).toUpperCase()}`;
      await onPlaceOrder({
        orderNo,
        customerId: Number(customerId),
        salesId: user.id,
        status: "SUBMITTED",
        subtotal,
        discountPercent: discount,
        discountAmount,
        total,
        notes,
        createdAt: today(),
        items: cart.map(c => ({
          productId: c.productId,
          specId: c.specId,
          productName: c.productName,
          productCode: c.productCode,
          spec: c.spec,
          quantity: c.quantity,
          unitPrice: c.unitPrice,
          subtotal: c.unitPrice * c.quantity
        })),
        logs: [{ time: now16(), user: user.name, action: "创建订单并提交" }]
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
              </div>
              <span className="font-medium" style={{ color: "#4a3560" }}>{fmtY(c.unitPrice * c.quantity)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <div>
          <label className="block text-xs text-gray-500 mb-1.5">选择客户 *</label>
          <div className="flex gap-2">
            <select value={customerId} onChange={e => setCustomerId(e.target.value)} className="flex-1 border rounded-lg px-3 py-2.5 text-sm bg-white">
              <option value="">请选择</option>
              {myCustomers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
            </select>
            <button onClick={onNewCustomer} className="px-3 py-2 text-sm border rounded-lg text-purple-700 hover:bg-purple-50 shrink-0">
              <Plus size={14} className="inline -mt-0.5" /> 新建
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1.5">折扣 (%)</label>
          <input type="number" min="0" max="50" value={discount} onChange={e => setDiscount(Number(e.target.value))} className="w-32 border rounded-lg px-3 py-2 text-sm" />
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
          <div className="flex justify-between pt-2 border-t text-base font-bold">
            <span className="text-gray-800">应付</span>
            <span style={{ color: "#4a3560" }}>{fmtY(total)}</span>
          </div>
        </div>
        <button
          onClick={handlePlace}
          disabled={!customerId || submitting}
          className="w-full mt-4 py-3 text-white font-medium rounded-xl disabled:opacity-40"
          style={{ background: "#4a3560" }}
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
  const [type, setType] = useState('SPA水疗馆');
  const [salesId, setSalesId] = useState(user.role === "SALES" ? user.id : 0);
  const [saving, setSaving] = useState(false);

  const salesList = users.filter(u => u.role === "SALES");

  const handleSave = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), contact: contact.trim(), phone: phone.trim(), address: address.trim(), type, salesId: salesId || null });
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
        <div><label className="block text-xs text-gray-500 mb-1">地址</label><input value={address} onChange={e => setAddress(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm" /></div>
        {user.role === "ADMIN" && salesList.length > 0 && (
          <div><label className="block text-xs text-gray-500 mb-1">所属销售</label>
            <select value={salesId} onChange={e => setSalesId(Number(e.target.value))} className="w-full border rounded-lg px-3 py-2 text-sm bg-white">
              <option value={0}>未分配</option>
              {salesList.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm border rounded-lg">取消</button>
          <button onClick={handleSave} disabled={!name.trim() || saving} className="px-6 py-2 text-sm text-white rounded-lg disabled:opacity-40" style={{ background: "#4a3560" }}>
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </Card>
    </div>
  );
}
