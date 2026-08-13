import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: packageRoot,
  test: {
    include: ['test/postgres.integration.test.ts'],
    passWithNoTests: false,
    testTimeout: 30_000,
  },
});
