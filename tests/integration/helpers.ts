import { Client } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const DB_URL =
  process.env.TEST_DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5432/test_first_blades';

// Key fija para serializar la ejecución de archivos de integración a nivel DB.
const FB_INTEGRATION_LOCK_KEY = 727274;

// Mismas variables que lib/supabase/admin.ts: URL + service role key del local.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Vacía un bucket de Storage usando la Storage API (no SQL directo:
 * storage.protect_delete() prohíbe DELETE sobre storage.objects).
 * Bucket vacío no es error. Recursa por prefijos de user_id.
 */
async function emptyStorageBucket(admin: SupabaseClient, bucket: string) {
  async function listAllPaths(prefix = ''): Promise<string[]> {
    const { data, error } = await admin.storage
      .from(bucket)
      .list(prefix, { limit: 1000 });
    if (error) throw error;

    const paths: string[] = [];
    for (const entry of data ?? []) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      // entry.id === null ⇒ prefijo (carpeta), recursar.
      if (entry.id === null) {
        paths.push(...(await listAllPaths(path)));
      } else {
        paths.push(path);
      }
    }
    return paths;
  }

  const paths = await listAllPaths('');
  if (paths.length > 0) {
    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) throw error;
  }
}

// UUIDs fijos para los usuarios de test
export const IDS = {
  admin:       'a0000000-0000-0000-0001-000000000001',
  supervisor:  'a0000000-0000-0000-0001-000000000002',
  supervisor2: 'a0000000-0000-0000-0001-000000000003',
  employee1:   'a0000000-0000-0000-0001-000000000004', // bajo supervisor
  employee2:   'a0000000-0000-0000-0001-000000000005', // bajo supervisor
  employee3:   'a0000000-0000-0000-0001-000000000006', // bajo supervisor2
};

/**
 * Limpia y re-siembra la base de datos de test.
 * Requiere que las migraciones ya estén aplicadas (supabase start las aplica).
 * No toca los esquemas auth ni storage: solo trunca datos públicos y
 * elimina/re-inserta los usuarios de test en auth.users.
 */
export async function setupTestDb(): Promise<Client> {
  const client = new Client({ connectionString: DB_URL });
  await client.connect();

  // 0. Advisory lock de sesión: serializa setup+run entre archivos a nivel Postgres,
  //    independiente del scheduler de Vitest. Se mantiene mientras viva esta conexión
  //    y se libera solo al cerrarla en afterAll (db.end()). No bloquea SELECT/INSERT
  //    regulares: solo bloquea a otro setupTestDb() que pida el mismo lock, así que
  //    las conexiones de asUser()/asServiceRole() no se ven afectadas.
  await client.query('SELECT pg_advisory_lock($1)', [FB_INTEGRATION_LOCK_KEY]);

  // Si el setup falla después de tomar el lock, lo liberamos para que el
  // siguiente archivo no quede esperando hasta el hook timeout.
  try {
    // 1. Limpiar tablas públicas en orden de dependencia (CASCADE maneja el resto)
    await client.query(`
      TRUNCATE TABLE
        audit_log, procedures, rotation_assignments, rotation_groups,
        ausencia_requests, pasaje_requests, documents, profiles
      RESTART IDENTITY CASCADE
    `);

    // 2. Limpiar objetos de Storage de tests anteriores (vía Storage API).
    //    storage.protect_delete() prohíbe DELETE directo sobre storage.objects.
    const storageAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await emptyStorageBucket(storageAdmin, 'documents');

    // 3. Eliminar usuarios de test previos de auth.users (cascade a profiles, ya vacío)
    await client.query(
      `DELETE FROM auth.users WHERE id = ANY($1::uuid[])`,
      [[...Object.values(IDS)]]
    );

    // 4. Insertar usuarios de test en auth.users.
    //    El trigger on_auth_user_created (migración 0001) crea el perfil automáticamente.
    for (const id of Object.values(IDS)) {
      await client.query(`
        INSERT INTO auth.users (
          id, aud, role, email, encrypted_password,
          email_confirmed_at, created_at, updated_at,
          raw_app_meta_data, raw_user_meta_data,
          is_sso_user, is_anonymous
        ) VALUES (
          $1::uuid, 'authenticated', 'authenticated', $2, '',
          now(), now(), now(),
          '{"provider":"email","providers":["email"]}', '{}',
          false, false
        ) ON CONFLICT (id) DO NOTHING
      `, [id, `${id}@test.com`]);
    }

    // 5. Insertar o actualizar perfiles directamente (no depende del trigger on_auth_user_created).
    //    ON CONFLICT (id) DO UPDATE cubre tanto el caso "trigger no disparó" como
    //    "trigger disparó con role='empleado' por defecto".
    await client.query(`
      INSERT INTO public.profiles (id, email, full_name, role, status) VALUES
        ($1::uuid, 'admin@test.com',       'Admin Test',       'admin'::user_role,      'activo'::employee_status),
        ($2::uuid, 'supervisor@test.com',  'Supervisor Test',  'supervisor'::user_role, 'activo'::employee_status),
        ($3::uuid, 'supervisor2@test.com', 'Supervisor2 Test', 'supervisor'::user_role, 'activo'::employee_status),
        ($4::uuid, 'emp1@test.com',        'Empleado 1',       'empleado'::user_role,   'activo'::employee_status),
        ($5::uuid, 'emp2@test.com',        'Empleado 2',       'empleado'::user_role,   'activo'::employee_status),
        ($6::uuid, 'emp3@test.com',        'Empleado 3',       'empleado'::user_role,   'activo'::employee_status)
      ON CONFLICT (id) DO UPDATE SET
        email     = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        role      = EXCLUDED.role,
        status    = EXCLUDED.status
    `, [IDS.admin, IDS.supervisor, IDS.supervisor2, IDS.employee1, IDS.employee2, IDS.employee3]);

    // 6. Asignar supervisor_id
    await client.query(
      'UPDATE profiles SET supervisor_id = $1::uuid WHERE id IN ($2::uuid, $3::uuid)',
      [IDS.supervisor, IDS.employee1, IDS.employee2]
    );
    await client.query(
      'UPDATE profiles SET supervisor_id = $1::uuid WHERE id = $2::uuid',
      [IDS.supervisor2, IDS.employee3]
    );

    // 7. Grants para el rol authenticated (necesario para que RLS se evalúe en tests)
    await client.query(`
      GRANT USAGE ON SCHEMA public TO authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
      GRANT USAGE ON SCHEMA storage TO authenticated;
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
    `);

    // 8. Tripwire: el seed base debe haber dejado exactamente 6 profiles.
    //    Corre como postgres (superusuario), así que ve todas las filas sin RLS.
    //    Si falla, el problema está en el seed o en un TRUNCATE concurrente
    //    de otro archivo — no lo escondemos en violaciones de FK posteriores.
    const { rows: tripwire } = await client.query(
      'SELECT count(*)::int AS n FROM public.profiles'
    );
    if (tripwire[0].n !== 6) {
      throw new Error(
        `setupTestDb: se esperaban 6 profiles tras el seed, hay ${tripwire[0].n}. ` +
        `Indica seed incompleto o TRUNCATE concurrente de otro archivo de test.`
      );
    }

    return client;
  } catch (err) {
    // Liberar el lock antes de propagar para que el siguiente archivo no espere.
    try { await client.query('SELECT pg_advisory_unlock($1)', [FB_INTEGRATION_LOCK_KEY]); } catch { /* ignorar */ }
    try { await client.end(); } catch { /* ignorar */ }
    throw err;
  }
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
