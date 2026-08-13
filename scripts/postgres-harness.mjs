import { spawn } from 'node:child_process';
import { glob, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const defaultRepositoryRoot = resolve(import.meta.dirname, '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function usage(writeError) {
  writeError('Usage: node scripts/postgres-harness.mjs <package-check|package-migrate|package-rollback|package-verify|package-integration>');
}

function createPaths(repositoryRoot) {
  const databasePackageRoot = resolve(repositoryRoot, 'packages', 'db');
  const distributionRoot = resolve(databasePackageRoot, 'dist');

  return {
    databasePackageRoot,
    distributionRoot,
    migrationRunner: resolve(distributionRoot, 'migration-runner.js'),
    migrations: resolve(distributionRoot, 'migrations'),
    migrationsIndex: resolve(distributionRoot, 'migrations', 'index.js'),
    packageIndex: resolve(distributionRoot, 'index.js'),
    postgresFoundation: resolve(distributionRoot, 'postgres-foundation.js'),
    typeIndex: resolve(distributionRoot, 'types', 'index.d.ts'),
    typeMigrationsIndex: resolve(distributionRoot, 'types', 'migrations', 'index.d.ts'),
  };
}

async function pathHasType(path, type) {
  try {
    const status = await stat(path);
    return type === 'file' ? status.isFile() : status.isDirectory();
  } catch {
    return false;
  }
}

async function requirePath(path, type, description, context) {
  if (await pathHasType(path, type)) {
    return true;
  }

  context.writeError(`Required built ${description} is missing: ${path}`);
  return false;
}

function requireDatabaseUrl(context) {
  if (context.environment.DATABASE_URL) {
    return true;
  }

  context.writeError('DATABASE_URL must be set. Start local PostgreSQL with Docker Compose, then export DATABASE_URL.');
  return false;
}

function runNpm(arguments_, context) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(npmCommand, arguments_, {
      cwd: context.repositoryRoot,
      env: context.environment,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`npm exited from signal ${signal}`));
        return;
      }

      resolvePromise(code ?? 1);
    });
  });
}

async function importBuiltModule(path) {
  return import(pathToFileURL(path).href);
}

async function findMigrationFiles(migrationGlob) {
  const migrationFiles = [];
  for await (const path of glob(migrationGlob)) {
    migrationFiles.push(resolve(path));
  }

  return migrationFiles.sort((left, right) => left.localeCompare(right));
}

async function checkBuiltMigrationPackage(context) {
  const paths = createPaths(context.repositoryRoot);
  const requiredPaths = [
    [paths.packageIndex, 'file', 'package entry point'],
    [paths.migrations, 'directory', 'migration directory'],
    [paths.migrationsIndex, 'file', 'migration discovery module'],
    [paths.migrationRunner, 'file', 'migration runner module'],
    [paths.typeIndex, 'file', 'package declaration entry point'],
    [paths.typeMigrationsIndex, 'file', 'migration declaration entry point'],
  ];

  for (const [path, type, description] of requiredPaths) {
    if (!(await requirePath(path, type, description, context))) {
      return undefined;
    }
  }

  let migrationsModule;
  try {
    migrationsModule = await importBuiltModule(paths.migrationsIndex);
  } catch (error) {
    context.writeError(`Unable to load built migration discovery module: ${error}`);
    return undefined;
  }

  if (typeof migrationsModule.discoverMigrations !== 'function' || typeof migrationsModule.migrationGlob !== 'string') {
    context.writeError('Built migration discovery module must export discoverMigrations and migrationGlob.');
    return undefined;
  }

  const migrationFiles = await findMigrationFiles(migrationsModule.migrationGlob);
  if (migrationFiles.length === 0) {
    context.writeError(`Built migration glob matched no runtime migrations: ${migrationsModule.migrationGlob}`);
    return undefined;
  }

  for (const migrationPath of migrationFiles) {
    if (extname(migrationPath) !== '.js') {
      context.writeError(`Built migration glob must not load non-JavaScript artifacts: ${migrationPath}`);
      return undefined;
    }

    const declarationPath = migrationPath.replace(/\.js$/, '.d.ts');
    if (await pathHasType(declarationPath, 'file')) {
      context.writeError(`Built declaration file must not be colocated with runtime migration: ${declarationPath}`);
      return undefined;
    }

    try {
      await importBuiltModule(migrationPath);
    } catch (error) {
      context.writeError(`Unable to load built migration module ${migrationPath}: ${error}`);
      return undefined;
    }
  }

  let migrations;
  try {
    migrations = await migrationsModule.discoverMigrations();
  } catch (error) {
    context.writeError(`Unable to discover built migrations: ${error}`);
    return undefined;
  }

  if (!Array.isArray(migrations) || migrations.length === 0) {
    context.writeError('Built migration discovery must return at least one migration.');
    return undefined;
  }

  for (const migration of migrations) {
    if (
      !migration
      || typeof migration.id !== 'string'
      || migration.id.length === 0
      || typeof migration.up !== 'string'
      || migration.up.trim().length === 0
      || typeof migration.down !== 'string'
      || migration.down.trim().length === 0
    ) {
      context.writeError('Built migration discovery returned an invalid reversible migration.');
      return undefined;
    }
  }

  return { migrations, paths };
}

