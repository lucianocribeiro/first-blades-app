// FB-F4-11 — Test dirigido a la clase de bug de interacción de navegador que
// las unit (RTL/jsdom) no detectan: <dialog>.showModal() e inertización del
// fondo. jsdom no implementa el modal top-layer real del navegador (no
// bloquea clicks/foco fuera del <dialog>), así que esta garantía sólo se
// puede probar contra un motor real (Chromium) — de ahí el pass de e2e.
//
// Usa el mismo <dialog> nativo que RejectModal (components/ui/Modal.tsx) —
// self-contenido: siembra su propio pendiente, independiente de
// aprobaciones.spec.ts.
import { test, expect } from '@playwright/test';
import { login, futureDate, credentialsFor, resolveUserId, seedPendingAusencia } from './helpers';
import { copy } from '../../lib/copy';

const NOTA_AUSENCIA = 'E2E-MODAL-INERT-AUSENCIA';

test.describe('Modal nativo (<dialog>.showModal()): inertización del fondo y foco atrapado', () => {
  test.beforeAll(async () => {
    const empleadoId = await resolveUserId(credentialsFor('empleado').email);
    await seedPendingAusencia({
      userId: empleadoId,
      fechaInicio: futureDate(150),
      fechaFin: futureDate(150),
      motivo: 'licencia_medica',
      nota: NOTA_AUSENCIA,
    });
  });

  test('con el modal abierto, el fondo no es clickeable y el foco no se escapa; al cerrar, vuelve a serlo', async ({ page }) => {
    await login(page, 'admin');
    await page.getByRole('link', { name: copy.nav.aprobaciones, exact: true }).click();
    await expect(page).toHaveURL(/\/aprobaciones/);

    const row = page.locator('tr', { hasText: NOTA_AUSENCIA });
    await row.getByRole('button', { name: copy.aprobaciones.actions.rechazar, exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // ─── Fondo inertizado: un click a un link del sidebar (detrás del
    // backdrop) no debe poder ejecutarse — Playwright espera a que el
    // elemento sea "actionable" (visible, no cubierto) y tira timeout si
    // nunca lo es, que es exactamente la garantía que se quiere probar.
    await expect(
      page.getByRole('link', { name: copy.nav.miPerfil, exact: true }).click({ timeout: 2000 })
    ).rejects.toThrow();
    await expect(page).toHaveURL(/\/aprobaciones/); // no navegó

    // ─── Foco atrapado: Tab repetido nunca saca el foco del <dialog>.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const focusedInsideDialog = await page.evaluate(() => {
        const dialogEl = document.querySelector('dialog[open]');
        return !!dialogEl && !!document.activeElement && dialogEl.contains(document.activeElement);
      });
      expect(focusedInsideDialog).toBe(true);
    }

    // ─── Cerrar (Escape → 'close' nativo → onClose de la app) y confirmar
    // que el fondo vuelve a ser interactivo.
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    await page.getByRole('link', { name: copy.nav.miPerfil, exact: true }).click();
    await expect(page).toHaveURL(/\/mi-perfil/);
  });
});
