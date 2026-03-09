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
import Users from './pages/Users';
import InventoryPage from './components/Inventory/InventoryPage';
import MovementHistory from './components/Inventory/MovementHistory';

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
          path="inventory/movements/:eventId"
          element={
            <ProtectedRoute permission="inventory:read">
              <MovementHistory />
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
