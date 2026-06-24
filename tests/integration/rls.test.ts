/**
 * Tests de integración RLS — Portal First Blades
 *
 * Corren contra un PostgreSQL real (servicio en CI o local).
 * Aplican la migración completa y ejecutan queries simulando JWT de Supabase.
 *
 * Cobertura: profiles, documents, pasaje_requests, ausencia_requests,
 *             rotation_groups, rotation_assignments, procedures, audit_log,
 *             storage.objects (testeado contra la Storage API real).
 *
 * Convenciones de aserción:
 *   - expectPermissionError: INSERT bloqueado por RLS → lanza error de permiso.
 *   - expectDeniedSilently:  UPDATE/DELETE filtrado por USING → rowCount = 0, sin error.
 *   - countRows / SELECT directo: verificación de visibilidad (SELECT bloqueado → 0 filas).
 *   - Storage API: asertar resultado observable (objeto presente/ausente, lista vacía/llena).
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  setupTestDb,
  asUser,
  asServiceRole,
  expectPermissionError,
  expectDeniedSilently,
  countRows,
  IDS,
  createStorageAdminClient,
  storageClientForUser,
  ensureDocumentsBucket,
} from './helpers';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client; // conexión superuser para setup/teardown

// IDs de registros de prueba (creados en beforeAll)
const DOC_EMP1_ID    = 'd0000000-0000-0000-0001-000000000001';
const PASAJE_ID      = 'b0000000-0000-0000-0001-000000000001';
const AUSENCIA_ID    = 'c0000000-0000-0000-0001-000000000001';
const ROT_GROUP_ID   = 'e0000000-0000-0000-0001-000000000001';
const ROT_ASSIGN_ID  = 'f0000000-0000-0000-0001-000000000001';
const PROCEDURE_ID   = 'f1000000-0000-0000-0001-000000000001';
const AUDIT_LOG_ID   = 'a1000000-0000-0000-0001-000000000001'; // fila conocida para assert real

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();

  // Seed de datos de prueba (como superuser, bypass RLS)
  await db.query(`
    INSERT INTO documents (id, user_id, document_type, filename, storage_path, uploaded_by, estado)
    VALUES ($1::uuid, $2::uuid, 'dni', 'doc.pdf', $2::text || '/dni-123.pdf', $2::uuid, 'pendiente')
    ON CONFLICT DO NOTHING
  `, [DOC_EMP1_ID, IDS.employee1]);

  await db.query(`
    INSERT INTO pasaje_requests (id, solicitante_id, empleado_id, motivo_viaje, fecha_viaje, origen, destino, estado)
    VALUES ($1, $2, $2, 'inicio_franco', '2026-07-01', 'Buenos Aires', 'Mendoza', 'pendiente')
    ON CONFLICT DO NOTHING
  `, [PASAJE_ID, IDS.employee1]);

  await db.query(`
    INSERT INTO ausencia_requests (id, user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado)
    VALUES ($1, $2, 'vacaciones', '2026-07-10', '2026-07-20', 'pendiente')
    ON CONFLICT DO NOTHING
  `, [AUSENCIA_ID, IDS.employee1]);

  await db.query(`
    INSERT INTO rotation_groups (id, name) VALUES ($1, 'Grupo A') ON CONFLICT DO NOTHING
  `, [ROT_GROUP_ID]);

  await db.query(`
    INSERT INTO rotation_assignments (id, user_id, fecha, estado_dia)
    VALUES ($1, $2, '2026-07-01', 'trabajando') ON CONFLICT DO NOTHING
  `, [ROT_ASSIGN_ID, IDS.employee1]);

  await db.query(`
    INSERT INTO procedures (id, title, content, created_by)
    VALUES ($1, 'Manual de Seguridad', 'Contenido...', $2) ON CONFLICT DO NOTHING
  `, [PROCEDURE_ID, IDS.admin]);

  // Fila conocida en audit_log para tests de lectura real (servicio superuser, bypass RLS)
  await db.query(`
    INSERT INTO audit_log (id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES ($1, $2, 'ESTADO_APROBADO', 'documents', $3,
            '{"estado":"pendiente"}'::jsonb, '{"estado":"aprobado"}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `, [AUDIT_LOG_ID, IDS.admin, DOC_EMP1_ID]);
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  if (!db) return;
  try {
    await db.query('SELECT pg_advisory_unlock_all();');
  } catch (e) {
    console.warn('[afterAll] no se pudo liberar el advisory lock:', e);
  } finally {
    try {
      await db.end();
    } catch (e) {
      console.warn('[afterAll] no se pudo cerrar la conexión:', e);
    }
  }
});

// ============================================================
// SERVICE_ROLE BYPASS — Admin/servidor bypassa RLS completamente
// ============================================================

describe.skipIf(!dbAvailable)('service_role: bypass RLS (confirmación de acceso admin/servidor)', () => {
  it('service_role ve TODOS los perfiles (6)', async () => {
    const n = await asServiceRole((c) => countRows(c, 'profiles'));
    expect(n).toBe(6);
  });

  it('service_role puede UPDATE cualquier perfil cross-user', async () => {
    await asServiceRole(async (c) => {
      const { rowCount } = await c.query(
        'UPDATE profiles SET full_name = $1 WHERE id = $2',
        ['SvcRoleUpdated', IDS.employee3]
      );
      expect(rowCount).toBeGreaterThanOrEqual(1);
    });
    // Verificar (como superuser) que el cambio se aplicó dentro de la transacción (ya fue rollback)
    // El ROLLBACK en asServiceRole restaura el estado — correcto para aislamiento
  });

  it('service_role puede INSERT documento con estado aprobado (bypass WITH CHECK)', async () => {
    await asServiceRole(async (c) => {
      await expect(
        c.query(
          `INSERT INTO documents (user_id, document_type, filename, storage_path, uploaded_by, estado)
           VALUES ($1::uuid, 'test', 'bypass.pdf', $1::text || '/bypass.pdf', $1::uuid, 'aprobado')`,
          [IDS.employee1]
        )
      ).resolves.toBeDefined();
    });
  });

  it('service_role lee audit_log con filas reales (bypass RLS → count > 0)', async () => {
    // Verifica que service_role ve la fila sembrada en beforeAll.
    // Si count === 0 aquí, el bypass no está funcionando o el seed falló.
    const n = await asServiceRole((c) => countRows(c, 'audit_log'));
    expect(n).toBeGreaterThan(0);
  });
});

// ============================================================
// PROFILES
// ============================================================

describe.skipIf(!dbAvailable)('RLS: profiles', () => {
  it('empleado ve solo su propia fila (SELECT)', async () => {
    const n = await asUser(IDS.employee1, (c) => countRows(c, 'profiles'));
    expect(n).toBe(1);
  });

  it('empleado NO ve fila de otro empleado (SELECT, caso negativo → 0 filas)', async () => {
    await asUser(IDS.employee1, async (c) => {
      const { rows } = await c.query('SELECT id FROM profiles WHERE id = $1', [IDS.employee2]);
      expect(rows).toHaveLength(0);
    });
  });

  it('supervisor ve su fila + equipo (employee1, employee2)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      const { rows } = await c.query('SELECT id FROM profiles');
      const ids = rows.map((r: { id: string }) => r.id);
      expect(ids).toContain(IDS.supervisor);
      expect(ids).toContain(IDS.employee1);
      expect(ids).toContain(IDS.employee2);
    });
  });

  it('supervisor NO ve empleados de otro supervisor (SELECT, caso negativo → 0 filas)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      const { rows } = await c.query('SELECT id FROM profiles WHERE id = $1', [IDS.employee3]);
      expect(rows).toHaveLength(0);
    });
  });

  it('supervisor NO ve al otro supervisor (SELECT, caso negativo → 0 filas)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      const { rows } = await c.query('SELECT id FROM profiles WHERE id = $1', [IDS.supervisor2]);
      expect(rows).toHaveLength(0);
    });
  });

  it('admin ve todos los perfiles (SELECT)', async () => {
    const n = await asUser(IDS.admin, (c) => countRows(c, 'profiles'));
    expect(n).toBe(6);
  });

  // UPDATE via USING clause → rowCount = 0, sin error
  it('empleado NO puede UPDATE su propio perfil (UPDATE denegado silenciosamente → rowCount=0)', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expectDeniedSilently(
        c, 'UPDATE profiles SET full_name = $1 WHERE id = $2', ['Hack', IDS.employee1]
      );
    });
  });

  it('supervisor NO puede UPDATE perfiles (UPDATE denegado silenciosamente → rowCount=0)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      await expectDeniedSilently(
        c, 'UPDATE profiles SET full_name = $1 WHERE id = $2', ['Hack', IDS.employee1]
      );
    });
  });

  it('admin puede UPDATE cualquier perfil', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rowCount } = await c.query(
        'UPDATE profiles SET full_name = $1 WHERE id = $2', ['Admin Updated', IDS.admin]
      );
      expect(rowCount).toBeGreaterThanOrEqual(1);
    });
  });
});

// ============================================================
// DOCUMENTS
// ============================================================

describe.skipIf(!dbAvailable)('RLS: documents', () => {
  it('empleado ve solo sus propios documentos (SELECT)', async () => {
    const n = await asUser(IDS.employee1, (c) => countRows(c, 'documents'));
    expect(n).toBe(1);
  });

  it('employee2 NO ve documentos de employee1 (SELECT, caso negativo → 0 filas)', async () => {
    await asUser(IDS.employee2, async (c) => {
      const n = await countRows(c, 'documents', `WHERE id = '${DOC_EMP1_ID}'`);
      expect(n).toBe(0);
    });
  });

  it('supervisor NO ve documentos de su equipo (SELECT, solo propio → 0 filas)', async () => {
    const n = await asUser(IDS.supervisor, (c) => countRows(c, 'documents'));
    expect(n).toBe(0);
  });

  it('supervisor2 NO ve documentos del equipo de supervisor (SELECT, caso negativo → 0 filas)', async () => {
    await asUser(IDS.supervisor2, async (c) => {
      const n = await countRows(c, 'documents', `WHERE id = '${DOC_EMP1_ID}'`);
      expect(n).toBe(0);
    });
  });

  it('admin ve todos los documentos (SELECT)', async () => {
    const n = await asUser(IDS.admin, (c) => countRows(c, 'documents'));
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('empleado puede INSERT documento propio con estado pendiente', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expect(
        c.query(
          `INSERT INTO documents (user_id, document_type, filename, storage_path, uploaded_by, estado)
           VALUES ($1::uuid, 'carnet', 'carnet.pdf', $1::text || '/carnet.pdf', $1::uuid, 'pendiente')`,
          [IDS.employee1]
        )
      ).resolves.toBeDefined();
    });
  });

  it('empleado puede INSERT documento con storage_path de su propia carpeta (CHECK pasa)', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expect(
        c.query(
          `INSERT INTO documents (user_id, document_type, filename, storage_path, uploaded_by, estado)
           VALUES ($1::uuid, 'licencia', 'lic.pdf', $1::text || '/licencia.pdf', $1::uuid, 'pendiente')`,
          [IDS.employee1]
        )
      ).resolves.toBeDefined();
    });
  });

  // CHECK constraint documents_storage_path_matches_user (migración 0005) → lanza error
  it('empleado NO puede INSERT documento con storage_path de carpeta ajena (CHECK)', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expect(
        c.query(
          `INSERT INTO documents (user_id, document_type, filename, storage_path, uploaded_by, estado)
           VALUES ($1::uuid, 'otros', 'x.pdf', $2::text || '/x.pdf', $1::uuid, 'pendiente')`,
          [IDS.employee1, IDS.employee2]
        )
      ).rejects.toThrow();
    });
  });

  // WITH CHECK falla → error
  it('empleado NO puede INSERT documento con estado aprobado (INSERT deniega con error)', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expectPermissionError(
        c,
        `INSERT INTO documents (user_id, document_type, filename, storage_path, uploaded_by, estado)
         VALUES ($1::uuid, 'dni', 'hack.pdf', $1::text || '/hack.pdf', $1::uuid, 'aprobado')`,
        [IDS.employee1]
      );
    });
  });

  // USING clause → rowCount = 0, sin error
  it('empleado NO puede UPDATE estado a aprobado (UPDATE denegado silenciosamente → rowCount=0)', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expectDeniedSilently(
        c, `UPDATE documents SET estado = 'aprobado' WHERE id = $1`, [DOC_EMP1_ID]
      );
    });
  });

  it('admin puede UPDATE estado a aprobado (aprobar)', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rowCount } = await c.query(
        `UPDATE documents SET estado = 'aprobado', reviewed_by = $1 WHERE id = $2`,
        [IDS.admin, DOC_EMP1_ID]
      );
      expect(rowCount).toBeGreaterThanOrEqual(1);
    });
  });
});

// ============================================================
// PASAJE_REQUESTS
// ============================================================

describe.skipIf(!dbAvailable)('RLS: pasaje_requests', () => {
  it('empleado ve solo sus propias solicitudes (SELECT)', async () => {
    const n = await asUser(IDS.employee1, (c) => countRows(c, 'pasaje_requests'));
    expect(n).toBe(1);
  });

  it('employee2 NO ve solicitudes de employee1 (SELECT, caso negativo → 0 filas)', async () => {
    await asUser(IDS.employee2, async (c) => {
      const n = await countRows(c, 'pasaje_requests', `WHERE id = '${PASAJE_ID}'`);
      expect(n).toBe(0);
    });
  });

  it('supervisor ve solicitudes de su equipo (SELECT)', async () => {
    const n = await asUser(IDS.supervisor, (c) => countRows(c, 'pasaje_requests'));
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('supervisor2 NO ve solicitudes del equipo de supervisor (SELECT, caso negativo → 0 filas)', async () => {
    await asUser(IDS.supervisor2, async (c) => {
      const n = await countRows(c, 'pasaje_requests', `WHERE id = '${PASAJE_ID}'`);
      expect(n).toBe(0);
    });
  });

  it('admin ve todas las solicitudes (SELECT)', async () => {
    const n = await asUser(IDS.admin, (c) => countRows(c, 'pasaje_requests'));
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('empleado puede INSERT pasaje propio con estado pendiente', async () => {
    await asUser(IDS.employee2, async (c) => {
      await expect(
        c.query(
          `INSERT INTO pasaje_requests (solicitante_id, empleado_id, motivo_viaje, fecha_viaje, origen, destino, estado)
           VALUES ($1, $1, 'fin_franco', '2026-08-01', 'Córdoba', 'Mendoza', 'pendiente')`,
          [IDS.employee2]
        )
      ).resolves.toBeDefined();
    });
  });

  // WITH CHECK: solicitante_id ≠ auth.uid() → error
  it('empleado NO puede INSERT pasaje para otro empleado (INSERT deniega con error)', async () => {
    await asUser(IDS.employee2, async (c) => {
      await expectPermissionError(
        c,
        `INSERT INTO pasaje_requests (solicitante_id, empleado_id, motivo_viaje, fecha_viaje, origen, destino, estado)
         VALUES ($1, $2, 'inicio_franco', '2026-08-01', 'X', 'Y', 'pendiente')`,
        [IDS.employee2, IDS.employee1]
      );
    });
  });

  // WITH CHECK: estado ≠ pendiente → error
  it('empleado NO puede INSERT pasaje con estado aprobado (INSERT deniega con error)', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expectPermissionError(
        c,
        `INSERT INTO pasaje_requests (solicitante_id, empleado_id, motivo_viaje, fecha_viaje, origen, destino, estado)
         VALUES ($1, $1, 'inicio_franco', '2026-08-01', 'X', 'Y', 'aprobado')`,
        [IDS.employee1]
      );
    });
  });

  it('supervisor puede INSERT pasaje para empleado de su equipo', async () => {
    await asUser(IDS.supervisor, async (c) => {
      await expect(
        c.query(
          `INSERT INTO pasaje_requests (solicitante_id, empleado_id, motivo_viaje, fecha_viaje, origen, destino, estado)
           VALUES ($1, $2, 'traslado_proyectos', '2026-09-01', 'Buenos Aires', 'Tucumán', 'pendiente')`,
          [IDS.supervisor, IDS.employee1]
        )
      ).resolves.toBeDefined();
    });
  });

  // WITH CHECK: empleado_id no está en el equipo del supervisor → error
  it('supervisor NO puede INSERT pasaje para empleado de otro equipo (INSERT deniega con error)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      await expectPermissionError(
        c,
        `INSERT INTO pasaje_requests (solicitante_id, empleado_id, motivo_viaje, fecha_viaje, origen, destino, estado)
         VALUES ($1, $2, 'inicio_franco', '2026-09-01', 'X', 'Y', 'pendiente')`,
        [IDS.supervisor, IDS.employee3]
      );
    });
  });

  // USING clause → rowCount = 0, sin error
  it('empleado NO puede UPDATE estado de pasaje (UPDATE denegado silenciosamente → rowCount=0)', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expectDeniedSilently(
        c, `UPDATE pasaje_requests SET estado = 'aprobado' WHERE id = $1`, [PASAJE_ID]
      );
    });
  });

  it('admin puede aprobar pasaje (UPDATE estado)', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rowCount } = await c.query(
        `UPDATE pasaje_requests SET estado = 'aprobado', reviewed_by = $1 WHERE id = $2`,
        [IDS.admin, PASAJE_ID]
      );
      expect(rowCount).toBeGreaterThanOrEqual(1);
    });
  });
});

// ============================================================
// AUSENCIA_REQUESTS
// ============================================================

describe.skipIf(!dbAvailable)('RLS: ausencia_requests', () => {
  it('empleado ve solo sus propias ausencias (SELECT)', async () => {
    const n = await asUser(IDS.employee1, (c) => countRows(c, 'ausencia_requests'));
    expect(n).toBe(1);
  });

  it('employee2 NO ve ausencias de employee1 (SELECT, caso negativo → 0 filas)', async () => {
    await asUser(IDS.employee2, async (c) => {
      const n = await countRows(c, 'ausencia_requests', `WHERE id = '${AUSENCIA_ID}'`);
      expect(n).toBe(0);
    });
  });

  it('supervisor ve ausencias de su equipo (SELECT)', async () => {
    const n = await asUser(IDS.supervisor, (c) => countRows(c, 'ausencia_requests'));
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('supervisor2 NO ve ausencias del equipo de supervisor (SELECT, caso negativo → 0 filas)', async () => {
    await asUser(IDS.supervisor2, async (c) => {
      const n = await countRows(c, 'ausencia_requests', `WHERE id = '${AUSENCIA_ID}'`);
      expect(n).toBe(0);
    });
  });

  it('admin ve todas las ausencias (SELECT)', async () => {
    const n = await asUser(IDS.admin, (c) => countRows(c, 'ausencia_requests'));
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('empleado puede INSERT ausencia propia con estado pendiente', async () => {
    await asUser(IDS.employee2, async (c) => {
      await expect(
        c.query(
          `INSERT INTO ausencia_requests (user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado)
           VALUES ($1, 'dia_tramite', '2026-09-05', '2026-09-05', 'pendiente')`,
          [IDS.employee2]
        )
      ).resolves.toBeDefined();
    });
  });

  it('empleado NO puede INSERT ausencia con estado aprobado (INSERT deniega con error)', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expectPermissionError(
        c,
        `INSERT INTO ausencia_requests (user_id, motivo_ausencia, fecha_inicio, fecha_fin, estado)
         VALUES ($1, 'vacaciones', '2026-09-01', '2026-09-10', 'aprobado')`,
        [IDS.employee1]
      );
    });
  });

  // USING clause → rowCount = 0, sin error
  it('supervisor NO puede UPDATE estado de ausencia (UPDATE denegado silenciosamente → rowCount=0)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      await expectDeniedSilently(
        c, `UPDATE ausencia_requests SET estado = 'aprobado' WHERE id = $1`, [AUSENCIA_ID]
      );
    });
  });

  it('admin puede aprobar ausencia (UPDATE estado)', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rowCount } = await c.query(
        `UPDATE ausencia_requests SET estado = 'aprobado', reviewed_by = $1 WHERE id = $2`,
        [IDS.admin, AUSENCIA_ID]
      );
      expect(rowCount).toBeGreaterThanOrEqual(1);
    });
  });
});

// ============================================================
// ROTATION_GROUPS
// ============================================================

describe.skipIf(!dbAvailable)('RLS: rotation_groups', () => {
  it('cualquier usuario autenticado puede leer grupos (SELECT)', async () => {
    for (const id of [IDS.employee1, IDS.supervisor, IDS.admin]) {
      const n = await asUser(id, (c) => countRows(c, 'rotation_groups'));
      expect(n).toBeGreaterThanOrEqual(1);
    }
  });

  it('empleado NO puede INSERT rotation_groups (INSERT deniega con error)', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expectPermissionError(c, `INSERT INTO rotation_groups (name) VALUES ('Hack')`);
    });
  });

  it('supervisor NO puede INSERT rotation_groups (INSERT deniega con error)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      await expectPermissionError(c, `INSERT INTO rotation_groups (name) VALUES ('Hack')`);
    });
  });

  it('admin puede INSERT rotation_groups', async () => {
    await asUser(IDS.admin, async (c) => {
      await expect(
        c.query(`INSERT INTO rotation_groups (name) VALUES ('Grupo Test')`)
      ).resolves.toBeDefined();
    });
  });
});

// ============================================================
// ROTATION_ASSIGNMENTS
// ============================================================

describe.skipIf(!dbAvailable)('RLS: rotation_assignments', () => {
  it('empleado ve solo su propio calendario (SELECT)', async () => {
    const n = await asUser(IDS.employee1, (c) => countRows(c, 'rotation_assignments'));
    expect(n).toBe(1);
  });

  it('employee2 NO ve el calendario de employee1 (SELECT, caso negativo → 0 filas)', async () => {
    await asUser(IDS.employee2, async (c) => {
      const n = await countRows(c, 'rotation_assignments', `WHERE id = '${ROT_ASSIGN_ID}'`);
      expect(n).toBe(0);
    });
  });

  it('supervisor ve su calendario + el de su equipo (SELECT)', async () => {
    const n = await asUser(IDS.supervisor, (c) => countRows(c, 'rotation_assignments'));
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('supervisor2 NO ve calendario del equipo de supervisor (SELECT, caso negativo → 0 filas)', async () => {
    await asUser(IDS.supervisor2, async (c) => {
      const n = await countRows(c, 'rotation_assignments', `WHERE id = '${ROT_ASSIGN_ID}'`);
      expect(n).toBe(0);
    });
  });

  it('admin ve todos los assignments (SELECT)', async () => {
    const n = await asUser(IDS.admin, (c) => countRows(c, 'rotation_assignments'));
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('empleado NO puede INSERT rotation_assignments (INSERT deniega con error)', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expectPermissionError(
        c,
        `INSERT INTO rotation_assignments (user_id, fecha, estado_dia) VALUES ($1, '2026-07-02', 'trabajando')`,
        [IDS.employee1]
      );
    });
  });

  it('admin puede INSERT rotation_assignments', async () => {
    await asUser(IDS.admin, async (c) => {
      await expect(
        c.query(
          `INSERT INTO rotation_assignments (user_id, fecha, estado_dia) VALUES ($1, '2026-07-02', 'en_franco')`,
          [IDS.employee1]
        )
      ).resolves.toBeDefined();
    });
  });
});

// ============================================================
// PROCEDURES
// ============================================================

describe.skipIf(!dbAvailable)('RLS: procedures', () => {
  it('empleado puede leer procedimientos (SELECT)', async () => {
    const n = await asUser(IDS.employee1, (c) => countRows(c, 'procedures'));
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('supervisor puede leer procedimientos (SELECT)', async () => {
    const n = await asUser(IDS.supervisor, (c) => countRows(c, 'procedures'));
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('empleado NO puede INSERT procedimientos (INSERT deniega con error)', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expectPermissionError(
        c,
        `INSERT INTO procedures (title, created_by) VALUES ('Hack', $1)`,
        [IDS.employee1]
      );
    });
  });

  it('supervisor NO puede INSERT procedimientos (INSERT deniega con error)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      await expectPermissionError(
        c,
        `INSERT INTO procedures (title, created_by) VALUES ('Hack', $1)`,
        [IDS.supervisor]
      );
    });
  });

  it('admin puede INSERT procedimientos', async () => {
    await asUser(IDS.admin, async (c) => {
      await expect(
        c.query(
          `INSERT INTO procedures (title, content, created_by) VALUES ('Test Proc', 'Contenido', $1)`,
          [IDS.admin]
        )
      ).resolves.toBeDefined();
    });
  });

  it('admin puede UPDATE procedimientos', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rowCount } = await c.query(
        `UPDATE procedures SET title = 'Manual Actualizado' WHERE id = $1`, [PROCEDURE_ID]
      );
      expect(rowCount).toBeGreaterThanOrEqual(1);
    });
  });
});

// ============================================================
// AUDIT_LOG
// ============================================================

describe.skipIf(!dbAvailable)('RLS: audit_log', () => {
  it('admin puede leer audit_log con filas reales (SELECT → count > 0)', async () => {
    // admin (role authenticated + JWT admin) debe ver la fila sembrada en beforeAll.
    // Prueba que la policy "audit_log_select_admin" funciona correctamente.
    await asUser(IDS.admin, async (c) => {
      const n = await countRows(c, 'audit_log');
      expect(n).toBeGreaterThan(0);
    });
  });

  it('empleado NO puede leer audit_log (SELECT, caso negativo → 0 filas visibles)', async () => {
    await asUser(IDS.employee1, async (c) => {
      const { rows } = await c.query('SELECT COUNT(*) AS n FROM audit_log');
      expect(parseInt(rows[0].n, 10)).toBe(0);
    });
  });

  it('supervisor NO puede leer audit_log (SELECT, caso negativo → 0 filas visibles)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      const { rows } = await c.query('SELECT COUNT(*) AS n FROM audit_log');
      expect(parseInt(rows[0].n, 10)).toBe(0);
    });
  });

  // INSERT tiene RLS activado; no hay policy que permita INSERT para authenticated
  it('usuario NO puede INSERT directamente en audit_log (INSERT deniega con error)', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expectPermissionError(
        c,
        `INSERT INTO audit_log (actor_id, action, table_name, record_id)
         VALUES ($1, 'HACK', 'profiles', $1)`,
        [IDS.employee1]
      );
    });
  });
});

// ============================================================
// STORAGE — control de acceso vía Storage API real
//
// Políticas activas (migración 0004):
//   SELECT: uid propio || is_admin()  (supervisor ya NO ve su equipo)
//   INSERT: uid propio || is_admin()
//   DELETE: is_admin() únicamente
// ============================================================

describe.skipIf(!dbAvailable)('storage.objects: control de acceso vía Storage API real', () => {
  const BUCKET = 'documents';
  const emp1File = `${IDS.employee1}/own-emp1.pdf`;
  const emp2File = `${IDS.employee2}/own-emp2.pdf`;
  const body = Buffer.from('contenido de prueba');

  let admin: SupabaseClient;
  let asEmp1: SupabaseClient;
  let asEmp2: SupabaseClient;
  let asAdminUser: SupabaseClient;
  let asSupervisor: SupabaseClient;

  beforeAll(async () => {
    if (!dbAvailable) return;
    admin = createStorageAdminClient();
    await ensureDocumentsBucket(admin);
    asEmp1 = storageClientForUser(IDS.employee1);
    asEmp2 = storageClientForUser(IDS.employee2);
    asAdminUser = storageClientForUser(IDS.admin);
    asSupervisor = storageClientForUser(IDS.supervisor);
    // Sembrar objetos vía service-role para los tests de lectura y borrado
    await admin.storage.from(BUCKET).upload(emp1File, body, { upsert: true, contentType: 'application/pdf' });
    await admin.storage.from(BUCKET).upload(emp2File, body, { upsert: true, contentType: 'application/pdf' });
  });

  it('empleado puede subir a su propia carpeta', async () => {
    const { error } = await asEmp2.storage.from(BUCKET)
      .upload(`${IDS.employee2}/nuevo-${Date.now()}.pdf`, body, { contentType: 'application/pdf' });
    expect(error).toBeNull();
  });

  it('empleado NO puede subir a carpeta ajena (WITH CHECK deniega con error)', async () => {
    const { error } = await asEmp2.storage.from(BUCKET)
      .upload(`${IDS.employee1}/hack.pdf`, body, { contentType: 'application/pdf' });
    expect(error).not.toBeNull();
  });

  it('empleado ve su propio objeto (list carpeta propia)', async () => {
    const { data, error } = await asEmp1.storage.from(BUCKET).list(IDS.employee1);
    expect(error).toBeNull();
    expect((data ?? []).some((o) => o.name === 'own-emp1.pdf')).toBe(true);
  });

  it('empleado NO ve objetos de carpeta ajena (SELECT filtrado → vacío)', async () => {
    const { data } = await asEmp2.storage.from(BUCKET).list(IDS.employee1);
    expect((data ?? []).length).toBe(0);
  });

  it('supervisor NO ve carpeta de su equipo (0004_rls_fixes: solo lo propio)', async () => {
    const { data } = await asSupervisor.storage.from(BUCKET).list(IDS.employee1);
    expect((data ?? []).length).toBe(0);
  });

  it('admin ve objetos de cualquier carpeta', async () => {
    const { data, error } = await asAdminUser.storage.from(BUCKET).list(IDS.employee1);
    expect(error).toBeNull();
    expect((data ?? []).some((o) => o.name === 'own-emp1.pdf')).toBe(true);
  });

  it('empleado NO puede borrar objeto ajeno (DELETE solo admin; el objeto persiste)', async () => {
    // La policy DELETE es is_admin() únicamente: el intento de emp2 no afecta.
    await asEmp2.storage.from(BUCKET).remove([emp1File]);
    const { data } = await admin.storage.from(BUCKET).list(IDS.employee1);
    expect((data ?? []).some((o) => o.name === 'own-emp1.pdf')).toBe(true);
  });

  it('admin puede borrar objeto de cualquier carpeta', async () => {
    const tempFile = `${IDS.employee1}/para-borrar-${Date.now()}.pdf`;
    await admin.storage.from(BUCKET).upload(tempFile, body, { upsert: true, contentType: 'application/pdf' });
    const { error } = await asAdminUser.storage.from(BUCKET).remove([tempFile]);
    expect(error).toBeNull();
    const { data } = await admin.storage.from(BUCKET).list(IDS.employee1);
    const filename = tempFile.split('/').pop()!;
    expect((data ?? []).some((o) => o.name === filename)).toBe(false);
  });
});

// ============================================================
// MI EQUIPO — RLS end-to-end (FB-F2-04)
//
// Verifica que el módulo "Mi Equipo" (supervisor-only) tiene las
// garantías de RLS correctas:
//   1. Supervisor ve exactamente los perfiles de su equipo.
//   2. Supervisor NO puede leer perfiles fuera de su equipo (por id directo).
//   3. Supervisor NO puede leer documentos de sus subordinados.
//
// (El gating de ruta — test 4 del requisito — está en el test unitario
//  tests/unit/mi-equipo-server-boundary.test.ts que ejercita requireSupervisor().)
// ============================================================

describe.skipIf(!dbAvailable)('Mi Equipo: RLS de perfiles y documentos', () => {
  it('supervisor ve exactamente los miembros de su equipo (cardinalidad 2, solo employee1 y employee2)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      // Simula la query del módulo Mi Equipo: .eq('supervisor_id', profile.id).
      // La RLS es el backstop, pero el scope de app impone supervisor_id explícito.
      const { rows } = await c.query(
        'SELECT id FROM profiles WHERE supervisor_id = $1',
        [IDS.supervisor]
      );
      const ids = rows.map((r: { id: string }) => r.id).sort();
      expect(ids).toHaveLength(2);
      expect(ids).toContain(IDS.employee1);
      expect(ids).toContain(IDS.employee2);
      expect(ids).not.toContain(IDS.supervisor);  // propio del supervisor no aparece
      expect(ids).not.toContain(IDS.employee3);   // equipo de supervisor2
      expect(ids).not.toContain(IDS.supervisor2);
    });
  });

  it('supervisor NO puede leer por id un perfil fuera de su equipo (RLS devuelve vacío)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      const { rows } = await c.query(
        'SELECT id FROM profiles WHERE id = $1',
        [IDS.employee3]
      );
      expect(rows).toHaveLength(0);
    });
  });

  it('supervisor NO puede leer documentos de sus subordinados (solo ve los propios)', async () => {
    // Documentos de employee1 (subordinado de supervisor) NO son visibles
    // para el supervisor — la policy documents_select (migración 0004) solo permite
    // user_id = auth.uid() || is_admin().
    await asUser(IDS.supervisor, async (c) => {
      const { rows } = await c.query(
        'SELECT id FROM documents WHERE user_id = $1',
        [IDS.employee1]
      );
      expect(rows).toHaveLength(0);
    });
  });

  // ── Scope de app en el detalle (hallazgo FB-F2-AUD-03 #1) ──────────────
  // La query del detalle usa .eq('id', id).eq('supervisor_id', supervisor.id).
  // Estos tests verifican los 3 casos semánticos del fix:

  it('detalle: miembro real del equipo → encontrado', async () => {
    await asUser(IDS.supervisor, async (c) => {
      const { rows } = await c.query(
        'SELECT id FROM profiles WHERE id = $1 AND supervisor_id = $2',
        [IDS.employee1, IDS.supervisor]
      );
      expect(rows).toHaveLength(1);
    });
  });

  it('detalle: id propio del supervisor → rechazado (scope de app, no RLS)', async () => {
    // La RLS permite que el supervisor vea su propia fila (id = auth.uid()).
    // El scope de app (.eq supervisor_id) es lo que impide que aparezca en Mi Equipo.
    await asUser(IDS.supervisor, async (c) => {
      const { rows } = await c.query(
        'SELECT id FROM profiles WHERE id = $1 AND supervisor_id = $2',
        [IDS.supervisor, IDS.supervisor]
      );
      expect(rows).toHaveLength(0);
    });
  });

  it('detalle: empleado fuera de cargo (employee3) → rechazado (scope de app + RLS)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      const { rows } = await c.query(
        'SELECT id FROM profiles WHERE id = $1 AND supervisor_id = $2',
        [IDS.employee3, IDS.supervisor]
      );
      expect(rows).toHaveLength(0);
    });
  });
});
