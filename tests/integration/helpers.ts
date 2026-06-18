import { Client } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';

export const DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/test_first_blades';

// UUIDs fijos para los usuarios de test
export const IDS = {
  admin:       'a0000000-0000-0000-0001-000000000001',
  supervisor:  'a0000000-0000-0000-0001-000000000002',
  supervisor2: 'a0000000-0000-0000-0001-000000000003',
  employee1:   'a0000000-0000-0000-0001-000000000004', // bajo supervisor
  employee2:   'a0000000-0000-0000-0001-000000000005', // bajo supervisor
  employee3:   'a0000000-0000-0000-0001-000000000006', // bajo supervisor2
};

/** Configura la base de datos de test (aplica setup + migración + grants + seed). */
export async function setupTestDb(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  // Reset completo de esquemas
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('DROP SCHEMA IF EXISTS auth CASCADE');
  await client.query('DROP SCHEMA IF EXISTS storage CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.query('GRANT ALL ON SCHEMA public TO public');

  // 1. Setup previo (auth mock, storage mock, roles)
  const setupSql = readFileSync(resolve('./tests/integration/setup.sql'), 'utf8');
  await client.query(setupSql);

  // 2. Migración principal
  const migrationSql = readFileSync(
    resolve('./supabase/migrations/0001_init.sql'),
    'utf8'
  );
  await client.query(migrationSql);

  // 3. Grants para el rol authenticated (usuarios normales)
  await client.query(`
    GRANT USAGE ON SCHEMA public TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
    GRANT USAGE ON SCHEMA storage TO authenticated;
    GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated;
  `);

  // 4. Seed: crear filas en auth.users (FK constraint de profiles)
  for (const [, id] of Object.entries(IDS)) {
    await client.query(
      'INSERT INTO auth.users (id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [id, `${id}@test.com`]
    );
  }

  // 5. Seed: perfiles
  await client.query(`
    INSERT INTO profiles (id, email, full_name, role, status) VALUES
      ($1, 'admin@test.com',       'Admin Test',       'admin',      'activo'),
      ($2, 'supervisor@test.com',  'Supervisor Test',  'supervisor', 'activo'),
      ($3, 'supervisor2@test.com', 'Supervisor2 Test', 'supervisor', 'activo'),
      ($4, 'emp1@test.com',        'Empleado 1',       'empleado',   'activo'),
      ($5, 'emp2@test.com',        'Empleado 2',       'empleado',   'activo'),
      ($6, 'emp3@test.com',        'Empleado 3',       'empleado',   'activo')
    ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, status = EXCLUDED.status
  `, [IDS.admin, IDS.supervisor, IDS.supervisor2, IDS.employee1, IDS.employee2, IDS.employee3]);

  // 6. Asignar supervisor_id
  await client.query(
    'UPDATE profiles SET supervisor_id = $1 WHERE id IN ($2, $3)',
    [IDS.supervisor, IDS.employee1, IDS.employee2]
  );
  await client.query(
    'UPDATE profiles SET supervisor_id = $1 WHERE id = $2',
    [IDS.supervisor2, IDS.employee3]
  );

  return client;
}

/**
 * Ejecuta un callback dentro de una transacción como el usuario dado.
 * Siempre hace ROLLBACK al final para no contaminar tests siguientes.
 * Simula el JWT de Supabase Auth usando request.jwt.claims.
 */
export async function asUser<T>(
  userId: string,
  callback: (client: Client) => Promise<T>
): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: userId })]
    );
    await client.query('SET LOCAL ROLE authenticated');
    return await callback(client);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

/**
 * Ejecuta un callback como service_role (BYPASSRLS).
 * Verifica que el bypass de RLS funciona del lado servidor/admin.
 * Siempre hace ROLLBACK al final.
 */
export async function asServiceRole<T>(
  callback: (client: Client) => Promise<T>
): Promise<T> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE service_role');
    return await callback(client);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

// ─── Helpers de aserción ──────────────────────────────────────

/**
 * Para INSERT que falla por RLS: espera un error de permiso lanzado.
 * PostgreSQL lanza error cuando ninguna policy de INSERT permite la fila
 * o cuando WITH CHECK falla.
 */
export async function expectPermissionError(
  client: Client,
  query: string,
  params: unknown[] = []
): Promise<void> {
  try {
    await client.query(query, params as string[]);
    throw new Error(
      `RLS debería haber bloqueado esta operación con error, pero tuvo éxito: ${query.substring(0, 100)}`
    );
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.startsWith('RLS debería haber bloqueado')
    ) {
      throw err;
    }
    // OK: PostgreSQL lanzó error de permiso
  }
}

/**
 * Para UPDATE/DELETE bloqueado por RLS via USING clause:
 * PostgreSQL NO lanza error, simplemente no afecta filas (las filtra).
 * Verifica que rowCount === 0.
 */
export async function expectDeniedSilently(
  client: Client,
  query: string,
  params: unknown[] = []
): Promise<void> {
  const result = await client.query(query, params as string[]);
  const affected = result.rowCount ?? 0;
  if (affected > 0) {
    throw new Error(
      `RLS debería filtrar esta operación (rowCount esperado = 0), pero afectó ${affected} filas: ${query.substring(0, 100)}`
    );
  }
}

/** Alias para compatibilidad — preferir los dos helpers específicos arriba. */
export async function expectDenied(
  client: Client,
  query: string,
  params: unknown[] = []
): Promise<void> {
  return expectPermissionError(client, query, params);
}

/** Helper: cuenta filas retornadas para verificar visibilidad. */
export async function countRows(
  client: Client,
  table: string,
  whereClause = ''
): Promise<number> {
  const sql = `SELECT COUNT(*) AS n FROM ${table} ${whereClause}`;
  const { rows } = await client.query(sql);
  return parseInt(rows[0].n, 10);
}
