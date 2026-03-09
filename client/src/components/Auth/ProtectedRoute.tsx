import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import type { UserRole } from '../../types/auth';
import { Button } from '@/components/ui/button';
import { Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';

interface ProtectedRouteProps {
  children: React.ReactNode;
  permission?: string;
  roles?: UserRole[];
}

export default function ProtectedRoute({ children, permission, roles }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading, hasPermission, isRole } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="mt-4 text-muted-foreground">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (permission && !hasPermission(permission)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="bg-card border rounded-lg shadow-lg p-8 max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-destructive/10 rounded-full mb-4">
            <ShieldAlert className="w-8 h-8 text-destructive" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Acceso Denegado</h2>
          <p className="text-muted-foreground mb-4">No tiene permisos para acceder a esta sección.</p>
          <Button onClick={() => window.history.back()}>Volver</Button>
        </div>
      </div>
    );
  }

  if (roles && roles.length > 0 && !isRole(...roles)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="bg-card border rounded-lg shadow-lg p-8 max-w-md text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-yellow-100 dark:bg-yellow-900/30 rounded-full mb-4">
            <ShieldCheck className="w-8 h-8 text-yellow-600 dark:text-yellow-400" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Rol Insuficiente</h2>
          <p className="text-muted-foreground mb-4">Su rol de usuario no tiene acceso a esta sección.</p>
          <Button onClick={() => window.history.back()}>Volver</Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
