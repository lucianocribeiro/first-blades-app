/**
 * Test de migración limpia — Portal First Blades
 *
 * Verifica que las migraciones (0001–0004) dejaron el esquema correcto.
 * Con Supabase local (supabase start), las migraciones ya se aplicaron al
 * iniciar; este test solo comprueba el estado resultante.
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DB_URL } from './helpers';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let client: Client;

beforeAll(async () => {
  if (!dbAvailable) return;
  client = new Client({ connectionString: DB_URL });
  await client.connect();
}, 30_000);

afterAll(async () => {
  await client?.end();
});

describe.skipIf(!dbAvailable)('migraciones 0001+0002+0003+0004: aplican limpias en DB fresca', () => {
  const expectedTables = [
    'profiles',
    'documents',
    'pasaje_requests',
    'ausencia_requests',
    'rotation_groups',
    'rotation_assignments',
    'procedures',
    'audit_log',
    'notification_log',
  ];

  for (const table of expectedTables) {
    it(`tabla public.${table} existe tras la migración`, async () => {
      const { rows } = await client.query(
        `SELECT to_regclass('public.${table}') AS oid`
      );
      expect(rows[0].oid).not.toBeNull();
    });
  }

  it('función auth_role() existe', async () => {
    const { rows } = await client.query(
      `SELECT proname FROM pg_proc WHERE proname = 'auth_role' AND pronamespace = 'public'::regnamespace`
    );
    expect(rows).toHaveLength(1);
  });

  it('función is_admin() existe', async () => {
    const { rows } = await client.query(
      `SELECT proname FROM pg_proc WHERE proname = 'is_admin' AND pronamespace = 'public'::regnamespace`
    );
    expect(rows).toHaveLength(1);
  });

  it('función log_audit() existe', async () => {
    const { rows } = await client.query(
      `SELECT proname FROM pg_proc WHERE proname = 'log_audit' AND pronamespace = 'public'::regnamespace`
    );
    expect(rows).toHaveLength(1);
  });

  it('RLS habilitada en todas las tablas', async () => {
    const { rows } = await client.query(`
      SELECT relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relrowsecurity = false
    `);
    expect(rows).toHaveLength(0);
  });

  it('bucket documents existe en storage', async () => {
    const { rows } = await client.query(
      `SELECT id FROM storage.buckets WHERE id = 'documents'`
    );
    expect(rows).toHaveLength(1);
  });

  it('enums de dominio existen (incluye certificado_tipo de 0002)', async () => {
    const { rows } = await client.query(`
      SELECT typname FROM pg_type
      WHERE typtype = 'e'
        AND typnamespace = 'public'::regnamespace
      ORDER BY typname
    `);
    const names = rows.map((r: { typname: string }) => r.typname).sort();
    expect(names).toEqual([
      'approval_status',
      'certificado_tipo',
      'employee_status',
      'estado_dia',
      'motivo_ausencia',
      'motivo_viaje',
      'notification_type',
      'post_aprobacion_tipo',
      'procedure_estado',
      'user_role',
    ]);
  });

  it('certificado_tipo tiene los 6 valores correctos', async () => {
    const { rows } = await client.query(`
      SELECT enumlabel FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      WHERE pg_type.typname = 'certificado_tipo'
      ORDER BY enumsortorder
    `);
    const values = rows.map((r: { enumlabel: string }) => r.enumlabel);
    expect(values).toEqual([
      'gwo', 'cursos_elevadores', 'espacio_confinado',
      'manejo_defensivo', 'cursos_vestas', 'otros',
    ]);
  });

  it('profiles tiene full_name, cuit y winda_id; nombre/apellido fueron retirados (0007)', async () => {
    const { rows } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles'
        AND column_name IN ('full_name', 'cuit', 'winda_id', 'nombre', 'apellido')
      ORDER BY column_name
    `);
    const cols = rows.map((r: { column_name: string }) => r.column_name);
    expect(cols).toContain('full_name');
    expect(cols).toContain('cuit');
    expect(cols).toContain('winda_id');
    expect(cols).not.toContain('nombre');
    expect(cols).not.toContain('apellido');
  });

  it('documents tiene columnas nuevas (certificado_tipo, certificado_otros_texto, fecha_vencimiento)', async () => {
    const { rows } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'documents'
        AND column_name IN ('certificado_tipo', 'certificado_otros_texto', 'fecha_vencimiento')
      ORDER BY column_name
    `);
    const cols = rows.map((r: { column_name: string }) => r.column_name);
    expect(cols).toEqual(['certificado_otros_texto', 'certificado_tipo', 'fecha_vencimiento']);
  });

  it('documents tiene columna file_purged_at nullable (migración 0003)', async () => {
    const { rows } = await client.query(`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'documents'
        AND column_name = 'file_purged_at'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].is_nullable).toBe('YES');
    expect(rows[0].data_type).toBe('timestamp with time zone');
  });

  it('policy documents_select existe (migración 0004)', async () => {
    const { rows } = await client.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'documents' AND policyname = 'documents_select'
    `);
    expect(rows).toHaveLength(1);
  });

  it('policy storage_documents_insert existe con soporte admin (migración 0004)', async () => {
    const { rows } = await client.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'storage_documents_insert'
    `);
    expect(rows).toHaveLength(1);
  });

  it('rotation_assignments tiene columnas nuevas es_estimado y motivo_otros_texto (migración 0009)', async () => {
    const { rows } = await client.query(`
      SELECT column_name, is_nullable, data_type, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'rotation_assignments'
        AND column_name IN ('es_estimado', 'motivo_otros_texto')
      ORDER BY column_name
    `);
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(byName.es_estimado.is_nullable).toBe('NO');
    expect(byName.es_estimado.data_type).toBe('boolean');
    expect(byName.es_estimado.column_default).toBe('false');
    expect(byName.motivo_otros_texto.is_nullable).toBe('YES');
    expect(byName.motivo_otros_texto.data_type).toBe('character varying');
  });

  it('rotation_assignments tiene EXACTAMENTE UNIQUE (user_id, fecha) — columnas y orden (per-día desde 0001, confirmado en 0009)', async () => {
    const { rows } = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.rotation_assignments'::regclass AND contype = 'u'
    `);
    // Detector de drift estricto: no alcanza con "existe alguna UNIQUE" (FB-F3-AUD-01
    // Hallazgo 5) — se valida la definición completa (columnas y orden exactos).
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toBe('UNIQUE (user_id, fecha)');
  });

  it('CHECK rotation_assignments_motivo_requerido exige motivo_ausencia cuando estado_dia = periodo_fuera_trabajo (expresión, no solo nombre — migración 0009)', async () => {
    const { rows } = await client.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.rotation_assignments'::regclass
        AND conname = 'rotation_assignments_motivo_requerido'
        AND contype = 'c'
    `);
    expect(rows).toHaveLength(1);
    // Se valida la expresión lógica real (no solo nombre/tipo, FB-F3-AUD-01 Hallazgo 5).
    // No se afirma el string completo porque Postgres normaliza casts de enum de forma
    // dependiente de versión; se afirma cada término semántico de la implicación.
    const def: string = rows[0].def;
    expect(def).toMatch(/estado_dia/);
    expect(def).toMatch(/periodo_fuera_trabajo/);
    expect(def).toMatch(/OR/);
    expect(def).toMatch(/motivo_ausencia IS NOT NULL/);
  });

  it('profiles.dni es text nullable con constraint UNIQUE (migración 0009)', async () => {
    const { rows: cols } = await client.query(`
      SELECT data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'dni'
    `);
    expect(cols).toHaveLength(1);
    expect(cols[0].data_type).toBe('text');
    expect(cols[0].is_nullable).toBe('YES');

    const { rows: cons } = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.profiles'::regclass
        AND conname = 'profiles_dni_unique'
        AND contype = 'u'
    `);
    expect(cons).toHaveLength(1);
    expect(cons[0].def).toBe('UNIQUE (dni)');
  });

  it('rotation_groups queda admin-only: policy rotation_groups_select_all fue eliminada (migración 0009, FB-F3-AUD-01 Hallazgo 3)', async () => {
    const { rows } = await client.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'rotation_groups'
    `);
    const names = rows.map((r) => r.policyname).sort();
    expect(names).toEqual(['rotation_groups_admin']);
  });

  it('notification_type tiene los 3 valores correctos, incluidos los de franco (migración 0010)', async () => {
    const { rows } = await client.query(`
      SELECT enumlabel FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      WHERE pg_type.typname = 'notification_type'
      ORDER BY enumsortorder
    `);
    const values = rows.map((r: { enumlabel: string }) => r.enumlabel);
    expect(values).toEqual(['vencimiento_documento', 'sin_franco', 'franco_excedido']);
  });

  it('notification_log.document_id es nullable (migración 0011)', async () => {
    const { rows } = await client.query(`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notification_log' AND column_name = 'document_id'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].is_nullable).toBe('YES');
  });

  it('notification_log tiene empleado_id (FK profiles, nullable) y racha_inicio (date, nullable) (migración 0011)', async () => {
    const { rows } = await client.query(`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notification_log'
        AND column_name IN ('empleado_id', 'racha_inicio')
      ORDER BY column_name
    `);
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(byName.empleado_id.is_nullable).toBe('YES');
    expect(byName.empleado_id.data_type).toBe('uuid');
    expect(byName.racha_inicio.is_nullable).toBe('YES');
    expect(byName.racha_inicio.data_type).toBe('date');

    const { rows: fk } = await client.query(`
      SELECT confrelid::regclass::text AS referenced
      FROM pg_constraint
      WHERE conrelid = 'public.notification_log'::regclass
        AND contype = 'f'
        AND conname = 'notification_log_empleado_id_fkey'
    `);
    expect(fk).toHaveLength(1);
    expect(fk[0].referenced).toBe('profiles');
  });

  it('CHECK notification_log_forma_por_tipo exige document_id XOR (empleado_id + racha_inicio) según tipo (migración 0011)', async () => {
    const { rows } = await client.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.notification_log'::regclass
        AND conname = 'notification_log_forma_por_tipo'
        AND contype = 'c'
    `);
    expect(rows).toHaveLength(1);
    const def: string = rows[0].def;
    expect(def).toMatch(/vencimiento_documento/);
    expect(def).toMatch(/sin_franco/);
    expect(def).toMatch(/franco_excedido/);
    expect(def).toMatch(/document_id IS NOT NULL/);
    expect(def).toMatch(/empleado_id IS NOT NULL/);
    expect(def).toMatch(/racha_inicio IS NOT NULL/);
  });

  it('CHECK notification_log_umbral_valido cubre 5/15/30 (documento), 48/60 (sin_franco) y 10/12 (franco_excedido) (migración 0011)', async () => {
    const { rows } = await client.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.notification_log'::regclass
        AND conname = 'notification_log_umbral_valido'
        AND contype = 'c'
    `);
    expect(rows).toHaveLength(1);
    const def: string = rows[0].def;
    expect(def).toMatch(/5, 15, 30/);
    expect(def).toMatch(/48, 60/);
    expect(def).toMatch(/10, 12/);
  });

  it('notification_log_franco_idempotencia es UNIQUE parcial (tipo, empleado_id, umbral, racha_inicio, recipient_profile_id) WHERE document_id IS NULL (migración 0011)', async () => {
    const { rows } = await client.query(`
      SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'notification_log'
        AND indexname = 'notification_log_franco_idempotencia'
    `);
    expect(rows).toHaveLength(1);
    const def: string = rows[0].indexdef;
    expect(def).toMatch(/UNIQUE/);
    expect(def).toMatch(/tipo, empleado_id, umbral, racha_inicio, recipient_profile_id/);
    expect(def).toMatch(/WHERE \(document_id IS NULL\)/);
  });

  it('notification_log sigue con la UNIQUE original de documentos intacta (tipo, document_id, umbral, recipient_profile_id)', async () => {
    const { rows } = await client.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.notification_log'::regclass
        AND conname = 'notification_log_idempotencia'
        AND contype = 'u'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toBe('UNIQUE (tipo, document_id, umbral, recipient_profile_id)');
  });

  it('notification_log RLS sigue deny-all: sin policies (migración 0011 no agrega ninguna)', async () => {
    const { rows } = await client.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'notification_log'
    `);
    expect(rows).toHaveLength(0);
  });

  it('ausencia_requests: inventario EXACTO de CHECKs — solo los 2 de 0012, con definición canónica completa (FB-F3-AUD-14 Hallazgo Medio 1: drift detector real, no "existe alguno")', async () => {
    const { rows } = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.ausencia_requests'::regclass AND contype = 'c'
      ORDER BY conname
    `);
    // Definiciones capturadas contra Postgres 17.10 real (misma versión que prod)
    // aplicando el archivo de migración 0012 tal cual, no adivinadas.
    expect(rows).toEqual([
      {
        conname: 'ausencia_requests_rechazo_requiere_motivo',
        def: "CHECK (((estado <> 'rechazado'::approval_status) OR ((motivo_rechazo IS NOT NULL) AND (btrim(motivo_rechazo) <> ''::text))))",
      },
      {
        conname: 'ausencia_requests_resolucion_completa',
        def: "CHECK (((estado = 'pendiente'::approval_status) OR ((reviewed_by IS NOT NULL) AND (reviewed_at IS NOT NULL))))",
      },
    ]);
  });

  it('ausencia_requests: inventario EXACTO de índices — pkey + el índice de respaldo de la exclusion constraint de 0014 (el parcial de 0012 fue reemplazado, FB-F4-01)', async () => {
    const { rows } = await client.query(`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'ausencia_requests'
      ORDER BY indexname
    `);
    // El nombre de ambos índices sí se afirma exacto (determinístico: pkey
    // explícito + el backing index de una EXCLUDE constraint sin índice
    // nombrado aparte toma el nombre de la constraint). El indexdef del
    // backing index se valida por componentes semánticos, no toEqual
    // literal completo: la forma en que ruleutils.c castea el literal
    // '[]' dentro de daterange(...) es dependiente de versión de Postgres
    // (mismo criterio ya aplicado más abajo al pg_get_constraintdef de la
    // propia exclusion constraint, y arriba al CHECK de rotation_assignments).
    expect(rows.map((r) => r.indexname).sort()).toEqual([
      'ausencia_requests_no_solapamiento_pendiente',
      'ausencia_requests_pkey',
    ]);

    const pkey = rows.find((r) => r.indexname === 'ausencia_requests_pkey');
    expect(pkey.indexdef).toBe(
      'CREATE UNIQUE INDEX ausencia_requests_pkey ON public.ausencia_requests USING btree (id)'
    );

    const exclIndex = rows.find((r) => r.indexname === 'ausencia_requests_no_solapamiento_pendiente');
    expect(exclIndex.indexdef).toMatch(/^CREATE INDEX ausencia_requests_no_solapamiento_pendiente/);
    expect(exclIndex.indexdef).toMatch(/USING gist/);
    expect(exclIndex.indexdef).toMatch(/user_id/);
    expect(exclIndex.indexdef).toMatch(/daterange\(fecha_inicio, fecha_fin, '\[\]'/);
    expect(exclIndex.indexdef).toMatch(/WHERE \(estado = 'pendiente'::approval_status\)/);
    // No es UNIQUE: una exclusion constraint no es una unique index (impone
    // no-solapamiento vía operadores, no igualdad estricta).
    expect(exclIndex.indexdef).not.toMatch(/CREATE UNIQUE INDEX/);
  });

  it('ausencia_requests_pendiente_unica (índice de 0012) fue removido por 0014', async () => {
    const { rows } = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'ausencia_requests'
        AND indexname = 'ausencia_requests_pendiente_unica'
    `);
    expect(rows).toHaveLength(0);
  });

  it('ausencia_requests: ni tabla ni RLS ni enums cambiaron de forma — solo se agregaron constraints (migración 0012 es delta puro)', async () => {
    const { rows: policies } = await client.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'ausencia_requests'
    `);
    expect(policies.map((r) => r.policyname).sort()).toEqual([
      'ausencias_delete_admin',
      'ausencias_insert_admin',
      'ausencias_insert_non_admin',
      'ausencias_select',
      'ausencias_update_admin',
    ]);

    const { rows: enums } = await client.query(`
      SELECT typname FROM pg_type
      WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace
      ORDER BY typname
    `);
    expect(enums.map((r) => r.typname)).toEqual([
      'approval_status',
      'certificado_tipo',
      'employee_status',
      'estado_dia',
      'motivo_ausencia',
      'motivo_viaje',
      'notification_type',
      'post_aprobacion_tipo',
      'procedure_estado',
      'user_role',
    ]);
  });

  // ─── FB-F3-17: función resolver_ausencia_request (0013) ───────────

  it('función resolver_ausencia_request() existe con la firma (uuid, text, text), 1 default, retorna void', async () => {
    const { rows } = await client.query(`
      SELECT
        p.pronargs,
        p.pronargdefaults,
        pg_get_function_result(p.oid) AS ret,
        (
          SELECT array_agg(t.typname::text ORDER BY u.ord)
          FROM unnest(p.proargtypes) WITH ORDINALITY AS u(oid, ord)
          JOIN pg_type t ON t.oid = u.oid
        ) AS arg_types
      FROM pg_proc p
      WHERE p.proname = 'resolver_ausencia_request' AND p.pronamespace = 'public'::regnamespace
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].arg_types).toEqual(['uuid', 'text', 'text']);
    expect(rows[0].pronargs).toBe(3);
    expect(rows[0].pronargdefaults).toBe(1);
    expect(rows[0].ret).toBe('void');
  });

  it('resolver_ausencia_request: SECURITY DEFINER con search_path fijo y owner consistente con is_admin()/auth_role() (FB-F3-18, cierra Nota de FB-F3-AUD-17)', async () => {
    // prosecdef + proconfig: la guarda de admin de adentro de la función es
    // el control de seguridad real (bypassea RLS de audit_log/rotation_assignments),
    // así que si algún día se pierde SECURITY DEFINER o el search_path fijo,
    // este test tiene que romper.
    const { rows } = await client.query(`
      SELECT p.prosecdef, p.proconfig, r.rolname AS owner
      FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname = 'resolver_ausencia_request' AND p.pronamespace = 'public'::regnamespace
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig).toContain('search_path=public');

    // El owner concreto (nombre de rol) difiere entre el Postgres local de
    // CI y producción, así que no se afirma un nombre hardcodeado. Lo que
    // importa para la seguridad es: (a) no es un rol de app (authenticated/
    // anon podrían escalar si fueran owner) y (b) es el mismo rol que ya es
    // owner de los otros SECURITY DEFINER de RLS (is_admin/auth_role) — si
    // resolver_ausencia_request quedara con un owner distinto, sería una
    // señal de drift en cómo se aplicó la migración.
    expect(['authenticated', 'anon', 'public']).not.toContain(rows[0].owner);

    const { rows: helperOwners } = await client.query(`
      SELECT p.proname, r.rolname AS owner
      FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname IN ('is_admin', 'auth_role') AND p.pronamespace = 'public'::regnamespace
      ORDER BY p.proname
    `);
    expect(helperOwners).toHaveLength(2);
    for (const helper of helperOwners) {
      expect(helper.owner).toBe(rows[0].owner);
    }
  });

  it('resolver_ausencia_request: EXECUTE otorgado a authenticated, negado a anon y a PUBLIC (0013)', async () => {
    const { rows } = await client.query(`
      SELECT
        has_function_privilege('authenticated', 'public.resolver_ausencia_request(uuid,text,text)', 'EXECUTE') AS authenticated_can,
        has_function_privilege('anon', 'public.resolver_ausencia_request(uuid,text,text)', 'EXECUTE') AS anon_can,
        has_function_privilege('public', 'public.resolver_ausencia_request(uuid,text,text)', 'EXECUTE') AS public_can
    `);
    expect(rows[0]).toEqual({ authenticated_can: true, anon_can: false, public_can: false });
  });

  it('0013 es delta puro: RLS y enums de ausencia_requests/rotation_assignments/audit_log no cambiaron (solo se agregó la función)', async () => {
    const { rows: ausenciaPolicies } = await client.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'ausencia_requests'
    `);
    expect(ausenciaPolicies.map((r) => r.policyname).sort()).toEqual([
      'ausencias_delete_admin',
      'ausencias_insert_admin',
      'ausencias_insert_non_admin',
      'ausencias_select',
      'ausencias_update_admin',
    ]);

    const { rows: rotationPolicies } = await client.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'rotation_assignments'
    `);
    expect(rotationPolicies.map((r) => r.policyname).sort()).toEqual([
      'rotation_assign_select',
      'rotation_assign_write_admin',
    ]);

    const { rows: auditPolicies } = await client.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'audit_log'
    `);
    expect(auditPolicies.map((r) => r.policyname)).toEqual(['audit_log_select_admin']);
  });

  // ─── FB-F4-01: no-solapamiento de ausencias pendientes (0014) ───────────

  it('extensión btree_gist instalada en schema extensions (0014)', async () => {
    const { rows } = await client.query(`
      SELECT e.extname, n.nspname AS schema
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'btree_gist'
    `);
    expect(rows).toEqual([{ extname: 'btree_gist', schema: 'extensions' }]);
  });

  it('ausencia_requests: exclusion constraint ausencia_requests_no_solapamiento_pendiente existe (contype EXCLUDE, gist, user_id + daterange, predicado pendiente) (0014)', async () => {
    const { rows } = await client.query(`
      SELECT conname, contype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.ausencia_requests'::regclass
        AND conname = 'ausencia_requests_no_solapamiento_pendiente'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].contype).toBe('x');

    // No se afirma el string completo de pg_get_constraintdef: el casteo
    // exacto del literal '[]' dentro de daterange(...) es dependiente de
    // versión de Postgres (mismo criterio que el resto del archivo cuando
    // ruleutils.c normaliza expresiones). Se validan los componentes
    // semánticos que importan para la regla de negocio.
    const def: string = rows[0].def;
    expect(def).toMatch(/EXCLUDE USING gist/);
    expect(def).toMatch(/user_id WITH =/);
    expect(def).toMatch(/daterange\(fecha_inicio, fecha_fin, '\[\]'/);
    expect(def).toMatch(/WITH &&/);
    expect(def).toMatch(/WHERE \(\(?estado = 'pendiente'::approval_status\)?\)/);
  });

  it('ausencia_requests: ni RLS ni enums cambiaron de forma en 0014 — el delta es solo la extensión + el reemplazo de índice por exclusion constraint', async () => {
    const { rows: policies } = await client.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'ausencia_requests'
    `);
    expect(policies.map((r) => r.policyname).sort()).toEqual([
      'ausencias_delete_admin',
      'ausencias_insert_admin',
      'ausencias_insert_non_admin',
      'ausencias_select',
      'ausencias_update_admin',
    ]);

    const { rows: enums } = await client.query(`
      SELECT typname FROM pg_type
      WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace
      ORDER BY typname
    `);
    expect(enums.map((r) => r.typname)).toEqual([
      'approval_status',
      'certificado_tipo',
      'employee_status',
      'estado_dia',
      'motivo_ausencia',
      'motivo_viaje',
      'notification_type',
      'post_aprobacion_tipo',
      'procedure_estado',
      'user_role',
    ]);
  });

  // ─── FB-F4-03: resolver_ausencia_request propaga motivo_otros_texto (0015) ─

  it('ausencia_requests.motivo_otros_texto existe: character varying(80), nullable, espejo de rotation_assignments (0015)', async () => {
    const { rows } = await client.query(`
      SELECT data_type, character_maximum_length, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'ausencia_requests' AND column_name = 'motivo_otros_texto'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe('character varying');
    expect(rows[0].character_maximum_length).toBe(80);
    expect(rows[0].is_nullable).toBe('YES');
  });

  it('ausencia_requests: 0015 no agrega ningún CHECK — motivo_otros_texto queda sin CHECK, igual que su espejo en rotation_assignments (inventario EXACTO de CHECKs sigue siendo el de 0012)', async () => {
    const { rows } = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.ausencia_requests'::regclass AND contype = 'c'
      ORDER BY conname
    `);
    expect(rows).toEqual([
      {
        conname: 'ausencia_requests_rechazo_requiere_motivo',
        def: "CHECK (((estado <> 'rechazado'::approval_status) OR ((motivo_rechazo IS NOT NULL) AND (btrim(motivo_rechazo) <> ''::text))))",
      },
      {
        conname: 'ausencia_requests_resolucion_completa',
        def: "CHECK (((estado = 'pendiente'::approval_status) OR ((reviewed_by IS NOT NULL) AND (reviewed_at IS NOT NULL))))",
      },
    ]);
  });

  it('resolver_ausencia_request: firma y atributos de seguridad de §6.1 intactos tras el CREATE OR REPLACE de 0015 (mismo prosecdef/search_path/owner/grants que 0013)', async () => {
    const { rows } = await client.query(`
      SELECT
        p.pronargs,
        p.pronargdefaults,
        pg_get_function_result(p.oid) AS ret,
        p.prosecdef,
        p.proconfig,
        r.rolname AS owner,
        (
          SELECT array_agg(t.typname::text ORDER BY u.ord)
          FROM unnest(p.proargtypes) WITH ORDINALITY AS u(oid, ord)
          JOIN pg_type t ON t.oid = u.oid
        ) AS arg_types
      FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname = 'resolver_ausencia_request' AND p.pronamespace = 'public'::regnamespace
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].arg_types).toEqual(['uuid', 'text', 'text']);
    expect(rows[0].pronargs).toBe(3);
    expect(rows[0].pronargdefaults).toBe(1);
    expect(rows[0].ret).toBe('void');
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig).toContain('search_path=public');
    expect(['authenticated', 'anon', 'public']).not.toContain(rows[0].owner);

    const { rows: grants } = await client.query(`
      SELECT
        has_function_privilege('authenticated', 'public.resolver_ausencia_request(uuid,text,text)', 'EXECUTE') AS authenticated_can,
        has_function_privilege('anon', 'public.resolver_ausencia_request(uuid,text,text)', 'EXECUTE') AS anon_can,
        has_function_privilege('public', 'public.resolver_ausencia_request(uuid,text,text)', 'EXECUTE') AS public_can
    `);
    // CREATE OR REPLACE no reinicia el ACL cuando la firma no cambia; esto
    // confirma que 0015 no aflojó ninguna guarda de acceso de §6.1.
    expect(grants[0]).toEqual({ authenticated_can: true, anon_can: false, public_can: false });
  });

  // ─── FB-F4-07: dias_viaje + resolver_pasaje_request (0016) ───────────

  it('pasaje_requests.dias_viaje existe: date[], nullable (0016)', async () => {
    const { rows } = await client.query(`
      SELECT data_type, udt_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'pasaje_requests' AND column_name = 'dias_viaje'
    `);
    expect(rows).toHaveLength(1);
    // Postgres reporta 'ARRAY' en data_type para cualquier columna de tipo
    // array; udt_name da el tipo de elemento real ('_date' = array de date).
    expect(rows[0].data_type).toBe('ARRAY');
    expect(rows[0].udt_name).toBe('_date');
    expect(rows[0].is_nullable).toBe('YES');
  });

  it('CHECK pasaje_requests_dias_viaje_no_vacio: NULL permitido, array vacío rechazado (0016)', async () => {
    const { rows } = await client.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.pasaje_requests'::regclass
        AND conname = 'pasaje_requests_dias_viaje_no_vacio'
        AND contype = 'c'
    `);
    expect(rows).toHaveLength(1);
    // Se valida por componentes semánticos (mismo criterio que el resto del
    // archivo para expresiones que Postgres normaliza con paréntesis extra).
    // Importa explícitamente que use cardinality() y NO array_length(): esta
    // última devuelve NULL (no 0) para un array vacío, lo que con el OR de
    // "IS NULL" dejaría pasar un '{}' — cardinality() sí devuelve 0.
    const def: string = rows[0].def;
    expect(def).toMatch(/dias_viaje IS NULL/);
    expect(def).toMatch(/OR/);
    expect(def).toMatch(/cardinality\(dias_viaje\) >= 1/);
    expect(def).not.toMatch(/array_length/);
  });

  it('pasaje_requests: RLS y enums no cambiaron en 0016 — el delta es solo la columna + su CHECK', async () => {
    const { rows: policies } = await client.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'pasaje_requests'
    `);
    expect(policies.map((r) => r.policyname).sort()).toEqual([
      'pasajes_delete_admin',
      'pasajes_insert_admin',
      'pasajes_insert_empleado',
      'pasajes_insert_supervisor',
      'pasajes_select',
      'pasajes_update_admin',
    ]);

    const { rows: enums } = await client.query(`
      SELECT typname FROM pg_type
      WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace
      ORDER BY typname
    `);
    expect(enums.map((r) => r.typname)).toEqual([
      'approval_status',
      'certificado_tipo',
      'employee_status',
      'estado_dia',
      'motivo_ausencia',
      'motivo_viaje',
      'notification_type',
      'post_aprobacion_tipo',
      'procedure_estado',
      'user_role',
    ]);
  });

  it('función resolver_pasaje_request() existe con la firma (uuid, text, text), 1 default, retorna void (0016)', async () => {
    const { rows } = await client.query(`
      SELECT
        p.pronargs,
        p.pronargdefaults,
        pg_get_function_result(p.oid) AS ret,
        (
          SELECT array_agg(t.typname::text ORDER BY u.ord)
          FROM unnest(p.proargtypes) WITH ORDINALITY AS u(oid, ord)
          JOIN pg_type t ON t.oid = u.oid
        ) AS arg_types
      FROM pg_proc p
      WHERE p.proname = 'resolver_pasaje_request' AND p.pronamespace = 'public'::regnamespace
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].arg_types).toEqual(['uuid', 'text', 'text']);
    expect(rows[0].pronargs).toBe(3);
    expect(rows[0].pronargdefaults).toBe(1);
    expect(rows[0].ret).toBe('void');
  });

  it('resolver_pasaje_request: SECURITY DEFINER con search_path fijo y owner consistente con is_admin()/auth_role() (0016, réplica de §6.1)', async () => {
    const { rows } = await client.query(`
      SELECT p.prosecdef, p.proconfig, r.rolname AS owner
      FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname = 'resolver_pasaje_request' AND p.pronamespace = 'public'::regnamespace
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].prosecdef).toBe(true);
    expect(rows[0].proconfig).toContain('search_path=public');

    // Mismo criterio que resolver_ausencia_request: no se afirma un nombre
    // de rol hardcodeado (difiere entre CI y prod), pero sí que no es un rol
    // de app y que coincide con el owner de is_admin()/auth_role() — si
    // resolver_pasaje_request quedara con un owner distinto, sería drift.
    expect(['authenticated', 'anon', 'public']).not.toContain(rows[0].owner);

    const { rows: helperOwners } = await client.query(`
      SELECT p.proname, r.rolname AS owner
      FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname IN ('is_admin', 'auth_role') AND p.pronamespace = 'public'::regnamespace
      ORDER BY p.proname
    `);
    expect(helperOwners).toHaveLength(2);
    for (const helper of helperOwners) {
      expect(helper.owner).toBe(rows[0].owner);
    }
  });

  it('resolver_pasaje_request: EXECUTE otorgado a authenticated, negado a anon y a PUBLIC (0016)', async () => {
    const { rows } = await client.query(`
      SELECT
        has_function_privilege('authenticated', 'public.resolver_pasaje_request(uuid,text,text)', 'EXECUTE') AS authenticated_can,
        has_function_privilege('anon', 'public.resolver_pasaje_request(uuid,text,text)', 'EXECUTE') AS anon_can,
        has_function_privilege('public', 'public.resolver_pasaje_request(uuid,text,text)', 'EXECUTE') AS public_can
    `);
    expect(rows[0]).toEqual({ authenticated_can: true, anon_can: false, public_can: false });
  });

  it('rotation_assignments: CHECK motivo_requerido y UNIQUE(user_id, fecha) siguen intactos — resolver_pasaje_request depende de ambos para en_viaje/upsert (0016 no los toca)', async () => {
    const { rows: check } = await client.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.rotation_assignments'::regclass
        AND conname = 'rotation_assignments_motivo_requerido'
        AND contype = 'c'
    `);
    expect(check).toHaveLength(1);
    expect(check[0].def).toMatch(/estado_dia/);
    expect(check[0].def).toMatch(/periodo_fuera_trabajo/);
    expect(check[0].def).toMatch(/motivo_ausencia IS NOT NULL/);

    const { rows: unique } = await client.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.rotation_assignments'::regclass AND contype = 'u'
    `);
    expect(unique).toHaveLength(1);
    expect(unique[0].def).toBe('UNIQUE (user_id, fecha)');
  });

  // ─── FB-F4-12: cambio post-aprobación (0017) ─────────────────────────

  it('enum post_aprobacion_tipo existe con EXACTAMENTE 2 valores: editada, cancelada (0017)', async () => {
    const { rows } = await client.query(`
      SELECT enumlabel FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      WHERE pg_type.typname = 'post_aprobacion_tipo'
      ORDER BY enumsortorder
    `);
    const values = rows.map((r: { enumlabel: string }) => r.enumlabel);
    expect(values).toEqual(['editada', 'cancelada']);
  });

  it('enums de dominio: post_aprobacion_tipo se sumó al inventario, el resto no cambió (0017)', async () => {
    const { rows } = await client.query(`
      SELECT typname FROM pg_type
      WHERE typtype = 'e' AND typnamespace = 'public'::regnamespace
      ORDER BY typname
    `);
    expect(rows.map((r: { typname: string }) => r.typname)).toEqual([
      'approval_status',
      'certificado_tipo',
      'employee_status',
      'estado_dia',
      'motivo_ausencia',
      'motivo_viaje',
      'notification_type',
      'post_aprobacion_tipo',
      'procedure_estado',
      'user_role',
    ]);
  });

  for (const table of ['ausencia_requests', 'pasaje_requests']) {
    it(`${table} tiene las 3 columnas de cambio post-aprobación: post_aprobacion_tipo (enum, nullable), comentario_post_aprobacion (text, nullable), post_aprobacion_at (timestamptz, nullable) (0017)`, async () => {
      const { rows } = await client.query(`
        SELECT column_name, data_type, udt_name, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
          AND column_name IN ('post_aprobacion_tipo', 'comentario_post_aprobacion', 'post_aprobacion_at')
      `, [table]);
      const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));

      expect(byName.post_aprobacion_tipo.udt_name).toBe('post_aprobacion_tipo');
      expect(byName.post_aprobacion_tipo.is_nullable).toBe('YES');

      expect(byName.comentario_post_aprobacion.data_type).toBe('text');
      expect(byName.comentario_post_aprobacion.is_nullable).toBe('YES');

      expect(byName.post_aprobacion_at.data_type).toBe('timestamp with time zone');
      expect(byName.post_aprobacion_at.is_nullable).toBe('YES');
    });
  }

  it('ausencia_requests y pasaje_requests: RLS no cambió en 0017 — el delta es solo columnas + funciones nuevas', async () => {
    const { rows: ausenciaPolicies } = await client.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'ausencia_requests'
    `);
    expect(ausenciaPolicies.map((r) => r.policyname).sort()).toEqual([
      'ausencias_delete_admin',
      'ausencias_insert_admin',
      'ausencias_insert_non_admin',
      'ausencias_select',
      'ausencias_update_admin',
    ]);

    const { rows: pasajePolicies } = await client.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'pasaje_requests'
    `);
    expect(pasajePolicies.map((r) => r.policyname).sort()).toEqual([
      'pasajes_delete_admin',
      'pasajes_insert_admin',
      'pasajes_insert_empleado',
      'pasajes_insert_supervisor',
      'pasajes_select',
      'pasajes_update_admin',
    ]);
  });

  for (const [fn, args] of [
    ['cancelar_editar_ausencia_aprobada', ['uuid', 'text', 'text', 'date', 'date']],
    ['cancelar_editar_pasaje_aprobado', ['uuid', 'text', 'text', '_date']],
  ] as const) {
    it(`función ${fn}() existe con la firma esperada, 2 defaults, retorna void (0017)`, async () => {
      const { rows } = await client.query(`
        SELECT
          p.pronargs,
          p.pronargdefaults,
          pg_get_function_result(p.oid) AS ret,
          (
            SELECT array_agg(t.typname::text ORDER BY u.ord)
            FROM unnest(p.proargtypes) WITH ORDINALITY AS u(oid, ord)
            JOIN pg_type t ON t.oid = u.oid
          ) AS arg_types
        FROM pg_proc p
        WHERE p.proname = $1 AND p.pronamespace = 'public'::regnamespace
      `, [fn]);
      expect(rows).toHaveLength(1);
      expect(rows[0].arg_types).toEqual([...args]);
      expect(rows[0].pronargs).toBe(args.length);
      expect(rows[0].pronargdefaults).toBe(fn === 'cancelar_editar_ausencia_aprobada' ? 2 : 1);
      expect(rows[0].ret).toBe('void');
    });

    it(`${fn}: SECURITY DEFINER con search_path fijo y owner consistente con is_admin()/auth_role() (0017, §6.1)`, async () => {
      const { rows } = await client.query(`
        SELECT p.prosecdef, p.proconfig, r.rolname AS owner
        FROM pg_proc p
        JOIN pg_roles r ON r.oid = p.proowner
        WHERE p.proname = $1 AND p.pronamespace = 'public'::regnamespace
      `, [fn]);
      expect(rows).toHaveLength(1);
      expect(rows[0].prosecdef).toBe(true);
      expect(rows[0].proconfig).toContain('search_path=public');
      expect(['authenticated', 'anon', 'public']).not.toContain(rows[0].owner);

      const { rows: helperOwners } = await client.query(`
        SELECT p.proname, r.rolname AS owner
        FROM pg_proc p
        JOIN pg_roles r ON r.oid = p.proowner
        WHERE p.proname IN ('is_admin', 'auth_role') AND p.pronamespace = 'public'::regnamespace
        ORDER BY p.proname
      `);
      expect(helperOwners).toHaveLength(2);
      for (const helper of helperOwners) {
        expect(helper.owner).toBe(rows[0].owner);
      }
    });
  }

  it('cancelar_editar_ausencia_aprobada: EXECUTE otorgado a authenticated, negado a anon y a PUBLIC (0017)', async () => {
    const { rows } = await client.query(`
      SELECT
        has_function_privilege('authenticated', 'public.cancelar_editar_ausencia_aprobada(uuid,text,text,date,date)', 'EXECUTE') AS authenticated_can,
        has_function_privilege('anon', 'public.cancelar_editar_ausencia_aprobada(uuid,text,text,date,date)', 'EXECUTE') AS anon_can,
        has_function_privilege('public', 'public.cancelar_editar_ausencia_aprobada(uuid,text,text,date,date)', 'EXECUTE') AS public_can
    `);
    expect(rows[0]).toEqual({ authenticated_can: true, anon_can: false, public_can: false });
  });

  it('cancelar_editar_pasaje_aprobado: EXECUTE otorgado a authenticated, negado a anon y a PUBLIC (0017)', async () => {
    const { rows } = await client.query(`
      SELECT
        has_function_privilege('authenticated', 'public.cancelar_editar_pasaje_aprobado(uuid,text,text,date[])', 'EXECUTE') AS authenticated_can,
        has_function_privilege('anon', 'public.cancelar_editar_pasaje_aprobado(uuid,text,text,date[])', 'EXECUTE') AS anon_can,
        has_function_privilege('public', 'public.cancelar_editar_pasaje_aprobado(uuid,text,text,date[])', 'EXECUTE') AS public_can
    `);
    expect(rows[0]).toEqual({ authenticated_can: true, anon_can: false, public_can: false });
  });

  // ─── FB-F5-02: procedures renombrado + estado + CHECK + RPCs (0020) ───

  it('procedures: columnas viejas (title/content/storage_path/category) ya no existen (0020)', async () => {
    const { rows } = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'procedures'
        AND column_name IN ('title', 'content', 'storage_path', 'category')
    `);
    expect(rows).toHaveLength(0);
  });

  it('procedures: columnas nuevas en español — titulo (NOT NULL), contenido_texto, file_path, categoria (nullable) (0020)', async () => {
    const { rows } = await client.query(`
      SELECT column_name, is_nullable, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'procedures'
        AND column_name IN ('titulo', 'contenido_texto', 'file_path', 'categoria')
    `);
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(byName.titulo.is_nullable).toBe('NO');
    expect(byName.titulo.data_type).toBe('text');
    expect(byName.contenido_texto.is_nullable).toBe('YES');
    expect(byName.file_path.is_nullable).toBe('YES');
    expect(byName.categoria.is_nullable).toBe('YES');
  });

  it('enum procedure_estado tiene EXACTAMENTE 2 valores: vigente, archivado (0020)', async () => {
    const { rows } = await client.query(`
      SELECT enumlabel FROM pg_enum
      JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
      WHERE pg_type.typname = 'procedure_estado'
      ORDER BY enumsortorder
    `);
    expect(rows.map((r: { enumlabel: string }) => r.enumlabel)).toEqual(['vigente', 'archivado']);
  });

  it('procedures.estado: procedure_estado NOT NULL DEFAULT vigente (0020)', async () => {
    const { rows } = await client.query(`
      SELECT is_nullable, column_default, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'procedures' AND column_name = 'estado'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].is_nullable).toBe('NO');
    expect(rows[0].udt_name).toBe('procedure_estado');
    expect(rows[0].column_default).toBe("'vigente'::procedure_estado");
  });

  it('CHECK procedures_contenido_presente exige contenido_texto O file_path no compuestos solo de whitespace ([[:space:]], no solo btrim), simétrico para los dos (0020, fix FB-F5-AUD-03 Hallazgo 1)', async () => {
    const { rows } = await client.query(`
      SELECT pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.procedures'::regclass
        AND conname = 'procedures_contenido_presente'
        AND contype = 'c'
    `);
    expect(rows).toHaveLength(1);
    // Componentes semánticos, no el string completo — mismo criterio que el
    // resto del archivo para expresiones normalizadas por Postgres.
    // FB-F5-AUD-03 Hallazgo 1: btrim() sin segundo argumento no recorta
    // tabs ni saltos de línea — este test exige explícitamente el operador
    // de regex [[:space:]] en las DOS ramas (no el btrim() del fix
    // anterior), para que una regresión a esa versión más débil lo rompa.
    const def: string = rows[0].def;
    expect(def).toMatch(/contenido_texto IS NOT NULL/);
    expect(def).toContain("contenido_texto !~ '^[[:space:]]*$'");
    expect(def).not.toContain('btrim');
    expect(def).toMatch(/OR/);
    expect(def).toMatch(/file_path IS NOT NULL/);
    expect(def).toContain("file_path !~ '^[[:space:]]*$'");
  });

  it('procedures: inventario EXACTO de policies — procedures_select (renombrada de procedures_select_all) + procedures_write_admin (0020)', async () => {
    const { rows } = await client.query(`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'procedures'
    `);
    expect(rows.map((r) => r.policyname).sort()).toEqual(['procedures_select', 'procedures_write_admin']);
  });

  it('profiles: motivo_baja (text, nullable) y fecha_baja (date, nullable) existen, sin backfill (0020)', async () => {
    const { rows } = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'profiles'
        AND column_name IN ('motivo_baja', 'fecha_baja')
    `);
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(byName.motivo_baja.data_type).toBe('text');
    expect(byName.motivo_baja.is_nullable).toBe('YES');
    expect(byName.fecha_baja.data_type).toBe('date');
    expect(byName.fecha_baja.is_nullable).toBe('YES');
  });

  for (const [fn, argTypes, ret] of [
    ['crear_procedimiento', ['text', 'text', 'text', 'text'], 'uuid'],
    ['actualizar_procedimiento', ['uuid', 'text', 'text', 'text', 'text'], 'void'],
    ['archivar_procedimiento', ['uuid', 'procedure_estado'], 'void'],
  ] as const) {
    it(`función ${fn}() existe con la firma esperada, sin defaults, retorna ${ret} (0020)`, async () => {
      const { rows } = await client.query(`
        SELECT
          p.pronargs,
          p.pronargdefaults,
          pg_get_function_result(p.oid) AS ret,
          (
            SELECT array_agg(t.typname::text ORDER BY u.ord)
            FROM unnest(p.proargtypes) WITH ORDINALITY AS u(oid, ord)
            JOIN pg_type t ON t.oid = u.oid
          ) AS arg_types
        FROM pg_proc p
        WHERE p.proname = $1 AND p.pronamespace = 'public'::regnamespace
      `, [fn]);
      expect(rows).toHaveLength(1);
      expect(rows[0].arg_types).toEqual([...argTypes]);
      expect(rows[0].pronargs).toBe(argTypes.length);
      expect(rows[0].pronargdefaults).toBe(0);
      expect(rows[0].ret).toBe(ret);
    });

    it(`${fn}: SECURITY DEFINER con search_path fijo, owner literal 'postgres' y ACL exacta (0020, fix FB-F5-AUD-02 Hallazgo 2)`, async () => {
      const { rows } = await client.query(`
        SELECT
          p.prosecdef,
          p.proconfig,
          r.rolname AS owner,
          array_to_string(ARRAY(SELECT unnest(p.proacl)::text ORDER BY 1), ', ') AS acl
        FROM pg_proc p
        JOIN pg_roles r ON r.oid = p.proowner
        WHERE p.proname = $1 AND p.pronamespace = 'public'::regnamespace
      `, [fn]);
      expect(rows).toHaveLength(1);
      expect(rows[0].prosecdef).toBe(true);
      expect(rows[0].proconfig).toContain('search_path=public');

      // Owner LITERAL, no solo "no es un rol de app": verificado contra
      // producción (proyecto simfemdkrkdbumefcxei) vía MCP de solo lectura
      // antes de este fix — is_admin/auth_role/log_audit/
      // resolver_ausencia_request/crear_aprobar_ausencia_admin son TODAS
      // owner=postgres ahí. El Postgres local de CI (supabase start) aplica
      // las migraciones con ese mismo rol, así que no hay divergencia real
      // entre CI y prod para esta aserción (FB-F5-AUD-02 Hallazgo 2).
      expect(rows[0].owner).toBe('postgres');

      // ACL EXACTA, no "no contiene anon/authenticated/public": el patrón
      // REVOKE ALL FROM PUBLIC/anon + GRANT EXECUTE TO authenticated deja
      // authenticated + postgres (el owner siempre queda listado). No hay
      // GRANT explícito a service_role en esta migración — aparece igual
      // por un ALTER DEFAULT PRIVILEGES de plataforma (mismo patrón ya
      // confirmado en resolver_ausencia_request/crear_aprobar_ausencia_admin,
      // que tampoco lo otorgan explícitamente y lo tienen). Cualquier grant
      // extra (ej. alguien vuelve a otorgarle a anon) rompe este test.
      expect(rows[0].acl).toBe('authenticated=X/postgres, postgres=X/postgres, service_role=X/postgres');

      const { rows: helperOwners } = await client.query(`
        SELECT p.proname, r.rolname AS owner
        FROM pg_proc p
        JOIN pg_roles r ON r.oid = p.proowner
        WHERE p.proname IN ('is_admin', 'auth_role') AND p.pronamespace = 'public'::regnamespace
        ORDER BY p.proname
      `);
      expect(helperOwners).toHaveLength(2);
      for (const helper of helperOwners) {
        expect(helper.owner).toBe('postgres');
      }
    });
  }

  it("log_audit: cerrada — owner literal 'postgres' y ACL exacta (solo postgres + service_role, sin anon/authenticated/PUBLIC) (0020, fix FB-F5-AUD-02 Hallazgo 2)", async () => {
    const { rows } = await client.query(`
      SELECT
        r.rolname AS owner,
        array_to_string(ARRAY(SELECT unnest(p.proacl)::text ORDER BY 1), ', ') AS acl
      FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE p.proname = 'log_audit' AND p.pronamespace = 'public'::regnamespace
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].owner).toBe('postgres');
    // service_role viene del GRANT explícito original de 0001 (no de
    // default privileges, a diferencia de las RPCs nuevas de arriba);
    // postgres queda porque el owner siempre aparece listado en el ACL.
    // anon/authenticated NO deben aparecer — este es el test que tiene que
    // fallar si alguien les vuelve a otorgar EXECUTE (regresión del
    // hallazgo de seguridad de FB-F5-01-INSPECT-REPORT.md, bloque C.3).
    expect(rows[0].acl).toBe('postgres=X/postgres, service_role=X/postgres');
  });

  it("storage.buckets: bucket 'procedimientos' privado, mismo límite de tamaño que 'documents', MIME ampliado a PDF/Word/texto plano (0020)", async () => {
    const { rows } = await client.query(`
      SELECT public, file_size_limit, allowed_mime_types
      FROM storage.buckets WHERE id = 'procedimientos'
    `);
    expect(rows).toHaveLength(1);
    expect(rows[0].public).toBe(false);
    // node-pg devuelve bigint como string para no perder precisión.
    expect(rows[0].file_size_limit).toBe('10485760');
    expect(rows[0].allowed_mime_types.sort()).toEqual([
      'application/msword',
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ].sort());
  });

  it("storage.objects: políticas del bucket 'procedimientos' existen — SELECT abierta a autenticado, INSERT/UPDATE/DELETE solo admin (0020)", async () => {
    const { rows } = await client.query(`
      SELECT policyname, cmd, qual, with_check FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname LIKE 'storage_procedimientos_%'
    `);
    const byName = Object.fromEntries(rows.map((r) => [r.policyname, r]));
    expect(Object.keys(byName).sort()).toEqual([
      'storage_procedimientos_delete',
      'storage_procedimientos_insert',
      'storage_procedimientos_select',
      'storage_procedimientos_update',
    ]);
    expect(byName.storage_procedimientos_select.qual).toMatch(/auth\.uid\(\) IS NOT NULL/);
    expect(byName.storage_procedimientos_insert.with_check).toMatch(/is_admin/);
    expect(byName.storage_procedimientos_update.qual).toMatch(/is_admin/);
    expect(byName.storage_procedimientos_delete.qual).toMatch(/is_admin/);
  });
});
