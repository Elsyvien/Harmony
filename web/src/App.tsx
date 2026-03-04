import { Navigate, Route, Routes } from 'react-router-dom';
import { ChatPage } from './pages/chat-page';
import { LoginPage } from './pages/login-page';
import { PrivacyPage } from './pages/privacy-page';
import { RegisterPage } from './pages/register-page';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/chat" element={<ChatPage />} />
      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  );
}
