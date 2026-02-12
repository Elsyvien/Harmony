import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { User, UserRole } from '../types/api';
import { chatApi } from '../api/chat-api';

const TOKEN_KEY = 'discordclone_token';
const USER_KEY = 'discordclone_user';

interface AuthState {
  token: string | null;
  user: User | null;
}

interface AuthContextValue extends AuthState {
  hydrating: boolean;
  setAuth: (token: string, user: User) => void;
  clearAuth: () => void;
}

const initialToken = localStorage.getItem(TOKEN_KEY);
const initialUser = localStorage.getItem(USER_KEY);

function parseStoredUser(raw: string | null): User | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<User>;
    if (!parsed.id || !parsed.username || !parsed.email || !parsed.createdAt) {
      return null;
    }
    const normalizedUsername = parsed.username.trim().toLowerCase();
    const fallbackRole: UserRole =
      normalizedUsername === 'max'
        ? 'OWNER'
        : parsed.isAdmin
          ? 'ADMIN'
          : 'MEMBER';
    const role = parsed.role ?? fallbackRole;
    const isAdmin = parsed.isAdmin ?? (role === 'OWNER' || role === 'ADMIN');
    return {
      id: parsed.id,
      username: parsed.username,
      email: parsed.email,
      createdAt: parsed.createdAt,
      avatarUrl: parsed.avatarUrl,
      role,
      isAdmin,
    };
  } catch {
    return null;
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const initialParsedUser = parseStoredUser(initialUser);
  const [state, setState] = useState<AuthState>({
    token: initialToken,
    user: initialParsedUser,
  });
  const [hydrating, setHydrating] = useState(Boolean(initialToken && !initialParsedUser));

  useEffect(() => {
    if (!state.token || state.user || !hydrating) {
      return;
    }

    let disposed = false;
    const hydrate = async () => {
      try {
        const response = await chatApi.me(state.token as string);
        if (disposed) {
          return;
        }
        localStorage.setItem(USER_KEY, JSON.stringify(response.user));
        setState((prev) => ({ ...prev, user: response.user }));
      } catch {
        if (disposed) {
          return;
        }
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setState({ token: null, user: null });
      } finally {
        if (!disposed) {
          setHydrating(false);
        }
      }
    };

    void hydrate();
    return () => {
      disposed = true;
    };
  }, [state.token, state.user, hydrating]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      hydrating,
      setAuth: (token, user) => {
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        setHydrating(false);
        setState({ token, user });
      },
      clearAuth: () => {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        setHydrating(false);
        setState({ token: null, user: null });
      },
    }),
    [state, hydrating],
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
