import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { User, UserRole, AuthState } from '../types/auth';
import { hasPermission as hasPermissionDefault } from '../types/auth';
import api from '../services/api';

interface AuthContextType extends AuthState {
  login: (username: string, password: string, turnstileToken?: string) => Promise<User | null>;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
  isRole: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

// M10: token en httpOnly cookie, solo guardamos user en localStorage
const USER_KEY = 'bingo_auth_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: true,
  });
  const [dynamicPermissions, setDynamicPermissions] = useState<string[] | null>(null);

  const loadDynamicPermissions = useCallback(async () => {
    try {
      const resp = await api.get('/permissions/my');
      if (resp.data.success) {
        setDynamicPermissions(resp.data.data.permissions);
      }
    } catch {
      // Fallback a permisos hardcodeados
      setDynamicPermissions(null);
    }
  }, []);

  const clearAuth = useCallback(() => {
    localStorage.removeItem(USER_KEY);
    setState({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
    });
  }, []);

  const verifyToken = useCallback(async () => {
    try {
      const response = await api.get('/auth/me');
      if (response.data.success) {
        const user = response.data.data as User;
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        setState(s => ({ ...s, user, isAuthenticated: true, isLoading: false }));
        loadDynamicPermissions();
      } else {
        clearAuth();
      }
    } catch {
      clearAuth();
    }
  }, [loadDynamicPermissions, clearAuth]);

  // Al iniciar, verificar si la cookie httpOnly es válida
  useEffect(() => {
    const userStr = localStorage.getItem(USER_KEY);

    if (userStr) {
      try {
        const user = JSON.parse(userStr) as User;
        setState({
          user,
          token: null,
          isAuthenticated: true,
          isLoading: true,
        });
        verifyToken();
      } catch {
        clearAuth();
      }
    } else {
      // Intentar verificar por si hay cookie válida
      verifyToken();
    }
  }, [verifyToken, clearAuth]);

  const login = async (username: string, password: string, turnstileToken?: string): Promise<User | null> => {
    try {
      const response = await api.post('/auth/login', { username, password, turnstileToken });

      if (response.data.success) {
        const { user } = response.data.data;

        // Limpiar cache del usuario anterior
        queryClient.clear();

        // M10: cookie httpOnly se setea automáticamente por el server
        localStorage.setItem(USER_KEY, JSON.stringify(user));

        setState({
          user,
          token: null,
          isAuthenticated: true,
          isLoading: false,
        });

        loadDynamicPermissions();

        return user;
      }
      return null;
    } catch (error) {
      console.error('Error en login:', error);
      return null;
    }
  };

  const logout = () => {
    // M10: limpiar cookie httpOnly en el server
    api.post('/auth/logout').catch(() => {});
    setDynamicPermissions(null);
    // Limpiar todo el cache de React Query para evitar datos de otro usuario
    queryClient.clear();
    clearAuth();
  };

  const checkPermission = useCallback((permission: string): boolean => {
    if (!state.user) return false;
    // Usar permisos dinámicos si están cargados, sino fallback a defaults
    if (dynamicPermissions) {
      return dynamicPermissions.includes(permission);
    }
    return hasPermissionDefault(state.user.role, permission);
  }, [state.user, dynamicPermissions]);

  const isRole = (...roles: UserRole[]): boolean => {
    if (!state.user) return false;
    return roles.includes(state.user.role);
  };

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        logout,
        hasPermission: checkPermission,
        isRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de un AuthProvider');
  }
  return context;
}
