import { NextRequest, NextResponse } from 'next/server';
import { runFrancoAlertsCron } from '@/lib/notifications/franco-alerts-runner';

// GET /api/cron/franco-alerts
// Invocado diariamente por Vercel Cron (vercel.json).
// Protegido con Authorization: Bearer <CRON_SECRET>; falla cerrado (401).
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const result = await runFrancoAlertsCron();
    console.log(
      `[franco-alerts-cron] empleados_en_alerta=${result.employeesInAlert} enviados=${result.sent} fallidos=${result.failed}`
    );
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Error desconocido' },
      { status: 500 }
    );
  }
}
