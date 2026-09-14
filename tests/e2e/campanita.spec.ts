// FB-PI-01 — Campanita del admin: badge de aprobaciones pendientes.
//
// Contra el stack efímero real (Next + Supabase local sembrado):
//  - admin ve el badge con el número correcto → click → aterriza en
//    /aprobaciones, y la bandeja lista exactamente esa cantidad de filas;
//  - al aprobar desde la bandeja, el badge baja SIN recargar (la Server
//    Action revalida y su respuesta re-renderiza el layout — ver
//    docs/audits/FB-PI-01-INSPECT.md §2.1);
//  - con cero pendientes no hay badge;
//  - supervisor y empleado no ven badge ni link a Aprobaciones.
//
// El número esperado NO es fijo: otras specs pueden dejar pendientes en la
// misma base. Se cuenta contra la base con el cliente admin, con el mismo
// filtro que lib/aprobaciones.ts (estado = 'pendiente' en las tres tablas;
// para el admin la RLS devuelve todas las filas, así que coincide).
import { test, expect, type Page } from '@playwright/test';
import { login, futureDate, credentialsFor, resolveUserId, seedPendingPasaje } from './helpers';
import { createAdminClient } from '../../lib/supabase/admin';
import { TABLAS_APROBACION } from '../../lib/aprobaciones';
import { copy } from '../../lib/copy';

const DIA_PASAJE = futureDate(210);
const DESTINO_PASAJE = 'Sitio E2E Campanita';

// El caso "cero pendientes" estaciona temporalmente los pendientes de la base
// y los restaura al final: los tests de este archivo corren en serie. En CI
// el job e2e corre con workers: 1 (sin specs concurrentes).
test.describe.configure({ mode: 'serial' });

async function contarPendientesEnBase(): Promise<number> {
  const admin = createAdminClient();
  let total = 0;
  for (const tabla of TABLAS_APROBACION) {
    const { count, error } = await admin
      .from(tabla)
      .select('*', { count: 'exact', head: true })
      .eq('estado', 'pendiente');
    if (error || count === null) {
      throw new Error(`[e2e] no se pudo contar pendientes de ${tabla}: ${error?.message}`);
    }
    total += count;
  }
  return total;
}

function textoBadge(n: number): string {
  return n > 99 ? copy.topbar.aprobacionesPendientesTope : String(n);
}

function campanitaAdmin(page: Page) {
  return page.locator('header a[href="/aprobaciones"]');
}

test.describe('Campanita: aprobaciones pendientes (admin)', () => {
  test.beforeAll(async () => {
    const empleadoId = await resolveUserId(credentialsFor('empleado').email);
    // Garantiza al menos un pendiente conocido (y el que se aprueba abajo).
    await seedPendingPasaje({
      solicitanteId: empleadoId,
      empleadoId,
      diasViaje: [DIA_PASAJE],
      destino: DESTINO_PASAJE,
    });
  });

  test('admin ve el badge con el número correcto y la campanita lleva a Aprobaciones', async ({ page }) => {
    await login(page, 'admin');
    const esperado = await contarPendientesEnBase();
    expect(esperado).toBeGreaterThan(0);

    // Recarga completa post-login: el layout se renderiza con el estado actual.
    await page.reload();
    const badge = page.getByTestId('campanita-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText(textoBadge(esperado));

    await campanitaAdmin(page).click();
    await expect(page).toHaveURL(/\/aprobaciones$/);

    // Criterio principal: el número coincide con las filas de la bandeja.
    await expect(page.locator('tbody tr')).toHaveCount(esperado);
    await expect(page.getByTestId('campanita-badge')).toHaveText(textoBadge(esperado));
  });

  test('al aprobar desde la bandeja, el badge baja sin recargar', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/aprobaciones');
    const antes = await contarPendientesEnBase();
    await expect(page.getByTestId('campanita-badge')).toHaveText(textoBadge(antes));

    const fila = page.locator('tr', { hasText: DESTINO_PASAJE });
    await expect(fila).toBeVisible();
    await fila.getByRole('button', { name: copy.aprobaciones.actions.aprobar, exact: true }).click();
    await expect(fila).toHaveCount(0);

    const despues = antes - 1;
    if (despues > 0) {
      await expect(page.getByTestId('campanita-badge')).toHaveText(textoBadge(despues));
    } else {
      await expect(page.getByTestId('campanita-badge')).toHaveCount(0);
    }
  });

  test('con cero pendientes no hay badge', async ({ page }) => {
    const admin = createAdminClient();
    const adminId = await resolveUserId(credentialsFor('admin').email);

    // Estaciona los pendientes actuales como 'aprobado' (con reviewed_by /
    // reviewed_at para respetar los CHECK de resolución) y los devuelve a
    // 'pendiente' al final, pase lo que pase. Solo toca la base efímera.
    const estacionados: Record<string, string[]> = {};
    try {
      for (const tabla of TABLAS_APROBACION) {
        const { data, error } = await admin
          .from(tabla)
          .update({ estado: 'aprobado', reviewed_by: adminId, reviewed_at: new Date().toISOString() })
          .eq('estado', 'pendiente')
          .select('id');
        if (error) throw new Error(`[e2e] no se pudo estacionar ${tabla}: ${error.message}`);
        estacionados[tabla] = (data ?? []).map((row) => row.id);
      }
      expect(await contarPendientesEnBase()).toBe(0);

      await login(page, 'admin');
      await page.reload();

      const campanita = campanitaAdmin(page);
      await expect(campanita).toBeVisible();
      await expect(campanita).toHaveAccessibleName(copy.topbar.aprobacionesSinPendientes);
      await expect(page.getByTestId('campanita-badge')).toHaveCount(0);
    } finally {
      for (const [tabla, ids] of Object.entries(estacionados)) {
        if (ids.length === 0) continue;
        const { error } = await admin
          .from(tabla as (typeof TABLAS_APROBACION)[number])
          .update({ estado: 'pendiente', reviewed_by: null, reviewed_at: null })
          .in('id', ids);
        if (error) throw new Error(`[e2e] no se pudo restaurar ${tabla}: ${error.message}`);
      }
    }
  });

  for (const role of ['supervisor', 'empleado'] as const) {
    test(`${role}: sin badge y sin link a Aprobaciones aunque haya pendientes`, async ({ page }) => {
      const empleadoId = await resolveUserId(credentialsFor('empleado').email);
      await seedPendingPasaje({
        solicitanteId: empleadoId,
        empleadoId,
        diasViaje: [futureDate(215)],
        destino: 'Sitio E2E Campanita no-admin',
      });
      expect(await contarPendientesEnBase()).toBeGreaterThan(0);

      await login(page, role);
      await expect(page.getByRole('button', { name: copy.topbar.notifications, exact: true })).toBeVisible();
      await expect(page.getByTestId('campanita-badge')).toHaveCount(0);
      await expect(campanitaAdmin(page)).toHaveCount(0);
    });
  }
});
