/**
 * Tests de integración RLS — Portal First Blades
 *
 * Corren contra un PostgreSQL real (servicio en CI o local).
 * Aplican la migración completa y ejecutan queries simulando JWT de Supabase.
 *
 * Cobertura: profiles, documents, pasaje_requests, ausencia_requests,
 *             rotation_groups, rotation_assignments, procedures, audit_log,
 *             storage.objects (policies en Postgres mock).
 *
 * LIMITACIÓN CONOCIDA — Storage signed URLs (upload/download real):
 *   El test de storage.objects aquí prueba las políticas RLS en Postgres usando
 *   una tabla mock. El flujo real de Supabase Storage (bucket API, signed URLs)
 *   requiere una instancia Supabase en vivo y se valida en el smoke-test manual
 *   de Fase 1 al conectar el proyecto real.
 *
 * Convenciones de aserción:
 *   - expectPermissionError: INSERT bloqueado por RLS → lanza error de permiso.
 *   - expectDeniedSilently:  UPDATE/DELETE filtrado por USING → rowCount = 0, sin error.
 *   - countRows / SELECT directo: verificación de visibilidad (SELECT bloqueado → 0 filas).
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupTestDb,
  asUser,
  asServiceRole,
  expectPermissionError,
  expectDeniedSilently,
  countRows,
  IDS,
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
  try {
    db = await setupTestDb();
  } catch (err) {
    console.warn('PostgreSQL no disponible — tests de integración omitidos:', (err as Error).message);
    return;
  }

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

  await db.query(`
    INSERT INTO storage.objects (bucket_id, name, owner)
    VALUES ('documents', $1::text || '/dni-123.pdf', $1::uuid) ON CONFLICT DO NOTHING
  `, [IDS.employee1]);

  // Fila conocida en audit_log para tests de lectura real (servicio superuser, bypass RLS)
  await db.query(`
    INSERT INTO audit_log (id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES ($1, $2, 'ESTADO_APROBADO', 'documents', $3,
            '{"estado":"pendiente"}'::jsonb, '{"estado":"aprobado"}'::jsonb)
    ON CONFLICT (id) DO NOTHING
  `, [AUDIT_LOG_ID, IDS.admin, DOC_EMP1_ID]);
}, 30_000);

afterAll(async () => {
  // Protección: db puede ser undefined si Postgres no estaba disponible
  await db?.end();
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
// STORAGE — policies RLS sobre storage.objects (mock Postgres)
//
// LIMITACIÓN: Estas policies se testean sobre una tabla mock en Postgres.
// El acceso real al bucket de Supabase Storage (signed URLs, upload/download)
// requiere el servicio Supabase en vivo y se valida en smoke-test de Fase 1.
// ============================================================

describe.skipIf(!dbAvailable)('RLS: storage.objects (policies en Postgres mock, no bucket real)', () => {
  it('usuario ve solo sus propios objetos (SELECT → solo carpeta propia)', async () => {
    await asUser(IDS.employee1, async (c) => {
      const { rows } = await c.query(
        `SELECT name FROM storage.objects WHERE bucket_id = 'documents'`
      );
      rows.forEach((r: { name: string }) => {
        expect(r.name.startsWith(IDS.employee1)).toBe(true);
      });
    });
  });

  it('employee2 NO ve objetos de employee1 (SELECT, caso negativo → 0 filas)', async () => {
    await asUser(IDS.employee2, async (c) => {
      const { rows } = await c.query(
        `SELECT name FROM storage.objects WHERE bucket_id = 'documents' AND owner = $1`,
        [IDS.employee1]
      );
      expect(rows).toHaveLength(0);
    });
  });

  it('admin ve todos los objetos en Storage (SELECT)', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows } = await c.query(
        `SELECT COUNT(*) AS n FROM storage.objects WHERE bucket_id = 'documents'`
      );
      expect(parseInt(rows[0].n, 10)).toBeGreaterThanOrEqual(1);
    });
  });

  // DELETE filtrado por USING → rowCount = 0, sin error
  it('usuario NO puede DELETE objetos ajenos (DELETE denegado silenciosamente → rowCount=0)', async () => {
    await asUser(IDS.employee2, async (c) => {
      await expectDeniedSilently(
        c,
        `DELETE FROM storage.objects WHERE bucket_id = 'documents' AND owner = $1`,
        [IDS.employee1]
      );
    });
  });

  it('usuario puede INSERT en su propia carpeta', async () => {
    await asUser(IDS.employee2, async (c) => {
      await expect(
        c.query(
          `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('documents', $1, $2)`,
          [`${IDS.employee2}/nuevo.pdf`, IDS.employee2]
        )
      ).resolves.toBeDefined();
    });
  });

  // WITH CHECK: carpeta ≠ auth.uid() → error
  it('usuario NO puede INSERT en carpeta ajena (INSERT deniega con error)', async () => {
    await asUser(IDS.employee2, async (c) => {
      await expectPermissionError(
        c,
        `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('documents', $1, $2)`,
        [`${IDS.employee1}/hack.pdf`, IDS.employee2]
      );
    });
  });
});
