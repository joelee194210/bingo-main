# Datos de Recuperacion del Sistema Bingo

## Base de datos

- **Motor:** PostgreSQL
- **Conexion:** `postgresql://slacker@localhost:5432/bingo`
- **Schema:** `server/src/database/schema.sql`

## Usuario administrador por defecto

Se crea automaticamente si no hay usuarios en la BD (en `server/src/services/authService.ts`):

- **Username:** `admin`
- **Password:** valor de `ADMIN_PASSWORD` env var, o `admin123` si no esta configurado
- **Rol:** `admin`
- **Full name:** `Administrador`

## Roles del sistema

| Rol | Descripcion |
|-----|-------------|
| admin | Acceso total al sistema |
| moderator | Gestion de eventos y juegos |
| seller | Venta y activacion de cartones |
| viewer | Solo lectura |
| inventory | Gestion de inventario |

## Estructura de datos clave

- **Evento** -> tiene muchos Cartones y Juegos
- **Carton:** grid 5x5, columnas B(1-15) I(16-30) N(31-45) G(46-60) O(61-75)
- **Serial:** formato `XXXXX-XX` (serie-secuencia, 50 cartones por serie)
- **Libreta/Lote:** agrupacion de 50 cartones (una serie)
- **Caja:** contiene multiples libretas/lotes

## Codigos QR del inventario

Formato payload: `B:<codigo>:<eventId>`

| Prefijo | Tipo | Ejemplo |
|---------|------|---------|
| CJ- | Caja | `B:CJ-00001:5` |
| LT- | Lote/Libreta | `B:LT-00001:5` |
| ENV- | Envio | `B:ENV-00001:5` |
| CT- | Centro | `B:CT-00001:5` |

## Backup

- Backup completo via `/api/backup` (requiere rol admin)
- Formato: PostgreSQL dump (.dump)
- Incluye: toda la data, esquema, indices

## Variables de entorno importantes

| Variable | Descripcion | Default |
|----------|-------------|---------|
| ADMIN_PASSWORD | Password del admin inicial | admin123 |
| JWT_SECRET | Secreto para tokens JWT | clave por defecto (dev) |
| DATABASE_URL | URL de PostgreSQL | postgresql://slacker@localhost:5432/bingo |
| PORT | Puerto del servidor | 3001 |
