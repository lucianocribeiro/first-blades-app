/**
 * Test de migración limpia — Portal First Blades
 *
 * Verifica que 0001_init.sql aplica sin errores en una base de datos fresca,
 * ejecutando los statements top-to-bottom tal como lo haría `supabase db push`.
 * Este test captura bugs de orden de dependencia (ej: función que referencia
 * una tabla que todavía no fue creada).
 */

import { Client } from 'pg';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DB_URL } from './helpers';

let client: Client;

beforeAll(async () => {
  client = new Client({ connectionString: DB_URL });
  await client.connect();

  // Reseteo completo — simula una DB fresca
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('DROP SCHEMA IF EXISTS auth CASCADE');
  await client.query('DROP SCHEMA IF EXISTS storage CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.query('GRANT ALL ON SCHEMA public TO public');

  // 1. Mocks de Supabase (auth, storage, roles) — mismo setup que rls.test.ts
  const setupSql = readFileSync(resolve('./tests/integration/setup.sql'), 'utf8');
  await client.query(setupSql);

  // 2. Migración real, top-to-bottom — si hay error de orden aquí, el test falla
  const migrationSql = readFileSync(
    resolve('./supabase/migrations/0001_init.sql'),
    'utf8'
  );
  await client.query(migrationSql);
}, 30_000);

afterAll(async () => {
  await client?.end();
});

describe('migración 0001_init.sql: aplica limpia en DB fresca', () => {
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

  it('enums de dominio existen', async () => {
    const { rows } = await client.query(`
      SELECT typname FROM pg_type
      WHERE typtype = 'e'
        AND typnamespace = 'public'::regnamespace
      ORDER BY typname
    `);
    const names = rows.map((r: { typname: string }) => r.typname).sort();
    expect(names).toEqual(
      ['approval_status', 'employee_status', 'estado_dia', 'motivo_ausencia', 'motivo_viaje', 'user_role']
    );
  });
});
