// FB-F4-18 — Empleado: Mi Perfil — sube un documento con un tipo de archivo
// no permitido y ve el mensaje amigable, no el genérico redactado.
//
// El input de archivo tiene `accept=".pdf,.jpg,..."` pero eso es solo un
// filtro de UI en el diálogo nativo del navegador, no una validación de
// constraint — un archivo .txt llega igual al submit y la validación real
// (validateDocumentFile, lib/storage.ts) corre server-side. Es, junto con
// "archivo demasiado grande", el único error esperado del flujo de subida
// de documentos que un usuario real puede disparar sin manipular el DOM
// (a diferencia de "tipo de documento no permitido", que exige un
// document_type fuera de las opciones del <Select>).
//
// Mismo motivo que tests/e2e/solicitudes.spec.ts (FB-F4-16): el mensaje de
// error server-side tiene que sobrevivir a un build de producción real —
// Next.js redacta el mensaje de cualquier `throw` que cruce el límite de una
// Server Action, así que esto solo se puede probar de verdad contra
// `next build && next start` (este job), nunca en `next dev` ni con mocks.
import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { copy } from '../../lib/copy';

test.describe('Empleado: Mi Perfil — Subir documento', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'empleado');
  });

  test('un tipo de archivo no permitido muestra el mensaje amigable, no el genérico redactado', async ({ page }) => {
    await page.goto('/mi-perfil');

    await page.getByRole('button', { name: copy.documentos.uploadButton, exact: true }).click();
    await expect(page.getByRole('heading', { name: copy.documentos.uploadModalTitle })).toBeVisible();

    await page.locator('#doc-upload-form input[type="file"]').setInputFiles({
      name: 'archivo-e2e-fb-f4-18.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('contenido de prueba E2E-FB-F4-18'),
    });
    await page.getByRole('button', { name: copy.general.confirm, exact: true }).click();

    await expect(
      page.getByText(copy.documentos.errors.tipoArchivoNoPermitido, { exact: false })
    ).toBeVisible();
    await expect(
      page.getByText('An error occurred in the Server Components render', { exact: false })
    ).toHaveCount(0);
    // El modal sigue abierto (no se cerró como en un envío exitoso).
    await expect(page.getByRole('heading', { name: copy.documentos.uploadModalTitle })).toBeVisible();
  });
});
