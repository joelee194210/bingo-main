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

const TOKEN_KEY = 'bingo_auth_token';
const USER_KEY = 'bingo_auth_user';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    token: null,
    isAuthenticated: false,
    isLoading: true,
  });

  // Cargar token y usuario del localStorage al iniciar
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    const userStr = localStorage.getItem(USER_KEY);

    if (token && userStr) {
      try {
        const user = JSON.parse(userStr) as User;
        // Configurar token en axios
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        setState({
          user,
          token,
          isAuthenticated: true,
          isLoading: true,
        });

        // Verificar token con el servidor
        verifyToken();
      } catch {
        // Token o usuario inválido
        clearAuth();
      }
    } else {
      setState(s => ({ ...s, isLoading: false }));
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
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    delete api.defaults.headers.common['Authorization'];
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

        // Guardar en localStorage
        localStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(USER_KEY, JSON.stringify(user));

        // Configurar token en axios
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`;

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
