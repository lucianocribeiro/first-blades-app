// FB-PI-11 — Import del calendario desde Excel (admin).
//
// Contra el stack efímero real (Next + Supabase local sembrado):
//  - el admin sube un .xlsx con el formato del export, ve la
//    previsualización (resumen, días que se borran dicho con todas las
//    letras, días pisados, saldo, errores), confirma, y el calendario queda
//    escrito (se verifica contra la base);
//  - con errores de validación, la confirmación queda bloqueada y no se
//    escribe nada;
//  - supervisor y empleado no ven el panel (el corte server-side lo cubre
//    tests/unit/calendario-import-action.test.ts con el guard real).
//
// Fechas: ~400 días en el PASADO. El resto de la suite usa fechas futuras
// (hasta +18 meses en calendario-celda-estimada), así que esta spec no pisa
// días de otras. Limpia su rango antes y después.
import { test, expect } from '@playwright/test';
import { login, credentialsFor, resolveUserId, seedRotationAssignment, clearRotationAssignments } from './helpers';
import { createAdminClient } from '../../lib/supabase/admin';
import { buildCalendarioWorkbook } from '../../lib/rotation/calendario-excel';
import { copy } from '../../lib/copy';

const t = copy.calendario.excel.importar;

function pasado(dias: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

const D1 = pasado(400);
const D2 = pasado(399);
const D3 = pasado(398);

async function archivo(email: string, filas: { fecha: string; estado: 'trabajando' | null }[]) {
  const buffer = await buildCalendarioWorkbook(
    {
      employees: [{ id: 'e2e', full_name: 'E2E Empleado', email }],
      assignments: filas
        .filter((f) => f.estado)
        .map((f) => ({ user_id: 'e2e', fecha: f.fecha, estado_dia: f.estado!, motivo_ausencia: null, motivo_otros_texto: null, notas: null })),
    },
    D1,
    D3
  );
  return {
    name: 'calendario.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer,
  };
}

async function diasEnBase(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('rotation_assignments')
    .select('fecha, estado_dia')
    .eq('user_id', userId)
    .gte('fecha', D1)
    .lte('fecha', D3)
    .order('fecha');
  if (error) throw new Error(`[e2e] no se pudo leer el calendario: ${error.message}`);
  return data;
}

test.describe('Calendario: import desde Excel', () => {
  let empleadoId: string;

  test.beforeEach(async () => {
    empleadoId = await resolveUserId(credentialsFor('empleado').email);
    await clearRotationAssignments({ userId: empleadoId, desde: D1, hasta: D3 });
  });

  test.afterEach(async () => {
    await clearRotationAssignments({ userId: empleadoId, desde: D1, hasta: D3 });
  });

  test('admin previsualiza, ve los bloques y confirma: el calendario queda escrito', async ({ page }) => {
    // D2 tiene asignación y el archivo lo trae vacío → se BORRA.
    await seedRotationAssignment({ userId: empleadoId, fecha: D2, estadoDia: 'en_franco' });

    await login(page, 'admin');
    await page.goto('/calendario');
    await expect(page.getByRole('heading', { name: t.panel.title })).toBeVisible();

    await page.getByLabel(t.panel.archivo).setInputFiles(
      await archivo(credentialsFor('empleado').email, [
        { fecha: D1, estado: 'trabajando' },
        { fecha: D2, estado: null },
        { fecha: D3, estado: null },
      ])
    );
    await page.getByRole('button', { name: t.panel.previsualizar, exact: true }).click();

    await expect(page.getByRole('heading', { name: t.preview.titulo })).toBeVisible();
    await expect(page.getByText(t.preview.nadaEscrito)).toBeVisible();
    // Nada escrito todavía.
    expect(await diasEnBase(empleadoId)).toEqual([{ fecha: D2, estado_dia: 'en_franco' }]);

    const resumen = page.getByRole('region', { name: t.preview.resumen.titulo });
    await expect(resumen.getByText(t.preview.resumen.crear).locator('..')).toContainText('1');
    await expect(resumen.getByText(t.preview.resumen.borrar).locator('..')).toContainText('1');
    await expect(resumen.getByText(t.preview.resumen.sinCambios).locator('..')).toContainText('1');

    // El borrado, dicho con todas las letras y listado.
    const borrados = page.getByRole('region', { name: `${t.preview.borrados.titulo} (1)` });
    await expect(borrados.getByText(t.preview.borrados.aviso)).toBeVisible();
    await expect(borrados.getByText(D2)).toBeVisible();

    await expect(page.getByText(t.preview.pisados.ninguno)).toBeVisible();
    await expect(page.getByText(t.preview.saldo.ninguno)).toBeVisible();
    await expect(page.getByText(t.preview.errores.ninguno)).toBeVisible();

    await page.getByRole('button', { name: t.panel.confirmar, exact: true }).click();
    await expect(page.getByText(t.exito.titulo)).toBeVisible();

    expect(await diasEnBase(empleadoId)).toEqual([{ fecha: D1, estado_dia: 'trabajando' }]);
  });

  test('con errores de validación la confirmación queda bloqueada y no se escribe nada', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/calendario');

    await page.getByLabel(t.panel.archivo).setInputFiles(
      await archivo('nadie@firstblades.test', [{ fecha: D1, estado: 'trabajando' }])
    );
    await page.getByRole('button', { name: t.panel.previsualizar, exact: true }).click();

    await expect(page.getByText(t.preview.errores.aviso)).toBeVisible();
    await expect(page.getByText(t.errores.emailInexistente).first()).toBeVisible();
    await expect(page.getByRole('button', { name: t.panel.confirmar, exact: true })).toBeDisabled();

    expect(await diasEnBase(empleadoId)).toEqual([]);
  });

  for (const role of ['supervisor', 'empleado'] as const) {
    test(`${role}: no ve el panel de import`, async ({ page }) => {
      await login(page, role);
      await page.goto('/calendario');

      await expect(page.getByRole('heading', { name: copy.calendario.title }).first()).toBeVisible();
      await expect(page.getByRole('heading', { name: t.panel.title })).toHaveCount(0);
      await expect(page.getByRole('button', { name: t.panel.previsualizar, exact: true })).toHaveCount(0);
    });
  }
});
