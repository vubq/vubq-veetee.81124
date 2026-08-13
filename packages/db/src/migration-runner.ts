import { runner } from 'node-pg-migrate';

import { migrationGlob } from './migrations/index.js';

export interface MigrationRunOptions {
  databaseUrl: string;
  schema?: string;
  direction?: 'up' | 'down';
  count?: number;
}

export async function runDatabaseMigrations({
  databaseUrl,
  schema,
  direction = 'up',
  count,
}: MigrationRunOptions): Promise<readonly string[]> {
  const applied = await runner({
    databaseUrl,
    dir: migrationGlob,
    direction,
    ...(schema === undefined
      ? {}
      : {
          schema,
          migrationsSchema: schema,
          createSchema: true,
          createMigrationsSchema: true,
        }),
    ...(count === undefined ? {} : { count }),
    migrationsTable: 'schema_migrations',
    singleTransaction: true,
    checkOrder: true,
    useGlob: true,
    ignorePattern: '**/*.d.ts',
    advisoryLockMode: 'wait',
    log: () => undefined,
  });

  return applied.map(({ name }) => name);
}
