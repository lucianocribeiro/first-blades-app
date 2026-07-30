// FB-F4-11 — Empleado: crea una Solicitud de Ausencia y una Solicitud de
// Pasaje (días de viaje discretos) por el formulario real, contra el stack
// efímero de CI. No depende de datos de otras specs.
import { test, expect } from '@playwright/test';
import { login, futureDate, exactLabel, credentialsFor, resolveUserId, seedPendingAusencia } from './helpers';
import { copy } from '../../lib/copy';

test.describe('Empleado: Solicitud de Ausencia', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'empleado');
  });

  test('crea una solicitud de vacaciones (rango de fechas) y queda Pendiente', async ({ page }) => {
    await page.goto('/solicitud-ausencia');

    await page.getByLabel(exactLabel(copy.solicitudAusencia.fields.motivo)).selectOption('vacaciones');
    await page.getByLabel(exactLabel(copy.solicitudAusencia.fields.fechaInicio)).fill(futureDate(60));
    await page.getByLabel(exactLabel(copy.solicitudAusencia.fields.fechaFin)).fill(futureDate(62));
    await page.getByRole('button', { name: copy.solicitudAusencia.submitButton, exact: true }).click();

    await expect(page.getByText(copy.solicitudAusencia.messages.success)).toBeVisible();
    await expect(page.getByText(copy.solicitudAusencia.listTitle)).toBeVisible();
    await expect(page.getByText(copy.solicitudAusencia.estados.pendiente).first()).toBeVisible();
  });

  // FB-F4-16: el mensaje de error server-side (solapamiento con una pendiente
  // existente, SQLSTATE 23P01) tiene que sobrevivir a un build de producción
  // real — Next.js redacta el mensaje de cualquier `throw` que cruce el
  // límite de una Server Action ("An error occurred in the Server Components
  // render..."), así que este caso solo se puede probar de verdad contra
  // `next build && next start` (exactamente lo que corre este job), nunca en
  // `next dev` ni en un test unitario con mocks (ver FB-F4-14 §8).
  test('solapamiento con una pendiente existente muestra el mensaje amigable, no el genérico redactado', async ({ page }) => {
    const empleadoId = await resolveUserId(credentialsFor('empleado').email);
    const fecha = futureDate(200);
    await seedPendingAusencia({
      userId: empleadoId,
      fechaInicio: fecha,
      fechaFin: fecha,
      nota: 'E2E-FB-F4-16-SOLAPAMIENTO',
    });

    await page.goto('/solicitud-ausencia');
    await page.getByLabel(exactLabel(copy.solicitudAusencia.fields.motivo)).selectOption('vacaciones');
    await page.getByLabel(exactLabel(copy.solicitudAusencia.fields.fechaInicio)).fill(fecha);
    await page.getByLabel(exactLabel(copy.solicitudAusencia.fields.fechaFin)).fill(fecha);
    await page.getByRole('button', { name: copy.solicitudAusencia.submitButton, exact: true }).click();

    await expect(page.getByText(copy.solicitudAusencia.errors.pendienteDuplicada)).toBeVisible();
    await expect(
      page.getByText('An error occurred in the Server Components render', { exact: false })
    ).toHaveCount(0);
  });
});

test.describe('Empleado: Solicitud de Pasaje', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'empleado');
  });

  test('crea una solicitud con días de viaje discretos (no un rango) y queda Pendiente', async ({ page }) => {
    await page.goto('/solicitud-pasaje');

    await page.getByLabel(exactLabel(copy.solicitudPasaje.fields.motivoViaje)).selectOption('traslado_proyectos');
    await page.getByLabel(exactLabel(copy.solicitudPasaje.fields.origen)).fill('Base Mendoza');
    await page.getByLabel(exactLabel(copy.solicitudPasaje.fields.destino)).fill('Parque eólico Sitio 7');

    // El primer día de viaje ya viene en el form; agrega un SEGUNDO día
    // discreto, no contiguo, vía el botón "Agregar día" — confirma que son
    // fechas sueltas, no un rango de inicio/fin como en ausencia. Cada fila
    // tiene su propio aria-label ("Días de viaje N") — ver SolicitudPasajeForm.
    await page.getByLabel(exactLabel(`${copy.solicitudPasaje.fields.diasViaje} 1`)).fill(futureDate(70));
    await page.getByRole('button', { name: copy.solicitudPasaje.diasViaje.agregarDia, exact: true }).click();
    await page.getByLabel(exactLabel(`${copy.solicitudPasaje.fields.diasViaje} 2`)).fill(futureDate(75));

    await page.getByRole('button', { name: copy.solicitudPasaje.submitButton, exact: true }).click();

    await expect(page.getByText(copy.solicitudPasaje.messages.success)).toBeVisible();
    await expect(page.getByText(copy.solicitudPasaje.listTitle)).toBeVisible();
    await expect(page.getByText(copy.solicitudPasaje.estados.pendiente).first()).toBeVisible();
    await expect(page.getByText('Base Mendoza')).toBeVisible();
  });
});
