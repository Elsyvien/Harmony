import { useState } from 'react';

interface AuthFormValues {
  username?: string;
  email: string;
  password: string;
}

interface AuthFormProps {
  mode: 'login' | 'register';
  loading: boolean;
  error: string | null;
  onSubmit: (values: AuthFormValues) => Promise<void>;
}

export function AuthForm(props: AuthFormProps) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  return (
    <form
      className="auth-card"
      onSubmit={async (event) => {
        event.preventDefault();
        await props.onSubmit({
          username: props.mode === 'register' ? username : undefined,
          email,
          password,
        });
      }}
    >
      <h1>{props.mode === 'login' ? 'Welcome Back' : 'Create Account'}</h1>
      <p className="auth-subtitle">DiscordClone MVP</p>

      {props.mode === 'register' ? (
        <label className="field">
          <span>Username</span>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            minLength={3}
            maxLength={24}
            required
          />
        </label>
      ) : null}

      <label className="field">
        <span>Email</span>
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          autoComplete="email"
          required
        />
      </label>

      <label className="field">
        <span>Password</span>
        <input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          autoComplete={props.mode === 'login' ? 'current-password' : 'new-password'}
          minLength={8}
          maxLength={72}
          required
        />
      </label>

      {props.error ? <p className="error-banner">{props.error}</p> : null}

      <button className="primary-btn" type="submit" disabled={props.loading}>
        {props.loading ? (
          <span className="btn-loader">
            <img
              src="https://github.com/user-attachments/assets/d95f17bf-855f-4b0f-a15b-a304021981ea"
              alt=""
              aria-hidden="true"
            />
            <span>Please wait...</span>
          </span>
        ) : props.mode === 'login' ? (
          'Log In'
        ) : (
          'Create Account'
        )}
      </button>
    </form>
  );
}
