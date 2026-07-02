/**
 * FB-F2-07 — Auth del cron de alertas de vencimiento.
 * Falla cerrado: 401 sin CRON_SECRET o con Bearer incorrecto. El runner se
 * mockea para no cargar Gmail/Supabase ni ejecutar lógica real.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/notifications/document-expiry-runner', () => ({
  runDocumentExpiryAlertsCron: vi
    .fn()
    .mockResolvedValue({ documentsEvaluated: 0, sent: 0, failed: 0 }),
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/cron/document-expiry-alerts/route';
import { runDocumentExpiryAlertsCron } from '@/lib/notifications/document-expiry-runner';

const URL = 'https://app.test/api/cron/document-expiry-alerts';

function req(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set('authorization', authHeader);
  return new NextRequest(URL, { headers });
}

describe('GET /api/cron/document-expiry-alerts — auth', () => {
  const OLD = process.env.CRON_SECRET;
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'secreto-de-prueba';
  });
  afterEach(() => {
    process.env.CRON_SECRET = OLD;
  });

  it('401 sin header Authorization', async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(runDocumentExpiryAlertsCron).not.toHaveBeenCalled();
  });

  it('401 con Bearer incorrecto', async () => {
    const res = await GET(req('Bearer otra-cosa'));
    expect(res.status).toBe(401);
    expect(runDocumentExpiryAlertsCron).not.toHaveBeenCalled();
  });

  it('401 si CRON_SECRET no está seteado (falla cerrado)', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req('Bearer secreto-de-prueba'));
    expect(res.status).toBe(401);
    expect(runDocumentExpiryAlertsCron).not.toHaveBeenCalled();
  });

  it('200 con Bearer correcto e invoca el runner', async () => {
    const res = await GET(req('Bearer secreto-de-prueba'));
    expect(res.status).toBe(200);
    expect(runDocumentExpiryAlertsCron).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
