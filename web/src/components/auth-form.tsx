import { Link } from 'react-router-dom';
import { useState } from 'react';
import harmonyLogo from '../../ressources/logos/logo.png';

interface AuthFormValues {
  username?: string;
  email: string;
  password: string;
}

interface AuthFormProps {
  mode: 'login' | 'register';
  loading: boolean;
  error: string | null;
  switchCopy: string;
  switchHref: string;
  switchLabel: string;
  onSubmit: (values: AuthFormValues) => Promise<void>;
}

export function AuthForm(props: AuthFormProps) {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const isLogin = props.mode === 'login';
  const eyebrow = isLogin ? 'Pick up where your conversation left off.' : 'Bring your people into one shared space.';
  const description = isLogin
    ? 'Jump back into servers, voice rooms, and direct messages without digging through noise.'
    : 'Create a workspace for chat, voice, and quick collaboration with a calmer interface than the usual clone.'
  const points = isLogin
    ? ['Resume active voice sessions quickly', 'Search channels and messages from one shell', 'Keep server, friends, and settings in reach']
    : ['Spin up rooms for text and voice instantly', 'Keep DMs, servers, and presence in one place', 'Tune notifications, appearance, and audio from day one'];

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
      <div className="auth-card-grid">
        <section className="auth-story" aria-hidden="true">
          <div className="auth-brand">
            <img className="auth-logo" src={harmonyLogo} alt="" />
            <div className="auth-brand-copy">
              <span>Harmony</span>
              <small>Chat, voice, and rooms that stay readable.</small>
            </div>
          </div>
          <p className="auth-story-eyebrow">{eyebrow}</p>
          <p className="auth-story-text">{description}</p>
          <ul className="auth-story-points">
            {points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </section>

        <section className="auth-form-panel">
          <div className="auth-form-header">
            <span className="auth-kicker">{isLogin ? 'Welcome back' : 'Create your account'}</span>
            <h1>{isLogin ? 'Sign in to Harmony' : 'Start with Harmony'}</h1>
            <p className="auth-subtitle">
              {isLogin
                ? 'Use your account details to return to your current rooms.'
                : 'Set up your account, then personalize the workspace from settings.'}
            </p>
          </div>

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
              <span className="btn-loader" role="status" aria-live="polite" aria-label="Submitting form">
                <span className="btn-loader-spinner" aria-hidden="true" />
                <span>Please wait...</span>
              </span>
            ) : isLogin ? (
              'Log In'
            ) : (
              'Create Account'
            )}
          </button>

          <div className="auth-footer">
            <p className="auth-switch-copy">
              {props.switchCopy} <Link to={props.switchHref}>{props.switchLabel}</Link>
            </p>
            <p className="auth-switch-copy">
              <Link to="/privacy">Privacy Policy</Link>
            </p>
          </div>
        </section>
      </div>
    </form>
  );
}