async function runPackageCheck(context) {
  const checked = await checkBuiltMigrationPackage(context);
  if (!checked) {
    return 1;
  }

  context.writeOutput(`Built PostgreSQL migration package check passed (${checked.migrations.length} migration${checked.migrations.length === 1 ? '' : 's'}).`);
  return 0;
}

async function runMigration(direction, context) {
  const checked = await checkBuiltMigrationPackage(context);
  if (!checked || !requireDatabaseUrl(context)) {
    return 1;
  }

  let migrationRunner;
  try {
    migrationRunner = await importBuiltModule(checked.paths.migrationRunner);
  } catch (error) {
    context.writeError(`Unable to load built migration runner: ${error}`);
    return 1;
  }

  if (typeof migrationRunner.runDatabaseMigrations !== 'function') {
    context.writeError('Built migration runner must export runDatabaseMigrations.');
    return 1;
  }

  try {
    await migrationRunner.runDatabaseMigrations({
      databaseUrl: context.environment.DATABASE_URL,
      direction,
      ...(direction === 'down' ? { count: 1 } : {}),
    });
    return 0;
  } catch (error) {
    context.writeError(`PostgreSQL migration ${direction} failed: ${error}`);
    return 1;
  }
}

async function runVerify(context) {
  const checked = await checkBuiltMigrationPackage(context);
  if (!checked || !requireDatabaseUrl(context)) {
    return 1;
  }

  if (!(await requirePath(checked.paths.postgresFoundation, 'file', 'foundation verifier module', context))) {
    return 1;
  }

  let foundation;
  try {
    foundation = await importBuiltModule(checked.paths.postgresFoundation);
  } catch (error) {
    context.writeError(`Unable to load built foundation verifier: ${error}`);
    return 1;
  }

  if (typeof foundation.verifyPostgresFoundation !== 'function') {
    context.writeError('Built foundation verifier must export verifyPostgresFoundation.');
    return 1;
  }

  try {
    const result = await foundation.verifyPostgresFoundation(context.environment.DATABASE_URL);
    context.writeOutput(`Built PostgreSQL foundation verifier passed (${result.appliedMigrationIds.length} migration${result.appliedMigrationIds.length === 1 ? '' : 's'}).`);
    return 0;
  } catch (error) {
    context.writeError(`Built PostgreSQL foundation verification failed: ${error}`);
    return 1;
  }
}

async function runIntegration(context) {
  if (!(await checkBuiltMigrationPackage(context)) || !requireDatabaseUrl(context)) {
    return 1;
  }

  return context.runNpm([
    'exec',
    '--',
    'vitest',
    'run',
    '--config',
    'packages/db/vitest.integration.config.ts',
  ], context);
}

function createContext(options) {
  const repositoryRoot = options.repositoryRoot ?? defaultRepositoryRoot;
  return {
    environment: options.environment ?? process.env,
    repositoryRoot,
    runNpm: options.runNpm ?? runNpm,
    writeError: options.writeError ?? console.error,
    writeOutput: options.writeOutput ?? console.log,
  };
}

export async function runPostgresHarness(command, options = {}) {
  const context = createContext(options);

  switch (command) {
    case 'package-check':
      return runPackageCheck(context);
    case 'package-migrate':
      return runMigration('up', context);
    case 'package-rollback':
      return runMigration('down', context);
    case 'package-verify':
      return runVerify(context);
    case 'package-integration':
      return runIntegration(context);
    default:
      usage(context.writeError);
      return 2;
  }
}

const entryPoint = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (entryPoint === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await runPostgresHarness(process.argv[2]);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
