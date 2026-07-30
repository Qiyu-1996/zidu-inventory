import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import * as api from '../lib/api';
import { useAuth } from './AuthContext';

const DataContext = createContext(null);

function redactWarehouseProducts(rows) {
  return (rows || []).map(product => ({
    ...product,
    specs: (product.specs || []).map(spec => ({
      ...spec,
      price: null,
      cost: null
    }))
  }));
}

function redactWarehouseOrders(rows) {
  return (rows || []).map(order => {
    const channelMeta = { ...(order.channelMeta || {}) };
    delete channelMeta.shippingFee;
    delete channelMeta.freightFee;
    delete channelMeta.shipping_fee;

    return {
      ...order,
      subtotal: null,
      discountPercent: null,
      discountAmount: null,
      total: null,
      paidAmount: null,
      discountResponsibility: null,
      discountReason: '',
      channelMeta,
      items: (order.items || []).map(item => ({
        ...item,
        unitPrice: null,
        unitCost: null,
        subtotal: null,
        unitPriceHint: ''
      })),
      payments: [],
      afterSales: (order.afterSales || []).map(afterSale => ({
        ...afterSale,
        requestedAmount: null,
        financeAmount: null,
        financeMethod: '',
        financeNote: '',
        items: (afterSale.items || []).map(item => ({
          ...item,
          unitPrice: null,
          unit_price: null,
          subtotal: null,
          amount: null
        }))
      }))
    };
  });
}

function redactWarehousePurchaseOrders(rows) {
  return (rows || []).map(order => ({
    ...order,
    total: null,
    items: (order.items || []).map(item => ({
      ...item,
      unitCost: null,
      subtotal: null
    }))
  }));
}

