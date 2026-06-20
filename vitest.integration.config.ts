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
    // Integración: un único proceso (singleFork) Y archivos en serie
    // (fileParallelism:false). Ambos son necesarios: singleFork solo
    // garantiza un worker; fileParallelism:false garantiza que cada
    // archivo termine entero antes de que arranque el siguiente, para
    // que el TRUNCATE de un setupTestDb() no pise el seed de otro archivo.
    fileParallelism: false,
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
