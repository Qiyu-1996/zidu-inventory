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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAll = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError('');
    try {
      const [p, c, o, u] = await Promise.all([
        api.fetchProducts(),
        api.fetchCustomers(),
        api.fetchOrders(),
        api.fetchUsers()
      ]);
      setProducts(p);
      setCustomers(c);
      setOrders(o);
      setUsers(u);
    } catch (e) {
      setError(e.message);
      console.error('Data load error:', e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ═══ Products ═══
  const addProduct = useCallback(async (product) => {
    const created = await api.createProduct(product);
    setProducts(prev => [...prev, created]);
    return created;
  }, []);

  const removeProduct = useCallback(async (productId) => {
    await api.deleteProduct(productId);
    setProducts(prev => prev.filter(p => p.id !== productId));
  }, []);

  // ═══ Customers ═══
  const addCustomer = useCallback(async (customer) => {
    const created = await api.createCustomer(customer);
    setCustomers(prev => [...prev, created]);
    return created;
  }, []);

  const addCustomerNote = useCallback(async (customerId, text, userName) => {
    const note = await api.addCustomerNote(customerId, text, userName);
    setCustomers(prev => prev.map(c =>
      c.id === customerId ? { ...c, notes: [...c.notes, note] } : c
    ));
  }, []);

  // ═══ Orders ═══
  const addOrder = useCallback(async (order) => {
    const orderId = await api.createOrder(order);
    // Reload orders and products (stock changed)
    const [newOrders, newProducts] = await Promise.all([
      api.fetchOrders(),
      api.fetchProducts()
    ]);
    setOrders(newOrders);
    setProducts(newProducts);
    return orderId;
  }, []);

  const updateOrderStatus = useCallback(async (orderId, newStatus, logEntry, shipmentData) => {
    await api.updateOrderStatus(orderId, newStatus, logEntry, shipmentData);
    // Update local state
    setOrders(prev => prev.map(o => {
      if (o.id !== orderId) return o;
      return {
        ...o,
        status: newStatus,
        logs: [...o.logs, logEntry],
        ...(shipmentData ? { shipment: shipmentData } : {})
      };
    }));
    // Reload products if cancelled (stock restored)
    if (newStatus === 'CANCELLED') {
      const newProducts = await api.fetchProducts();
      setProducts(newProducts);
    }
  }, []);

  // ═══ Users ═══
  const addUser = useCallback(async (name, phone, password, role) => {
    const created = await api.createUser(name, phone, password, role);
    setUsers(prev => [...prev, created]);
    return created;
  }, []);

  return (
    <DataContext.Provider value={{
      products, customers, orders, users, loading, error,
      addProduct, removeProduct,
      addCustomer, addCustomerNote,
      addOrder, updateOrderStatus,
      addUser, reload: loadAll
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
