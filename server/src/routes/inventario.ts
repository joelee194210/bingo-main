import { Router } from 'express';
import { existsSync } from 'fs';
import { getPool } from '../database/init.js';
import { requirePermission, requireRole } from '../middleware/auth.js';
import * as inv from '../services/inventarioModule.js';
import { getMovimientoPdfPath } from '../services/movimientoPdfService.js';
import { logActivity, auditFromReq } from '../services/auditService.js';
import { createUser, validatePassword } from '../services/authService.js';

const router = Router();

// Helper: verifica si el usuario tiene acceso al almacen (admin/moderator/loteria bypasean)
async function verificarAccesoAlmacen(pool: ReturnType<typeof getPool>, userId: number, userRole: string, almacenIds: number[]): Promise<boolean> {
  if (userRole === 'admin' || userRole === 'moderator' || userRole === 'loteria') return true;
  if (almacenIds.length === 0) return true;
  const validIds = almacenIds.filter(id => id && id > 0);
  if (validIds.length === 0) return false;
  const result = await pool.query(
    `SELECT almacen_id FROM almacen_usuarios WHERE user_id = $1 AND almacen_id = ANY($2) AND is_active = TRUE`,
    [userId, validIds]
  );
  // El usuario debe estar asignado a al menos uno de los almacenes involucrados
  return result.rows.length > 0;
}

// =====================================================
// ALMACENES
// =====================================================

