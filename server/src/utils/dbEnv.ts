/**
 * Utilidades para manejar DATABASE_URL de forma segura al invocar procesos
 * externos (pg_dump, psql).
 *
 * SEC-H2 / TS-C2: pasar la URL completa como argumento CLI a spawn() deja
 * la contraseña visible en `ps aux` para cualquier proceso del mismo host.
 * En entornos multi-tenant o con acceso compartido, esto es una filtración
 * innecesaria. La alternativa idiomática es poblar PGHOST/PGPORT/PGUSER/
 * PGPASSWORD/PGDATABASE via `env` del spawn: libpq los lee automáticamente.
 */

/**
 * Devuelve el DATABASE_URL validado:
 * - En producción exige que esté definido explícitamente.
 * - En desarrollo permite fallback local para DX.
 *
 * SEC-H2: el fallback hardcoded estaba disponible en cualquier entorno, lo
 * que ocultaba configuraciones faltantes en deploy (Railway podía arrancar
 * apuntando a "slacker@localhost" si olvidabas setear la var).
 */
export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'DATABASE_URL env var es requerida en producción. ' +
      'Configurala en Railway / tu plataforma antes de arrancar el servicio.'
    );
  }

  // Dev local: fallback conveniente pero con warning visible.
  console.warn(
    '⚠️  DATABASE_URL no está seteada. Usando fallback local (solo dev): ' +
    'postgresql://slacker@localhost:5432/bingo'
  );
  return 'postgresql://slacker@localhost:5432/bingo';
}

/**
 * Construye el objeto `env` para `spawn('pg_dump'|'psql', args, { env })`
 * con las credenciales de la conexión extraídas del DATABASE_URL.
 * libpq usa PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE/PGSSLMODE automáticamente.
 * Así la contraseña NO queda visible en argv (ps aux).
 */
export function pgSpawnEnv(databaseUrl: string): NodeJS.ProcessEnv {
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL inválido (no se puede parsear como URL)');
  }

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (parsed.hostname) env.PGHOST = parsed.hostname;
  if (parsed.port) env.PGPORT = parsed.port;
  if (parsed.username) env.PGUSER = decodeURIComponent(parsed.username);
  if (parsed.password) env.PGPASSWORD = decodeURIComponent(parsed.password);
  const dbName = parsed.pathname.replace(/^\//, '');
  if (dbName) env.PGDATABASE = dbName;
  const sslmode = parsed.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;

  // Borrar DATABASE_URL del env del proceso hijo — redundante y evita que
  // algún subproceso lo loguee accidentalmente.
  delete env.DATABASE_URL;

  return env;
}
