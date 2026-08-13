import { describe, expect, it, vi } from 'vitest';

import { createDatabase, createDatabaseClient } from '../src/client.js';

describe('createDatabase', () => {
  it('maps package options to an owned PostgreSQL pool', async () => {
    const database = createDatabase({
      connectionString: 'postgresql://veetee.test/database',
      applicationName: 'db-contract-test',
      maxConnections: 7,
    });

    expect(database.pool.options.connectionString).toBe('postgresql://veetee.test/database');
    expect(database.pool.options.application_name).toBe('db-contract-test');
    expect(database.pool.options.max).toBe(7);

    const end = vi.spyOn(database.pool, 'end').mockResolvedValue();
    await database.close();
    expect(end).toHaveBeenCalledOnce();
  });

  it('does not end a caller-owned pool', async () => {
    const owner = createDatabase({ connectionString: 'postgresql://veetee.test/owner' });
    const end = vi.spyOn(owner.pool, 'end').mockResolvedValue();
    const borrowed = createDatabase({ pool: owner.pool });

    await borrowed.close();
    expect(end).not.toHaveBeenCalled();

    await owner.close();
    expect(end).toHaveBeenCalledOnce();
  });

  it('rejects ambiguous or invalid pool configuration', () => {
    const owner = createDatabase({ connectionString: 'postgresql://veetee.test/owner' });

    expect(() => createDatabase({
      connectionString: 'postgresql://veetee.test/another',
      pool: owner.pool,
    })).toThrow('either connectionString or pool');
    expect(() => createDatabase({ maxConnections: 0 })).toThrow('positive integer');
  });

  it('keeps the string compatibility alias', () => {
    const database = createDatabaseClient('postgresql://veetee.test/compatibility');
    expect(database.pool.options.connectionString).toBe('postgresql://veetee.test/compatibility');
  });
});
