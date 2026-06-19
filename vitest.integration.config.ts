import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globalSetup: ['./tests/integration/global-setup.ts'],
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Los tests de integración corren en serie para no pisarse en la BD
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
    },
  },
});
