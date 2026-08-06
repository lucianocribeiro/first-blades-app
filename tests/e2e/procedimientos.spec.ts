// FB-F5-06/FB-F5-07 — Procedimientos / Políticas: un recorrido por rol.
//
// Admin: crea un procedimiento de texto, lo edita, lo archiva y lo
// restaura (recorrido principal) + un segundo test con el cruce real de
// archivo (subida → signed URL → reemplazo → borrado del anterior,
// FB-F5-AUD-05 Hallazgo 4 — la validación de tipo/tamaño en sí ya está
// cubierta del lado del server en tests/unit/procedimientos-storage.test.ts
// y tests/unit/procedimientos-actions.test.ts; acá se prueba el cruce
// completo contra Storage real, que nada mockeado puede probar).
//
// Empleado y Supervisor: ven y buscan, pero no tienen acciones de admin, no
// ven los archivados en la lista/búsqueda, y una URL directa a un id
// archivado da 404 (FB-F5-AUD-05 Hallazgo 1 — filtro de aplicación
// superpuesto a la RLS, que ya está probada exhaustivamente contra
// Postgres real en tests/integration/rls.test.ts y
// tests/integration/procedimientos-rpc.test.ts). Acá se prueba que la UI
// respeta ese límite (no muestra ni sirve lo que no debería).
import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { copy } from '../../lib/copy';
import { createAdminClient } from '../../lib/supabase/admin';

// El procedimiento archivado sembrado por seed-e2e.ts (id generado en
// runtime, no fijo) — usado por los tests de URL directa (FB-F5-AUD-05
// Hallazgo 1) sin necesitar sesión de admin para encontrarlo.
async function getSeededArchivedProcedureId(): Promise<string> {
  const { data, error } = await createAdminClient()
    .from('procedures')
    .select('id')
    .eq('titulo', 'E2E Procedimiento Archivado')
    .single();
  if (error || !data) throw new Error(`No se encontró el procedimiento archivado sembrado: ${error?.message}`);
  return data.id;
}

