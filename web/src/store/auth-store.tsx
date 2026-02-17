import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { User, UserRole } from '../types/api';
import { chatApi } from '../api/chat-api';
import {
  AUTH_TOKEN_STORAGE_KEY,
  AUTH_UNAUTHORIZED_EVENT,
  AUTH_USER_STORAGE_KEY,
  clearStoredAuth,
} from '../config/auth';
import { getStorageItem, setStorageItem } from '../utils/safe-storage';

interface AuthState {
  token: string | null;
  user: User | null;
}

interface AuthContextValue extends AuthState {
  hydrating: boolean;
  setAuth: (token: string, user: User) => void;
  clearAuth: () => void;
}

const initialToken = getStorageItem(AUTH_TOKEN_STORAGE_KEY);
const initialUser = getStorageItem(AUTH_USER_STORAGE_KEY);

function isUserRole(value: unknown): value is UserRole {
  return value === 'OWNER' || value === 'ADMIN' || value === 'MODERATOR' || value === 'MEMBER';
}

function parseStoredUser(raw: string | null): User | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<User>;
    if (!parsed.id || !parsed.username || !parsed.email || !parsed.createdAt) {
      return null;
    }
    const role: UserRole = isUserRole(parsed.role) ? parsed.role : 'MEMBER';
    const isAdmin = role === 'OWNER' || role === 'ADMIN';
    return {
      id: parsed.id,
      username: parsed.username,
      email: parsed.email,
      createdAt: parsed.createdAt,
      avatarUrl: typeof parsed.avatarUrl === 'string' ? parsed.avatarUrl : undefined,
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
  const [hydrating, setHydrating] = useState(Boolean(initialToken));

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const handleUnauthorized = () => {
      setHydrating(false);
      setState({ token: null, user: null });
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => {
      window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    };
  }, []);

  useEffect(() => {
    if (!state.token || !hydrating) {
      return;
    }

    let disposed = false;
    const hydrate = async () => {
      try {
        const response = await chatApi.me(state.token as string);
        if (disposed) {
          return;
        }
        setStorageItem(AUTH_USER_STORAGE_KEY, JSON.stringify(response.user));
        setState((prev) => ({ ...prev, user: response.user }));
      } catch {
        if (disposed) {
          return;
        }
        clearStoredAuth();
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
  }, [state.token, hydrating]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      hydrating,
      setAuth: (token, user) => {
        setStorageItem(AUTH_TOKEN_STORAGE_KEY, token);
        setStorageItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
        setHydrating(false);
        setState({ token, user });
      },
      clearAuth: () => {
        clearStoredAuth();
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
