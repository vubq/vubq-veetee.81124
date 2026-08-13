#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const entrypoint = new URL('../dist/index.js', import.meta.url);

if (!existsSync(fileURLToPath(entrypoint))) {
  const require = createRequire(import.meta.url);
  const tsc = require.resolve('typescript/bin/tsc');
  const project = fileURLToPath(new URL('../tsconfig.build.json', import.meta.url));
  const build = spawnSync(process.execPath, [tsc, '-b', project], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    stdio: 'inherit',
  });
  if (build.error !== undefined) {
    throw build.error;
  }
  if (build.status !== 0) {
    process.exitCode = build.status ?? 1;
  }
}

if (process.exitCode === undefined) {
  process.argv[1] = fileURLToPath(entrypoint);
  await import(entrypoint.href);
}
