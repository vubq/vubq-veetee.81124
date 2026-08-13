import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const integrationTest = databaseUrl === undefined ? it.skip : it;

describe('PostgreSQL foundation integration', () => {
  integrationTest('applies migrations and verifies database invariants (requires DATABASE_URL)', async () => {
    const { verifyPostgresFoundation } = await import('../src/postgres-foundation.js');
    const result = await verifyPostgresFoundation(databaseUrl!);

    expect(result.appliedMigrationIds.length).toBeGreaterThan(0);
    expect(result.invariants).toEqual(expect.arrayContaining([
      'canonical-device-hardware-id-is-unique',
      'one-active-pairing-request-per-device',
      'one-default-provider-binding-per-revision-role',
      'mcp-request-id-is-unique-within-session',
    ]));
  });
});
