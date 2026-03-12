import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import ProtectedRoute from './components/Auth/ProtectedRoute';
import Login from './pages/Login';
import Dashboard from './components/Dashboard/Dashboard';
import EventList from './components/Events/EventList';
import EventDetail from './components/Events/EventDetail';
import CardList from './components/Cards/CardList';
import CardGenerator from './components/Cards/CardGenerator';
import GameList from './components/Game/GameList';
import GamePlay from './components/Game/GamePlay';
import CardValidator from './components/Cards/CardValidator';
import CardActivation from './components/Cards/CardActivation';
import Users from './pages/Users';
import QRExport from './components/Export/QRExport';
import BarcodeExport from './components/Export/BarcodeExport';
import PromoPage from './components/Promo/PromoPage';
import InventoryPage from './components/Inventory/InventoryPage';
import AsignacionDetail from './components/Inventory/AsignacionDetail';
import InventarioUsuarios from './components/Inventory/InventarioUsuarios';
import MiInventario from './components/Inventory/MiInventario';
import VentaPage from './components/Inventory/VentaPage';

function App() {
  return (
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

        {/* Promocion / Raspadito */}
        <Route
          path="promo"
          element={
            <ProtectedRoute permission="cards:create">
              <PromoPage />
            </ProtectedRoute>
          }
        />

        {/* Inventario */}
        <Route
          path="inventory"
          element={
            <ProtectedRoute permission="inventory:read">
              <InventoryPage />
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

        {/* Ruta por defecto */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
