/**
 * FB-F3-13 — Auth del cron de alertas de descanso.
 * Falla cerrado: 401 sin CRON_SECRET o con Bearer incorrecto. El runner se
 * mockea para no cargar Gmail/Supabase ni ejecutar lógica real.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/notifications/franco-alerts-runner', () => ({
  runFrancoAlertsCron: vi.fn().mockResolvedValue({ employeesInAlert: 0, sent: 0, failed: 0 }),
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/cron/franco-alerts/route';
import { runFrancoAlertsCron } from '@/lib/notifications/franco-alerts-runner';

const URL = 'https://app.test/api/cron/franco-alerts';

function req(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set('authorization', authHeader);
  return new NextRequest(URL, { headers });
}

describe('GET /api/cron/franco-alerts — auth', () => {
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
    expect(runFrancoAlertsCron).not.toHaveBeenCalled();
  });

  it('401 con Bearer incorrecto', async () => {
    const res = await GET(req('Bearer otra-cosa'));
    expect(res.status).toBe(401);
    expect(runFrancoAlertsCron).not.toHaveBeenCalled();
  });

  it('401 si CRON_SECRET no está seteado (falla cerrado)', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req('Bearer secreto-de-prueba'));
    expect(res.status).toBe(401);
    expect(runFrancoAlertsCron).not.toHaveBeenCalled();
  });

  it('200 con Bearer correcto e invoca el runner', async () => {
    const res = await GET(req('Bearer secreto-de-prueba'));
    expect(res.status).toBe(200);
    expect(runFrancoAlertsCron).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
