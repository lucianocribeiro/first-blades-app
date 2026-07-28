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
import { login, futureDate, credentialsFor, resolveUserId, seedPendingAusencia, exactLabel } from './helpers';
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
    // page.goto() en vez de clickear el link del sidebar: ESE link, en
    // Sidebar.tsx, dispara onClick={onClose} (colapsa el sidebar a w-0 —
    // pensado para cerrar el drawer mobile tras navegar). Clickearlo acá
    // colapsaría el sidebar ANTES de que el test llegue a usarlo, confundiendo
    // "el fondo está inerte por el modal" con "el sidebar está colapsado por
    // su propio click" — nada que ver con la garantía que se quiere probar.
    await page.goto('/aprobaciones');

    const row = page.locator('tr', { hasText: NOTA_AUSENCIA });
    await row.getByRole('button', { name: copy.aprobaciones.actions.rechazar, exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // ─── Fondo inertizado: un click a un link del sidebar (detrás del
    // backdrop) no debe poder ejecutarse. trial:true corre sólo los chequeos
    // de "actionable" (visible, no cubierto) sin llegar a clickear de
    // verdad — evita que, si por algún motivo SÍ fuera clickeable, dispare
    // la navegación real y su propio onClose (ver comentario arriba).
    await expect(
      page.getByRole('link', { name: copy.nav.miPerfil, exact: true }).click({ timeout: 2000, trial: true })
    ).rejects.toThrow();
    await expect(page).toHaveURL(/\/aprobaciones/); // no navegó

    async function activeElementLocation(): Promise<string> {
      return page.evaluate(() => {
        const dialogEl = document.querySelector('dialog[open]');
        const active = document.activeElement;
        if (dialogEl && active && dialogEl.contains(active)) return 'inside-dialog';
        return `outside-dialog:${active?.tagName ?? 'null'}${active?.className ? `.${active.className}` : ''}`;
      });
    }

    // ─── Foco: hace foco explícito en un campo conocido del modal (el
    // textarea de motivo) y confirma que el click realmente lo enfocó, antes
    // de afirmar nada sobre el trap — sin este chequeo intermedio, un fallo
    // más adelante no distingue "el click no enfocó" de "el foco se escapó".
    await dialog.getByLabel(exactLabel(copy.aprobaciones.rejectModal.motivoLabel)).click();
    expect(await activeElementLocation()).toBe('inside-dialog');

    // ─── Foco atrapado (inertización, vía foco programático): un elemento
    // del fondo es INERTE mientras el modal está abierto — inerte no sólo
    // bloquea clicks (ya afirmado arriba), también rechaza foco programático
    // (.focus() en JS es un no-op sobre un elemento inerte, por spec). Se usa
    // esto en vez de simular Tab con el teclado: en corridas reales de CI, el
    // Tab sintético (CDP) sacaba el foco a "ningún lado" (document.body) de
    // forma reproducible incluso con el fondo ya confirmado inerte para
    // click — un artefacto de cómo Chromium headless procesa el keydown
    // sintetizado, no un fallo de la app (ver docs/prompts/FB-F4-11.md). El
    // foco programático prueba la MISMA garantía de inertización sin esa
    // dependencia.
    await page.evaluate(() => {
      const link = document.querySelector('a[href="/mi-perfil"]') as HTMLElement | null;
      link?.focus();
    });
    expect(await activeElementLocation()).toBe('inside-dialog');

    // ─── Cerrar (Escape → 'close' nativo → onClose de la app) y confirmar
    // que el fondo vuelve a ser interactivo — trial:true de nuevo, por la
    // misma razón: probar "es clickeable" sin disparar el onClose propio
    // del link y su efecto colateral de colapsar el sidebar.
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();

    await page.getByRole('link', { name: copy.nav.miPerfil, exact: true }).click({ trial: true, timeout: 5000 });
  });
});
