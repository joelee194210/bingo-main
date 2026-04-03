-- Migration: Online Sales (Landing de Venta con Yappy)

CREATE TABLE IF NOT EXISTS online_sales_config (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
    is_enabled BOOLEAN DEFAULT FALSE,
    price_per_card NUMERIC(10,2) NOT NULL DEFAULT 5.00,
    max_cards_per_order INTEGER DEFAULT 20,
    min_cards_per_order INTEGER DEFAULT 1,
    almacen_id INTEGER REFERENCES almacenes(id),  -- almacen del que se venden cartones
    yappy_qr_image TEXT,
    yappy_collection_alias TEXT,
    payment_instructions TEXT DEFAULT 'Abre tu app de Yappy, escanea el QR y en la descripcion coloca tu codigo de orden.',
    order_expiry_minutes INTEGER DEFAULT 30,
    landing_title TEXT,
    landing_description TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS online_orders (
    id SERIAL PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    order_code TEXT NOT NULL UNIQUE,
    quantity INTEGER NOT NULL,
    unit_price NUMERIC(10,2) NOT NULL DEFAULT 5.00,
    total_amount NUMERIC(10,2) NOT NULL,
    buyer_name TEXT NOT NULL,
    buyer_email TEXT NOT NULL,
    buyer_phone TEXT NOT NULL,
    buyer_cedula TEXT,
    status TEXT NOT NULL DEFAULT 'pending_payment'
        CHECK(status IN ('pending_payment','payment_confirmed','cards_assigned',
                         'completed','expired','failed','cancelled')),
    card_ids INTEGER[] DEFAULT '{}',
    yappy_transaction_id TEXT,
    yappy_transaction_data JSONB,
    payment_confirmed_at TIMESTAMP,
    payment_confirmed_by TEXT,
    pdf_path TEXT,
    download_token TEXT UNIQUE,
    email_sent_at TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_online_orders_event ON online_orders(event_id);
CREATE INDEX IF NOT EXISTS idx_online_orders_status ON online_orders(status);
CREATE INDEX IF NOT EXISTS idx_online_orders_code ON online_orders(order_code);
CREATE INDEX IF NOT EXISTS idx_online_orders_download ON online_orders(download_token);
CREATE INDEX IF NOT EXISTS idx_online_orders_expires ON online_orders(expires_at) WHERE status = 'pending_payment';
