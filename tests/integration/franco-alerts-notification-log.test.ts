/**
 * Tests de integración — notification_log para alertas de descanso (FB-F3-13)
 *
 * Cubre contra Supabase local real (migraciones 0010/0011):
 *  1. CHECK notification_log_forma_por_tipo: una fila de franco NUNCA tiene
 *     document_id, y SIEMPRE tiene empleado_id + racha_inicio (y viceversa
 *     para documento).
 *  2. CHECK notification_log_umbral_valido: 48/60 para sin_franco, 10/12
 *     para franco_excedido; cualquier otro valor se rechaza.
 *  3. Índice único parcial notification_log_franco_idempotencia: mismo
 *     episodio+umbral+destinatario no se puede insertar dos veces; otro
 *     destinatario, otro umbral, u otra racha_inicio (episodio nuevo) sí.
 *  4. runFrancoAlerts + store Supabase end-to-end: idempotencia real (correr
 *     el cron dos veces no reenvía), con `send` falso.
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupTestDb, IDS, createStorageAdminClient, asServiceRole } from './helpers';
import { runFrancoAlerts } from '@/lib/notifications/franco-alerts';
import { createSupabaseFrancoAlertsStore } from '@/lib/notifications/franco-alerts-store';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;

function fechaMenos(fechaFin: string, diasAtras: number): string {
  const [y, m, d] = fechaFin.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - diasAtras)).toISOString().split('T')[0];
}

const HOY = '2026-07-31';

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();
}, 30_000);

afterAll(async () => {
  if (!dbAvailable || !db) return;
  try {
    await db.query('SELECT pg_advisory_unlock_all();');
  } finally {
    await db.end();
  }
});

// ─── CHECK: forma por tipo ─────────────────────────────────────

describe.skipIf(!dbAvailable)('notification_log: CHECK forma_por_tipo (FB-F3-13)', () => {
  it('rechaza una fila de franco con document_id NOT NULL', async () => {
    await expect(
      asServiceRole(async (client) => {
        await client.query(
          `INSERT INTO notification_log (tipo, document_id, empleado_id, umbral, racha_inicio, recipient_profile_id)
           VALUES ('sin_franco', gen_random_uuid(), $1::uuid, 48, $2::date, $3::uuid)`,
          [IDS.employee1, HOY, IDS.admin]
        );
      })
    ).rejects.toThrow();
  });

  it('rechaza una fila de franco sin empleado_id', async () => {
    await expect(
      asServiceRole(async (client) => {
        await client.query(
          `INSERT INTO notification_log (tipo, umbral, racha_inicio, recipient_profile_id)
           VALUES ('sin_franco', 48, $1::date, $2::uuid)`,
          [HOY, IDS.admin]
        );
      })
    ).rejects.toThrow();
  });

  it('rechaza una fila de franco sin racha_inicio', async () => {
    await expect(
      asServiceRole(async (client) => {
        await client.query(
          `INSERT INTO notification_log (tipo, empleado_id, umbral, recipient_profile_id)
           VALUES ('sin_franco', $1::uuid, 48, $2::uuid)`,
          [IDS.employee1, IDS.admin]
        );
      })
    ).rejects.toThrow();
  });

  it('acepta una fila de franco válida (sin document_id, con empleado_id + racha_inicio)', async () => {
    await asServiceRole(async (client) => {
      const res = await client.query(
        `INSERT INTO notification_log (tipo, empleado_id, umbral, racha_inicio, recipient_profile_id)
         VALUES ('sin_franco', $1::uuid, 48, $2::date, $3::uuid)`,
        [IDS.employee1, HOY, IDS.admin]
      );
      expect(res.rowCount).toBe(1);
    });
  });
});

// ─── CHECK: umbral válido por tipo ──────────────────────────────

describe.skipIf(!dbAvailable)('notification_log: CHECK umbral_valido por tipo (FB-F3-13)', () => {
  it('sin_franco acepta 48 y 60, rechaza otro valor', async () => {
    await asServiceRole(async (client) => {
      for (const umbral of [48, 60]) {
        const res = await client.query(
          `INSERT INTO notification_log (tipo, empleado_id, umbral, racha_inicio, recipient_profile_id)
           VALUES ('sin_franco', $1::uuid, $2, $3::date, $4::uuid)`,
          [IDS.employee1, umbral, fechaMenos(HOY, umbral), IDS.admin]
        );
        expect(res.rowCount).toBe(1);
      }
    });
    await expect(
      asServiceRole(async (client) => {
        await client.query(
          `INSERT INTO notification_log (tipo, empleado_id, umbral, racha_inicio, recipient_profile_id)
           VALUES ('sin_franco', $1::uuid, 50, $2::date, $3::uuid)`,
          [IDS.employee1, HOY, IDS.admin]
        );
      })
    ).rejects.toThrow();
  });

  it('franco_excedido acepta 10 y 12, rechaza otro valor', async () => {
    await asServiceRole(async (client) => {
      for (const umbral of [10, 12]) {
        const res = await client.query(
          `INSERT INTO notification_log (tipo, empleado_id, umbral, racha_inicio, recipient_profile_id)
           VALUES ('franco_excedido', $1::uuid, $2, $3::date, $4::uuid)`,
          [IDS.employee1, umbral, fechaMenos(HOY, umbral), IDS.admin]
        );
        expect(res.rowCount).toBe(1);
      }
    });
    await expect(
      asServiceRole(async (client) => {
        await client.query(
          `INSERT INTO notification_log (tipo, empleado_id, umbral, racha_inicio, recipient_profile_id)
           VALUES ('franco_excedido', $1::uuid, 11, $2::date, $3::uuid)`,
          [IDS.employee1, HOY, IDS.admin]
        );
      })
    ).rejects.toThrow();
  });

  it('vencimiento_documento sigue aceptando solo 5/15/30 (sin regresión de 0008)', async () => {
    await expect(
      asServiceRole(async (client) => {
        await client.query(
          `INSERT INTO notification_log (tipo, document_id, umbral, recipient_profile_id)
           VALUES ('vencimiento_documento', gen_random_uuid(), 48, $1::uuid)`,
          [IDS.admin]
        );
      })
    ).rejects.toThrow();
  });
});

// ─── Índice único parcial: idempotencia de franco ──────────────

describe.skipIf(!dbAvailable)('notification_log: idempotencia de franco (índice único parcial, FB-F3-13)', () => {
  it('rechaza duplicado exacto (tipo, empleado_id, umbral, racha_inicio, recipient_profile_id)', async () => {
    await expect(
      asServiceRole(async (client) => {
        const insert = `
          INSERT INTO notification_log (tipo, empleado_id, umbral, racha_inicio, recipient_profile_id)
          VALUES ('sin_franco', $1::uuid, 48, $2::date, $3::uuid)
        `;
        await client.query(insert, [IDS.employee1, HOY, IDS.admin]);
        await client.query(insert, [IDS.employee1, HOY, IDS.admin]);
      })
    ).rejects.toThrow();
  });

  it('permite el mismo episodio+umbral para OTRO destinatario (otro admin)', async () => {
    await asServiceRole(async (client) => {
      const insert = `
        INSERT INTO notification_log (tipo, empleado_id, umbral, racha_inicio, recipient_profile_id)
        VALUES ('sin_franco', $1::uuid, 48, $2::date, $3::uuid)
      `;
      await client.query(insert, [IDS.employee1, HOY, IDS.admin]);
      const res = await client.query(insert, [IDS.employee1, HOY, IDS.supervisor]);
      expect(res.rowCount).toBe(1);
    });
  });

  it('permite el mismo umbral con OTRA racha_inicio (episodio distinto)', async () => {
    await asServiceRole(async (client) => {
      const insert = `
        INSERT INTO notification_log (tipo, empleado_id, umbral, racha_inicio, recipient_profile_id)
        VALUES ('sin_franco', $1::uuid, 48, $2::date, $3::uuid)
      `;
      await client.query(insert, [IDS.employee1, HOY, IDS.admin]);
      const res = await client.query(insert, [IDS.employee1, fechaMenos(HOY, 100), IDS.admin]);
      expect(res.rowCount).toBe(1);
    });
  });

  it('múltiples filas de franco (document_id NULL) no chocan contra la UNIQUE original de documentos', async () => {
    // La UNIQUE de 0008 es (tipo, document_id, umbral, recipient_profile_id); Postgres
    // no compara NULLs como iguales ahí, así que 2 filas de franco con
    // document_id NULL nunca hubieran chocado contra ESA constraint — el
    // índice parcial es el mecanismo real de idempotencia para franco.
    await asServiceRole(async (client) => {
      const res1 = await client.query(
        `INSERT INTO notification_log (tipo, empleado_id, umbral, racha_inicio, recipient_profile_id)
         VALUES ('franco_excedido', $1::uuid, 10, $2::date, $3::uuid)`,
        [IDS.employee1, HOY, IDS.admin]
      );
      const res2 = await client.query(
        `INSERT INTO notification_log (tipo, empleado_id, umbral, racha_inicio, recipient_profile_id)
         VALUES ('franco_excedido', $1::uuid, 12, $2::date, $3::uuid)`,
        [IDS.employee2, HOY, IDS.admin]
      );
      expect(res1.rowCount).toBe(1);
      expect(res2.rowCount).toBe(1);
    });
  });
});

// ─── runFrancoAlerts + store Supabase end-to-end ────────────────

describe.skipIf(!dbAvailable)('runFrancoAlerts con store Supabase (idempotencia real)', () => {
  it('primera corrida envía a los admins y registra; la segunda no reenvía', async () => {
    const admin = createStorageAdminClient();

    // employee1 (equipo de supervisor): 48 días trabajando consecutivos
    // hasta HOY → alcanza el primer umbral de sin_franco (48).
    const values = Array.from({ length: 48 }, (_, i) => {
      const fecha = fechaMenos(HOY, 47 - i);
      return `('${IDS.employee1}', '${fecha}', 'trabajando', false)`;
    }).join(',\n');
    await db.query(`INSERT INTO rotation_assignments (user_id, fecha, estado_dia, es_estimado) VALUES ${values}`);

    const store = createSupabaseFrancoAlertsStore(admin);

    const sent1: string[] = [];
    const send1 = async (p: { to: string }) => {
      sent1.push(p.to);
    };
    const r1 = await runFrancoAlerts({ store, send: send1, today: HOY });
    expect(r1.employeesInAlert).toBe(1);
    expect(r1.sent).toBeGreaterThanOrEqual(1);
    expect(sent1).toContain('admin@test.com');

    const { data: logs } = await admin
      .from('notification_log')
      .select('umbral, recipient_profile_id')
      .eq('empleado_id', IDS.employee1);
    expect((logs ?? []).length).toBeGreaterThan(0);

    // Segunda corrida el mismo día: nada nuevo se envía.
    const sent2: string[] = [];
    const send2 = async (p: { to: string }) => {
      sent2.push(p.to);
    };
    const r2 = await runFrancoAlerts({ store, send: send2, today: HOY });
    expect(r2.sent).toBe(0);
    expect(sent2).toHaveLength(0);
  }, 20_000);
});
