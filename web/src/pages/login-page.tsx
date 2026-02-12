import { Navigate, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { chatApi } from '../api/chat-api';
import { AuthForm } from '../components/auth-form';
import { useAuth } from '../store/auth-store';
import { getErrorMessage } from '../utils/error-message';

export function LoginPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Harmony';
  }, []);

  if (auth.token) {
    return <Navigate to="/chat" replace />;
  }

  return (
    <main className="auth-page">
      <AuthForm
        mode="login"
        loading={loading}
        error={error}
        switchCopy="No account yet?"
        switchHref="/register"
        switchLabel="Create one"
        onSubmit={async ({ email, password }) => {
          try {
            setLoading(true);
            setError(null);
            const response = await chatApi.login({ email, password });
            auth.setAuth(response.token, response.user);
            navigate('/chat');
          } catch (err) {
            setError(getErrorMessage(err, 'Login failed'));
          } finally {
            setLoading(false);
          }
        }}
      />
    </main>
  );
}
