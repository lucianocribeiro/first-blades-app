// FB-F4-11 — Admin: bandeja de Aprobaciones — previsualización de
// sobrescritura, aprobar una ausencia y rechazar un pasaje (con motivo).
//
// Los datos pendientes se siembran directo con el cliente admin (mismo
// createAdminClient() que usa la app) en vez de crearlos por UI: esta spec
// ejerce la LECTURA/resolución de la cola, no el alta (ya cubierta en
// solicitudes.spec.ts), y queda determinística sin depender del orden de
// otras specs — cada fila se ubica por un marcador único (nota/destino).
import { test, expect } from '@playwright/test';
import {
  login,
  futureDate,
  credentialsFor,
  resolveUserId,
  seedRotationAssignment,
  seedPendingAusencia,
  seedPendingPasaje,
  exactLabel,
} from './helpers';
import { copy } from '../../lib/copy';

const FECHA_AUSENCIA = futureDate(100);
const DIA_PASAJE = futureDate(120);
const NOTA_AUSENCIA = 'E2E-APROBACIONES-AUSENCIA';
const DESTINO_PASAJE = 'Sitio E2E Aprobaciones';

test.describe('Admin: Aprobaciones', () => {
  test.beforeAll(async () => {
    const empleadoId = await resolveUserId(credentialsFor('empleado').email);

    // Colisión preexistente en el calendario del empleado, en la MISMA fecha
    // de la ausencia a aprobar — dispara la previsualización de sobrescritura.
    await seedRotationAssignment({ userId: empleadoId, fecha: FECHA_AUSENCIA, estadoDia: 'trabajando' });

    await seedPendingAusencia({
      userId: empleadoId,
      fechaInicio: FECHA_AUSENCIA,
      fechaFin: FECHA_AUSENCIA,
      motivo: 'vacaciones',
      nota: NOTA_AUSENCIA,
    });

    await seedPendingPasaje({
      solicitanteId: empleadoId,
      empleadoId,
      diasViaje: [DIA_PASAJE],
      destino: DESTINO_PASAJE,
    });
  });

  test.beforeEach(async ({ page }) => {
    await login(page, 'admin');
  });

  test('ve la previsualización de sobrescritura y aprueba la ausencia pendiente', async ({ page }) => {
    await page.getByRole('link', { name: copy.nav.aprobaciones, exact: true }).click();
    await expect(page).toHaveURL(/\/aprobaciones/);

    const ausenciaRow = page.locator('tr', { hasText: NOTA_AUSENCIA });
    await expect(ausenciaRow).toBeVisible();
    await expect(ausenciaRow.getByText(copy.aprobaciones.sobrescritura.aviso)).toBeVisible();

    await ausenciaRow.getByRole('button', { name: copy.aprobaciones.actions.aprobar, exact: true }).click();

    // La bandeja sólo lista pendientes: al aprobar, la fila desaparece.
    await expect(ausenciaRow).toHaveCount(0);
  });

  test('rechaza el pasaje pendiente exigiendo motivo', async ({ page }) => {
    await page.getByRole('link', { name: copy.nav.aprobaciones, exact: true }).click();
    await expect(page).toHaveURL(/\/aprobaciones/);

    const pasajeRow = page.locator('tr', { hasText: DESTINO_PASAJE });
    await expect(pasajeRow).toBeVisible();

    await pasajeRow.getByRole('button', { name: copy.aprobaciones.actions.rechazar, exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Confirmar sin motivo → error amigable, el modal sigue abierto.
    await dialog.getByRole('button', { name: copy.aprobaciones.rejectModal.confirm, exact: true }).click();
    await expect(dialog.getByText(copy.aprobaciones.rejectModal.motivoRequired)).toBeVisible();

    await dialog.getByLabel(exactLabel(copy.aprobaciones.rejectModal.motivoLabel)).fill('No corresponde para este ciclo (e2e).');
    await dialog.getByRole('button', { name: copy.aprobaciones.rejectModal.confirm, exact: true }).click();

    await expect(pasajeRow).toHaveCount(0);
  });
});
