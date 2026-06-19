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
  } catch {
    process.env.INTEGRATION_DB_AVAILABLE = 'false';
    console.warn(
      '\n⚠️  [integration] PostgreSQL no disponible — todos los tests de integración serán skipped.' +
      '\n   Iniciá Postgres local o configurá TEST_DATABASE_URL para correrlos.\n'
    );
  }
}
