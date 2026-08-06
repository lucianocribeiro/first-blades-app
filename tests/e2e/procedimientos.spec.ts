// FB-F5-06 — Procedimientos / Políticas: un recorrido por rol.
//
// Admin: crea un procedimiento de texto, lo edita, lo archiva y lo
// restaura — el flujo completo de gestión. Empleado: ve y busca, pero no
// tiene acciones de admin ni ve los archivados — el límite de rol es
// RLS + filtro de app (ya probado exhaustivamente contra Postgres real en
// tests/integration/rls.test.ts y tests/integration/procedimientos-rpc.test.ts);
// acá se prueba que la UI respeta ese límite (no muestra lo que no debería).
//
// El procedimiento de archivo (subida real) no se cubre acá — la
// validación de tipo/tamaño ya está probada del lado del server en
// tests/unit/procedimientos-storage.test.ts y
// tests/unit/procedimientos-actions.test.ts; este spec cubre el recorrido
// de texto, que ejercita las mismas tres Server Actions.
import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { copy } from '../../lib/copy';

test.describe('Admin: Procedimientos — crear, editar, archivar, restaurar', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin');
  });

  test('recorrido completo de un procedimiento de texto', async ({ page }) => {
    const titulo = `E2E Nuevo Procedimiento ${Date.now()}`;
    const tituloEditado = `${titulo} (editado)`;

    // ─── Crear ───────────────────────────────────────────────
    await page.goto('/procedimientos');
    await page.getByRole('link', { name: copy.procedimientos.newButton }).click();
    await expect(page.getByRole('heading', { name: copy.procedimientos.form.crearTitle })).toBeVisible();

    await page.getByRole('textbox', { name: copy.procedimientos.form.titulo, exact: false }).fill(titulo);
    await page.getByRole('textbox', { name: copy.procedimientos.form.contenidoTexto, exact: false }).fill('Contenido de prueba e2e.\n\n## Sección\n\nTexto.');
    await page.getByRole('button', { name: copy.procedimientos.form.guardar, exact: true }).click();

    await expect(page.getByRole('heading', { name: titulo })).toBeVisible();
    await expect(page.getByText('Contenido de prueba e2e.', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sección', level: 2 })).toBeVisible();

    // ─── Editar ──────────────────────────────────────────────
    await page.goto('/procedimientos');
    const row = page.getByRole('row', { name: new RegExp(titulo) });
    await row.getByRole('link', { name: copy.procedimientos.editButton, exact: true }).click();
    await expect(page.getByRole('heading', { name: copy.procedimientos.form.editarTitle })).toBeVisible();

    const tituloInput = page.getByRole('textbox', { name: copy.procedimientos.form.titulo, exact: false });
    await tituloInput.fill(tituloEditado);
    await page.getByRole('button', { name: copy.procedimientos.form.guardar, exact: true }).click();

    await expect(page.getByRole('heading', { name: tituloEditado })).toBeVisible();

    // ─── Archivar ────────────────────────────────────────────
    await page.goto('/procedimientos');
    const rowEditado = page.getByRole('row', { name: new RegExp(tituloEditado.replace(/[()]/g, '\\$&')) });
    await rowEditado.getByRole('button', { name: copy.procedimientos.archiveButton, exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: copy.procedimientos.confirmArchivar.title })).toBeVisible();
    await dialog.getByRole('button', { name: copy.procedimientos.confirmArchivar.confirm, exact: true }).click();

    // Desaparece del listado por default (solo vigentes).
    await expect(page.getByRole('row', { name: new RegExp(tituloEditado.replace(/[()]/g, '\\$&')) })).toHaveCount(0);

    // Con "mostrar archivados" reaparece, etiquetado.
    await page.getByLabel(copy.procedimientos.search.mostrarArchivados, { exact: true }).check();
    const rowArchivado = page.getByRole('row', { name: new RegExp(tituloEditado.replace(/[()]/g, '\\$&')) });
    await expect(rowArchivado).toBeVisible();
    await expect(rowArchivado.getByText(copy.status.archivado, { exact: true })).toBeVisible();

    // ─── Restaurar ───────────────────────────────────────────
    await rowArchivado.getByRole('button', { name: copy.procedimientos.restoreButton, exact: true }).click();
    const restoreDialog = page.getByRole('dialog');
    await expect(restoreDialog.getByRole('heading', { name: copy.procedimientos.confirmRestaurar.title })).toBeVisible();
    await restoreDialog.getByRole('button', { name: copy.procedimientos.confirmRestaurar.confirm, exact: true }).click();

    await page.getByLabel(copy.procedimientos.search.mostrarArchivados, { exact: true }).uncheck();
    await expect(page.getByRole('row', { name: new RegExp(tituloEditado.replace(/[()]/g, '\\$&')) })).toBeVisible();
  });
});

test.describe('Empleado: Procedimientos — ve y busca, sin acciones de admin ni archivados', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'empleado');
  });

  test('ve el procedimiento sembrado vigente, no ve el archivado ni acciones de admin', async ({ page }) => {
    await page.goto('/procedimientos');

    await expect(page.getByRole('link', { name: copy.procedimientos.newButton })).toHaveCount(0);
    await expect(page.getByLabel(copy.procedimientos.search.mostrarArchivados, { exact: true })).toHaveCount(0);

    await expect(page.getByRole('link', { name: 'E2E Procedimiento Vigente', exact: true })).toBeVisible();
    await expect(page.getByText('E2E Procedimiento Archivado')).toHaveCount(0);

    const row = page.getByRole('row', { name: /E2E Procedimiento Vigente/ });
    await expect(row.getByRole('link', { name: copy.procedimientos.editButton, exact: true })).toHaveCount(0);
    await expect(row.getByRole('button', { name: copy.procedimientos.archiveButton, exact: true })).toHaveCount(0);

    // Búsqueda server-side por categoría: el vigente sigue apareciendo, el
    // archivado sigue sin poder verse ni por búsqueda directa de su título.
    await page.getByPlaceholder(copy.procedimientos.search.placeholder).fill('E2E Procedimiento Archivado');
    await page.waitForURL(/q=/);
    await expect(page.getByText('E2E Procedimiento Archivado')).toHaveCount(0);
    await expect(page.getByText(copy.procedimientos.emptyState.noAdminSinResultados)).toBeVisible();

    await page.getByPlaceholder(copy.procedimientos.search.placeholder).fill('E2E Seguridad');
    await page.waitForURL(/q=E2E/);
    await expect(page.getByRole('link', { name: 'E2E Procedimiento Vigente', exact: true })).toBeVisible();
  });

  test('puede abrir el procedimiento vigente y ver su contenido', async ({ page }) => {
    await page.goto('/procedimientos');
    await page.getByRole('link', { name: 'E2E Procedimiento Vigente', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'E2E Procedimiento Vigente' })).toBeVisible();
    await expect(page.getByText('Contenido de prueba del procedimiento vigente sembrado', { exact: false })).toBeVisible();
  });
});
