// FB-F6-01 — Ítem de sidebar "Inventario": visible solo para admin, placeholder
// (mismo comportamiento que Rendición de Gastos hoy — no navega a ningún lado).
// El cableado del destino externo real es FB-F6-02.
import { test, expect } from '@playwright/test';
import { login } from './helpers';
import { copy } from '../../lib/copy';

test.describe('Sidebar: visibilidad de "Inventario" por rol', () => {
  test('admin ve "Inventario" y el click no navega', async ({ page }) => {
    await login(page, 'admin');
    const link = page.getByRole('link', { name: copy.nav.inventario, exact: true });
    await expect(link).toBeVisible();

    await link.click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('supervisor NO ve "Inventario"', async ({ page }) => {
    await login(page, 'supervisor');
    await expect(page.getByRole('link', { name: copy.nav.inventario, exact: true })).toHaveCount(0);
  });

  test('empleado NO ve "Inventario"', async ({ page }) => {
    await login(page, 'empleado');
    await expect(page.getByRole('link', { name: copy.nav.inventario, exact: true })).toHaveCount(0);
  });
});
