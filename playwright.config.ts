import { defineConfig, devices } from '@playwright/test';

// FB-F4-11: cablea Playwright a CI contra el stack efímero (Supabase local +
// la app Next servida como en prod). Chromium-only en este pass — el bug de
// interacción dirigido (<dialog>.showModal()/inertización) es de Chromium;
// Firefox/WebKit quedan para un pass posterior. Retries mínimos (no 2): el
// objetivo es determinismo, no enmascarar flakes reintentando.
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // En CI: build+start (paridad con prod, sirve la app ya buildeada con
    // las env vars del Supabase local horneadas en el bundle cliente). En
    // dev local: `next dev` de siempre, para iterar rápido.
    command: isCI ? 'npm run build && npm run start' : 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
