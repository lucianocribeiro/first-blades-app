// FB-PI-04 — Export del calendario a Excel (admin).
//
// Contra el stack efímero real (Next + Supabase local sembrado):
//  - el admin elige un rango en /calendario, exporta y el navegador descarga
//    el .xlsx con el rango en el nombre; el archivo trae una fila por
//    empleado o supervisor activo (sin admins) × día del rango (se cuenta
//    contra la base);
//  - supervisor y empleado no ven la acción (el corte server-side lo cubre
//    tests/unit/calendario-export-action.test.ts con el guard real).
//
// Solo lectura: no escribe nada en la base, así que no pisa otras specs.
import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { login, credentialsFor, exactLabel } from './helpers';
import { createAdminClient } from '../../lib/supabase/admin';
import { copy } from '../../lib/copy';

const DESDE = '2026-03-01';
const HASTA = '2026-03-07'; // 7 días

const t = copy.calendario.excel.panel;

async function contarActivosNoAdmin(): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from('profiles')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'activo')
    .in('role', ['empleado', 'supervisor']);
  if (error || count === null) throw new Error(`[e2e] no se pudo contar activos: ${error?.message}`);
  return count;
}

test.describe('Calendario: export a Excel', () => {
  test('admin exporta un rango y se descarga el .xlsx', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/calendario');

    await expect(page.getByRole('heading', { name: t.title })).toBeVisible();
    await page.getByLabel(exactLabel(t.desde)).fill(DESDE);
    await page.getByLabel(exactLabel(t.hasta)).fill(HASTA);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: t.exportar, exact: true }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe(`calendario_${DESDE}_a_${HASTA}.xlsx`);
    await expect(page.getByText(t.exportado)).toBeVisible();

    const path = await download.path();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(path);
    const sheet = wb.getWorksheet(copy.calendario.excel.hojas.calendario)!;

    const activos = await contarActivosNoAdmin();
    expect(sheet.rowCount - 1).toBe(activos * 7);

    const emails = new Set<string>();
    sheet.eachRow((row, n) => {
      if (n > 1) emails.add(String(row.getCell(1).value));
    });
    expect(emails.has(credentialsFor('empleado').email)).toBe(true);
    expect(emails.has(credentialsFor('supervisor').email)).toBe(true);
    expect(emails.has(credentialsFor('admin').email)).toBe(false);
    expect(wb.getWorksheet(copy.calendario.excel.hojas.referencia)).toBeDefined();
  });

  test('rango invertido: mensaje es-AR, sin descarga', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/calendario');

    await page.getByLabel(exactLabel(t.desde)).fill(HASTA);
    await page.getByLabel(exactLabel(t.hasta)).fill(DESDE);
    await page.getByRole('button', { name: t.exportar, exact: true }).click();

    // Por texto, no por role=alert: el route announcer de Next también es un alert.
    await expect(page.getByText(copy.calendario.excel.errors.rangoInvertido)).toBeVisible();
  });

  for (const role of ['supervisor', 'empleado'] as const) {
    test(`${role}: no ve la acción de exportar`, async ({ page }) => {
      await login(page, role);
      await page.goto('/calendario');

      await expect(page.getByRole('heading', { name: copy.calendario.title }).first()).toBeVisible();
      await expect(page.getByRole('heading', { name: t.title })).toHaveCount(0);
      await expect(page.getByRole('button', { name: t.exportar, exact: true })).toHaveCount(0);
    });
  }
});
