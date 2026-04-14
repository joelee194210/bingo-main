-- Migration: CHECK constraint en inv_documentos.accion e inv_movimientos.accion
-- Previene inserción de strings arbitrarios (typos, mayúsculas) que romperían
-- silenciosamente las queries de reportes filtradas por accion.
--
-- Idempotente: usa DO blocks que verifican existencia antes de crear.
-- Para correr: psql $DATABASE_URL -f migration_inv_accion_check.sql

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inv_documentos_accion_check'
  ) THEN
    -- Limpiar valores corruptos antes de añadir el constraint, si existen.
    -- Solo log; no eliminamos automáticamente para no perder data.
    PERFORM 1 FROM inv_documentos
      WHERE accion NOT IN ('venta','consignacion','devolucion','traslado','asignacion','recepcion','carga_inventario','ajuste','asignar','devolver','cancelar')
      LIMIT 1;
    IF FOUND THEN
      RAISE NOTICE 'inv_documentos contiene acciones fuera del enum esperado. Constraint NO añadido. Revisa los datos antes de re-ejecutar.';
    ELSE
      ALTER TABLE inv_documentos
        ADD CONSTRAINT inv_documentos_accion_check
        CHECK (accion IN ('venta','consignacion','devolucion','traslado','asignacion','recepcion','carga_inventario','ajuste','asignar','devolver','cancelar'));
      RAISE NOTICE 'Constraint inv_documentos_accion_check añadido.';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inv_movimientos_accion_check'
  ) THEN
    PERFORM 1 FROM inv_movimientos
      WHERE accion NOT IN ('venta','consignacion','devolucion','traslado','asignacion','recepcion','carga_inventario','ajuste','asignar','devolver','cancelar')
      LIMIT 1;
    IF FOUND THEN
      RAISE NOTICE 'inv_movimientos contiene acciones fuera del enum esperado. Constraint NO añadido.';
    ELSE
      ALTER TABLE inv_movimientos
        ADD CONSTRAINT inv_movimientos_accion_check
        CHECK (accion IN ('venta','consignacion','devolucion','traslado','asignacion','recepcion','carga_inventario','ajuste','asignar','devolver','cancelar'));
      RAISE NOTICE 'Constraint inv_movimientos_accion_check añadido.';
    END IF;
  END IF;
END $$;

-- Índice compuesto para acelerar la subquery de /validar-devolucion que busca
-- el último movimiento de un cartón filtrando por tipo_entidad y referencia.
CREATE INDEX IF NOT EXISTS idx_inv_mov_ref_tipo_event_created
  ON inv_movimientos(referencia, tipo_entidad, event_id, created_at DESC);
