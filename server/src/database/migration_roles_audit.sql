-- Migración: Sistema de permisos dinámicos y log de auditoría

-- Tabla de overrides de permisos por rol
CREATE TABLE IF NOT EXISTS role_permissions (
  id SERIAL PRIMARY KEY,
  role VARCHAR(20) NOT NULL,
  permission VARCHAR(50) NOT NULL,
  granted BOOLEAN NOT NULL DEFAULT true,
  updated_by INTEGER REFERENCES users(id),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(role, permission)
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role);

-- Log de actividad del sistema
CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  username VARCHAR(100),
  action VARCHAR(100) NOT NULL,
  category VARCHAR(50) NOT NULL,
  details JSONB DEFAULT '{}',
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_category ON activity_log(category);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at DESC);
