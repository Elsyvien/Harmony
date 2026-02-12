import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { chatApi } from '../api/chat-api';
import { AuthForm } from '../components/auth-form';
import { useAuth } from '../store/auth-store';
import { getErrorMessage } from '../utils/error-message';

export function RegisterPage() {
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
        mode="register"
        loading={loading}
        error={error}
        onSubmit={async ({ username, email, password }) => {
          try {
            setLoading(true);
            setError(null);
            const response = await chatApi.register({
              username: username ?? '',
              email,
              password,
            });
            auth.setAuth(response.token, response.user);
            navigate('/chat');
          } catch (err) {
            setError(getErrorMessage(err, 'Registration failed'));
          } finally {
            setLoading(false);
          }
        }}
      />
      <p className="switch-copy">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}
