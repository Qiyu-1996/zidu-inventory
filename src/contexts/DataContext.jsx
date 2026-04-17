import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import * as api from '../lib/api';
import { useAuth } from './AuthContext';

const DataContext = createContext(null);

export function DataProvider({ children }) {
  const { user } = useAuth();
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAll = useCallback(async () => {
    if (!user) return;
    setLoading(true); setError('');
    try {
      const [p, c, o, u, po, tiers, scenarios, configs, sup, tasks, targets] = await Promise.all([
        api.fetchProducts(), api.fetchCustomers(), api.fetchOrders(), api.fetchUsers(),
        api.fetchPurchaseOrders().catch(() => []),
        api.fetchPricingTiers().catch(() => []),
        api.fetchScenarioPackages().catch(() => []),
        api.fetchConfigOptions().catch(() => []),
        api.fetchSuppliers().catch(() => []),
        api.fetchSalesTasks().catch(() => []),
        api.fetchSalesTargets().catch(() => [])
      ]);
      setProducts(p); setCustomers(c); setOrders(o); setUsers(u);
      setPurchaseOrders(po); setPricingTiers(tiers); setScenarioPackages(scenarios);
      setConfigOptions(configs); setSuppliers(sup); setSalesTasks(tasks); setSalesTargets(targets);
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Products
  const addProduct = useCallback(async (product) => { const r = await api.createProduct(product); setProducts(p => [...p, r]); return r; }, []);
  const editProduct = useCallback(async (product) => { const r = await api.updateProduct(product); setProducts(p => p.map(x => x.id === r.id ? r : x)); return r; }, []);
  const removeProduct = useCallback(async (id) => { await api.deleteProduct(id); setProducts(p => p.filter(x => x.id !== id)); }, []);

  // Customers
  const addCustomer = useCallback(async (c) => { const r = await api.createCustomer(c); setCustomers(p => [...p, r]); return r; }, []);
  const editCustomer = useCallback(async (id, fields) => {
    const r = await api.updateCustomer(id, fields);
    setCustomers(p => p.map(c => c.id === id ? { ...c, name: r.name, contact: r.contact, phone: r.phone, address: r.address, type: r.type, salesId: r.sales_id } : c));
  }, []);
  const addCustomerNote = useCallback(async (cid, text, name) => {
    const n = await api.addCustomerNote(cid, text, name);
    setCustomers(p => p.map(c => c.id === cid ? { ...c, notes: [...c.notes, n] } : c));
  }, []);

  // Orders
  const addOrder = useCallback(async (order) => {
    await api.createOrder(order);
    const [newOrders, newProducts] = await Promise.all([api.fetchOrders(), api.fetchProducts()]);
    setOrders(newOrders); setProducts(newProducts);
  }, []);
  const updateOrderStatus = useCallback(async (orderId, newStatus, logEntry, shipmentData) => {
    await api.updateOrderStatus(orderId, newStatus, logEntry, shipmentData);
    setOrders(p => p.map(o => o.id !== orderId ? o : { ...o, status: newStatus, logs: [...o.logs, logEntry], ...(shipmentData ? { shipment: shipmentData } : {}) }));
    if (newStatus === 'CANCELLED') { const np = await api.fetchProducts(); setProducts(np); }
  }, []);
  const recordPayment = useCallback(async (orderId, amount, method, note, recordedBy) => {
    const result = await api.recordPayment(orderId, amount, method, note, recordedBy);
    setOrders(p => p.map(o => o.id !== orderId ? o : { ...o, paymentStatus: result.status, paidAmount: result.totalPaid, payments: [...(o.payments || []), { amount, method, note, recordedBy, createdAt: new Date().toISOString() }] }));
  }, []);

  // Users
  const addUser = useCallback(async (n, ph, pw, r) => { const u = await api.createUser(n, ph, pw, r); setUsers(p => [...p, u]); return u; }, []);
  const resetUserPassword = useCallback(async (targetId, newPw) => { await api.adminResetPassword(user.id, targetId, newPw); }, [user]);
  const toggleUserStatus = useCallback(async (targetId, newStatus) => {
    await api.toggleUserStatus(user.id, targetId, newStatus);
    setUsers(p => p.map(u => u.id === targetId ? { ...u, status: newStatus } : u));
  }, [user]);

  // Stock
  const adjustStock = useCallback(async (specId, productId, type, reason, qty, note) => {
    const result = await api.adjustStock(specId, productId, type, reason, qty, note, user.name);
    setProducts(p => p.map(pr => pr.id === productId ? { ...pr, specs: pr.specs.map(s => s.id === specId ? { ...s, stock: result.after } : s) } : pr));
    return result;
  }, [user]);
  const loadStockLog = useCallback(async () => { const log = await api.fetchStockLog(); setStockLog(log); return log; }, []);

  // Purchase Orders
  const addPurchaseOrder = useCallback(async (po) => { const id = await api.createPurchaseOrder(po); await loadAll(); return id; }, [loadAll]);
  const updatePOStatus = useCallback(async (poId, status) => { await api.updatePurchaseOrderStatus(poId, status); setPurchaseOrders(p => p.map(po => po.id === poId ? { ...po, status } : po)); }, []);
  const receivePOItems = useCallback(async (poId, items) => {
    const po = purchaseOrders.find(p => p.id === poId);
    await api.receivePurchaseItems(poId, items, user.name);
    // Reload everything since stock changed
    const [newProducts, newPOs] = await Promise.all([api.fetchProducts(), api.fetchPurchaseOrders()]);
    setProducts(newProducts); setPurchaseOrders(newPOs);
  }, [user, purchaseOrders]);

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
    // Update product stock locally
    setProducts(p => p.map(pr => pr.id === batch.productId ? {
      ...pr,
      specs: pr.specs.map(s => s.id === batch.specId ? { ...s, stock: s.stock + batch.quantity } : s)
    } : pr));
    return b;
  }, [user]);
  const removeBatch = useCallback(async (batchId, productId, specId, remainingQty) => {
    await api.deleteBatch(batchId);
    setProducts(p => p.map(pr => pr.id === productId ? {
      ...pr,
      specs: pr.specs.map(s => s.id === specId ? { ...s, stock: Math.max(0, s.stock - remainingQty) } : s)
    } : pr));
  }, []);

  return (
    <DataContext.Provider value={{
      products, customers, orders, users, purchaseOrders, pricingTiers, scenarioPackages, stockLog, configOptions,
      suppliers, salesTasks, salesTargets,
      loading, error,
      addProduct, editProduct, removeProduct,
      addCustomer, editCustomer, addCustomerNote,
      addOrder, updateOrderStatus, recordPayment,
      addUser, resetUserPassword, toggleUserStatus,
      adjustStock, loadStockLog,
      addPurchaseOrder, updatePOStatus, receivePOItems,
      updateTiers, getCustomerTier,
      updatePackageItems,
      addConfig, removeConfig,
      addBatch, removeBatch,
      addSupplier, editSupplier, removeSupplier,
      addTask, completeTask, removeTask,
      setTarget,
      log,
      reload: loadAll
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
