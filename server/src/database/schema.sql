-- Schema para Plataforma de Bingo Americano (PostgreSQL)
-- Diseñado para manejar 1,000,000+ cartones

-- =====================================================
-- TABLA DE USUARIOS Y AUTENTICACIÓN
-- =====================================================

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin', 'moderator', 'seller', 'viewer', 'inventory')),
    is_active BOOLEAN DEFAULT TRUE,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);

-- =====================================================
-- TABLAS DE BINGO
-- =====================================================

CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    total_cards INTEGER DEFAULT 0,
    cards_sold INTEGER DEFAULT 0,
    use_free_center BOOLEAN DEFAULT TRUE,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'completed', 'cancelled')),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cards (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    card_number INTEGER NOT NULL,
    serial TEXT NOT NULL DEFAULT '',
    card_code TEXT NOT NULL UNIQUE,
    validation_code TEXT NOT NULL UNIQUE,
    numbers TEXT NOT NULL,
    numbers_hash TEXT NOT NULL,
    promo_text TEXT,
    is_sold BOOLEAN DEFAULT FALSE,
    sold_at TIMESTAMP,
    buyer_name TEXT,
    buyer_phone TEXT,
    buyer_cedula TEXT,
    buyer_libreta TEXT,
    lote_id INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS games (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    name TEXT,
    game_type TEXT NOT NULL CHECK(game_type IN (
        'horizontal_line', 'vertical_line', 'diagonal',
        'blackout', 'four_corners', 'x_pattern', 'custom'
    )),
    custom_pattern TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'paused', 'completed', 'cancelled')),
    is_practice_mode BOOLEAN DEFAULT TRUE,
    called_balls TEXT DEFAULT '[]',
    winner_cards TEXT DEFAULT '[]',
    prize_description TEXT,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ball_history (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL,
    ball_number INTEGER NOT NULL,
    ball_column TEXT NOT NULL,
    call_order INTEGER NOT NULL,
    called_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_winners (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL,
    card_id INTEGER NOT NULL,
    card_number INTEGER NOT NULL,
    card_code TEXT NOT NULL,
    validation_code TEXT NOT NULL,
    buyer_name TEXT,
    buyer_phone TEXT,
    winning_pattern TEXT NOT NULL,
    balls_to_win INTEGER NOT NULL,
    won_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS game_reports (
    id SERIAL PRIMARY KEY,
    game_id INTEGER NOT NULL UNIQUE,
    event_name TEXT NOT NULL,
    game_name TEXT,
    game_type TEXT NOT NULL,
    is_practice_mode BOOLEAN NOT NULL,
    total_balls_called INTEGER NOT NULL,
    total_winners INTEGER NOT NULL,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    report_generated_at TIMESTAMP DEFAULT NOW(),
    report_data TEXT NOT NULL,
    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS verification_logs (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    verification_type TEXT NOT NULL CHECK(verification_type IN ('generation', 'batch', 'manual')),
    total_cards_checked INTEGER NOT NULL,
    duplicates_found INTEGER DEFAULT 0,
    issues_found TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- ÍNDICES
-- =====================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_cards_event_hash ON cards(event_id, numbers_hash);
CREATE INDEX IF NOT EXISTS idx_cards_event_sold ON cards(event_id, is_sold);
CREATE INDEX IF NOT EXISTS idx_cards_event_number ON cards(event_id, card_number);
CREATE INDEX IF NOT EXISTS idx_cards_validation ON cards(validation_code);
CREATE INDEX IF NOT EXISTS idx_cards_serial ON cards(serial);
CREATE INDEX IF NOT EXISTS idx_games_event ON games(event_id, status);
CREATE INDEX IF NOT EXISTS idx_ball_history_game ON ball_history(game_id, call_order);
CREATE INDEX IF NOT EXISTS idx_winners_game ON game_winners(game_id);
CREATE INDEX IF NOT EXISTS idx_winners_card ON game_winners(card_id);

-- =====================================================
-- TRIGGERS (PostgreSQL syntax)
-- =====================================================

CREATE OR REPLACE FUNCTION update_event_total_cards_insert() RETURNS TRIGGER AS $$
BEGIN
    UPDATE events SET total_cards = total_cards + 1, updated_at = NOW() WHERE id = NEW.event_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_event_sold_cards() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_sold = TRUE AND OLD.is_sold = FALSE THEN
        UPDATE events SET cards_sold = cards_sold + 1, updated_at = NOW() WHERE id = NEW.event_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION update_event_total_cards_delete() RETURNS TRIGGER AS $$
BEGIN
    UPDATE events SET total_cards = total_cards - 1, updated_at = NOW() WHERE id = OLD.event_id;
    IF OLD.is_sold = TRUE THEN
        UPDATE events SET cards_sold = cards_sold - 1 WHERE id = OLD.event_id;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_event_total_cards ON cards;
CREATE TRIGGER trg_update_event_total_cards
AFTER INSERT ON cards FOR EACH ROW EXECUTE FUNCTION update_event_total_cards_insert();

DROP TRIGGER IF EXISTS trg_update_event_sold_cards ON cards;
CREATE TRIGGER trg_update_event_sold_cards
AFTER UPDATE OF is_sold ON cards FOR EACH ROW EXECUTE FUNCTION update_event_sold_cards();

DROP TRIGGER IF EXISTS trg_update_event_cards_delete ON cards;
CREATE TRIGGER trg_update_event_cards_delete
AFTER DELETE ON cards FOR EACH ROW EXECUTE FUNCTION update_event_total_cards_delete();

-- =====================================================
-- DATOS INICIALES
-- =====================================================

INSERT INTO settings (key, value) VALUES
    ('generation_batch_size', '10000'),
    ('max_cards_per_event', '1000000'),
    ('default_game_type', 'blackout')
ON CONFLICT (key) DO NOTHING;

-- =====================================================
-- SISTEMA DE PROMOCIONES
-- =====================================================

CREATE TABLE IF NOT EXISTS promo_config (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL UNIQUE,
    is_enabled BOOLEAN DEFAULT FALSE,
    no_prize_text TEXT NOT NULL DEFAULT 'Gracias por participar',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS promo_prizes (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    distributed INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_promo_prizes_event ON promo_prizes(event_id);

-- =====================================================
-- SISTEMA DE INVENTARIO LEGACY (centros, cajas, lotes, envios)
-- =====================================================

CREATE TABLE IF NOT EXISTS centros (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    parent_id INTEGER,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    address TEXT,
    contact_name TEXT,
    contact_phone TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    total_cajas INTEGER DEFAULT 0,
    total_lotes INTEGER DEFAULT 0,
    total_cards INTEGER DEFAULT 0,
    total_sold INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES centros(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_centros_event_code ON centros(event_id, code);
CREATE INDEX IF NOT EXISTS idx_centros_parent ON centros(parent_id);
CREATE INDEX IF NOT EXISTS idx_centros_event ON centros(event_id);

CREATE TABLE IF NOT EXISTS cajas (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    caja_code TEXT NOT NULL UNIQUE,
    centro_id INTEGER,
    total_lotes INTEGER DEFAULT 0,
    status TEXT DEFAULT 'sellada' CHECK(status IN ('sellada', 'abierta', 'en_transito', 'agotada')),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (centro_id) REFERENCES centros(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_cajas_event ON cajas(event_id);
CREATE INDEX IF NOT EXISTS idx_cajas_centro ON cajas(centro_id);
CREATE INDEX IF NOT EXISTS idx_cajas_status ON cajas(event_id, status);

CREATE TABLE IF NOT EXISTS lotes (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    caja_id INTEGER,
    lote_code TEXT NOT NULL UNIQUE,
    series_number TEXT NOT NULL,
    centro_id INTEGER,
    status TEXT DEFAULT 'disponible' CHECK(status IN ('en_caja', 'disponible', 'en_transito', 'vendido_parcial', 'vendido_completo', 'devuelto')),
    cards_sold INTEGER DEFAULT 0,
    total_cards INTEGER DEFAULT 50,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (caja_id) REFERENCES cajas(id) ON DELETE SET NULL,
    FOREIGN KEY (centro_id) REFERENCES centros(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_lotes_event ON lotes(event_id);
CREATE INDEX IF NOT EXISTS idx_lotes_caja ON lotes(caja_id);
CREATE INDEX IF NOT EXISTS idx_lotes_centro ON lotes(centro_id);
CREATE INDEX IF NOT EXISTS idx_lotes_series ON lotes(event_id, series_number);
CREATE INDEX IF NOT EXISTS idx_lotes_status ON lotes(event_id, status);

CREATE TABLE IF NOT EXISTS envios (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    envio_code TEXT NOT NULL UNIQUE,
    from_centro_id INTEGER NOT NULL,
    to_centro_id INTEGER NOT NULL,
    status TEXT DEFAULT 'preparando' CHECK(status IN ('preparando', 'enviado', 'en_transito', 'recibido', 'recibido_parcial', 'cancelado')),
    notes TEXT,
    prepared_by TEXT,
    sent_at TIMESTAMP,
    received_at TIMESTAMP,
    received_by TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (from_centro_id) REFERENCES centros(id),
    FOREIGN KEY (to_centro_id) REFERENCES centros(id)
);
CREATE INDEX IF NOT EXISTS idx_envios_event ON envios(event_id);
CREATE INDEX IF NOT EXISTS idx_envios_from ON envios(from_centro_id);
CREATE INDEX IF NOT EXISTS idx_envios_to ON envios(to_centro_id);
CREATE INDEX IF NOT EXISTS idx_envios_status ON envios(event_id, status);

CREATE TABLE IF NOT EXISTS envio_items (
    id SERIAL PRIMARY KEY,
    envio_id INTEGER NOT NULL,
    item_type TEXT NOT NULL CHECK(item_type IN ('caja', 'lote')),
    caja_id INTEGER,
    lote_id INTEGER,
    received BOOLEAN DEFAULT FALSE,
    received_at TIMESTAMP,
    notes TEXT,
    FOREIGN KEY (envio_id) REFERENCES envios(id) ON DELETE CASCADE,
    FOREIGN KEY (caja_id) REFERENCES cajas(id) ON DELETE SET NULL,
    FOREIGN KEY (lote_id) REFERENCES lotes(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_envio_items_envio ON envio_items(envio_id);

CREATE TABLE IF NOT EXISTS inventory_audit (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK(entity_type IN ('caja', 'lote', 'card', 'envio', 'centro')),
    entity_id INTEGER NOT NULL,
    centro_id INTEGER,
    envio_id INTEGER,
    details TEXT,
    performed_by TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_audit_event ON inventory_audit(event_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON inventory_audit(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_centro ON inventory_audit(centro_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON inventory_audit(created_at);

-- =====================================================
-- MÓDULO DE INVENTARIO AISLADO
-- =====================================================

CREATE TABLE IF NOT EXISTS almacenes (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    parent_id INTEGER,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    address TEXT,
    contact_name TEXT,
    contact_phone TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES almacenes(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_almacenes_event_code ON almacenes(event_id, code);
CREATE INDEX IF NOT EXISTS idx_almacenes_parent ON almacenes(parent_id);
CREATE INDEX IF NOT EXISTS idx_almacenes_event ON almacenes(event_id);

CREATE TABLE IF NOT EXISTS almacen_usuarios (
    id SERIAL PRIMARY KEY,
    almacen_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    rol TEXT NOT NULL DEFAULT 'operador' CHECK(rol IN ('administrador', 'operador', 'vendedor')),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (almacen_id) REFERENCES almacenes(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_almacen_usuarios_unique ON almacen_usuarios(almacen_id, user_id);
CREATE INDEX IF NOT EXISTS idx_almacen_usuarios_user ON almacen_usuarios(user_id);

CREATE TABLE IF NOT EXISTS inv_asignaciones (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    almacen_id INTEGER NOT NULL,
    tipo_entidad TEXT NOT NULL CHECK(tipo_entidad IN ('caja', 'libreta', 'carton')),
    referencia TEXT NOT NULL,
    cantidad_cartones INTEGER NOT NULL DEFAULT 0,
    persona_nombre TEXT NOT NULL,
    persona_telefono TEXT,
    persona_user_id INTEGER,
    proposito TEXT NOT NULL CHECK(proposito IN ('custodia', 'venta')),
    estado TEXT NOT NULL DEFAULT 'asignado' CHECK(estado IN ('asignado', 'parcial', 'completado', 'devuelto', 'cancelado')),
    cartones_vendidos INTEGER DEFAULT 0,
    asignado_por INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    devuelto_at TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (almacen_id) REFERENCES almacenes(id) ON DELETE CASCADE,
    FOREIGN KEY (persona_user_id) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (asignado_por) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_inv_asig_event ON inv_asignaciones(event_id);
CREATE INDEX IF NOT EXISTS idx_inv_asig_almacen ON inv_asignaciones(almacen_id);
CREATE INDEX IF NOT EXISTS idx_inv_asig_persona ON inv_asignaciones(persona_nombre);
CREATE INDEX IF NOT EXISTS idx_inv_asig_estado ON inv_asignaciones(estado);
CREATE INDEX IF NOT EXISTS idx_inv_asig_referencia ON inv_asignaciones(referencia);

CREATE TABLE IF NOT EXISTS inv_asignacion_cartones (
    id SERIAL PRIMARY KEY,
    asignacion_id INTEGER NOT NULL,
    card_id INTEGER NOT NULL,
    card_code TEXT NOT NULL,
    serial TEXT NOT NULL,
    vendido BOOLEAN DEFAULT FALSE,
    vendido_at TIMESTAMP,
    comprador_nombre TEXT,
    comprador_telefono TEXT,
    FOREIGN KEY (asignacion_id) REFERENCES inv_asignaciones(id) ON DELETE CASCADE,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_inv_asig_cart_asig ON inv_asignacion_cartones(asignacion_id);
CREATE INDEX IF NOT EXISTS idx_inv_asig_cart_card ON inv_asignacion_cartones(card_id);

-- Documentos de movimiento (agrupa items de un mismo traslado)
CREATE TABLE IF NOT EXISTS inv_documentos (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    accion TEXT NOT NULL,
    de_almacen_id INTEGER,
    a_almacen_id INTEGER,
    de_nombre TEXT,
    a_nombre TEXT,
    a_cedula TEXT,
    a_libreta TEXT,
    total_items INTEGER DEFAULT 0,
    total_cartones INTEGER DEFAULT 0,
    pdf_path TEXT,
    firma_entrega TEXT,
    firma_recibe TEXT,
    nombre_entrega TEXT,
    nombre_recibe TEXT,
    realizado_por INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (de_almacen_id) REFERENCES almacenes(id) ON DELETE SET NULL,
    FOREIGN KEY (a_almacen_id) REFERENCES almacenes(id) ON DELETE SET NULL,
    FOREIGN KEY (realizado_por) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_inv_doc_event ON inv_documentos(event_id);

CREATE TABLE IF NOT EXISTS inv_movimientos (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL,
    almacen_id INTEGER,
    asignacion_id INTEGER,
    tipo_entidad TEXT NOT NULL CHECK(tipo_entidad IN ('caja', 'libreta', 'carton')),
    referencia TEXT NOT NULL,
    accion TEXT NOT NULL,
    de_persona TEXT,
    a_persona TEXT,
    cantidad_cartones INTEGER DEFAULT 0,
    detalles TEXT,
    realizado_por INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    pdf_path TEXT,
    firma_entrega TEXT,
    firma_recibe TEXT,
    nombre_entrega TEXT,
    nombre_recibe TEXT,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (almacen_id) REFERENCES almacenes(id) ON DELETE SET NULL,
    FOREIGN KEY (asignacion_id) REFERENCES inv_asignaciones(id) ON DELETE SET NULL,
    FOREIGN KEY (realizado_por) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_inv_mov_event ON inv_movimientos(event_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_almacen ON inv_movimientos(almacen_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_referencia ON inv_movimientos(referencia);
CREATE INDEX IF NOT EXISTS idx_inv_mov_created ON inv_movimientos(created_at);
