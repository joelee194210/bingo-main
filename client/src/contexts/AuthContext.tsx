import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import type { User, UserRole, AuthState } from '../types/auth';
import { hasPermission } from '../types/auth';
import api from '../services/api';

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  hasPermission: (permission: string) => boolean;
  isRole: (...roles: UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

// M10: token ahora en httpOnly cookie, solo guardamos user en localStorage
const USER_KEY = 'bingo_auth_user';
// Token en memoria solo para Socket.IO (no persiste en localStorage)
let memoryToken: string | null = null;

export function getAuthToken(): string | null {
  return memoryToken;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: true,
  });

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
  }, []);

  const verifyToken = async () => {
    try {
      const response = await api.get('/auth/me');
      if (response.data.success) {
        const user = response.data.data as User;
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        setState(s => ({ ...s, user, isAuthenticated: true, isLoading: false }));
      } else {
        clearAuth();
      }
    } catch {
      clearAuth();
    }
  };

  const clearAuth = () => {
    localStorage.removeItem(USER_KEY);
    memoryToken = null;
    setState({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
    });
  };

  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      const response = await api.post('/auth/login', { username, password });

      if (response.data.success) {
        const { token, user } = response.data.data;

        // M10: cookie httpOnly se setea automáticamente por el server
        // Guardar solo user en localStorage, token en memoria para Socket.IO
        localStorage.setItem(USER_KEY, JSON.stringify(user));
        memoryToken = token;

        setState({
          user,
          token,
          isAuthenticated: true,
          isLoading: false,
        });

        return true;
      }
      return false;
    } catch (error) {
      console.error('Error en login:', error);
      return false;
    }
  };

  const logout = () => {
    // M10: limpiar cookie httpOnly en el server
    api.post('/auth/logout').catch(() => {});
    clearAuth();
  };

  const checkPermission = (permission: string): boolean => {
    if (!state.user) return false;
    return hasPermission(state.user.role, permission);
  };

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