router.get('/almacenes', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const eventId = parseInt(req.query.event_id as string, 10);
    if (!eventId) return res.status(400).json({ success: false, error: 'event_id requerido' });
    const data = await inv.getAlmacenes(pool, eventId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/almacenes/tree/:eventId', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const data = await inv.getAlmacenTree(pool, parseInt(req.params.eventId as string, 10));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.post('/almacenes', requirePermission('inventory:manage'), async (req, res) => {
  try {
    const pool = getPool();
    const { event_id, name, code, parent_id, address, contact_name, contact_phone } = req.body;
    if (!event_id || !name) return res.status(400).json({ success: false, error: 'event_id y name son requeridos' });
    const data = await inv.createAlmacen(pool, event_id, { name, code, parent_id, address, contact_name, contact_phone });
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

router.put('/almacenes/:id', requirePermission('inventory:manage'), async (req, res) => {
  try {
    const pool = getPool();
    const data = await inv.updateAlmacen(pool, parseInt(req.params.id as string, 10), req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

router.get('/almacenes/:id', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const data = await inv.getAlmacen(pool, parseInt(req.params.id as string, 10));
    if (!data) return res.status(404).json({ success: false, error: 'Almacen no encontrado' });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// =====================================================
// MIS ALMACENES (para usuario logueado)
// =====================================================

router.get('/mis-almacenes', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const userId = (req as unknown as { user: { id: number } }).user.id;
    const data = await inv.getMisAlmacenes(pool, userId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// =====================================================
// CREAR USUARIO DE INVENTARIO
// =====================================================

router.post('/crear-usuario', requirePermission('inventory:users'), async (req, res) => {
  try {
    const pool = getPool();
    const { username, password, full_name, email } = req.body;
    if (!username || !password || !full_name) {
      return res.status(400).json({ success: false, error: 'Usuario, contraseña y nombre completo son requeridos' });
    }
    const pwError = validatePassword(password);
    if (pwError) return res.status(400).json({ success: false, error: pwError });

    const user = await createUser(pool, { username, password, full_name, email, role: 'inventory' });

    const reqUser = (req as any).user;
    logActivity(pool, auditFromReq(req, 'inventory_user_created', 'users', {
      created_user: username, created_by: reqUser?.username,
    }));

    res.status(201).json({ success: true, data: user });
  } catch (error) {
    const msg = (error as Error).message;
    if (msg.includes('ya existe') || msg.includes('ya está registrado')) {
      return res.status(400).json({ success: false, error: msg });
    }
    res.status(500).json({ success: false, error: 'Error interno del servidor' });
  }
});

// =====================================================
// ALMACEN USUARIOS
// =====================================================

router.get('/almacenes/:id/usuarios', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const data = await inv.getAlmacenUsuarios(pool, parseInt(req.params.id as string, 10));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.post('/almacenes/:id/usuarios', requirePermission('inventory:users'), async (req, res) => {
  try {
    const pool = getPool();
    const { user_id, rol } = req.body;
    if (!user_id) return res.status(400).json({ success: false, error: 'user_id requerido' });
    const data = await inv.addUsuarioToAlmacen(pool, parseInt(req.params.id as string, 10), user_id, rol);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

// Todos los usuarios de inventario de un evento
router.get('/usuarios/:eventId', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const data = await inv.getInventarioUsuarios(pool, parseInt(req.params.eventId as string, 10));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.put('/almacenes/:id/usuarios/:userId', requirePermission('inventory:users'), async (req, res) => {
  try {
    const pool = getPool();
    const almacenId = parseInt(req.params.id as string, 10);
    const userId = parseInt(req.params.userId as string, 10);
    const { rol, new_almacen_id } = req.body;

    if (new_almacen_id && new_almacen_id !== almacenId) {
      // Reasignar a otro almacen: eliminar del actual, agregar al nuevo
      await inv.removeUsuarioFromAlmacen(pool, almacenId, userId);
      const data = await inv.addUsuarioToAlmacen(pool, new_almacen_id, userId, rol || 'operador');
      return res.json({ success: true, data });
    }

    if (rol) {
      // Solo cambiar rol en el mismo almacen
      await pool.query('UPDATE almacen_usuarios SET rol = $1 WHERE almacen_id = $2 AND user_id = $3', [rol, almacenId, userId]);
    }

    const result = await pool.query(`
      SELECT au.*, u.full_name, u.username
      FROM almacen_usuarios au JOIN users u ON u.id = au.user_id
      WHERE au.almacen_id = $1 AND au.user_id = $2
    `, [almacenId, userId]);
    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

router.delete('/almacenes/:id/usuarios/:userId', requirePermission('inventory:users'), async (req, res) => {
  try {
    const pool = getPool();
    await inv.removeUsuarioFromAlmacen(pool, parseInt(req.params.id as string, 10), parseInt(req.params.userId as string, 10));
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

// =====================================================
// INVENTARIO INICIAL (solo admin)
// =====================================================

router.post('/inventario-inicial/:eventId', requireRole('admin'), async (req, res) => {
  try {
    const pool = getPool();
    const eventId = parseInt(req.params.eventId as string, 10);

    // Buscar almacen raiz del evento
    const rootResult = await pool.query(
      'SELECT id, name FROM almacenes WHERE event_id = $1 AND parent_id IS NULL ORDER BY id LIMIT 1',
      [eventId]
    );
    if (rootResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'No existe un almacen raiz para este evento. Crea un almacen primero.' });
    }
    const rootAlmacen = rootResult.rows[0];

    // Asignar todas las cajas sin almacen al almacen raiz
    const result = await pool.query(
      'UPDATE cajas SET almacen_id = $1, updated_at = NOW() WHERE event_id = $2 AND almacen_id IS NULL RETURNING id',
      [rootAlmacen.id, eventId]
    );
    const cajasAsignadas = result.rowCount ?? 0;

    // Propagar a lotes y cards que no tengan almacen
    await pool.query(
      'UPDATE lotes SET almacen_id = $1 WHERE event_id = $2 AND almacen_id IS NULL',
      [rootAlmacen.id, eventId]
    );
    await pool.query(`
      UPDATE cards SET almacen_id = $1
      FROM lotes l WHERE l.id = cards.lote_id AND l.event_id = $2 AND cards.almacen_id IS NULL
    `, [rootAlmacen.id, eventId]);

    if (cajasAsignadas === 0) {
      return res.json({ success: true, data: { cajasAsignadas: 0, almacen: rootAlmacen.name, message: 'Todas las cajas ya estan asignadas al almacen raiz' } });
    }

    // Registrar movimiento
    const userId = (req as unknown as { user: { id: number } }).user.id;
    await pool.query(`
      INSERT INTO inv_movimientos (event_id, almacen_id, tipo_entidad, referencia, accion, cantidad_cartones, detalles, realizado_por)
      VALUES ($1, $2, 'caja', 'INVENTARIO_INICIAL', 'carga_inventario', $3, $4, $5)
    `, [eventId, rootAlmacen.id, cajasAsignadas,
        JSON.stringify({ tipo: 'inventario_inicial', cajas: cajasAsignadas }),
        userId]);

    res.json({ success: true, data: { cajasAsignadas, almacen: rootAlmacen.name } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// =====================================================
// RESUMEN E INVENTARIO
// =====================================================

router.get('/resumen/:eventId', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const almacenId = req.query.almacen_id ? parseInt(req.query.almacen_id as string, 10) : undefined;
    const data = await inv.getResumenInventario(pool, parseInt(req.params.eventId as string, 10), almacenId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Cajas disponibles para cargar (con info de almacen actual)
router.get('/cajas-disponibles/:eventId', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const data = await inv.getCajasDisponibles(pool, parseInt(req.params.eventId as string, 10));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Cargar por referencia (caja/libreta/carton code)
router.post('/cargar-por-referencia', requirePermission('inventory:move'), async (req, res) => {
  try {
    const pool = getPool();
    const reqUser = (req as any).user;
    const userId = reqUser.id;
    const { event_id, almacen_id, tipo_entidad, referencia, firma_entrega, firma_recibe, nombre_entrega, nombre_recibe } = req.body;
    if (!event_id || !almacen_id || !tipo_entidad || !referencia) {
      return res.status(400).json({ success: false, error: 'event_id, almacen_id, tipo_entidad y referencia son requeridos' });
    }
    // Verificar acceso al almacen
    if (!await verificarAccesoAlmacen(pool, userId, reqUser.role, [almacen_id])) {
      return res.status(403).json({ success: false, error: 'No tiene acceso a este almacen' });
    }
    const firmas = (firma_entrega || firma_recibe) ? { firma_entrega, firma_recibe, nombre_entrega, nombre_recibe } : undefined;
    const data = await inv.cargarInventarioPorReferencia(pool, event_id, almacen_id, tipo_entidad, referencia, userId, firmas);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

// Cargar cajas a un almacen (bulk)
router.post('/cargar-inventario', requirePermission('inventory:move'), async (req, res) => {
  try {
    const pool = getPool();
    const reqUser = (req as any).user;
    const userId = reqUser.id;
    const { event_id, almacen_id, caja_ids } = req.body;
    if (!event_id || !almacen_id || !caja_ids?.length) {
      return res.status(400).json({ success: false, error: 'event_id, almacen_id y caja_ids son requeridos' });
    }
    // Verificar acceso al almacen
    if (!await verificarAccesoAlmacen(pool, userId, reqUser.role, [almacen_id])) {
      return res.status(403).json({ success: false, error: 'No tiene acceso a este almacen' });
    }
    const data = await inv.cargarInventario(pool, event_id, almacen_id, caja_ids, userId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

router.get('/cajas/:eventId', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const almacenId = req.query.almacen_id ? parseInt(req.query.almacen_id as string, 10) : undefined;
    const data = await inv.getCajas(pool, parseInt(req.params.eventId as string, 10), almacenId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/lotes/:eventId', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const data = await inv.getLotes(pool, parseInt(req.params.eventId as string, 10));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Libretas sueltas de un almacén (sin caja en el mismo almacén)
router.get('/libretas-sueltas/:eventId/:almacenId', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const data = await inv.getLibretasSueltas(pool, parseInt(req.params.eventId as string, 10), parseInt(req.params.almacenId as string, 10));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Cartones sueltos de un almacén (sin lote en el mismo almacén)
router.get('/cartones-sueltos/:eventId/:almacenId', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const data = await inv.getCartonesSueltos(pool, parseInt(req.params.eventId as string, 10), parseInt(req.params.almacenId as string, 10));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Cartones de un lote
router.get('/lotes/:loteId/cartones', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query(
      `SELECT c.id, c.card_code, c.serial, c.is_sold, c.buyer_name, c.sold_at
       FROM cards c WHERE c.lote_id = $1 ORDER BY c.card_number`,
      [parseInt(req.params.loteId as string, 10)]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// =====================================================
// ASIGNACIONES
// =====================================================

// IMPORTANT: detalle route must come BEFORE the :eventId wildcard
router.get('/asignaciones/detalle/:id', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const data = await inv.getAsignacion(pool, parseInt(req.params.id as string, 10));
    if (!data) return res.status(404).json({ success: false, error: 'Asignacion no encontrada' });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/asignaciones/:eventId', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const { almacen_id, estado, proposito, persona, page, limit } = req.query;
    const result = await inv.getAsignaciones(pool, parseInt(req.params.eventId as string, 10), {
      almacen_id: almacen_id ? parseInt(almacen_id as string, 10) : undefined,
      estado: estado as string | undefined,
      proposito: proposito as string | undefined,
      persona: persona as string | undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });
    res.json({ success: true, data: result.data, pagination: { total: result.total } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.post('/asignaciones', requirePermission('inventory:move'), async (req, res) => {
  try {
    const pool = getPool();
    const reqUser = (req as any).user;
    const userId = reqUser.id;
    const { firma_entrega, firma_recibe, nombre_entrega, nombre_recibe, ...asignacionData } = req.body;
    // Verificar acceso al almacen
    if (!await verificarAccesoAlmacen(pool, userId, reqUser.role, [asignacionData.almacen_id])) {
      return res.status(403).json({ success: false, error: 'No tiene acceso a este almacen' });
    }
    const firmas = (firma_entrega || firma_recibe) ? { firma_entrega, firma_recibe, nombre_entrega, nombre_recibe } : undefined;
    const data = await inv.createAsignacion(pool, { ...asignacionData, asignado_por: userId }, firmas);
    logActivity(pool, auditFromReq(req, 'asignacion_created', 'inventory', { asignacion_id: data.id, referencia: asignacionData.referencia }));
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

router.post('/asignaciones/:id/devolver', requirePermission('inventory:move'), async (req, res) => {
  try {
    const pool = getPool();
    const userId = (req as unknown as { user: { id: number } }).user.id;
    const { firma_entrega, firma_recibe, nombre_entrega, nombre_recibe } = req.body || {};
    const firmas = (firma_entrega || firma_recibe) ? { firma_entrega, firma_recibe, nombre_entrega, nombre_recibe } : undefined;
    const asigId = parseInt(req.params.id as string, 10);
    const data = await inv.devolverAsignacion(pool, asigId, userId, firmas);
    logActivity(pool, auditFromReq(req, 'devolucion', 'inventory', { asignacion_id: asigId }));
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

router.post('/asignaciones/:id/cancelar', requirePermission('inventory:move'), async (req, res) => {
  try {
    const pool = getPool();
    const userId = (req as unknown as { user: { id: number } }).user.id;
    const { firma_entrega, nombre_entrega } = req.body || {};
    const firmas = firma_entrega ? { firma_entrega, nombre_entrega } : undefined;
    const data = await inv.cancelarAsignacion(pool, parseInt(req.params.id as string, 10), userId, firmas);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

// =====================================================
// VENTAS
// =====================================================

router.post('/vender/carton/:cartonId', requirePermission('inventory:sell'), async (req, res) => {
  try {
    const pool = getPool();
    const reqUser = (req as any).user;
    const userId = reqUser.id;
    // Verificar que el usuario tiene acceso al almacén del cartón
    const cardResult = await pool.query('SELECT almacen_id FROM cards WHERE id = $1', [req.params.cartonId]);
    if (!cardResult.rows[0]) return res.status(404).json({ success: false, error: 'Carton no encontrado' });
    if (cardResult.rows[0].almacen_id !== null && !await verificarAccesoAlmacen(pool, userId, reqUser.role, [cardResult.rows[0].almacen_id])) {
      return res.status(403).json({ success: false, error: 'No tiene acceso a este almacen' });
    }
    const data = await inv.venderCarton(pool, parseInt(req.params.cartonId as string, 10), userId, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

router.post('/vender/todos/:asignacionId', requirePermission('inventory:sell'), async (req, res) => {
  try {
    const pool = getPool();
    const reqUser = (req as any).user;
    const userId = reqUser.id;
    // Verificar que el usuario tiene acceso al almacén de la asignación
    const asigResult = await pool.query('SELECT almacen_id FROM inv_asignaciones WHERE id = $1', [req.params.asignacionId]);
    if (!asigResult.rows[0]) return res.status(404).json({ success: false, error: 'Asignacion no encontrada' });
    if (asigResult.rows[0].almacen_id !== null && !await verificarAccesoAlmacen(pool, userId, reqUser.role, [asigResult.rows[0].almacen_id])) {
      return res.status(403).json({ success: false, error: 'No tiene acceso a este almacen' });
    }
    const data = await inv.venderTodos(pool, parseInt(req.params.asignacionId as string, 10), userId, req.body);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

// =====================================================
// DOCUMENTOS DE MOVIMIENTO
// =====================================================

// Ejecutar movimiento bulk (nuevo endpoint principal)
router.post('/movimiento-bulk', requirePermission('inventory:move'), async (req, res) => {
  try {
    const pool = getPool();
    const reqUser = (req as any).user;
    const userId = reqUser.id;
    const { event_id, accion, almacen_destino_id, almacen_origen_id, items, firma_entrega, firma_recibe, nombre_entrega, nombre_recibe } = req.body;
    if (!event_id || !almacen_destino_id || !items?.length) {
      return res.status(400).json({ success: false, error: 'event_id, almacen_destino_id e items son requeridos' });
    }
    // Verificar acceso al almacen origen y/o destino
    const almacenesToCheck = [almacen_destino_id, almacen_origen_id].filter(Boolean);
    if (!await verificarAccesoAlmacen(pool, userId, reqUser.role, almacenesToCheck)) {
      return res.status(403).json({ success: false, error: 'No tiene acceso a este almacen' });
    }
    const firmas = (firma_entrega || firma_recibe) ? { firma_entrega, firma_recibe, nombre_entrega, nombre_recibe } : undefined;
    const data = await inv.ejecutarMovimientoBulk(pool, event_id, {
      accion: accion || 'traslado',
      almacen_destino_id,
      almacen_origen_id,
      items,
      firmas,
    }, userId);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

// Ejecutar venta
router.post('/venta', requirePermission('inventory:sell'), async (req, res) => {
  try {
    const pool = getPool();
    const reqUser = (req as any).user;
    const userId = reqUser.id;
    const { event_id, almacen_id, items, buyer_name, buyer_cedula, buyer_libreta, buyer_phone, firma_entrega, firma_recibe, nombre_entrega, nombre_recibe } = req.body;
    if (!event_id || !almacen_id || !items?.length) {
      return res.status(400).json({ success: false, error: 'event_id, almacen_id e items son requeridos' });
    }
    // Verificar acceso al almacen
    if (!await verificarAccesoAlmacen(pool, userId, reqUser.role, [almacen_id])) {
      return res.status(403).json({ success: false, error: 'No tiene acceso a este almacen' });
    }
    const firmas = (firma_entrega || firma_recibe) ? { firma_entrega, firma_recibe, nombre_entrega, nombre_recibe } : undefined;
    const data = await inv.ejecutarVenta(pool, event_id, {
      almacen_id,
      items,
      buyer_name,
      buyer_cedula,
      buyer_libreta,
      buyer_phone,
      firmas,
    }, userId);
    logActivity(pool, auditFromReq(req, 'venta', 'inventory', { event_id, items_count: items.length, total_cartones: data.totalCartones }));
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

// Validar referencia (buscar caja/libreta/carton por codigo)
router.get('/validar-referencia/:eventId/:referencia', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const eventId = parseInt(req.params.eventId as string, 10);
    const ref = (req.params.referencia as string).toUpperCase();
    const almacenId = req.query.almacen_id ? parseInt(req.query.almacen_id as string, 10) : undefined;

    // Buscar como caja
    const cajaRes = await pool.query(
      `SELECT c.id, c.caja_code, c.almacen_id, c.total_lotes, a.name as almacen_name,
        COALESCE((SELECT SUM(l.total_cards) FROM lotes l WHERE l.caja_id = c.id), 0) as total_cartones,
        COALESCE((SELECT SUM(l.cards_sold) FROM lotes l WHERE l.caja_id = c.id), 0) as vendidos
       FROM cajas c LEFT JOIN almacenes a ON a.id = c.almacen_id
       WHERE c.caja_code = $1 AND c.event_id = $2`, [ref, eventId]
    );
    if (cajaRes.rows.length > 0) {
      const c = cajaRes.rows[0];
      const enMiAlmacen = !almacenId || c.almacen_id === almacenId;
      return res.json({ success: true, data: {
        tipo: 'caja', referencia: c.caja_code, existe: true, enMiAlmacen,
        almacen: c.almacen_name, totalCartones: Number(c.total_cartones),
        vendidos: Number(c.vendidos), disponibles: Number(c.total_cartones) - Number(c.vendidos),
      }});
    }

    // Buscar como libreta
    const loteRes = await pool.query(
      `SELECT l.id, l.lote_code, l.almacen_id, l.total_cards, l.cards_sold, a.name as almacen_name
       FROM lotes l LEFT JOIN almacenes a ON a.id = l.almacen_id
       WHERE l.lote_code = $1 AND l.event_id = $2`, [ref, eventId]
    );
    if (loteRes.rows.length > 0) {
      const l = loteRes.rows[0];
      const enMiAlmacen = !almacenId || l.almacen_id === almacenId;
      return res.json({ success: true, data: {
        tipo: 'libreta', referencia: l.lote_code, existe: true, enMiAlmacen,
        almacen: l.almacen_name, totalCartones: l.total_cards,
        vendidos: l.cards_sold, disponibles: l.total_cards - l.cards_sold,
      }});
    }

    // Buscar como carton por card_code o serial
    // Si el formato es tipo "203-21", convertir a serial con padding: "00203-21"
    let serialSearch = ref;
    const serialMatch = ref.match(/^(\d+)-(\d+)$/);
    if (serialMatch) {
      serialSearch = serialMatch[1].padStart(5, '0') + '-' + serialMatch[2].padStart(2, '0');
    }
    const cardRes = await pool.query(
      `SELECT c.id, c.card_code, c.serial, c.is_sold, c.almacen_id, a.name as almacen_name
       FROM cards c LEFT JOIN almacenes a ON a.id = c.almacen_id
       WHERE (c.card_code = $1 OR c.serial = $3) AND c.event_id = $2`, [ref, eventId, serialSearch]
    );
    if (cardRes.rows.length > 0) {
      const card = cardRes.rows[0];
      const enMiAlmacen = !almacenId || card.almacen_id === almacenId;
      const displayRef = card.serial.replace(/^0+/, '').replace(/-0+/, '-');
      return res.json({ success: true, data: {
        tipo: 'carton', referencia: displayRef, existe: true, enMiAlmacen,
        almacen: card.almacen_name, totalCartones: 1,
        vendidos: card.is_sold ? 1 : 0, disponibles: card.is_sold ? 0 : 1,
      }});
    }

    res.json({ success: true, data: { tipo: null, referencia: ref, existe: false } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// PDF de documento
router.get('/documentos/pdf/:documentoId', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query('SELECT pdf_path FROM inv_documentos WHERE id = $1', [parseInt(req.params.documentoId as string, 10)]);
    const doc = rows[0] as { pdf_path: string | null } | undefined;
    if (!doc || !doc.pdf_path) return res.status(404).json({ success: false, error: 'PDF no disponible para este documento' });

    const filepath = getMovimientoPdfPath(doc.pdf_path);
    if (!existsSync(filepath)) return res.status(404).json({ success: false, error: 'Archivo PDF no encontrado' });

    res.download(filepath, doc.pdf_path);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Detalle de documento con sus movimientos
router.get('/documentos/detalle/:documentoId', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const data = await inv.getDocumento(pool, parseInt(req.params.documentoId as string, 10));
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

// Lista de documentos por evento
router.get('/documentos/:eventId', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const { almacen_id, accion, page, limit } = req.query;
    const result = await inv.getDocumentos(pool, parseInt(req.params.eventId as string, 10), {
      almacen_id: almacen_id ? parseInt(almacen_id as string, 10) : undefined,
      accion: accion as string | undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });
    res.json({ success: true, data: result.data, pagination: { total: result.total } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// =====================================================
// MOVIMIENTOS / TRAZABILIDAD (legacy + detalle)
// =====================================================

// PDF route MUST come before :eventId wildcard
router.get('/movimientos/pdf/:movimientoId', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    // Primero buscar en inv_movimientos, si tiene documento_id redirigir al PDF del documento
    const { rows } = await pool.query('SELECT pdf_path, documento_id FROM inv_movimientos WHERE id = $1', [parseInt(req.params.movimientoId as string, 10)]);
    const mov = rows[0] as { pdf_path: string | null; documento_id: number | null } | undefined;
    if (!mov) return res.status(404).json({ success: false, error: 'Movimiento no encontrado' });

    // Si tiene documento, servir el PDF del documento
    if (mov.documento_id) {
      const docRows = await pool.query('SELECT pdf_path FROM inv_documentos WHERE id = $1', [mov.documento_id]);
      const doc = docRows.rows[0] as { pdf_path: string | null } | undefined;
      if (doc?.pdf_path) {
        const filepath = getMovimientoPdfPath(doc.pdf_path);
        if (existsSync(filepath)) return res.download(filepath, doc.pdf_path);
      }
    }

    if (!mov.pdf_path) return res.status(404).json({ success: false, error: 'PDF no disponible para este movimiento' });

    const filepath = getMovimientoPdfPath(mov.pdf_path);
    if (!existsSync(filepath)) return res.status(404).json({ success: false, error: 'Archivo PDF no encontrado' });

    res.download(filepath, mov.pdf_path);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/movimientos/:eventId', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const { almacen_id, tipo_entidad, accion, referencia, page, limit } = req.query;
    const result = await inv.getMovimientos(pool, parseInt(req.params.eventId as string, 10), {
      almacen_id: almacen_id ? parseInt(almacen_id as string, 10) : undefined,
      tipo_entidad: tipo_entidad as string | undefined,
      accion: accion as string | undefined,
      referencia: referencia as string | undefined,
      page: page ? parseInt(page as string, 10) : undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
    });
    res.json({ success: true, data: result.data, pagination: { total: result.total } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/trazabilidad/:eventId/:referencia', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const data = await inv.getTrazabilidad(pool, parseInt(req.params.eventId as string, 10), req.params.referencia as string);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// =====================================================
// ESCANEO DE CODIGO
// =====================================================

router.get('/escanear/:eventId/:codigo', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const data = await inv.escanearCodigo(pool, parseInt(req.params.eventId as string, 10), req.params.codigo as string);
    if (!data) return res.status(404).json({ success: false, error: 'Codigo no encontrado' });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// =====================================================
// DASHBOARD LOTERÍA
// =====================================================

router.get('/loteria-dashboard/:eventId', requirePermission('loteria:dashboard'), async (req, res) => {
  try {
    const pool = getPool();
    const data = await inv.getLoteriaDashboard(pool, parseInt(req.params.eventId as string, 10));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// =====================================================
// DASHBOARD GENERAL (todos los almacenes)
// =====================================================

router.get('/dashboard-general/:eventId', requirePermission('inventory:dashboard'), async (req, res) => {
  try {
    const pool = getPool();
    const data = await inv.getDashboardGeneral(pool, parseInt(req.params.eventId as string, 10));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Vista informativa (solo lectura) — misma data, permiso menor
router.get('/dashboard-ventas/:eventId', requirePermission('inventory:read'), async (req, res) => {
  try {
    const pool = getPool();
    const data = await inv.getDashboardGeneral(pool, parseInt(req.params.eventId as string, 10));
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

export default router;
