import { Client } from 'pg';

const DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/test_first_blades';

export async function setup() {
  const client = new Client({ connectionString: DB_URL });
  try {
    await client.connect();
    await client.query('SELECT 1');
    await client.end();
    process.env.INTEGRATION_DB_AVAILABLE = 'true';
  } catch (err) {
    // Si TEST_DATABASE_URL está explícitamente configurada (modo CI), la base
    // debe estar disponible. Un skip silencioso enmascararía una falla real,
    // así que propagamos el error para que CI falle en vez de ignorarlo.
    if (process.env.TEST_DATABASE_URL) {
      throw new Error(
        `[integration] TEST_DATABASE_URL está configurada (${DB_URL}) pero PostgreSQL no responde. ` +
        `Verificá que Supabase local está corriendo antes de ejecutar los tests de integración. ` +
        `Error original: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    process.env.INTEGRATION_DB_AVAILABLE = 'false';
    console.warn(
      '\n⚠️  [integration] PostgreSQL no disponible — todos los tests de integración serán skipped.' +
      '\n   Iniciá Postgres local o configurá TEST_DATABASE_URL para correrlos.\n'
    );
  }
}
