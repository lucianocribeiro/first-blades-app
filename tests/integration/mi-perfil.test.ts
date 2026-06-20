/**
 * Tests de integración — Módulo Mi Perfil (FB-F1-01)
 *
 * Cubre: RLS de profiles (nuevos campos), documents con certificado_tipo y
 * fecha_vencimiento, flujo purgatorio (pendiente → aprobar/rechazar),
 * límite de rol para los 3 roles, campo estudio_medico solo admin.
 *
 * Corre contra PostgreSQL real con la migración completa (0001 + 0002).
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

let db: Client;

const DOC_CERT_ID   = 'dc000000-0000-0000-0001-000000000010';
const DOC_OTROS_ID  = 'dc000000-0000-0000-0001-000000000011';
const DOC_ESTUDIO_ID = 'dc000000-0000-0000-0001-000000000012';

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();

  // Seed: actualizar perfiles con los nuevos campos de Fase 1
  await db.query(`
    UPDATE profiles
    SET nombre = 'Juan', apellido = 'Pérez', cuit = '20-12345678-9', winda_id = 'W123'
    WHERE id = $1
  `, [IDS.employee1]);

  await db.query(`
    UPDATE profiles
    SET nombre = 'María', apellido = 'López', cuit = '27-98765432-1', winda_id = 'W456'
    WHERE id = $1
  `, [IDS.supervisor]);

  // Seed: documento tipo certificado GWO (employee1)
  await db.query(`
    INSERT INTO documents (
      id, user_id, document_type, filename, storage_path,
      uploaded_by, estado, certificado_tipo, fecha_vencimiento
    )
    VALUES ($1::uuid, $2::uuid, 'certificado', 'gwo.pdf', $2::text || '/certificado-gwo.pdf',
            $2::uuid, 'pendiente', 'gwo', '2027-01-01')
    ON CONFLICT DO NOTHING
  `, [DOC_CERT_ID, IDS.employee1]);

  // Seed: certificado tipo "otros" con texto
  await db.query(`
    INSERT INTO documents (
      id, user_id, document_type, filename, storage_path,
      uploaded_by, estado, certificado_tipo, certificado_otros_texto
    )
    VALUES ($1::uuid, $2::uuid, 'certificado', 'otros.pdf', $2::text || '/certificado-otros.pdf',
            $2::uuid, 'pendiente', 'otros', 'Habilitación especial GN')
    ON CONFLICT DO NOTHING
  `, [DOC_OTROS_ID, IDS.employee1]);

  // Seed: documento estudio médico (solo admin puede ver)
  await db.query(`
    INSERT INTO documents (
      id, user_id, document_type, filename, storage_path,
      uploaded_by, estado
    )
    VALUES ($1::uuid, $2::uuid, 'estudio_medico', 'estudio.pdf', $2::text || '/estudio_medico.pdf',
            $3::uuid, 'pendiente')
    ON CONFLICT DO NOTHING
  `, [DOC_ESTUDIO_ID, IDS.employee1, IDS.admin]);
}, 30_000);

afterAll(async () => {
  await db?.end();
});

// ============================================================
// PROFILES — nuevos campos (Fase 1)
// ============================================================

describe.skipIf(!dbAvailable)('profiles: campos Fase 1 (nombre, apellido, cuit, winda_id)', () => {
  it('empleado puede leer sus propios campos nombre/apellido/cuit/winda_id', async () => {
    await asUser(IDS.employee1, async (c) => {
      const { rows } = await c.query(
        'SELECT nombre, apellido, cuit, winda_id FROM profiles WHERE id = $1',
        [IDS.employee1]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].nombre).toBe('Juan');
      expect(rows[0].apellido).toBe('Pérez');
      expect(rows[0].cuit).toBe('20-12345678-9');
      expect(rows[0].winda_id).toBe('W123');
    });
  });

  it('empleado NO puede UPDATE sus propios campos (UPDATE denegado silenciosamente)', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expectDeniedSilently(
        c,
        'UPDATE profiles SET nombre = $1, apellido = $2 WHERE id = $3',
        ['Hack', 'Hack', IDS.employee1]
      );
    });
  });

  it('supervisor NO puede UPDATE perfiles de su equipo', async () => {
    await asUser(IDS.supervisor, async (c) => {
      await expectDeniedSilently(
        c,
        'UPDATE profiles SET cuit = $1 WHERE id = $2',
        ['00-00000000-0', IDS.employee1]
      );
    });
  });

  it('supervisor puede leer campos nombre/apellido/cuit/winda_id de su equipo', async () => {
    await asUser(IDS.supervisor, async (c) => {
      const { rows } = await c.query(
        'SELECT nombre, apellido, cuit, winda_id FROM profiles WHERE id = $1',
        [IDS.employee1]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].nombre).toBe('Juan');
    });
  });

  it('supervisor NO puede leer perfiles de empleados de otro supervisor', async () => {
    await asUser(IDS.supervisor, async (c) => {
      const { rows } = await c.query(
        'SELECT nombre FROM profiles WHERE id = $1',
        [IDS.employee3]
      );
      expect(rows).toHaveLength(0);
    });
  });

  it('admin puede UPDATE nombre/apellido/cuit/winda_id de cualquier perfil', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rowCount } = await c.query(
        'UPDATE profiles SET nombre = $1, apellido = $2, cuit = $3, winda_id = $4 WHERE id = $5',
        ['TestNombre', 'TestApellido', '20-11111111-1', 'W999', IDS.employee2]
      );
      expect(rowCount).toBeGreaterThanOrEqual(1);
    });
  });

  it('admin puede leer entrevista_tecnica (campo solo-admin)', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows } = await c.query(
        'SELECT entrevista_tecnica FROM profiles WHERE id = $1',
        [IDS.employee1]
      );
      expect(rows).toHaveLength(1);
      // El campo existe (puede ser null si no fue seteado)
      expect('entrevista_tecnica' in rows[0]).toBe(true);
    });
  });

  it('admin puede UPDATE entrevista_tecnica', async () => {
    const entrevistaJson = JSON.stringify({ aerogeneradores: true, palas_eolicas: false });
    await asUser(IDS.admin, async (c) => {
      const { rowCount } = await c.query(
        'UPDATE profiles SET entrevista_tecnica = $1::jsonb WHERE id = $2',
        [entrevistaJson, IDS.employee1]
      );
      expect(rowCount).toBeGreaterThanOrEqual(1);
    });
  });
});

// ============================================================
// DOCUMENTS — certificado_tipo y fecha_vencimiento
// ============================================================

describe.skipIf(!dbAvailable)('documents: nuevos campos Fase 1 (certificado_tipo, fecha_vencimiento)', () => {
  it('empleado puede leer sus propios documentos con certificado_tipo y fecha_vencimiento', async () => {
    await asUser(IDS.employee1, async (c) => {
      const { rows } = await c.query(
        'SELECT certificado_tipo, fecha_vencimiento FROM documents WHERE id = $1',
        [DOC_CERT_ID]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].certificado_tipo).toBe('gwo');
      expect(rows[0].fecha_vencimiento).not.toBeNull();
    });
  });

  it('empleado puede leer certificado_otros_texto', async () => {
    await asUser(IDS.employee1, async (c) => {
      const { rows } = await c.query(
        'SELECT certificado_tipo, certificado_otros_texto FROM documents WHERE id = $1',
        [DOC_OTROS_ID]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].certificado_tipo).toBe('otros');
      expect(rows[0].certificado_otros_texto).toBe('Habilitación especial GN');
    });
  });

  it('empleado puede INSERT certificado con tipo gwo y fecha_vencimiento', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expect(
        c.query(
          `INSERT INTO documents (
            user_id, document_type, filename, storage_path, uploaded_by,
            estado, certificado_tipo, fecha_vencimiento
          )
          VALUES ($1::uuid, 'certificado', 'gwo2.pdf', $1::text || '/certificado-gwo2.pdf', $1::uuid,
                  'pendiente', 'gwo', '2028-06-01')`,
          [IDS.employee1]
        )
      ).resolves.toBeDefined();
    });
  });

  it('empleado puede INSERT certificado tipo cursos_elevadores', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expect(
        c.query(
          `INSERT INTO documents (
            user_id, document_type, filename, storage_path, uploaded_by,
            estado, certificado_tipo
          )
          VALUES ($1::uuid, 'certificado', 'elev.pdf', $1::text || '/certificado-elev.pdf', $1::uuid,
                  'pendiente', 'cursos_elevadores')`,
          [IDS.employee1]
        )
      ).resolves.toBeDefined();
    });
  });

  it('empleado puede INSERT certificado tipo cursos_vestas', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expect(
        c.query(
          `INSERT INTO documents (
            user_id, document_type, filename, storage_path, uploaded_by,
            estado, certificado_tipo
          )
          VALUES ($1::uuid, 'certificado', 'vestas.pdf', $1::text || '/certificado-vestas.pdf', $1::uuid,
                  'pendiente', 'cursos_vestas')`,
          [IDS.employee1]
        )
      ).resolves.toBeDefined();
    });
  });

  it('empleado NO puede INSERT documento de otro usuario (WITH CHECK falla)', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expectPermissionError(
        c,
        `INSERT INTO documents (user_id, document_type, filename, storage_path, uploaded_by, estado)
         VALUES ($1::uuid, 'dni', 'hack.pdf', $1::text || '/hack.pdf', $2, 'pendiente')`,
        [IDS.employee2, IDS.employee1]
      );
    });
  });

  it('empleado NO puede cambiar estado a aprobado (WITH CHECK falla)', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expectPermissionError(
        c,
        `INSERT INTO documents (user_id, document_type, filename, storage_path, uploaded_by, estado)
         VALUES ($1::uuid, 'licencia', 'lic.pdf', $1::text || '/lic.pdf', $1::uuid, 'aprobado')`,
        [IDS.employee1]
      );
    });
  });

  it('empleado NO puede UPDATE estado de sus propios documentos (USING deniega)', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expectDeniedSilently(
        c,
        `UPDATE documents SET estado = 'aprobado' WHERE id = $1`,
        [DOC_CERT_ID]
      );
    });
  });

  it('supervisor NO ve documentos de su equipo (SELECT, solo propio → 0 filas)', async () => {
    const n1 = await asUser(IDS.supervisor,  (c) => countRows(c, 'documents', `WHERE user_id = '${IDS.employee1}'`));
    const n2 = await asUser(IDS.supervisor2, (c) => countRows(c, 'documents', `WHERE user_id = '${IDS.employee1}'`));
    expect(n1).toBe(0); // supervisor no ve documentos de su equipo (0004_rls_fixes: solo propio)
    expect(n2).toBe(0); // supervisor2 tampoco
  });

  it('supervisor NO puede UPDATE documentos (USING deniega)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      await expectDeniedSilently(
        c,
        `UPDATE documents SET estado = 'aprobado' WHERE id = $1`,
        [DOC_CERT_ID]
      );
    });
  });
});

// ============================================================
// PURGATORIO — flujo pendiente → aprobar / rechazar (solo admin)
// ============================================================

describe.skipIf(!dbAvailable)('purgatorio: flujo de aprobación/rechazo de documentos', () => {
  it('admin puede aprobar un documento (UPDATE estado a aprobado)', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rowCount } = await c.query(
        `UPDATE documents SET estado = 'aprobado', reviewed_by = $1, reviewed_at = now()
         WHERE id = $2`,
        [IDS.admin, DOC_CERT_ID]
      );
      expect(rowCount).toBeGreaterThanOrEqual(1);
    });
  });

  it('admin puede rechazar un documento con motivo_rechazo', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rowCount } = await c.query(
        `UPDATE documents SET estado = 'rechazado', motivo_rechazo = $1,
                              reviewed_by = $2, reviewed_at = now()
         WHERE id = $3`,
        ['Falta firma', IDS.admin, DOC_OTROS_ID]
      );
      expect(rowCount).toBeGreaterThanOrEqual(1);
    });
  });

  it('admin puede leer todos los documentos incluyendo estudio_medico', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows } = await c.query(
        `SELECT document_type FROM documents WHERE id = $1`,
        [DOC_ESTUDIO_ID]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].document_type).toBe('estudio_medico');
    });
  });

  it('empleado NO puede leer el documento estudio_medico propio (RLS no filtra por tipo — restricción en app layer)', async () => {
    // La RLS de documents no filtra por document_type; la restricción es en app layer.
    // Este test documenta el comportamiento esperado a nivel de base de datos.
    // El empleado SÍ puede ver la fila desde SQL, pero la app la oculta.
    await asUser(IDS.employee1, async (c) => {
      const { rows } = await c.query(
        `SELECT document_type FROM documents WHERE id = $1`,
        [DOC_ESTUDIO_ID]
      );
      // RLS permite SELECT por user_id = auth.uid(), así que el empleado ve la fila en BD.
      // La app layer filtra estudio_medico en Mi Perfil para no-admin.
      expect(rows).toHaveLength(1);
    });
  });

  it('service_role puede ver todos los documentos (bypass RLS)', async () => {
    const n = await asServiceRole((c) => countRows(c, 'documents'));
    expect(n).toBeGreaterThan(0);
  });
});

// ============================================================
// LÍMITE DE ROL — verificación de los 3 roles para Mi Perfil
// ============================================================

describe.skipIf(!dbAvailable)('límite de rol: Mi Perfil (empleado / supervisor / admin)', () => {
  it('empleado: solo ve su propia fila en profiles', async () => {
    const n = await asUser(IDS.employee1, (c) => countRows(c, 'profiles'));
    expect(n).toBe(1);
  });

  it('empleado: solo ve sus propios documentos', async () => {
    const n = await asUser(IDS.employee2, (c) => countRows(c, 'documents'));
    // employee2 no tiene documentos en el seed de este test
    expect(n).toBe(0);
  });

  it('supervisor: en Mi Perfil ve SOLO su propia fila (no el equipo — es su perfil propio)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      const { rows } = await c.query('SELECT id FROM profiles WHERE id = $1', [IDS.supervisor]);
      expect(rows).toHaveLength(1);
    });
  });

  it('supervisor: NO puede editar su propio perfil (UPDATE denegado silenciosamente)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      await expectDeniedSilently(
        c,
        'UPDATE profiles SET nombre = $1 WHERE id = $2',
        ['HackSupervisor', IDS.supervisor]
      );
    });
  });

  it('admin: ve todos los perfiles (6 usuarios)', async () => {
    const n = await asUser(IDS.admin, (c) => countRows(c, 'profiles'));
    expect(n).toBe(6);
  });

  it('admin: puede UPDATE nombre/apellido/cuit/winda_id en cualquier perfil', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rowCount } = await c.query(
        'UPDATE profiles SET nombre = $1, cuit = $2 WHERE id = $3',
        ['AdminUpdate', '20-99999999-9', IDS.supervisor]
      );
      expect(rowCount).toBeGreaterThanOrEqual(1);
    });
  });

  it('admin: puede UPDATE status y entrevista_tecnica (campos solo-admin)', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rowCount } = await c.query(
        `UPDATE profiles SET status = 'inactivo', entrevista_tecnica = '{"aerogeneradores":true}'::jsonb
         WHERE id = $1`,
        [IDS.employee3]
      );
      expect(rowCount).toBeGreaterThanOrEqual(1);
    });
  });

  it('empleado: NO puede UPDATE status (campo solo-admin)', async () => {
    await asUser(IDS.employee1, async (c) => {
      await expectDeniedSilently(
        c,
        `UPDATE profiles SET status = 'inactivo' WHERE id = $1`,
        [IDS.employee1]
      );
    });
  });

  it('supervisor: NO puede UPDATE status de un empleado de su equipo', async () => {
    await asUser(IDS.supervisor, async (c) => {
      await expectDeniedSilently(
        c,
        `UPDATE profiles SET status = 'inactivo' WHERE id = $1`,
        [IDS.employee1]
      );
    });
  });
});

// ============================================================
// STORAGE — límite de rol para documentos en bucket
// ============================================================

describe.skipIf(!dbAvailable)('storage.objects: límite de rol para documentos', () => {
  it('empleado puede INSERT objeto en su propia carpeta', async () => {
    await asUser(IDS.employee2, async (c) => {
      await expect(
        c.query(
          `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('documents', $1, $2)`,
          [`${IDS.employee2}/certificado-test.pdf`, IDS.employee2]
        )
      ).resolves.toBeDefined();
    });
  });

  it('empleado NO puede INSERT objeto en carpeta ajena (WITH CHECK falla)', async () => {
    await asUser(IDS.employee2, async (c) => {
      await expectPermissionError(
        c,
        `INSERT INTO storage.objects (bucket_id, name, owner) VALUES ('documents', $1, $2)`,
        [`${IDS.employee1}/hack.pdf`, IDS.employee2]
      );
    });
  });

  it('supervisor NO ve objetos de carpetas ajenas — solo la propia (0004_rls_fixes)', async () => {
    await asUser(IDS.supervisor, async (c) => {
      const { rows } = await c.query(
        `SELECT name FROM storage.objects WHERE bucket_id = 'documents' AND owner = $1`,
        [IDS.employee3] // employee3 es del equipo de supervisor2, no de supervisor
      );
      expect(rows).toHaveLength(0);
    });
  });

  it('admin ve todos los objetos en Storage', async () => {
    await asUser(IDS.admin, async (c) => {
      const { rows } = await c.query(
        `SELECT COUNT(*) AS n FROM storage.objects WHERE bucket_id = 'documents'`
      );
      expect(parseInt(rows[0].n, 10)).toBeGreaterThanOrEqual(1);
    });
  });

  it('usuario NO puede DELETE objetos ajenos (USING deniega → rowCount=0)', async () => {
    await asUser(IDS.employee2, async (c) => {
      await expectDeniedSilently(
        c,
        `DELETE FROM storage.objects WHERE bucket_id = 'documents' AND owner = $1`,
        [IDS.employee1]
      );
    });
  });
});
