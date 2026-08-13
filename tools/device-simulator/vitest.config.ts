import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const contractSource = fileURLToPath(
  new URL('../../packages/protocol-contracts/src/index.ts', import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      '@veetee/protocol-contracts': contractSource,
    },
  },
});
