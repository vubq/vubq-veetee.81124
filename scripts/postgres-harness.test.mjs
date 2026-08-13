import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { runPostgresHarness } from './postgres-harness.mjs';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

async function createRepositoryFixture() {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'veetee-postgres-harness-'));
  const databaseRoot = join(fixtureRoot, 'packages', 'db');
  const sourceRoot = join(repositoryRoot, 'packages', 'db');

  await cp(join(sourceRoot, 'dist'), join(databaseRoot, 'dist'), { recursive: true });
  return fixtureRoot;
}

async function withRepositoryFixture(assertion) {
  const fixtureRoot = await createRepositoryFixture();

  try {
    await assertion(fixtureRoot);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

function silentOptions(repositoryRootOverride, environment = {}) {
  return {
    environment,
    repositoryRoot: repositoryRootOverride,
    writeError: () => undefined,
    writeOutput: () => undefined,
  };
}

test('PostgreSQL harness documents an unknown command with a nonzero result', async () => {
  assert.equal(await runPostgresHarness('unknown', silentOptions(repositoryRoot)), 2);
});

test('PostgreSQL harness validates compiled migration discovery offline', async () => {
  assert.equal(await runPostgresHarness('package-check', silentOptions(repositoryRoot)), 0);
});

test('PostgreSQL harness fails closed when the built migration package is absent', async () => {
  await withRepositoryFixture(async (fixtureRoot) => {
    await rm(join(fixtureRoot, 'packages', 'db', 'dist', 'migrations', 'index.js'));

    assert.equal(await runPostgresHarness('package-check', silentOptions(fixtureRoot)), 1);
  });
});

test('PostgreSQL harness rejects declaration files alongside built migrations', async () => {
  await withRepositoryFixture(async (fixtureRoot) => {
    const migrationsDirectory = join(fixtureRoot, 'packages', 'db', 'dist', 'migrations');
    const migrationFile = (await readdir(migrationsDirectory)).find((name) => /^\d{4}_.+\.js$/.test(name));
    assert.ok(migrationFile, 'fixture must contain a runtime migration');

    const declarationPath = join(migrationsDirectory, migrationFile.replace(/\.js$/, '.d.ts'));
    await writeFile(declarationPath, 'export {};\n', 'utf8');

    assert.equal(await runPostgresHarness('package-check', silentOptions(fixtureRoot)), 1);
  });
});

test('PostgreSQL harness fails closed when built migration discovery matches no runtime migration', async () => {
  await withRepositoryFixture(async (fixtureRoot) => {
    const manifestPath = join(fixtureRoot, 'packages', 'db', 'dist', 'migration-manifest.js');
    const content = await readFile(manifestPath, 'utf8');
    await writeFile(
      manifestPath,
      content.replace('[0-9][0-9][0-9][0-9]_*.${migrationExtension}', '[9][9][9][9]_*.${migrationExtension}'),
      'utf8',
    );

    assert.equal(await runPostgresHarness('package-check', silentOptions(fixtureRoot)), 1);
  });
});

test('PostgreSQL harness requires DATABASE_URL after built package validation', async () => {
  assert.equal(await runPostgresHarness('package-migrate', silentOptions(repositoryRoot)), 1);
  assert.equal(await runPostgresHarness('package-rollback', silentOptions(repositoryRoot)), 1);
  assert.equal(await runPostgresHarness('package-verify', silentOptions(repositoryRoot)), 1);
  assert.equal(await runPostgresHarness('package-integration', silentOptions(repositoryRoot)), 1);
});

test('PostgreSQL harness invokes only the dedicated integration configuration', async () => {
  let arguments_;
  const result = await runPostgresHarness('package-integration', {
    ...silentOptions(repositoryRoot, { DATABASE_URL: 'postgresql://integration-only.test/veetee' }),
    runNpm: async (receivedArguments) => {
      arguments_ = receivedArguments;
      return 0;
    },
  });

  assert.equal(result, 0);
  assert.deepEqual(arguments_, [
    'exec',
    '--',
    'vitest',
    'run',
    '--config',
    'packages/db/vitest.integration.config.ts',
  ]);
});

test('database package and root scripts expose built-artifact commands', async () => {
  const [databasePackage, rootPackage] = await Promise.all([
    readFile(new URL('../packages/db/package.json', import.meta.url), 'utf8').then(JSON.parse),
    readFile(new URL('../package.json', import.meta.url), 'utf8').then(JSON.parse),
  ]);

  for (const script of ['migration:check', 'migrate', 'rollback', 'verify', 'test:integration']) {
    assert.match(databasePackage.scripts[script], /postgres-harness\.mjs package-/);
  }

  for (const script of ['db:check', 'db:migrate', 'db:rollback', 'db:verify', 'test:integration:postgres']) {
    assert.match(rootPackage.scripts[script], /npm run build --workspace @veetee\/db/);
  }

  assert.equal(databasePackage.exports['.'].types, './dist/types/index.d.ts');
});
