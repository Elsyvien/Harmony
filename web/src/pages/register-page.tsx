import { Navigate, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { chatApi } from '../api/chat-api';
import { AuthForm } from '../components/auth-form';
import { useAuth } from '../store/auth-store';
import { getErrorMessage } from '../utils/error-message';
import { trackTelemetry } from '../utils/telemetry';

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
        switchCopy="Already have an account?"
        switchHref="/login"
        switchLabel="Log in"
        onSubmit={async ({ username, email, password }) => {
          try {
            setLoading(true);
            setError(null);
            const response = await chatApi.register({
              username: username ?? '',
              email,
              password,
            });
            trackTelemetry({
              name: 'auth.register.succeeded',
              success: true,
              context: {
                method: 'password',
              },
            });
            auth.setAuth(response.token, response.user);
            navigate('/chat');
          } catch (err: unknown) {
            const errorCode = typeof err === 'object' && err && 'code' in err && typeof (err as { code?: unknown }).code === 'string'
              ? (err as { code: string }).code
              : undefined;
            trackTelemetry({
              name: 'auth.register.failed',
              level: 'warn',
              success: false,
              context: {
                method: 'password',
                code: errorCode,
              },
            });
            setError(getErrorMessage(err, 'Registration failed'));
          } finally {
            setLoading(false);
          }
        }}
      />
    </main>
  );
}
