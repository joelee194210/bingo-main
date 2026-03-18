import { Outlet, NavLink, useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { ROLE_LABELS } from '@/types/auth';
import { Button } from '@/components/ui/button';
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
    ],
  },
  {
    label: 'Inventario',
    items: [
      { to: '/inventory', icon: Warehouse, label: 'Inventario', permission: 'inventory:read' },
      { to: '/inventory/mi-inventario', icon: PackageOpen, label: 'Mi Inventario', permission: 'inventory:read' },
      { to: '/inventory/venta', icon: ShoppingCart, label: 'Punto de Venta', permission: 'inventory:read' },
      { to: '/inventory/venta-general', icon: ShoppingCart, label: 'Venta General', permission: 'inventory:read' },
      { to: '/dashboard-general', icon: BarChart3, label: 'Dashboard General', permission: 'inventory:manage' },
      { to: '/loteria', icon: BarChart3, label: 'Dashboard Loteria', permission: 'inventory:read' },
      { to: '/reportes/ventas', icon: ClipboardList, label: 'Reporte Ventas', permission: 'reports:read' },
      { to: '/inventory/usuarios', icon: UserCog, label: 'Usuarios Inv.', permission: 'inventory:manage' },
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
  const { user, logout, hasPermission } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
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
          <div className="flex items-center gap-3">
            <div className="sidebar-logo w-9 h-9 rounded-lg flex items-center justify-center text-lg font-bold text-white">
              B
            </div>
            <div>
              <span className="text-[15px] font-bold text-white tracking-tight">Bingo Pro</span>
              <p className="text-[10px] text-slate-500 font-medium tracking-widest uppercase">Manager</p>
            </div>
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
                onClick={handleLogout}
                className="text-destructive focus:text-destructive cursor-pointer"
              >
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar Sesion
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-8 animate-fade-in-up min-w-0">
          <Outlet />
        </main>

        {/* Footer */}
        <footer className="shrink-0 border-t px-4 lg:px-8 py-4 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Bingo Pro Manager &copy; 2026</span>
          <span>v2.0</span>
        </footer>
      </div>
    </div>
  );
}
