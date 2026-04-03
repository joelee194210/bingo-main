import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { APP_VERSION } from '@/version';
import {
  LayoutDashboard,
  CalendarDays,
  CreditCard,
  Gamepad2,
  CheckCircle,
  ScanLine,
  QrCode,
  Barcode,
  Gift,
  Warehouse,
  PackageOpen,
  ShoppingCart,
  Menu,
  X,
  Users,
  UserCog,
  LogOut,
  ChevronRight,
  BarChart3,
  HardDrive,
  ShieldCheck,
  ScrollText,
  Package,
  BookOpen,
  ClipboardList,
  Eye,
  KeyRound,
  Loader2,
  FileDown,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import api from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { ROLE_LABELS } from '@/types/auth';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';

const navGroups = [
  {
    label: 'Principal',
    items: [
      { to: '/', icon: LayoutDashboard, label: 'Dashboard', permission: 'dashboard:read' },
      { to: '/events', icon: CalendarDays, label: 'Eventos', permission: 'events:read' },
      { to: '/games', icon: Gamepad2, label: 'Juegos', permission: 'games:read' },
    ],
  },
  {
    label: 'Cartones',
    items: [
      { to: '/cards', icon: CreditCard, label: 'Cartones', permission: 'cards:read' },
      { to: '/cards/activate', icon: ScanLine, label: 'Activacion', permission: 'cards:sell' },
      { to: '/cards/validate', icon: CheckCircle, label: 'Validar', permission: 'cards:read' },
      { to: '/promo', icon: Gift, label: 'Raspadito', permission: 'cards:create' },
      { to: '/descargar-digital', icon: FileDown, label: 'Descargar Digital', permission: 'cards:sell' },
    ],
  },
  {
    label: 'Inventario',
    items: [
      { to: '/inventory', icon: Warehouse, label: 'Inventario', permission: 'inventory:read' },
      { to: '/inventory/mi-inventario', icon: PackageOpen, label: 'Mi Inventario', permission: 'inventory:read' },
      { to: '/inventory/venta', icon: ShoppingCart, label: 'Punto de Venta Loteria', permission: 'inventory:sell' },
      { to: '/inventory/venta-general', icon: ShoppingCart, label: 'Venta General', permission: 'inventory:sell' },
      { to: '/dashboard-general', icon: BarChart3, label: 'Dashboard General', permission: 'inventory:dashboard' },
      { to: '/resumen-ventas', icon: Eye, label: 'Resumen Ventas', permission: 'inventory:dashboard' },
      { to: '/loteria', icon: BarChart3, label: 'Dashboard Loteria', permission: 'loteria:dashboard' },
      { to: '/reportes/ventas', icon: ClipboardList, label: 'Reporte Ventas', permission: 'reports:sales' },
      { to: '/reportes/ventas-agencias', icon: ClipboardList, label: 'Reporte Ventas Agencias', permission: 'reports:sales_agencias' },
      { to: '/inventory/usuarios', icon: UserCog, label: 'Usuarios Inv.', permission: 'inventory:users' },
    ],
  },
  {
    label: 'Exportar',
    items: [
      { to: '/export/qr', icon: QrCode, label: 'QR Codes', permission: 'cards:export' },
      { to: '/export/barcode', icon: Barcode, label: 'Cod. Barras', permission: 'cards:export' },
      { to: '/export/qr-cajas', icon: Package, label: 'QR Cajas', permission: 'cards:export' },
      { to: '/export/qr-libretas', icon: BookOpen, label: 'QR Libretas', permission: 'cards:export' },
    ],
  },
  {
    label: 'Mi Equipo',
    items: [
      { to: '/mis-usuarios', icon: UserCog, label: 'Mis Usuarios', permission: 'sub_users:manage' },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { to: '/users', icon: Users, label: 'Usuarios', permission: 'users:read' },
      { to: '/permisos', icon: ShieldCheck, label: 'Permisos', permission: 'permissions:manage' },
      { to: '/auditoria', icon: ScrollText, label: 'Auditoria', permission: 'audit:read' },
      { to: '/backup', icon: HardDrive, label: 'Backup', permission: 'users:read' },
    ],
  },
];

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const resetPasswordForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordError('');
  };

  const handleChangePassword = async () => {
    setPasswordError('');
    if (!currentPassword || !newPassword) {
      setPasswordError('Todos los campos son requeridos');
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('La nueva contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Las contraseñas no coinciden');
      return;
    }
    setChangingPassword(true);
    try {
      await api.post('/auth/change-password', { current_password: currentPassword, new_password: newPassword });
      toast.success('Contraseña cambiada exitosamente');
      setShowPasswordDialog(false);
      resetPasswordForm();
    } catch (err: any) {
      setPasswordError(err.response?.data?.error || 'Error al cambiar contraseña');
    } finally {
      setChangingPassword(false);
    }
  };

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => hasPermission(item.permission)),
    }))
    .filter((group) => group.items.length > 0);

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'admin': return 'destructive';
      case 'moderator': return 'info';
      case 'seller': return 'success';
      default: return 'secondary';
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`sidebar fixed top-0 left-0 z-50 h-full w-64 flex flex-col transform transition-transform duration-300 lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-5">
          <div className="flex-1 flex justify-center">
            <img src="/logo.png" alt="Logo" className="h-14 object-contain" />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden text-slate-400 hover:text-white hover:bg-white/5 h-8 w-8"
            onClick={() => setSidebarOpen(false)}
            aria-label="Cerrar menu"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <Separator className="bg-white/[0.06] mx-5" />

        {/* Navigation — scrollable */}
        <nav className="flex-1 overflow-y-auto p-3 mt-2 space-y-3">
          {visibleGroups.map((group) => (
            <div key={group.label} className="space-y-0.5">
              <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest px-4 mb-1">
                {group.label}
              </p>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    isActive ? 'sidebar-item sidebar-item-active' : 'sidebar-item'
                  }
                  onClick={() => setSidebarOpen(false)}
                >
                  <item.icon className="h-[18px] w-[18px] sidebar-icon" />
                  <span className="text-[13px] flex-1">{item.label}</span>
                  <ChevronRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* User section at bottom — fixed */}
        <div className="flex-shrink-0 p-4">
          <Separator className="bg-white/[0.06] mb-4" />
          <div className="flex items-center gap-3 px-2">
            <Avatar className="h-8 w-8 ring-2 ring-blue-500/20">
              <AvatarFallback className="bg-blue-500/10 text-blue-400 text-xs font-bold">
                {user?.full_name?.charAt(0).toUpperCase() || 'U'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-slate-300 truncate">{user?.full_name}</p>
              <p className="text-[10px] text-slate-500 truncate">
                {user?.role ? ROLE_LABELS[user.role] : ''}
              </p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:ml-64 min-h-screen flex flex-col overflow-x-hidden">
        {/* Top bar */}
        <header className="topbar shrink-0">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden h-9 w-9"
              onClick={() => setSidebarOpen(true)}
              aria-label="Abrir menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </div>

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-3 h-auto py-2 hover:bg-muted/60">
                <div className="hidden sm:block text-right">
                  <p className="text-sm font-medium">{user?.full_name}</p>
                  <Badge variant={getRoleBadgeVariant(user?.role || '')} className="text-[10px] h-[18px]">
                    {user?.role ? ROLE_LABELS[user.role] : ''}
                  </Badge>
                </div>
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                    {user?.full_name?.charAt(0).toUpperCase() || 'U'}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <p className="font-medium">{user?.full_name}</p>
                <p className="text-xs text-muted-foreground font-normal">
                  {user?.email || `@${user?.username}`}
                </p>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => { resetPasswordForm(); setShowPasswordDialog(true); }}
                className="cursor-pointer"
              >
                <KeyRound className="mr-2 h-4 w-4" />
                Cambiar Contraseña
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={handleLogout}
                className="text-destructive focus:text-destructive cursor-pointer"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar Sesion
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Cambiar contraseña dialog */}
          <Dialog open={showPasswordDialog} onOpenChange={(v) => { if (!v) resetPasswordForm(); setShowPasswordDialog(v); }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Cambiar Contraseña</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {passwordError && (
                  <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg">
                    {passwordError}
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Contraseña actual</Label>
                  <PasswordInput
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Ingrese su contraseña actual"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Nueva contraseña</Label>
                  <PasswordInput
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimo 8 caracteres"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Confirmar nueva contraseña</Label>
                  <PasswordInput
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repita la nueva contraseña"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => { resetPasswordForm(); setShowPasswordDialog(false); }}>
                  Cancelar
                </Button>
                <Button onClick={handleChangePassword} disabled={changingPassword}>
                  {changingPassword && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Cambiar Contraseña
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-8 animate-fade-in-up min-w-0">
          <Outlet />
        </main>

        {/* Footer */}
        <footer className="shrink-0 border-t px-4 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>MegabingoTV &copy; 2026</span>
          <span>{APP_VERSION}</span>
        </footer>
      </div>
    </div>
  );
}
