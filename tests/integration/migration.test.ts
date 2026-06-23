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
});
