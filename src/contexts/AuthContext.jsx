import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import * as api from '../lib/api';
import { supabase } from '../lib/supabase';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    api.restoreSession().then(profile => {
      if (active) setUser(profile);
    }).finally(() => {
      if (active) setInitializing(false);
    });

    const { data } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_OUT' && active) setUser(null);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const login = useCallback(async (phone, password) => {
    setLoading(true);
    setError('');
    try {
      const u = await api.login(phone, password);
      setUser(u);
      return u;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setLoading(true);
    try { await api.logout(); } catch { /* local logout must still complete */ }
    setUser(null);
    setLoading(false);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading: loading || initializing, error, login, logout, setError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
