import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ziduLogo from '../assets/zidu-logo.png';

// Soft Wellness：暖米 #EFEAE2 / 深紫 #5C4B73 / 蜂蜜黄 #F3BD5B / 草本绿 #7B8F67
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
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden zidu-login">

      <div className="w-full max-w-sm mx-4 relative z-10">
        <div className="text-center mb-8">
          <img src={ziduLogo} alt="紫都 ZIDU" style={{ height: 48, margin: '0 auto' }} />
          <div style={{ color: '#8D7442', fontSize: 12, fontWeight: 600, marginTop: 12 }}>ZIDU AROMA</div>
          <div style={{ color: '#7C756B', fontSize: 12, marginTop: 8 }}>源自新疆 · 深耕行业三十三年的精油应用专家</div>
        </div>

        <div className="rounded-lg p-7 zidu-login-card">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs mb-1.5" style={{ color: '#7A7164', letterSpacing: 2, fontWeight: 500 }}>手机号</label>
              <input
                type="tel"
                value={phone}
                onChange={e => { setPhone(e.target.value); setError(''); }}
                placeholder="请输入手机号"
                className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none zidu-input"
                style={{ background: '#FFFCF7', border: '1px solid #E6DECF', color: '#3F3650' }}
                autoComplete="tel"
              />
            </div>
            <div>
              <label className="block text-xs mb-1.5" style={{ color: '#7A7164', letterSpacing: 2, fontWeight: 500 }}>密码</label>
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); }}
                placeholder="请输入密码"
                className="w-full px-4 py-3 rounded-xl text-sm focus:outline-none zidu-input"
                style={{ background: '#FFFCF7', border: '1px solid #E6DECF', color: '#3F3650' }}
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="text-sm rounded-lg px-3 py-2" style={{ color: '#8D5F5B', background: '#F3E2DE', border: '1px solid #EFD9D4' }}>{error}</div>
            )}

            <button
              type="submit"
              disabled={loading || !phone.trim() || !password.trim()}
              className="w-full py-3 font-medium rounded-lg transition-all disabled:opacity-50"
              style={{ background: '#5C4B73', color: '#FFFFFF', boxShadow: '0 8px 24px rgba(92,75,115,0.20)' }}
            >
              {loading ? '登录中...' : '登 录'}
            </button>
          </form>
        </div>

        <div className="text-center mt-7 text-xs" style={{ color: '#A5A095' }}>
          ZIDU BUSINESS PLATFORM
        </div>
      </div>

      <style>{`.zidu-input::placeholder{color:#B3A99A}.zidu-input:focus{border-color:#5C4B73!important}`}</style>
    </div>
  );
}
