// FB-F5-08 — Gestión de Usuarios: reseteo de contraseña, baja con motivo y
// fecha, y el gate de acceso (requireAuth() solo deja entrar a
// status='activo'). Un solo recorrido con dos contextos de browser: el
// admin y el usuario de prueba que crea, para poder ejercer el caso real
// "alguien inactivado mientras seguía navegando" — algo que no se puede
// simular con mocks (necesita una revocación de sesión real contra
// Supabase Auth, ver lib/auth.ts).
import { test, expect } from '@playwright/test';
import { login, exactLabel } from './helpers';
import { copy } from '../../lib/copy';

test.describe('Admin: Gestión de Usuarios — reseteo, baja y gate de acceso', () => {
  test('resetea contraseña, da de baja con motivo/fecha, y corta la sesión de quien ya estaba navegando', async ({ page, browser }) => {
    test.setTimeout(90_000);

    await login(page, 'admin');

    const nombre = `E2E FB508 Gate ${Date.now()}`;
    const email = `e2e-fb508-${Date.now()}@firstblades.test`;
    const initialPassword = 'Contrasena1';
    const newPassword = 'ContrasenaDos2';

    // ─── Crear usuario de prueba ────────────────────────────────
    await page.goto('/gestion-usuarios');
    await page.getByRole('button', { name: copy.gestionUsuarios.createUser, exact: true }).click();
    await expect(page.getByRole('heading', { name: copy.gestionUsuarios.createUser })).toBeVisible();

    await page.getByLabel(exactLabel(copy.gestionUsuarios.form.nombre)).fill(nombre);
    await page.getByLabel(exactLabel(copy.gestionUsuarios.form.email)).fill(email);
    await page.getByLabel(exactLabel(copy.gestionUsuarios.form.password)).fill(initialPassword);
    await page.getByRole('button', { name: copy.general.create, exact: true }).click();

    const row = page.getByRole('row', { name: new RegExp(nombre) });
    await expect(row).toBeVisible();

    // ─── Admin restablece la contraseña ─────────────────────────
    // ANTES de que el usuario inicie sesión por primera vez: Supabase Auth
    // revoca del lado del servidor cualquier sesión existente al cambiar la
    // contraseña vía el admin API (mismo signOut de scope 'global' que usa
    // el gate). Si el empleado ya hubiera iniciado sesión con la contraseña
    // inicial ANTES de este paso, esa sesión quedaría cortada por el
    // reseteo — no por el gate de status que este test quiere probar más
    // abajo. Por eso el login "de verdad" (la sesión que se deja abierta
    // para el chequeo del gate) pasa recién DESPUÉS del reseteo.
    await row.getByRole('button', { name: copy.gestionUsuarios.resetPassword.action, exact: true }).click();
    await expect(page.getByRole('heading', { name: copy.gestionUsuarios.resetPassword.title })).toBeVisible();
    await page.getByLabel(exactLabel(copy.gestionUsuarios.resetPassword.passwordLabel)).fill(newPassword);
    await page.getByRole('button', { name: copy.gestionUsuarios.resetPassword.confirm, exact: true }).click();
    await expect(page.getByRole('heading', { name: copy.gestionUsuarios.resetPassword.title })).toHaveCount(0);

    // La contraseña vieja deja de servir (contexto descartable, no se deja
    // abierto — solo confirma el rechazo).
    const oldPasswordContext = await browser.newContext();
    const oldPasswordPage = await oldPasswordContext.newPage();
    await oldPasswordPage.goto('/login');
    await oldPasswordPage.getByLabel(exactLabel(copy.auth.login.email)).fill(email);
    await oldPasswordPage.getByLabel(exactLabel(copy.auth.login.password)).fill(initialPassword);
    await oldPasswordPage.getByRole('button', { name: copy.auth.login.submit, exact: true }).click();
    await expect(oldPasswordPage.getByText(copy.auth.login.invalidCredentials)).toBeVisible();
    await oldPasswordContext.close();

    // ─── El usuario inicia sesión con la contraseña nueva y se queda
    // "navegando" — esta es la sesión que el gate va a cortar más abajo.
    const employeeContext = await browser.newContext();
    const employeePage = await employeeContext.newPage();
    await employeePage.goto('/login');
    await employeePage.getByLabel(exactLabel(copy.auth.login.email)).fill(email);
    await employeePage.getByLabel(exactLabel(copy.auth.login.password)).fill(newPassword);
    await employeePage.getByRole('button', { name: copy.auth.login.submit, exact: true }).click();
    await expect(employeePage).toHaveURL(/\/dashboard/);

    // ─── Admin da de baja con motivo y fecha (default hoy) ──────
    await row.getByRole('button', { name: copy.gestionUsuarios.deactivate, exact: true }).click();
    await expect(page.getByRole('heading', { name: copy.gestionUsuarios.bajaModal.title })).toBeVisible();

    const motivo = 'Renuncia — prueba e2e FB-F5-08';
    await page.getByLabel(exactLabel(copy.gestionUsuarios.bajaModal.motivoLabel)).fill(motivo);
    const fechaInput = page.getByLabel(exactLabel(copy.gestionUsuarios.bajaModal.fechaLabel));
    await expect(fechaInput).not.toHaveValue(''); // hoy por defecto, sin tocarlo

    await page.getByRole('button', { name: copy.gestionUsuarios.bajaModal.confirm, exact: true }).click();
    await expect(page.getByRole('heading', { name: copy.gestionUsuarios.bajaModal.title })).toHaveCount(0);

    // Motivo y fecha quedan consultables en la ficha (modal de edición)
    await row.getByRole('button', { name: copy.general.edit, exact: true }).click();
    await expect(page.getByText(motivo)).toBeVisible();
    await page.getByRole('button', { name: copy.general.cancel, exact: true }).click();

    // ─── Gate de acceso: la sesión YA abierta se corta en el siguiente
    // request — no sigue "adentro" con la sesión vieja, y no queda un loop
    // /login↔/dashboard (requireAuth() revoca la sesión server-side antes
    // de redirigir; ver lib/auth.ts).
    await employeePage.goto('/mi-perfil');
    await expect(employeePage).toHaveURL(/\/login/);
    await expect(employeePage.getByText(copy.errors.sessionExpired)).toBeVisible();

    // Tampoco puede volver a entrar con la contraseña (correcta) tras la
    // baja — mismo mensaje genérico que credenciales inválidas, sin
    // revelar que la cuenta existe ni que fue dada de baja.
    await employeePage.getByLabel(exactLabel(copy.auth.login.email)).fill(email);
    await employeePage.getByLabel(exactLabel(copy.auth.login.password)).fill(newPassword);
    await employeePage.getByRole('button', { name: copy.auth.login.submit, exact: true }).click();
    await expect(employeePage).toHaveURL(/\/login/);
    await expect(employeePage.getByText(copy.errors.sessionExpired)).toBeVisible();

    await employeeContext.close();
  });

  test('la validación de contraseña rechaza una débil en el alta', async ({ page }) => {
    await login(page, 'admin');
    await page.goto('/gestion-usuarios');
    await page.getByRole('button', { name: copy.gestionUsuarios.createUser, exact: true }).click();

    await page.getByLabel(exactLabel(copy.gestionUsuarios.form.nombre)).fill(`E2E FB508 Debil ${Date.now()}`);
    await page.getByLabel(exactLabel(copy.gestionUsuarios.form.email)).fill(`e2e-fb508-debil-${Date.now()}@firstblades.test`);
    await page.getByLabel(exactLabel(copy.gestionUsuarios.form.password)).fill('debil');
    await page.getByRole('button', { name: copy.general.create, exact: true }).click();

    await expect(page.getByText(copy.gestionUsuarios.password.tooShort)).toBeVisible();
    // El modal sigue abierto — no se creó el usuario
    await expect(page.getByRole('heading', { name: copy.gestionUsuarios.createUser })).toBeVisible();
  });
});
