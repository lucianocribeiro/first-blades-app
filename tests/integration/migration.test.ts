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
});
