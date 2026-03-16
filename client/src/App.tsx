import { Routes, Route, Navigate } from 'react-router-dom';
import { Suspense, lazy } from 'react';
import Layout from './components/Layout/Layout';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import Login from './pages/Login';
import Dashboard from './components/Dashboard/Dashboard';
import { Loader2 } from 'lucide-react';

// Lazy load heavy pages
const EventList = lazy(() => import('./components/Events/EventList'));
const EventDetail = lazy(() => import('./components/Events/EventDetail'));
const CardList = lazy(() => import('./components/Cards/CardList'));
const CardGenerator = lazy(() => import('./components/Cards/CardGenerator'));
const GameList = lazy(() => import('./components/Game/GameList'));
const GamePlay = lazy(() => import('./components/Game/GamePlay'));
const CardValidator = lazy(() => import('./components/Cards/CardValidator'));
const CardActivation = lazy(() => import('./components/Cards/CardActivation'));
const Users = lazy(() => import('./pages/Users'));
const QRExport = lazy(() => import('./components/Export/QRExport'));
const BarcodeExport = lazy(() => import('./components/Export/BarcodeExport'));
const QRCajasExport = lazy(() => import('./components/Export/QRCajasExport'));
const QRLibretasExport = lazy(() => import('./components/Export/QRLibretasExport'));
const PromoPage = lazy(() => import('./components/Promo/PromoPage'));
const InventoryPage = lazy(() => import('./components/Inventory/InventoryPage'));
const AsignacionDetail = lazy(() => import('./components/Inventory/AsignacionDetail'));
const InventarioUsuarios = lazy(() => import('./components/Inventory/InventarioUsuarios'));
const MiInventario = lazy(() => import('./components/Inventory/MiInventario'));
const VentaPage = lazy(() => import('./components/Inventory/VentaPage'));
const LoteriaDashboard = lazy(() => import('./components/Inventory/LoteriaDashboard'));
const BackupPage = lazy(() => import('./components/Backup/BackupPage'));
const Permissions = lazy(() => import('./pages/Permissions'));
const ActivityLog = lazy(() => import('./pages/ActivityLog'));
const MisUsuarios = lazy(() => import('./pages/MisUsuarios'));

function LazyFallback() {
  return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

function App() {
  return (
    <Suspense fallback={<LazyFallback />}>
    <Routes>
      {/* Ruta pública - Login */}
      <Route path="/login" element={<Login />} />

      {/* Rutas protegidas */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />

        {/* Eventos - lectura para todos, creación solo admin */}
        <Route path="events" element={<EventList />} />
        <Route path="events/:id" element={<EventDetail />} />

        {/* Cartones - lectura para todos */}
        <Route path="cards" element={<CardList />} />

        {/* Generar cartones - solo admin */}
        <Route
          path="cards/generate/:eventId"
          element={
            <ProtectedRoute permission="cards:create">
              <CardGenerator />
            </ProtectedRoute>
          }
        />

        {/* Activar/Vender cartones */}
        <Route
          path="cards/activate"
          element={
            <ProtectedRoute permission="cards:sell">
              <CardActivation />
            </ProtectedRoute>
          }
        />

        {/* Validar cartones - todos pueden validar */}
        <Route path="cards/validate" element={<CardValidator />} />

        {/* Juegos - lectura para todos */}
        <Route path="games" element={<GameList />} />

        {/* Jugar - solo admin y moderador */}
        <Route
          path="games/:id"
          element={
            <ProtectedRoute permission="games:play">
              <GamePlay />
            </ProtectedRoute>
          }
        />

        {/* Gestión de usuarios - solo admin */}
        <Route
          path="users"
          element={
            <ProtectedRoute permission="users:read">
              <Users />
            </ProtectedRoute>
          }
        />

        {/* Mis Usuarios - solo loteria */}
        <Route
          path="mis-usuarios"
          element={
            <ProtectedRoute permission="sub_users:manage">
              <MisUsuarios />
            </ProtectedRoute>
          }
        />

        {/* Promocion / Raspadito */}
        <Route
          path="promo"
          element={
            <ProtectedRoute permission="cards:create">
              <PromoPage />
            </ProtectedRoute>
          }
        />

        {/* Inventario — rutas estáticas ANTES de la dinámica :eventId */}
        <Route
          path="inventory"
          element={
            <ProtectedRoute permission="inventory:read">
              <InventoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="inventory/usuarios"
          element={
            <ProtectedRoute permission="inventory:manage">
              <InventarioUsuarios />
            </ProtectedRoute>
          }
        />
        <Route
          path="inventory/mi-inventario"
          element={
            <ProtectedRoute permission="inventory:read">
              <MiInventario />
            </ProtectedRoute>
          }
        />
        <Route
          path="inventory/venta"
          element={
            <ProtectedRoute permission="inventory:read">
              <VentaPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="inventory/:eventId"
          element={
            <ProtectedRoute permission="inventory:read">
              <InventoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="inventory/:eventId/asignacion/:id"
          element={
            <ProtectedRoute permission="inventory:read">
              <AsignacionDetail />
            </ProtectedRoute>
          }
        />

        {/* Dashboard Lotería */}
        <Route
          path="loteria"
          element={
            <ProtectedRoute permission="inventory:read">
              <LoteriaDashboard />
            </ProtectedRoute>
          }
        />

        {/* Backup y Restauración */}
        <Route
          path="backup"
          element={
            <ProtectedRoute permission="users:read">
              <BackupPage />
            </ProtectedRoute>
          }
        />

        {/* Permisos */}
        <Route
          path="permisos"
          element={
            <ProtectedRoute permission="permissions:manage">
              <Permissions />
            </ProtectedRoute>
          }
        />

        {/* Auditoría */}
        <Route
          path="auditoria"
          element={
            <ProtectedRoute permission="audit:read">
              <ActivityLog />
            </ProtectedRoute>
          }
        />

        {/* Exportar QR Codes */}
        <Route
          path="export/qr"
          element={
            <ProtectedRoute permission="cards:export">
              <QRExport />
            </ProtectedRoute>
          }
        />

        {/* Exportar Codigos de Barra */}
        <Route
          path="export/barcode"
          element={
            <ProtectedRoute permission="cards:export">
              <BarcodeExport />
            </ProtectedRoute>
          }
        />

        {/* QR Cajas */}
        <Route
          path="export/qr-cajas"
          element={
            <ProtectedRoute permission="cards:export">
              <QRCajasExport />
            </ProtectedRoute>
          }
        />

        {/* QR Libretas */}
        <Route
          path="export/qr-libretas"
          element={
            <ProtectedRoute permission="cards:export">
              <QRLibretasExport />
            </ProtectedRoute>
          }
        />

        {/* Ruta por defecto */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </Suspense>
  );
}

export default App;
