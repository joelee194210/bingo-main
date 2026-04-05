-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Security Hardening (Ola 1 — auditoría 2026-04-05)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ⚠️  NO APLICAR AUTOMÁTICAMENTE. Requiere paso manual de verificación.
-- El código (confirmPayment en server/ y landing/) ya protege en app-layer,
-- esta migración agrega la segunda capa a nivel de base de datos.
--
-- Aplicar en producción siguiendo los pasos en orden.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- PASO 1 — Verificar que NO hay yappy_transaction_id duplicados en prod
-- ───────────────────────────────────────────────────────────────────────────
-- Si esta query devuelve CERO filas, es seguro continuar al PASO 2.
-- Si devuelve filas, investigar antes de seguir: hay pagos duplicados reales
-- o bugs históricos del replay. Limpiar con cuidado antes del PASO 2.

-- SELECT yappy_transaction_id, COUNT(*) AS veces, array_agg(order_code) AS ordenes
-- FROM online_orders
-- WHERE yappy_transaction_id IS NOT NULL
-- GROUP BY yappy_transaction_id
-- HAVING COUNT(*) > 1;

-- ───────────────────────────────────────────────────────────────────────────
-- PASO 2 — Crear UNIQUE INDEX parcial (no bloquea NULLs, no requiere lock largo)
-- ───────────────────────────────────────────────────────────────────────────
-- CONCURRENTLY permite crear el índice sin bloquear escrituras. NO correr
-- esto dentro de una transacción BEGIN/COMMIT; se ejecuta directo en psql.

-- CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS
--   uniq_online_orders_yappy_txn
-- ON online_orders (yappy_transaction_id)
-- WHERE yappy_transaction_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- PASO 3 — Verificar que el índice quedó VALID
-- ───────────────────────────────────────────────────────────────────────────

-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE tablename = 'online_orders' AND indexname = 'uniq_online_orders_yappy_txn';

-- ───────────────────────────────────────────────────────────────────────────
-- ROLLBACK SEC-C2 (si hay que revertir)
-- ───────────────────────────────────────────────────────────────────────────

-- DROP INDEX CONCURRENTLY IF EXISTS uniq_online_orders_yappy_txn;

-- ═══════════════════════════════════════════════════════════════════════════
-- Ola 2 — Estabilidad de generación masiva + performance PostgreSQL
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Todos los índices se crean CONCURRENTLY para NO bloquear escrituras.
-- NO correr dentro de BEGIN/COMMIT; ejecutar cada CREATE INDEX por separado.
-- Verificar con: SELECT indexname FROM pg_indexes WHERE tablename = 'cards';

-- ───────────────────────────────────────────────────────────────────────────
-- DB-C3 — Índice GIN sobre online_orders.card_ids
-- ───────────────────────────────────────────────────────────────────────────
-- Las queries de reserva de cartones ahora usan el operador @> (array contains)
-- en lugar de SELECT unnest(card_ids). Con este índice GIN, PostgreSQL puede
-- usar el índice en vez de Seq Scan.

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_online_orders_card_ids
--   ON online_orders USING GIN (card_ids);

-- ───────────────────────────────────────────────────────────────────────────
-- DB-H5 — Índice en cards.sold_by (FK sin índice)
-- ───────────────────────────────────────────────────────────────────────────
-- Reports de ventas hacen JOIN users ON cards.sold_by = users.id.
-- Con 1M+ cartones el JOIN sin índice es un Seq Scan completo.

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cards_sold_by
--   ON cards(sold_by)
--   WHERE sold_by IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- DB-H6 — Índice en cards.lote_id (FK sin índice)
-- ───────────────────────────────────────────────────────────────────────────
-- El listado de cartones hace LEFT JOIN lotes ON lotes.id = cards.lote_id.

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cards_lote
--   ON cards(lote_id)
--   WHERE lote_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- DB-M14 — Índices parciales para búsqueda de comprador
-- ───────────────────────────────────────────────────────────────────────────
-- Solo indexamos cartones vendidos (los únicos con buyer_phone/cedula).

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cards_buyer_phone
--   ON cards(buyer_phone)
--   WHERE buyer_phone IS NOT NULL;

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cards_buyer_cedula
--   ON cards(buyer_cedula)
--   WHERE buyer_cedula IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- DB-M15 — Índice parcial en user_sessions.expires_at
-- ───────────────────────────────────────────────────────────────────────────
-- Usado por cleanup de sesiones expiradas y verificación de tokens activos.
-- Índice parcial con NOW() NO es posible (NOW no es IMMUTABLE);
-- usamos un índice completo sobre expires_at.

-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_expires
--   ON user_sessions(expires_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- Ola 3 — Hardening de auth / infra
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- SEC-H6 — password_changed_at en users (revocación de JWT al cambiar password)
-- ───────────────────────────────────────────────────────────────────────────
-- NOTA: el init.ts ya aplica esta migración idempotentemente al arranque via
-- el patrón `checkColumn` + `ALTER TABLE ADD COLUMN`. Esta sección existe
-- como referencia manual si prefieres aplicar antes del deploy.
--
-- El middleware de auth tolera que la columna no exista (graceful degradation)
-- detectando el error code 42703 y cacheando el estado.

-- ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP;

-- ═══════════════════════════════════════════════════════════════════════════
-- DB-C4 — Nota sobre triggers de contadores (NO aplicar aún)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Los triggers `update_event_total_cards_delete` y `update_event_sold_cards`
-- en schema.sql hacen DOS UPDATE separados para total_cards y cards_sold.
-- Entre ambos UPDATE otra transacción puede leer el estado intermedio.
-- El endpoint PUT /api/cards/:id/sell YA fue parchado con SELECT ... FOR UPDATE
-- (cierra la race en app-layer); consolidar los triggers en un único UPDATE
-- sigue siendo deseable como defensa en profundidad, pero implica reemplazar
-- funciones PL/pgSQL activas en prod. Dejar para una ventana de mantenimiento.
--
-- Propuesta de fix (para aplicar más adelante):
--
-- CREATE OR REPLACE FUNCTION update_event_total_cards_delete()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   UPDATE events
--   SET total_cards = total_cards - 1,
--       cards_sold  = cards_sold  - CASE WHEN OLD.is_sold THEN 1 ELSE 0 END,
--       updated_at  = NOW()
--   WHERE id = OLD.event_id;
--   RETURN OLD;
-- END;
-- $$ LANGUAGE plpgsql;
