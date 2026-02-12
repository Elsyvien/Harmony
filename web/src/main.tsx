import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './store/auth-store';
import harmonyLogo from '../ressources/logos/logo.png';
import './styles/global.css';
import './styles/user-sidebar.css';

function upsertHeadLink(rel: string) {
  const existing = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (existing) {
    return existing;
  }
  const link = document.createElement('link');
  link.rel = rel;
  document.head.appendChild(link);
  return link;
}

function applyFavicon(href: string) {
  const favicon = upsertHeadLink('icon');
  favicon.type = 'image/png';
  favicon.sizes = '64x64';
  favicon.href = href;

  const appleTouchIcon = upsertHeadLink('apple-touch-icon');
  appleTouchIcon.type = 'image/png';
  appleTouchIcon.sizes = '180x180';
  appleTouchIcon.href = href;
}

function setSquareFaviconFromImage(src: string) {
  const image = new Image();
  image.onload = () => {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) {
      applyFavicon(src);
      return;
    }

    const scale = Math.min(size / image.naturalWidth, size / image.naturalHeight);
    const drawWidth = image.naturalWidth * scale;
    const drawHeight = image.naturalHeight * scale;
    const offsetX = (size - drawWidth) / 2;
    const offsetY = (size - drawHeight) / 2;

    context.clearRect(0, 0, size, size);
    context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
    applyFavicon(canvas.toDataURL('image/png'));
  };
  image.onerror = () => applyFavicon(src);
  image.src = src;
}

setSquareFaviconFromImage(harmonyLogo);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>,
);
