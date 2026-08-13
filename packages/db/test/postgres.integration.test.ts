import { describe, expect, it } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const integrationTest = databaseUrl === undefined ? it.skip : it;

describe('PostgreSQL foundation integration', () => {
  integrationTest('applies, exercises, rolls back, and reapplies the foundation (requires DATABASE_URL)', async () => {
    const { foundationInvariants, verifyPostgresFoundation } = await import('../src/postgres-foundation.js');
    const result = await verifyPostgresFoundation(databaseUrl!);

    expect(result.appliedMigrationIds).toEqual([
      '0001_access_control',
      '0002_devices_pairing',
      '0003_provider_pipelines',
      '0004_firmware_delivery',
      '0005_conversation_retention',
      '0006_mcp_audit_outbox',
    ]);
    expect(result.invariants).toEqual(foundationInvariants);
    expect(result.invariants).toEqual(expect.arrayContaining([
      'canonical-device-hardware-id-is-unique',
      'client-id-is-non-global',
      'one-live-pairing-request-per-device',
      'pairing-claims-are-transactional',
      'firmware-publication-requires-signed-approved-artifact',
      'firmware-download-tickets-are-device-bound-and-single-use',
      'conversation-session-identity-is-authoritative',
      'conversation-turn-abort-lifecycle-is-coherent',
      'conversation-events-are-metadata-only-and-immutable',
      'mcp-call-identity-is-session-direction-request-attempt',
      'mcp-policy-derives-approval',
      'mcp-terminal-calls-cannot-be-approved',
      'outbox-deliveries-are-mutable',
      'outbox-events-are-immutable',
      'audit-events-are-immutable',
      'migrations-rollback-and-reapply-cleanly',
    ]));
  });
});
