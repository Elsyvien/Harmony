import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { User, UserRole } from '../types/api';
import { chatApi } from '../api/chat-api';
import { getStorageItem, removeStorageItem, setStorageItem } from '../utils/safe-storage';

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

const initialToken = getStorageItem(TOKEN_KEY);
const initialUser = getStorageItem(USER_KEY);

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
    const normalizedUsername = parsed.username.trim().toLowerCase();
    const fallbackRole: UserRole =
      normalizedUsername === 'max'
        ? 'OWNER'
        : parsed.isAdmin
          ? 'ADMIN'
          : 'MEMBER';
    const role = isUserRole(parsed.role) ? parsed.role : fallbackRole;
    const isAdmin = parsed.isAdmin ?? (role === 'OWNER' || role === 'ADMIN');
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
        setStorageItem(USER_KEY, JSON.stringify(response.user));
        setState((prev) => ({ ...prev, user: response.user }));
      } catch {
        if (disposed) {
          return;
        }
        removeStorageItem(TOKEN_KEY);
        removeStorageItem(USER_KEY);
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
        setStorageItem(TOKEN_KEY, token);
        setStorageItem(USER_KEY, JSON.stringify(user));
        setHydrating(false);
        setState({ token, user });
      },
      clearAuth: () => {
        removeStorageItem(TOKEN_KEY);
        removeStorageItem(USER_KEY);
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
