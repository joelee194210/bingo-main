-- Schema para Plataforma de Bingo Americano
-- Diseñado para manejar 1,000,000+ cartones

-- =====================================================
-- TABLA DE USUARIOS Y AUTENTICACIÓN
-- =====================================================

-- Tabla de Usuarios
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer' CHECK(role IN ('admin', 'moderator', 'seller', 'viewer')),
    is_active INTEGER DEFAULT 1,
    last_login DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Sesiones (para tracking de tokens)
CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at DATETIME NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Índices para usuarios (username y email ya tienen UNIQUE constraints = índices automáticos)
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);

-- =====================================================
-- TABLAS DE BINGO
-- =====================================================

-- Tabla de Eventos de Bingo
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    total_cards INTEGER DEFAULT 0,
    cards_sold INTEGER DEFAULT 0,
    use_free_center INTEGER DEFAULT 1,  -- 1 = FREE en centro, 0 = número en centro
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'completed', 'cancelled')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Cartones
-- Optimizada para búsquedas rápidas con índices
CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    card_number INTEGER NOT NULL,
    serial TEXT NOT NULL,                   -- Serie-Secuencia ej: 00001-01 (50 cartones por serie)
    card_code TEXT NOT NULL UNIQUE,        -- Código alfanumérico de 5 caracteres
    validation_code TEXT NOT NULL,          -- Código de validación de 5 caracteres

    -- Números del cartón almacenados como JSON
    -- Formato: {"B":[3,7,12,1,15],"I":[22,19,28,30,16],"N":[38,44,31,42],"G":[51,59,48,55,60],"O":[67,74,62,70,65]}
    numbers TEXT NOT NULL,

    -- Hash para verificación rápida de duplicados
    numbers_hash TEXT NOT NULL,

    -- Estado del cartón
    is_sold INTEGER DEFAULT 0,
    sold_at DATETIME,
    buyer_name TEXT,
    buyer_phone TEXT,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Tabla de Partidas/Juegos
CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    name TEXT,

    -- Tipo de juego
    game_type TEXT NOT NULL CHECK(game_type IN (
        'horizontal_line',
        'vertical_line',
        'diagonal',
        'blackout',
        'four_corners',
        'x_pattern',
        'custom'
    )),

    -- Patrón personalizado si game_type = 'custom'
    custom_pattern TEXT,

    -- Estado del juego
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'paused', 'completed', 'cancelled')),

    -- Solo cartones vendidos participan (modo real)
    is_practice_mode INTEGER DEFAULT 1,

    -- Balotas llamadas (JSON array de números)
    called_balls TEXT DEFAULT '[]',

    -- Cartones ganadores (JSON array de IDs)
    winner_cards TEXT DEFAULT '[]',

    prize_description TEXT,

    started_at DATETIME,
    finished_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Tabla de historial de balotas por juego (certificación)
CREATE TABLE IF NOT EXISTS ball_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    ball_number INTEGER NOT NULL,
    ball_column TEXT NOT NULL,  -- B, I, N, G, O
    call_order INTEGER NOT NULL,  -- Orden en que fue llamada (1, 2, 3...)
    called_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- Tabla de ganadores de juegos
CREATE TABLE IF NOT EXISTS game_winners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL,
    card_id INTEGER NOT NULL,
    card_number INTEGER NOT NULL,
    card_code TEXT NOT NULL,
    validation_code TEXT NOT NULL,
    buyer_name TEXT,
    buyer_phone TEXT,
    winning_pattern TEXT NOT NULL,  -- Nombre del patrón ganador
    balls_to_win INTEGER NOT NULL,  -- Cantidad de balotas necesarias para ganar
    won_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

-- Tabla de reportes generados
CREATE TABLE IF NOT EXISTS game_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL UNIQUE,
    event_name TEXT NOT NULL,
    game_name TEXT,
    game_type TEXT NOT NULL,
    is_practice_mode INTEGER NOT NULL,
    total_balls_called INTEGER NOT NULL,
    total_winners INTEGER NOT NULL,
    started_at DATETIME,
    finished_at DATETIME,
    report_generated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    report_data TEXT NOT NULL,  -- JSON completo del reporte

    FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
);

-- Tabla de historial de verificaciones
CREATE TABLE IF NOT EXISTS verification_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    verification_type TEXT NOT NULL CHECK(verification_type IN ('generation', 'batch', 'manual')),
    total_cards_checked INTEGER NOT NULL,
    duplicates_found INTEGER DEFAULT 0,
    issues_found TEXT,  -- JSON con detalles de problemas
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed')),
    started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- Tabla de configuración del sistema
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- =====================================================
-- ÍNDICES OPTIMIZADOS PARA 1M+ REGISTROS
-- =====================================================

-- Índice para verificación de duplicados O(1)
CREATE INDEX IF NOT EXISTS idx_cards_hash ON cards(numbers_hash);

-- card_code ya tiene UNIQUE constraint = índice automático

