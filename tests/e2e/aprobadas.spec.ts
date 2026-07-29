// FB-F4-14 — Admin: vista de Solicitudes Aprobadas — cancelar una aprobada
// vigente (con comentario) y el bloqueo de la guarda LIFO (0017) mostrando
// el mensaje amigable en vez del error crudo de Postgres.
//
// Los datos ya-aprobados se siembran directo con el cliente admin (mismo
// createAdminClient() que usa la app) — la spec ejerce cancelar_editar_*
// (0017), no la aprobación en sí (ya cubierta en aprobaciones.spec.ts). Cada
// fila se ubica por un marcador único (nota/destino), independiente del
// orden de otras specs.
import { test, expect } from '@playwright/test';
import {
  login,
  futureDate,
  credentialsFor,
  resolveUserId,
  seedApprovedAusencia,
  seedApprovedPasaje,
  exactLabel,
} from './helpers';
import { copy } from '../../lib/copy';

const FECHA_CANCELAR = futureDate(150);
const NOTA_CANCELAR = 'E2E-APROBADAS-CANCELAR';

const FECHA_LIFO_TARGET = futureDate(160);
const NOTA_LIFO_TARGET = 'E2E-APROBADAS-LIFO-TARGET';
const DESTINO_LIFO_BLOQUEO = 'Sitio E2E Aprobadas LIFO';

test.describe('Admin: Solicitudes Aprobadas', () => {
  test.beforeAll(async () => {
    const empleadoId = await resolveUserId(credentialsFor('empleado').email);
    const adminId = await resolveUserId(credentialsFor('admin').email);

    // Aprobada vigente, sin nada posterior que la bloquee.
    await seedApprovedAusencia({
      userId: empleadoId,
      reviewedById: adminId,
      fechaInicio: FECHA_CANCELAR,
      fechaFin: FECHA_CANCELAR,
      reviewedAt: '2027-01-01T00:00:00Z',
      nota: NOTA_CANCELAR,
    });

    // Objetivo con una aprobación POSTERIOR (reviewed_at mayor) que se
    // superpone en la misma fecha — la guarda LIFO (0017) debe bloquear.
    await seedApprovedAusencia({
      userId: empleadoId,
      reviewedById: adminId,
      fechaInicio: FECHA_LIFO_TARGET,
      fechaFin: FECHA_LIFO_TARGET,
      reviewedAt: '2027-01-01T00:00:00Z',
      nota: NOTA_LIFO_TARGET,
    });
    await seedApprovedPasaje({
      solicitanteId: empleadoId,
      empleadoId,
      reviewedById: adminId,
      diasViaje: [FECHA_LIFO_TARGET],
      reviewedAt: '2027-01-02T00:00:00Z',
      destino: DESTINO_LIFO_BLOQUEO,
    });
  });

  test.beforeEach(async ({ page }) => {
    await login(page, 'admin');
  });

  test('cancela una aprobada vigente con comentario obligatorio', async ({ page }) => {
    await page.goto('/aprobadas');
    await expect(page).toHaveURL(/\/aprobadas/);

    const row = page.locator('tr', { hasText: NOTA_CANCELAR });
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: copy.aprobadas.actions.cancelar })).toBeVisible();

    await row.getByRole('button', { name: copy.aprobadas.actions.cancelar }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Confirmar sin comentario → error amigable, el modal sigue abierto.
    await dialog.getByRole('button', { name: copy.aprobadas.cancelModal.confirm }).click();
    await expect(dialog.getByText(copy.aprobadas.cancelModal.comentarioRequired)).toBeVisible();

    await dialog.getByLabel(exactLabel(copy.aprobadas.cancelModal.comentarioLabel)).fill(
      'El empleado ya no necesita esta ausencia (e2e).'
    );
    await dialog.getByRole('button', { name: copy.aprobadas.cancelModal.confirm }).click();

    // Tras cancelar: la marca "Cancelada" queda visible y los botones de
    // acción desaparecen (la RPC rechazaría un segundo cambio).
    await expect(row.getByText(copy.status.cancelada)).toBeVisible();
    await expect(row.getByRole('button', { name: copy.aprobadas.actions.cancelar })).toHaveCount(0);
    await expect(row.getByRole('button', { name: copy.aprobadas.actions.editarFechas })).toHaveCount(0);
  });

  test('guarda LIFO: bloquea cancelar con el mensaje amigable, no el error crudo', async ({ page }) => {
    await page.goto('/aprobadas');
    await expect(page).toHaveURL(/\/aprobadas/);

    const row = page.locator('tr', { hasText: NOTA_LIFO_TARGET });
    await expect(row).toBeVisible();

    await row.getByRole('button', { name: copy.aprobadas.actions.cancelar }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByLabel(exactLabel(copy.aprobadas.cancelModal.comentarioLabel)).fill(
      'Intento de cancelación bloqueado por LIFO (e2e).'
    );
    await dialog.getByRole('button', { name: copy.aprobadas.cancelModal.confirm }).click();

    // El modal se cierra (la action tira antes de confirmar el éxito) y el
    // mensaje de error amigable queda visible en la página — el copy
    // reemplaza el prefijo crudo de Postgres ("No se puede cancelar la
    // solicitud <uuid>: ..."), que nunca debería llegar a pantalla.
    await expect(page.getByText(copy.aprobadas.errors.lifoBloqueo, { exact: false })).toBeVisible();
    await expect(page.getByText('No se puede cancelar la solicitud', { exact: false })).toHaveCount(0);

    // La solicitud objetivo sigue vigente (no se marcó cancelada) — sus
    // acciones siguen disponibles para reintentar tras resolver el bloqueo.
    await expect(row.getByText(copy.status.cancelada)).toHaveCount(0);
    await expect(row.getByRole('button', { name: copy.aprobadas.actions.cancelar })).toBeVisible();
  });
});
