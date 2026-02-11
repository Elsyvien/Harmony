import { createContext, useContext, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { User } from '../types/api';

const TOKEN_KEY = 'discordclone_token';
const USER_KEY = 'discordclone_user';

interface AuthState {
  token: string | null;
  user: User | null;
}

interface AuthContextValue extends AuthState {
  setAuth: (token: string, user: User) => void;
  clearAuth: () => void;
}

const initialToken = localStorage.getItem(TOKEN_KEY);
const initialUser = localStorage.getItem(USER_KEY);

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<AuthState>({
    token: initialToken,
    user: initialUser ? (JSON.parse(initialUser) as User) : null,
  });

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      setAuth: (token, user) => {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        setState({ token, user });
      },
      clearAuth: () => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setState({ token: null, user: null });
      },
    }),
    [state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
