import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function LoginScreen() {
  const { login, loading, error, setError } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!phone.trim() || !password.trim()) return;
    await login(phone.trim(), password);
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: "linear-gradient(135deg, #1e1a2e 0%, #3b2d5e 50%, #6c5ce7 100%)" }}>
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-sm mx-4">
        <div className="text-center mb-8">
          <div className="text-3xl font-bold" style={{ color: "#1e1a2e" }}>
            紫都 <span className="text-purple-400 text-lg font-normal">ZBP</span>
          </div>
          <div className="text-sm text-gray-400 mt-1">业务管理平台</div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">手机号</label>
            <input
              type="tel"
              value={phone}
              onChange={e => { setPhone(e.target.value); setError(''); }}
              placeholder="请输入手机号"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-transparent"
              autoComplete="tel"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">密码</label>
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(''); }}
              placeholder="请输入密码"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-transparent"
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</div>
          )}

          <button
            type="submit"
            disabled={loading || !phone.trim() || !password.trim()}
            className="w-full py-3 text-white font-medium rounded-xl transition-all disabled:opacity-50"
            style={{ background: "linear-gradient(135deg, #4a3560, #6c5ce7)" }}
          >
            {loading ? '登录中...' : '登  录'}
          </button>
        </form>

        <div className="text-center mt-6 text-xs text-gray-300">
          ZIDU Business Platform v2.0
        </div>
      </div>
    </div>
  );
}
