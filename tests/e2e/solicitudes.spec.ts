// FB-F4-11 — Empleado: crea una Solicitud de Ausencia y una Solicitud de
// Pasaje (días de viaje discretos) por el formulario real, contra el stack
// efímero de CI. No depende de datos de otras specs.
import { test, expect } from '@playwright/test';
import { login, futureDate } from './helpers';
import { copy } from '../../lib/copy';

test.describe('Empleado: Solicitud de Ausencia', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'empleado');
  });

  test('crea una solicitud de vacaciones (rango de fechas) y queda Pendiente', async ({ page }) => {
    await page.goto('/solicitud-ausencia');

    await page.getByLabel(copy.solicitudAusencia.fields.motivo, { exact: true }).selectOption('vacaciones');
    await page.getByLabel(copy.solicitudAusencia.fields.fechaInicio, { exact: true }).fill(futureDate(60));
    await page.getByLabel(copy.solicitudAusencia.fields.fechaFin, { exact: true }).fill(futureDate(62));
    await page.getByRole('button', { name: copy.solicitudAusencia.submitButton, exact: true }).click();

    await expect(page.getByText(copy.solicitudAusencia.messages.success)).toBeVisible();
    await expect(page.getByText(copy.solicitudAusencia.listTitle)).toBeVisible();
    await expect(page.getByText(copy.solicitudAusencia.estados.pendiente).first()).toBeVisible();
  });
});

test.describe('Empleado: Solicitud de Pasaje', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'empleado');
  });

  test('crea una solicitud con días de viaje discretos (no un rango) y queda Pendiente', async ({ page }) => {
    await page.goto('/solicitud-pasaje');

    await page.getByLabel(copy.solicitudPasaje.fields.motivoViaje, { exact: true }).selectOption('traslado_proyectos');
    await page.getByLabel(copy.solicitudPasaje.fields.origen, { exact: true }).fill('Base Mendoza');
    await page.getByLabel(copy.solicitudPasaje.fields.destino, { exact: true }).fill('Parque eólico Sitio 7');

    // El primer día de viaje ya viene en el form; agrega un SEGUNDO día
    // discreto, no contiguo, vía el botón "Agregar día" — confirma que son
    // fechas sueltas, no un rango de inicio/fin como en ausencia. Cada fila
    // tiene su propio aria-label ("Días de viaje N") — ver SolicitudPasajeForm.
    await page.getByLabel(`${copy.solicitudPasaje.fields.diasViaje} 1`, { exact: true }).fill(futureDate(70));
    await page.getByRole('button', { name: copy.solicitudPasaje.diasViaje.agregarDia, exact: true }).click();
    await page.getByLabel(`${copy.solicitudPasaje.fields.diasViaje} 2`, { exact: true }).fill(futureDate(75));

    await page.getByRole('button', { name: copy.solicitudPasaje.submitButton, exact: true }).click();

    await expect(page.getByText(copy.solicitudPasaje.messages.success)).toBeVisible();
    await expect(page.getByText(copy.solicitudPasaje.listTitle)).toBeVisible();
    await expect(page.getByText(copy.solicitudPasaje.estados.pendiente).first()).toBeVisible();
    await expect(page.getByText('Base Mendoza')).toBeVisible();
  });
});
