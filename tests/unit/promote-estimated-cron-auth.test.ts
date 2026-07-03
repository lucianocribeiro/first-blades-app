/**
 * FB-F3-07 — Auth del cron de promoción estimado → real.
 * Falla cerrado: 401 sin CRON_SECRET o con Bearer incorrecto. La función
 * productiva se mockea para no tocar Supabase ni ejecutar lógica real.
 * Calco de tests/unit/document-expiry-cron-auth.test.ts (mismo molde de
 * cron de Fase 2).
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/rotation/promote-estimated', () => ({
  promoteEstimatedDays: vi.fn().mockResolvedValue({ promoted: 0 }),
}));

import { NextRequest } from 'next/server';
import { GET } from '@/app/api/cron/promote-estimated-days/route';
import { promoteEstimatedDays } from '@/lib/rotation/promote-estimated';

const URL = 'https://app.test/api/cron/promote-estimated-days';

function req(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) headers.set('authorization', authHeader);
  return new NextRequest(URL, { headers });
}

describe('GET /api/cron/promote-estimated-days — auth', () => {
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
    expect(promoteEstimatedDays).not.toHaveBeenCalled();
  });

  it('401 con Bearer incorrecto', async () => {
    const res = await GET(req('Bearer otra-cosa'));
    expect(res.status).toBe(401);
    expect(promoteEstimatedDays).not.toHaveBeenCalled();
  });

  it('401 si CRON_SECRET no está seteado (falla cerrado)', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req('Bearer secreto-de-prueba'));
    expect(res.status).toBe(401);
    expect(promoteEstimatedDays).not.toHaveBeenCalled();
  });

  it('200 con Bearer correcto e invoca la función productiva', async () => {
    const res = await GET(req('Bearer secreto-de-prueba'));
    expect(res.status).toBe(200);
    expect(promoteEstimatedDays).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.promoted).toBe(0);
  });
});
