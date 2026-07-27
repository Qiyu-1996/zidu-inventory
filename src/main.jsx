import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { DataProvider } from './contexts/DataContext';

function SessionDataProvider({ children }) {
  const { user } = useAuth();
  const sessionKey = user ? `${user.id}:${user.role}` : 'signed-out';
  return <DataProvider key={sessionKey}>{children}</DataProvider>;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <SessionDataProvider>
        <App />
      </SessionDataProvider>
    </AuthProvider>
  </StrictMode>,
);