export function DataProvider({ children }) {
  const { user } = useAuth();
  const isWarehouse = user?.role === 'WAREHOUSE';
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [users, setUsers] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [pricingTiers, setPricingTiers] = useState([]);
  const [scenarioPackages, setScenarioPackages] = useState([]);
  const [stockLog, setStockLog] = useState([]);
  const [configOptions, setConfigOptions] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [salesTasks, setSalesTasks] = useState([]);
  const [salesTargets, setSalesTargets] = useState([]);
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // silent=true：后台静默刷新，不触发全屏加载、单接口失败保留原数据（不清零）
  const loadAll = useCallback(async (silent) => {
    if (!user) return;
    if (!silent) setLoading(true);
    setError('');
    try {
      const [p, c, o, u, po, tiers, scenarios, configs, sup, tasks, targets, recipeRows] = await Promise.all([
        api.fetchProducts(isWarehouse).catch(() => null), api.fetchCustomers().catch(() => null),
        api.fetchOrders(isWarehouse).catch(() => null), api.fetchUsers().catch(() => null),
        api.fetchPurchaseOrders(isWarehouse).catch(() => null),
        isWarehouse ? Promise.resolve([]) : api.fetchPricingTiers().catch(() => null),
        isWarehouse ? Promise.resolve([]) : api.fetchScenarioPackages().catch(() => null),
        api.fetchConfigOptions().catch(() => null),
        api.fetchSuppliers(isWarehouse).catch(() => null),
        isWarehouse ? Promise.resolve([]) : api.fetchSalesTasks().catch(() => null),
        isWarehouse ? Promise.resolve([]) : api.fetchSalesTargets().catch(() => null),
        api.fetchRecipes().catch(() => null)
      ]);
      // 仅当成功取到数据时才覆盖；失败返回 null 则保留现有数据，避免清零
      if (p) setProducts(isWarehouse ? redactWarehouseProducts(p) : p);
      if (c) setCustomers(c);
      if (o) setOrders(isWarehouse ? redactWarehouseOrders(o) : o);
      if (u) setUsers(u);
      if (po) setPurchaseOrders(isWarehouse ? redactWarehousePurchaseOrders(po) : po);
      if (tiers) setPricingTiers(tiers);
      if (scenarios) setScenarioPackages(scenarios);
      if (configs) setConfigOptions(configs);
      if (sup) setSuppliers(sup);
      if (tasks) setSalesTasks(tasks);
      if (targets) setSalesTargets(targets);
      if (recipeRows) setRecipes(recipeRows);
    } catch (e) { setError(e.message); } finally { if (!silent) setLoading(false); }
  }, [user, isWarehouse]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Products
  const addProduct = useCallback(async (product) => { const r = await api.createProduct(product); setProducts(p => [...p, r]); return r; }, []);
  const editProduct = useCallback(async (product) => { const r = await api.updateProduct(product); setProducts(p => p.map(x => x.id === r.id ? r : x)); return r; }, []);
  const editProductDensity = useCallback(async (productId, densityGml) => {
    const density = await api.updateProductDensity(productId, densityGml);
    setProducts(current => current.map(product => product.id === productId ? { ...product, ...density } : product));
    return density;
  }, []);
  const removeProduct = useCallback(async (id) => { await api.deleteProduct(id); setProducts(p => p.filter(x => x.id !== id)); }, []);

  // Recipe library
  const reloadRecipes = useCallback(async () => {
    const rows = await api.fetchRecipes();
    setRecipes(rows);
    return rows;
  }, []);
  const saveRecipe = useCallback(async (recipe) => {
    const result = await api.saveRecipe(recipe);
    await reloadRecipes();
    return result;
  }, [reloadRecipes]);
  const archiveRecipe = useCallback(async (recipeId) => {
    const result = await api.archiveRecipe(recipeId);
    await reloadRecipes();
    return result;
  }, [reloadRecipes]);

  // Customers
  const addCustomer = useCallback(async (c) => { const r = await api.createCustomer(c); setCustomers(p => [...p, r]); return r; }, []);
  const editCustomer = useCallback(async (id, fields) => {
    const r = await api.updateCustomer(id, fields);
    setCustomers(p => p.map(c => c.id === id ? { ...c, name: r.name, contact: r.contact, phone: r.phone, address: r.address, type: r.type, salesId: r.sales_id, province: r.province || '', distributorLevel: r.distributor_level || null } : c));
  }, []);
  const removeCustomer = useCallback(async (id) => {
    await api.deleteCustomer(id);
    setCustomers(p => p.filter(c => c.id !== id));
  }, []);

  const addCustomerNote = useCallback(async (cid, text, name) => {
    const n = await api.addCustomerNote(cid, text, name);
    setCustomers(p => p.map(c => c.id === cid ? { ...c, notes: [...c.notes, n] } : c));
  }, []);

  // Orders
  const addOrder = useCallback(async (order) => {
    await api.createOrder(order);
    const [newOrders, newProducts] = await Promise.all([api.fetchOrders(isWarehouse), api.fetchProducts(isWarehouse)]);
    setOrders(isWarehouse ? redactWarehouseOrders(newOrders) : newOrders);
    setProducts(isWarehouse ? redactWarehouseProducts(newProducts) : newProducts);
  }, [isWarehouse]);
  const removeOrder = useCallback(async (orderId, restoreStock, deletedBy) => {
    await api.deleteOrder(orderId, restoreStock, deletedBy || user?.name || '');
    setOrders(p => p.filter(o => o.id !== orderId));
    if (restoreStock) {
      const np = await api.fetchProducts(isWarehouse);
      setProducts(isWarehouse ? redactWarehouseProducts(np) : np);
    }
  }, [user, isWarehouse]);

  const editOrderItems = useCallback(async (orderId, changes, totals, logEntry) => {
    await api.updateOrderItems(orderId, changes, totals, logEntry);
    const [newOrders, newProducts] = await Promise.all([api.fetchOrders(isWarehouse), api.fetchProducts(isWarehouse)]);
    setOrders(isWarehouse ? redactWarehouseOrders(newOrders) : newOrders);
    setProducts(isWarehouse ? redactWarehouseProducts(newProducts) : newProducts);
  }, [isWarehouse]);

  const updateOrderDiscountResponsibility = useCallback(async (orderId, responsibility, reason) => {
    const result = await api.updateOrderDiscountResponsibility(orderId, responsibility, reason, user?.name || '');
    setOrders(p => p.map(o => o.id === orderId ? { ...o, ...result } : o));
    return result;
  }, [user]);

  const updateOrderStatus = useCallback(async (orderId, newStatus, logEntry, shipmentData) => {
    await api.updateOrderStatus(orderId, newStatus, logEntry, shipmentData);
    setOrders(p => p.map(o => o.id !== orderId ? o : { ...o, status: newStatus, logs: [...o.logs, logEntry], ...(shipmentData ? { shipment: shipmentData } : {}) }));
    if (newStatus === 'CANCELLED') {
      const np = await api.fetchProducts(isWarehouse);
      setProducts(isWarehouse ? redactWarehouseProducts(np) : np);
    }
  }, [isWarehouse]);
  const requestUnpaidShipping = useCallback(async (orderId, reason) => {
    const result = await api.requestUnpaidShipping(orderId, user?.id, reason);
    const rows = await api.fetchOrders(isWarehouse);
    setOrders(isWarehouse ? redactWarehouseOrders(rows) : rows);
    return result;
  }, [user, isWarehouse]);
  const reviewUnpaidShipping = useCallback(async (orderId, approved, note) => {
    const result = await api.reviewUnpaidShipping(orderId, user?.id, approved, note);
    const rows = await api.fetchOrders(isWarehouse);
    setOrders(isWarehouse ? redactWarehouseOrders(rows) : rows);
    return result;
  }, [user, isWarehouse]);
  const recordPayment = useCallback(async (orderId, amount, method, note, recordedBy, priceAdjustment = 0) => {
    const result = await api.recordPayment(orderId, amount, method, note, recordedBy, priceAdjustment);
    setOrders(p => p.map(o => o.id !== orderId ? o : {
      ...o,
      subtotal: result.subtotal ?? o.subtotal,
      total: result.total ?? o.total,
      paymentStatus: result.status,
      paidAmount: result.totalPaid,
      status: result.orderStatus || o.status,
      payments: [...(o.payments || []), { amount, method, note, recordedBy, createdAt: new Date().toISOString() }]
    }));
    return result;
  }, []);
  const createAfterSale = useCallback(async (orderId, payload) => {
    const result = await api.createAfterSale(orderId, payload);
    const newOrders = await api.fetchOrders(isWarehouse);
    setOrders(isWarehouse ? redactWarehouseOrders(newOrders) : newOrders);
    return result;
  }, [isWarehouse]);
  const processAfterSaleWarehouse = useCallback(async (afterSaleId, payload) => {
    const result = await api.processAfterSaleWarehouse(afterSaleId, payload);
    const [newOrders, newProducts] = await Promise.all([api.fetchOrders(isWarehouse), api.fetchProducts(isWarehouse)]);
    setOrders(isWarehouse ? redactWarehouseOrders(newOrders) : newOrders);
    setProducts(isWarehouse ? redactWarehouseProducts(newProducts) : newProducts);
    return result;
  }, [isWarehouse]);
  const completeAfterSaleFinance = useCallback(async (afterSaleId, payload) => {
    const result = await api.completeAfterSaleFinance(afterSaleId, payload);
    const [newOrders, newProducts] = await Promise.all([api.fetchOrders(isWarehouse), api.fetchProducts(isWarehouse)]);
    setOrders(isWarehouse ? redactWarehouseOrders(newOrders) : newOrders);
    setProducts(isWarehouse ? redactWarehouseProducts(newProducts) : newProducts);
    return result;
  }, [isWarehouse]);
  const cancelAfterSale = useCallback(async (afterSaleId, note) => {
    const result = await api.cancelAfterSale(afterSaleId, user?.name || '', note || '');
    const rows = await api.fetchOrders(isWarehouse);
    setOrders(isWarehouse ? redactWarehouseOrders(rows) : rows);
    return result;
  }, [user, isWarehouse]);

  // Users
  const addUser = useCallback(async (n, ph, pw, r) => { const u = await api.createUser(n, ph, pw, r); setUsers(p => [...p, u]); return u; }, []);
  const resetUserPassword = useCallback(async (targetId, newPw) => { await api.adminResetPassword(user.id, targetId, newPw); }, [user]);
  const toggleUserStatus = useCallback(async (targetId, newStatus) => {
    await api.toggleUserStatus(user.id, targetId, newStatus);
    setUsers(p => p.map(u => u.id === targetId ? { ...u, status: newStatus } : u));
  }, [user]);
  const updateUserRole = useCallback(async (targetId, newRole) => {
    await api.updateUserRole(user.id, targetId, newRole);
    setUsers(p => p.map(u => u.id === targetId
      ? api.normalizeUserAccess({ ...u, role: newRole, accessRole: newRole })
      : u));
  }, [user]);
  const archiveUser = useCallback(async (targetId) => {
    await api.archiveUser(user.id, targetId);
    setUsers(p => p.map(u => u.id === targetId ? { ...u, status: 'deleted' } : u));
  }, [user]);

  // Stock
  const adjustStock = useCallback(async (specId, productId, type, reason, qty, note) => {
    const result = await api.adjustStock(specId, productId, type, reason, qty, note, user.name);
    setProducts(p => p.map(pr => pr.id === productId ? { ...pr, specs: pr.specs.map(s => s.id === specId ? { ...s, stock: result.after } : s) } : pr));
    return result;
  }, [user]);
  const adjustRawStock = useCallback(async (productId, type, reason, qtyKg, note, densityGml, densityTemperatureC) => {
    const result = await api.adjustRawStock(productId, type, reason, qtyKg, note, user.name, densityGml, densityTemperatureC);
    const rows = await api.fetchProducts(isWarehouse);
    setProducts(isWarehouse ? redactWarehouseProducts(rows) : rows);
    return result;
  }, [user, isWarehouse]);
  const adjustStockFromBatch = useCallback(async (specId, batchId, qty, reason, note) => {
    const result = await api.adjustStockFromBatch(specId, batchId, qty, reason, note, user.name);
    const rows = await api.fetchProducts(isWarehouse);
    setProducts(isWarehouse ? redactWarehouseProducts(rows) : rows);
    return result;
  }, [user, isWarehouse]);
  const loadStockLog = useCallback(async () => { const log = await api.fetchStockLog(); setStockLog(log); return log; }, []);

  // Purchase Orders
  const addPurchaseOrder = useCallback(async (po) => { const id = await api.createPurchaseOrder(po); await loadAll(); return id; }, [loadAll]);
  const editPurchaseOrder = useCallback(async (poId, po) => { await api.updatePurchaseOrder(poId, po); await loadAll(); }, [loadAll]);
  const removePurchaseOrder = useCallback(async (poId) => {
    await api.deletePurchaseOrder(poId, user?.name || '');
    setPurchaseOrders(p => p.filter(po => po.id !== poId));
  }, [user]);
  const updatePOStatus = useCallback(async (poId, status) => {
    await api.updatePurchaseOrderStatus(poId, status, user?.name || '');
    const rows = await api.fetchPurchaseOrders(isWarehouse);
    setPurchaseOrders(isWarehouse ? redactWarehousePurchaseOrders(rows) : rows);
  }, [user, isWarehouse]);
  const closePurchaseOrder = useCallback(async (poId, note) => {
    await api.closePurchaseOrder(poId, user?.name || '', note);
    const rows = await api.fetchPurchaseOrders(isWarehouse);
    setPurchaseOrders(isWarehouse ? redactWarehousePurchaseOrders(rows) : rows);
  }, [user, isWarehouse]);
  const reversePurchaseReceipt = useCallback(async (batchId, note) => {
    await api.reversePurchaseReceipt(batchId, user?.name || '', note);
    const [newProducts, newPOs] = await Promise.all([api.fetchProducts(isWarehouse), api.fetchPurchaseOrders(isWarehouse)]);
    setProducts(isWarehouse ? redactWarehouseProducts(newProducts) : newProducts);
    setPurchaseOrders(isWarehouse ? redactWarehousePurchaseOrders(newPOs) : newPOs);
  }, [user, isWarehouse]);
  const receivePOItems = useCallback(async (poId, items) => {
    await api.receivePurchaseItems(poId, items, user.name);
    // Reload everything since stock changed
    const [newProducts, newPOs] = await Promise.all([api.fetchProducts(isWarehouse), api.fetchPurchaseOrders(isWarehouse)]);
    setProducts(isWarehouse ? redactWarehouseProducts(newProducts) : newProducts);
    setPurchaseOrders(isWarehouse ? redactWarehousePurchaseOrders(newPOs) : newPOs);
  }, [user, isWarehouse]);

  // Pricing Tiers
  const updateTiers = useCallback(async (tiers) => { const r = await api.updatePricingTiers(tiers); setPricingTiers(r); }, []);
  const getCustomerTier = useCallback((customerId) => api.calculateCustomerTier(customerId, orders, pricingTiers), [orders, pricingTiers]);

  // Scenario Packages
  const updatePackageItems = useCallback(async (pkgId, items) => {
    await api.updateScenarioPackageItems(pkgId, items);
    const fresh = await api.fetchScenarioPackages();
    setScenarioPackages(fresh);
  }, []);

  // Config Options
  const addConfig = useCallback(async (category, value) => {
    const o = await api.addConfigOption(category, value);
    setConfigOptions(p => [...p, o]);
    return o;
  }, []);
  const removeConfig = useCallback(async (id) => {
    await api.deleteConfigOption(id);
    setConfigOptions(p => p.filter(c => c.id !== id));
  }, []);

  // Suppliers
  const addSupplier = useCallback(async (s) => { const r = await api.createSupplier(s); setSuppliers(p => [...p, r]); return r; }, []);
  const editSupplier = useCallback(async (id, s) => { const r = await api.updateSupplier(id, s); setSuppliers(p => p.map(x => x.id === id ? r : x)); }, []);
  const removeSupplier = useCallback(async (id) => { await api.deleteSupplier(id); setSuppliers(p => p.filter(x => x.id !== id)); }, []);

  // Sales Tasks
  const addTask = useCallback(async (task) => {
    const t = await api.createSalesTask({ ...task, createdBy: user.name });
    setSalesTasks(p => [...p, t]);
    return t;
  }, [user]);
  const completeTask = useCallback(async (taskId, note) => {
    const t = await api.completeSalesTask(taskId, note);
    setSalesTasks(p => p.map(x => x.id === taskId ? t : x));
  }, []);
  const removeTask = useCallback(async (id) => { await api.deleteSalesTask(id); setSalesTasks(p => p.filter(x => x.id !== id)); }, []);

  // Sales Targets
  const setTarget = useCallback(async (target) => {
    await api.upsertSalesTarget(target);
    const fresh = await api.fetchSalesTargets();
    setSalesTargets(fresh);
  }, []);

  // Audit Logs
  const log = useCallback((action, entityType, entityId, details) => {
    if (!user) return;
    api.logAudit(user.id, user.name, action, entityType, entityId, details);
  }, [user]);

  // Batches
  const addBatch = useCallback(async (batch) => {
    const b = await api.createBatch({ ...batch, operatorName: user.name });
    const rows = await api.fetchProducts(isWarehouse);
    setProducts(isWarehouse ? redactWarehouseProducts(rows) : rows);
    return b;
  }, [user, isWarehouse]);
  const removeBatch = useCallback(async (batchId) => {
    await api.deleteBatch(batchId);
    const rows = await api.fetchProducts(isWarehouse);
    setProducts(isWarehouse ? redactWarehouseProducts(rows) : rows);
  }, [isWarehouse]);

  return (
    <DataContext.Provider value={{
      products, customers, orders, users, purchaseOrders, pricingTiers, scenarioPackages, stockLog, configOptions,
      suppliers, salesTasks, salesTargets, recipes,
      loading, error,
      addProduct, editProduct, editProductDensity, removeProduct,
      saveRecipe, archiveRecipe, reloadRecipes,
      addCustomer, editCustomer, removeCustomer, addCustomerNote,
      addOrder, updateOrderStatus, requestUnpaidShipping, reviewUnpaidShipping, removeOrder, editOrderItems, updateOrderDiscountResponsibility, recordPayment,
      createAfterSale, processAfterSaleWarehouse, completeAfterSaleFinance, cancelAfterSale,
      addUser, resetUserPassword, toggleUserStatus, updateUserRole, archiveUser,
      adjustStock, adjustRawStock, adjustStockFromBatch, loadStockLog,
      addPurchaseOrder, editPurchaseOrder, removePurchaseOrder, updatePOStatus, closePurchaseOrder, reversePurchaseReceipt, receivePOItems,
      updateTiers, getCustomerTier,
      updatePackageItems,
      addConfig, removeConfig,
      addBatch, removeBatch,
      addSupplier, editSupplier, removeSupplier,
      addTask, completeTask, removeTask,
      setTarget,
      log,
      reload: () => loadAll(true)
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be inside DataProvider');
  return ctx;
}
