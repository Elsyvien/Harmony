import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './store/auth-store';
import harmonyLogo from '../ressources/logos/logo.png';
import './styles/global.css';
import './styles/user-sidebar.css';

const favicon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
if (favicon) {
  favicon.href = harmonyLogo;
} else {
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = harmonyLogo;
  document.head.appendChild(link);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>,
);