test.describe('Admin: Procedimientos — crear, editar, archivar, restaurar', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin');
  });

  test('recorrido completo de un procedimiento de texto', async ({ page }) => {
    // Deliberadamente NO empieza con "Nuevo procedimiento" — ese es el
    // texto exacto del botón de alta (copy.procedimientos.newButton), y un
    // getByRole no-exact en OTRO test (el de empleado) matchea por
    // substring: un título que arrancara así rompía esa aserción con un
    // falso positivo real (encontrado en CI).
    const titulo = `E2E Manual Temporal ${Date.now()}`;
    const tituloEditado = `${titulo} (editado)`;

    // ─── Crear ───────────────────────────────────────────────
    await page.goto('/procedimientos');
    await page.getByRole('link', { name: copy.procedimientos.newButton, exact: true }).click();
    await expect(page.getByRole('heading', { name: copy.procedimientos.form.crearTitle })).toBeVisible();

    await page.getByRole('textbox', { name: copy.procedimientos.form.titulo, exact: false }).fill(titulo);
    await page.getByRole('textbox', { name: copy.procedimientos.form.contenidoTexto, exact: false }).fill('Contenido de prueba e2e.\n\n## Sección\n\nTexto.');
    await page.getByRole('button', { name: copy.procedimientos.form.guardar, exact: true }).click();

    await expect(page.getByRole('heading', { name: titulo })).toBeVisible();
    await expect(page.getByText('Contenido de prueba e2e.', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sección', level: 2 })).toBeVisible();
    const procedureId = page.url().split('/procedimientos/')[1];

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

    // El admin SÍ puede abrirlo por URL directa aunque esté archivado
    // (FB-F5-AUD-05 Hallazgo 1 — el filtro de aplicación en el detalle es
    // solo para no-admin, ver [id]/page.tsx).
    const archivadoResponse = await page.goto(`/procedimientos/${procedureId}`);
    expect(archivadoResponse?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: tituloEditado })).toBeVisible();
    await page.goto('/procedimientos');

    // Con "mostrar archivados" reaparece, etiquetado. El checkbox está
    // controlado por el query param de la URL (no por estado local) — el
    // cambio se ve recién después de que router.push() resuelve la
    // navegación, así que se usa click() + una assertion con auto-retry
    // (toBeChecked) en vez de check(), que verifica el cambio de estado
    // de forma inmediata y sin reintentos.
    const mostrarArchivadosCheckbox = page.getByLabel(copy.procedimientos.search.mostrarArchivados, { exact: true });
    await mostrarArchivadosCheckbox.click();
    await expect(mostrarArchivadosCheckbox).toBeChecked();
    const rowArchivado = page.getByRole('row', { name: new RegExp(tituloEditado.replace(/[()]/g, '\\$&')) });
    await expect(rowArchivado).toBeVisible();
    await expect(rowArchivado.getByText(copy.status.archivado, { exact: true })).toBeVisible();

    // ─── Restaurar ───────────────────────────────────────────
    await rowArchivado.getByRole('button', { name: copy.procedimientos.restoreButton, exact: true }).click();
    const restoreDialog = page.getByRole('dialog');
    await expect(restoreDialog.getByRole('heading', { name: copy.procedimientos.confirmRestaurar.title })).toBeVisible();
    await restoreDialog.getByRole('button', { name: copy.procedimientos.confirmRestaurar.confirm, exact: true }).click();

    await mostrarArchivadosCheckbox.click();
    await expect(mostrarArchivadosCheckbox).not.toBeChecked();
    await expect(page.getByRole('row', { name: new RegExp(tituloEditado.replace(/[()]/g, '\\$&')) })).toBeVisible();

    // Cleanup: no dejar el procedimiento de este test colgado en la base —
    // afecta reruns y a otros specs que listan/cuentan procedimientos.
    await createAdminClient().from('procedures').delete().eq('titulo', tituloEditado);
  });

  // FB-F5-AUD-05 Hallazgo 4: el cruce File → Server Action → Storage →
  // signed URL es exactamente la forma del bug de Fase 4 que un e2e contra
  // build de producción cazó y nada mockeado detectaba (redacción de
  // mensajes de Next en prod). Un solo recorrido, archivo chico (.txt de
  // unos bytes), sin esperas artificiales — el job de e2e ya está lento.
  test('sube un archivo real, el link firmado funciona, y al reemplazarlo el anterior se borra del bucket', async ({ page }) => {
    const titulo = `E2E Archivo Temporal ${Date.now()}`;
    const admin = createAdminClient();

    // ─── Crear con archivo ───────────────────────────────────
    await page.goto('/procedimientos/nuevo');
    await page.getByRole('textbox', { name: copy.procedimientos.form.titulo, exact: false }).fill(titulo);
    await page.getByRole('radio', { name: copy.procedimientos.form.tipoArchivo, exact: true }).check();
    // Locator por id, no por label: "Archivo" es el texto tanto del radio
    // de tipo de contenido como del label del input de archivo — un
    // getByLabel no-exact ahí choca con la misma clase de colisión de
    // substring que ya rompió un test antes en este archivo.
    await page.locator('#procedimiento-archivo').setInputFiles({
      name: 'archivo-e2e-v1.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('contenido e2e v1'),
    });
    await page.getByRole('button', { name: copy.procedimientos.form.guardar, exact: true }).click();

    await expect(page.getByRole('heading', { name: titulo })).toBeVisible();
    const procedureId = page.url().split('/procedimientos/')[1];

    // ─── El link firmado funciona de verdad (no solo que exista) ─────
    const openLink = page.getByRole('link', { name: copy.procedimientos.openFile, exact: true });
    await expect(openLink).toBeVisible();
    const signedUrl = await openLink.getAttribute('href');
    expect(signedUrl).toBeTruthy();
    const signedResponse = await page.request.get(signedUrl!);
    expect(signedResponse.ok()).toBe(true);

    const { data: rowV1 } = await admin.from('procedures').select('file_path').eq('id', procedureId).single();
    const oldPath = rowV1?.file_path;
    expect(oldPath).toBeTruthy();

    // ─── Editar reemplazando el archivo ──────────────────────
    await page.goto(`/procedimientos/${procedureId}/editar`);
    await page.locator('#procedimiento-archivo').setInputFiles({
      name: 'archivo-e2e-v2.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('contenido e2e v2, mas largo que el anterior'),
    });
    await page.getByRole('button', { name: copy.procedimientos.form.guardar, exact: true }).click();
    await expect(page.getByRole('heading', { name: titulo })).toBeVisible();

    const { data: rowV2 } = await admin.from('procedures').select('file_path').eq('id', procedureId).single();
    const newPath = rowV2?.file_path;
    expect(newPath).toBeTruthy();
    expect(newPath).not.toBe(oldPath);

    // El archivo anterior se borró del bucket — vía la API real de
    // Storage (storage.protect_delete() bloquea un DELETE SQL directo
    // sobre storage.objects, así que no hay otra forma de verificarlo).
    const { error: downloadOldError } = await admin.storage.from('procedimientos').download(oldPath!);
    expect(downloadOldError).toBeTruthy();

    // ─── Cleanup ──────────────────────────────────────────────
    await admin.storage.from('procedimientos').remove([newPath!]);
    await admin.from('procedures').delete().eq('id', procedureId);
  });
});

test.describe('Empleado: Procedimientos — ve y busca, sin acciones de admin ni archivados', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'empleado');
  });

  test('ve el procedimiento sembrado vigente, no ve el archivado ni acciones de admin', async ({ page }) => {
    await page.goto('/procedimientos');

    await expect(page.getByRole('link', { name: copy.procedimientos.newButton, exact: true })).toHaveCount(0);
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

  test('URL directa a un archivado: 404, no un procedimiento en blanco (FB-F5-AUD-05 Hallazgo 1)', async ({ page }) => {
    const archivedId = await getSeededArchivedProcedureId();
    const response = await page.goto(`/procedimientos/${archivedId}`);
    expect(response?.status()).toBe(404);
  });
});

test.describe('Supervisor: Procedimientos — mismo límite que Empleado sobre archivados', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'supervisor');
  });

  test('URL directa a un archivado: 404 (FB-F5-AUD-05 Hallazgo 1)', async ({ page }) => {
    const archivedId = await getSeededArchivedProcedureId();
    const response = await page.goto(`/procedimientos/${archivedId}`);
    expect(response?.status()).toBe(404);
  });
});
