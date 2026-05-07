import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import './index.css';
import { useStore } from './stores/useStore';
import { applyTheme } from './themes';
import AuthPage from './pages/AuthPage';
import AppPage from './pages/AppPage';

function ProtectedRoute({ children }) {
  const token = useStore(s => s.token);
  return token ? children : <Navigate to="/login" replace />;
}

function App() {
  const user = useStore(s => s.user);
  
  React.useEffect(() => {
    applyTheme(user?.theme || 'dark');
  }, [user?.theme]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/*" element={<ProtectedRoute><AppPage /></ProtectedRoute>} />
      </Routes>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: { background: 'var(--bg-elevated)', color: 'var(--text-primary)', border: '1px solid var(--border)', fontFamily: 'var(--font-sans)', fontSize: 13 },
          success: { iconTheme: { primary: 'var(--success)', secondary: 'var(--bg-base)' } },
          error: { iconTheme: { primary: 'var(--danger)', secondary: 'var(--bg-base)' } }
        }}
      />
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
