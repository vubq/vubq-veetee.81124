import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface CreateDatabaseOptions {
  connectionString?: string;
  pool?: Pool;
  applicationName?: string;
  maxConnections?: number;
}

export interface DatabaseClient {
  db: Database;
  pool: Pool;
  close: () => Promise<void>;
}

/** @deprecated Use CreateDatabaseOptions instead. */
export type DatabaseClientOptions = CreateDatabaseOptions;

function validateOptions({ connectionString, pool, maxConnections }: CreateDatabaseOptions): void {
  if (connectionString !== undefined && pool !== undefined) {
    throw new TypeError('createDatabase accepts either connectionString or pool, not both');
  }

  if (maxConnections !== undefined && (!Number.isInteger(maxConnections) || maxConnections <= 0)) {
    throw new TypeError('maxConnections must be a positive integer');
  }
}

/**
 * Creates a database facade. Pools supplied by callers remain caller-owned and
 * are intentionally not ended by close().
 */
export function createDatabase(options: CreateDatabaseOptions = {}): DatabaseClient {
  validateOptions(options);

  const ownsPool = options.pool === undefined;
  const pool = options.pool ?? new Pool({
    ...(options.connectionString === undefined ? {} : { connectionString: options.connectionString }),
    ...(options.applicationName === undefined ? {} : { application_name: options.applicationName }),
    ...(options.maxConnections === undefined ? {} : { max: options.maxConnections }),
  });
  const db = drizzle(pool, { schema });

  return {
    db,
    pool,
    close: async () => {
      if (ownsPool) {
        await pool.end();
      }
    },
  };
}

/** @deprecated Use createDatabase({ connectionString }) instead. */
export function createDatabaseClient(connectionString: string): DatabaseClient;
/** @deprecated Use createDatabase(options) instead. */
export function createDatabaseClient(options: CreateDatabaseOptions): DatabaseClient;
export function createDatabaseClient(options: CreateDatabaseOptions | string): DatabaseClient {
  return createDatabase(typeof options === 'string' ? { connectionString: options } : options);
}

export async function withDatabaseTransaction<T>(
  client: DatabaseClient,
  callback: (transaction: Parameters<Parameters<Database['transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return client.db.transaction(callback);
}
