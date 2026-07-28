// FB-F4-11 — Login de los 3 roles vía el form real (email+password),
// contra el stack efímero de CI (Supabase local, sembrado por seed-e2e).
import { test, expect } from '@playwright/test';
import { login, exactLabel } from './helpers';
import { copy } from '../../lib/copy';

test.describe('Login por rol', () => {
  test('admin inicia sesión y llega al dashboard', async ({ page }) => {
    await login(page, 'admin');
    await expect(page.getByText(copy.pages.dashboard.welcome)).toBeVisible();
  });

  test('supervisor inicia sesión y llega al dashboard', async ({ page }) => {
    await login(page, 'supervisor');
    await expect(page.getByText(copy.pages.dashboard.welcome)).toBeVisible();
  });

  test('empleado inicia sesión y llega al dashboard', async ({ page }) => {
    await login(page, 'empleado');
    await expect(page.getByText(copy.pages.dashboard.welcome)).toBeVisible();
  });

  test('credenciales inválidas muestran el error amigable, sin redirigir', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(exactLabel(copy.auth.login.email)).fill('no-existe@firstblades.test');
    await page.getByLabel(exactLabel(copy.auth.login.password)).fill('contraseña-incorrecta');
    await page.getByRole('button', { name: copy.auth.login.submit, exact: true }).click();

    await expect(page.getByText(copy.auth.login.invalidCredentials)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
