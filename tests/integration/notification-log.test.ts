/**
 * Tests de integración — Log de notificaciones + alertas de vencimiento (FB-F2-07)
 *
 * Cubre contra Supabase local real:
 *  1. Constraint de idempotencia (tipo, document_id, umbral, recipient_profile_id).
 *  2. RLS deny-all: ningún rol de usuario lee/escribe notification_log por la API.
 *  3. Store Supabase + runner end-to-end: recordSent/getSentThresholds y que
 *     correr el cron dos veces no reenvía (idempotencia real), con `send` falso.
 */

import { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  setupTestDb,
  IDS,
  createStorageAdminClient,
  asUser,
  asServiceRole,
  expectPermissionError,
} from './helpers';
import { runDocumentExpiryAlerts } from '@/lib/notifications/document-expiry';
import { createSupabaseExpiryStore } from '@/lib/notifications/document-expiry-store';

const dbAvailable = process.env.INTEGRATION_DB_AVAILABLE === 'true';

let db: Client;
let docId: string;

function fechaEnDias(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().split('T')[0];
}
function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

beforeAll(async () => {
  if (!dbAvailable) return;
  db = await setupTestDb();

  // Documento aprobado con vencimiento en 4 días (dueño = employee1).
  const admin = createStorageAdminClient();
  const { data, error } = await admin
    .from('documents')
    .insert({
      user_id: IDS.employee1,
      uploaded_by: IDS.admin,
      document_type: 'licencia',
      filename: 'lic.pdf',
      storage_path: `${IDS.employee1}/lic-venc.pdf`,
      estado: 'aprobado',
      fecha_vencimiento: fechaEnDias(4),
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  docId = data!.id;
}, 30_000);

afterAll(async () => {
  if (!dbAvailable || !db) return;
  try {
    await db.query('SELECT pg_advisory_unlock_all();');
  } finally {
    await db.end();
  }
});

// ─── Constraint de idempotencia ───────────────────────────────

describe.skipIf(!dbAvailable)('notification_log: constraint de idempotencia', () => {
  it('rechaza duplicados de (tipo, document_id, umbral, recipient_profile_id)', async () => {
    await expect(
      asServiceRole(async (client) => {
        const insert = `
          INSERT INTO notification_log (tipo, document_id, umbral, recipient_profile_id)
          VALUES ('vencimiento_documento', $1::uuid, 5, $2::uuid)
        `;
        await client.query(insert, [docId, IDS.employee1]);
        // Segundo insert idéntico → viola la unique constraint.
        await client.query(insert, [docId, IDS.employee1]);
      })
    ).rejects.toThrow();
  });

  it('permite el mismo documento+umbral para OTRO destinatario', async () => {
    await asServiceRole(async (client) => {
      const insert = `
        INSERT INTO notification_log (tipo, document_id, umbral, recipient_profile_id)
        VALUES ('vencimiento_documento', $1::uuid, 5, $2::uuid)
      `;
      await client.query(insert, [docId, IDS.employee1]);
      // Mismo umbral, distinto destinatario → permitido.
      const res = await client.query(insert, [docId, IDS.admin]);
      expect(res.rowCount).toBe(1);
    });
  });

  it('rechaza umbral fuera de {5,15,30} (CHECK)', async () => {
    await expect(
      asServiceRole(async (client) => {
        await client.query(
          `INSERT INTO notification_log (tipo, document_id, umbral, recipient_profile_id)
           VALUES ('vencimiento_documento', $1::uuid, 7, $2::uuid)`,
          [docId, IDS.employee1]
        );
      })
    ).rejects.toThrow();
  });
});

// ─── RLS deny-all ─────────────────────────────────────────────

describe.skipIf(!dbAvailable)('notification_log: RLS deny-all para clientes', () => {
  it('empleado no puede SELECT (sin política → 0 filas visibles)', async () => {
    // Sembrar una fila visible para service_role.
    await createStorageAdminClient()
      .from('notification_log')
      .insert({
        tipo: 'vencimiento_documento',
        document_id: docId,
        umbral: 15,
        recipient_profile_id: IDS.employee1,
      });

    await asUser(IDS.employee1, async (client) => {
      const { rows } = await client.query('SELECT count(*)::int AS n FROM notification_log');
      expect(rows[0].n).toBe(0);
    });
  });

  it('admin tampoco puede SELECT (tabla interna del sistema)', async () => {
    await asUser(IDS.admin, async (client) => {
      const { rows } = await client.query('SELECT count(*)::int AS n FROM notification_log');
      expect(rows[0].n).toBe(0);
    });
  });

  it('empleado no puede INSERT (sin política de INSERT)', async () => {
    await asUser(IDS.employee1, async (client) => {
      await expectPermissionError(
        client,
        `INSERT INTO notification_log (tipo, document_id, umbral, recipient_profile_id)
         VALUES ('vencimiento_documento', $1::uuid, 30, $2::uuid)`,
        [docId, IDS.employee1]
      );
    });
  });
});

// ─── Store Supabase + runner end-to-end ───────────────────────

describe.skipIf(!dbAvailable)('runDocumentExpiryAlerts con store Supabase (idempotencia real)', () => {
  it('primera corrida envía a dueño + admin y registra; la segunda no reenvía', async () => {
    const admin = createStorageAdminClient();
    const store = createSupabaseExpiryStore(admin);
    const today = todayStr();

    const sent1: string[] = [];
    const send1 = async (p: { to: string }) => {
      sent1.push(p.to);
    };
    const r1 = await runDocumentExpiryAlerts({ store, send: send1, today });
    // Al menos dueño (emp1) + admin. Puede haber más admins si otro test los creó,
    // pero el documento sembrado tiene un único dueño.
    expect(r1.sent).toBeGreaterThanOrEqual(2);
    expect(sent1).toContain('emp1@test.com');
    expect(sent1).toContain('admin@test.com');

    // Se registraron umbrales en notification_log para ese documento.
    const { data: logs } = await admin
      .from('notification_log')
      .select('umbral, recipient_profile_id')
      .eq('document_id', docId);
    expect((logs ?? []).length).toBeGreaterThan(0);

    // Segunda corrida el mismo día: nada nuevo se envía.
    const sent2: string[] = [];
    const send2 = async (p: { to: string }) => {
      sent2.push(p.to);
    };
    const r2 = await runDocumentExpiryAlerts({ store, send: send2, today });
    expect(r2.sent).toBe(0);
    expect(sent2).toHaveLength(0);
  }, 20_000);
});