-- Índice compuesto para filtrado por evento y estado de venta
CREATE INDEX IF NOT EXISTS idx_cards_event_sold ON cards(event_id, is_sold);

-- Índice para paginación eficiente por evento
CREATE INDEX IF NOT EXISTS idx_cards_event_number ON cards(event_id, card_number);

-- Índice para búsqueda por código de validación
CREATE INDEX IF NOT EXISTS idx_cards_validation ON cards(validation_code);

-- Índice para búsqueda por serial (creado en migración si la columna ya existe)
-- CREATE INDEX IF NOT EXISTS idx_cards_serial ON cards(serial);

-- Índice para juegos por evento
CREATE INDEX IF NOT EXISTS idx_games_event ON games(event_id, status);

-- Índice para historial de balotas
CREATE INDEX IF NOT EXISTS idx_ball_history_game ON ball_history(game_id, call_order);

-- Índice para ganadores por juego
CREATE INDEX IF NOT EXISTS idx_winners_game ON game_winners(game_id);

-- Índice para buscar ganadores por cartón
CREATE INDEX IF NOT EXISTS idx_winners_card ON game_winners(card_id);

-- =====================================================
-- TRIGGERS
-- =====================================================

-- Trigger para actualizar contador de cartones en evento (O(1) en vez de COUNT(*))
CREATE TRIGGER IF NOT EXISTS update_event_total_cards
AFTER INSERT ON cards
BEGIN
    UPDATE events
    SET total_cards = total_cards + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.event_id;
END;

-- Trigger para actualizar contador de vendidos (O(1) en vez de COUNT(*))
CREATE TRIGGER IF NOT EXISTS update_event_sold_cards
AFTER UPDATE OF is_sold ON cards
WHEN NEW.is_sold = 1
BEGIN
    UPDATE events
    SET cards_sold = cards_sold + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.event_id;
END;

-- =====================================================
-- DATOS INICIALES
-- =====================================================

INSERT OR IGNORE INTO settings (key, value) VALUES
    ('generation_batch_size', '10000'),
    ('max_cards_per_event', '1000000'),
    ('default_game_type', 'blackout');

-- =====================================================
-- SISTEMA DE INVENTARIO JERÁRQUICO (hasta 5 niveles)
-- =====================================================

-- Definición de niveles de la jerarquía por evento
CREATE TABLE IF NOT EXISTS inventory_levels (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 5),
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    UNIQUE(event_id, level)
);

CREATE INDEX IF NOT EXISTS idx_inv_levels_event ON inventory_levels(event_id);

-- Nodos del árbol de distribución
CREATE TABLE IF NOT EXISTS inventory_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    parent_id INTEGER,
    level INTEGER NOT NULL CHECK(level BETWEEN 1 AND 5),
    name TEXT NOT NULL,
    code TEXT,
    contact_name TEXT,
    contact_phone TEXT,
    is_active INTEGER DEFAULT 1,
    total_assigned INTEGER DEFAULT 0,
    total_distributed INTEGER DEFAULT 0,
    total_sold INTEGER DEFAULT 0,
    total_returned INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES inventory_nodes(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_inv_nodes_event ON inventory_nodes(event_id);
CREATE INDEX IF NOT EXISTS idx_inv_nodes_parent ON inventory_nodes(parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_nodes_event_code ON inventory_nodes(event_id, code) WHERE code IS NOT NULL;

-- Asignación actual de cada cartón a un nodo
CREATE TABLE IF NOT EXISTS inventory_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL,
    node_id INTEGER NOT NULL,
    event_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'assigned' CHECK(status IN ('assigned', 'sold', 'returned')),
    assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
    FOREIGN KEY (node_id) REFERENCES inventory_nodes(id) ON DELETE RESTRICT,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_assign_card_active ON inventory_assignments(card_id) WHERE status = 'assigned';
CREATE INDEX IF NOT EXISTS idx_inv_assign_node ON inventory_assignments(node_id, status);
CREATE INDEX IF NOT EXISTS idx_inv_assign_event ON inventory_assignments(event_id);

-- Historial de movimientos (auditoría completa)
CREATE TABLE IF NOT EXISTS inventory_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    card_id INTEGER NOT NULL,
    movement_type TEXT NOT NULL CHECK(movement_type IN ('initial_load', 'assign_down', 'return_up', 'mark_sold', 'unmark_sold')),
    from_node_id INTEGER,
    to_node_id INTEGER,
    performed_by INTEGER NOT NULL,
    batch_id TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
    FOREIGN KEY (from_node_id) REFERENCES inventory_nodes(id),
    FOREIGN KEY (to_node_id) REFERENCES inventory_nodes(id),
    FOREIGN KEY (performed_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_inv_mov_event ON inventory_movements(event_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_card ON inventory_movements(card_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_batch ON inventory_movements(batch_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_from ON inventory_movements(from_node_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_to ON inventory_movements(to_node_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_date ON inventory_movements(created_at);
