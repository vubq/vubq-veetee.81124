import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { upSql as accessControlUpSql } from '../src/migrations/0001_access_control.js';
import {
  downSql,
  upSql,
} from '../src/migrations/0002_devices_pairing.js';

const databaseUrl = process.env.DATABASE_URL;
const integrationTest = databaseUrl === undefined ? it.skip : it;

interface PairingRow {
  id: string;
  device_id: string;
  state: string;
  attempt_count: number;
  max_attempts: number;
  claimed_at: Date | null;
  claimed_by_operator_id: string | null;
  consumed_at: Date | null;
}

interface DeviceRow {
  id: string;
}

interface OperatorRow {
  id: string;
}

interface ConsumptionRow {
  id: string;
  pairing_request_id: string;
}

function requiredRow<T>(rows: readonly T[], description: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`Expected ${description}`);
  }
  return row;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function qualified(schema: string, relation: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(relation)}`;
}

async function createDevice(client: Client, schema: string, suffix: string): Promise<string> {
  const result = await client.query<DeviceRow>(
    `INSERT INTO ${qualified(schema, 'devices')} (hardware_id, client_id, board_type)
     VALUES ($1, $2, 'pairing-test-board')
     RETURNING id`,
    [`00:11:22:33:44:${suffix}`, `pairing-client-${suffix}`],
  );
  return requiredRow(result.rows, 'pairing test device').id;
}

async function createOperator(client: Client, schema: string, email: string): Promise<string> {
  const result = await client.query<OperatorRow>(
    `INSERT INTO ${qualified(schema, 'operators')} (email, display_name)
     VALUES ($1, $2)
     RETURNING id`,
    [email, email],
  );
  return requiredRow(result.rows, 'pairing test operator').id;
}

async function createOrRefresh(
  client: Client,
  schema: string,
  deviceId: string,
  discriminator: string,
  maxAttempts = 5,
): Promise<PairingRow> {
  const result = await client.query<PairingRow>(
    `SELECT * FROM ${qualified(schema, 'veetee_create_or_refresh_pairing_request')}(
       $1,
       decode($2, 'hex'),
       decode($3, 'hex'),
       decode($4, 'hex'),
       decode($5, 'hex'),
       now() + interval '10 minutes',
       $6
     )`,
    [deviceId, `a1${discriminator}`, `b1${discriminator}`, `c1${discriminator}`, `d1${discriminator}`, maxAttempts],
  );
  return requiredRow(result.rows, 'created pairing request');
}

describe('pairing migration SQL contract', () => {
  it('defines verifier-only refresh and atomic claimant-bound claim functions with reversible teardown', () => {
    expect(upSql).toContain('CREATE FUNCTION veetee_create_or_refresh_pairing_request(');
    expect(upSql).toContain('CREATE FUNCTION veetee_claim_pairing_request(');
    expect(upSql).toContain('FOR UPDATE;');
    expect(upSql).toContain("state = 'expired'");
    expect(upSql).toContain("state = 'locked'");
    expect(upSql).toContain('p_claimant_operator_id');
    expect(upSql).toContain('p_code_digest bytea');
    expect(upSql).toContain('p_challenge_digest bytea');
    expect(upSql).toContain('pairing_requests_expire_stale_before_insert');
    expect(upSql).not.toMatch(/\bcode\s+(?:text|varchar|char)/i);
    expect(upSql).not.toMatch(/\bchallenge\s+(?:text|varchar|char)/i);
    expect(downSql).toContain(
      'DROP FUNCTION IF EXISTS veetee_claim_pairing_request(uuid, uuid, bytea, bytea, timestamptz);',
    );
    expect(downSql).toContain(
      'DROP FUNCTION IF EXISTS veetee_create_or_refresh_pairing_request(uuid, bytea, bytea, bytea, bytea, timestamptz, integer, timestamptz);',
    );
  });
});

describe('pairing migration SQL behavior', () => {
  integrationTest('refreshes expired requests, serializes claims, locks failed attempts, and consumes once', async () => {
    const schema = `pairing_${randomUUID().replaceAll('-', '')}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    try {
      await client.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
      await client.query(`SET search_path TO ${quoteIdentifier(schema)}, public`);
      await client.query(accessControlUpSql);
      await client.query(upSql);

      const expiredPendingDeviceId = await createDevice(client, schema, '61');
      const expiredPending = await createOrRefresh(client, schema, expiredPendingDeviceId, '01');
      await client.query(
        `UPDATE ${qualified(schema, 'pairing_requests')}
         SET expires_at = now() - interval '1 second'
         WHERE id = $1`,
        [expiredPending.id],
      );
      const refreshedPending = await createOrRefresh(client, schema, expiredPendingDeviceId, '02');
      expect(refreshedPending.id).not.toBe(expiredPending.id);
      const expiredPendingState = await client.query<{ state: string }>(
        `SELECT state FROM ${qualified(schema, 'pairing_requests')} WHERE id = $1`,
        [expiredPending.id],
      );
      expect(requiredRow(expiredPendingState.rows, 'expired pending request').state).toBe('expired');

      const expiredClaimedDeviceId = await createDevice(client, schema, '62');
      const claimantOneId = await createOperator(client, schema, 'pairing-claimant-one@example.test');
      const expiredClaimed = await createOrRefresh(client, schema, expiredClaimedDeviceId, '03');
      await client.query(
        `UPDATE ${qualified(schema, 'pairing_requests')}
         SET state = 'claimed',
             claimed_at = now(),
             claimed_by_operator_id = $2,
             expires_at = now() - interval '1 second'
         WHERE id = $1`,
        [expiredClaimed.id, claimantOneId],
      );
      const refreshedClaimed = await createOrRefresh(client, schema, expiredClaimedDeviceId, '04');
      expect(refreshedClaimed.id).not.toBe(expiredClaimed.id);
      const expiredClaimedState = await client.query<{ state: string }>(
        `SELECT state FROM ${qualified(schema, 'pairing_requests')} WHERE id = $1`,
        [expiredClaimed.id],
      );
      expect(requiredRow(expiredClaimedState.rows, 'expired claimed request').state).toBe('expired');

      const claimDeviceId = await createDevice(client, schema, '63');
      const claimantTwoId = await createOperator(client, schema, 'pairing-claimant-two@example.test');
      const claimable = await createOrRefresh(client, schema, claimDeviceId, '05');

      const concurrentClaim = async (operatorId: string): Promise<PairingRow> => {
        const contender = new Client({ connectionString: databaseUrl });
        await contender.connect();
        try {
          await contender.query(`SET search_path TO ${quoteIdentifier(schema)}, public`);
          const result = await contender.query<PairingRow>(
            `SELECT * FROM ${qualified(schema, 'veetee_claim_pairing_request')}(
               $1,
               $2,
               decode('a105', 'hex'),
               decode('c105', 'hex')
             )`,
            [claimable.id, operatorId],
          );
          return requiredRow(result.rows, 'atomic claim result');
        } finally {
          await contender.end();
        }
      };

      const claimOutcomes = await Promise.allSettled([
        concurrentClaim(claimantOneId),
        concurrentClaim(claimantTwoId),
      ]);
      const successfulClaims = claimOutcomes.filter((outcome) => outcome.status === 'fulfilled');
      const rejectedClaims = claimOutcomes.filter((outcome) => outcome.status === 'rejected');
      expect(successfulClaims).toHaveLength(1);
      expect(rejectedClaims).toHaveLength(1);
      const winningClaim = successfulClaims[0];
      if (winningClaim === undefined || winningClaim.status !== 'fulfilled') {
        throw new Error('Expected exactly one successful pairing claim');
      }
      const winningPairing = winningClaim.value;
      expect(winningPairing.state).toBe('claimed');
      expect([claimantOneId, claimantTwoId]).toContain(winningPairing.claimed_by_operator_id);

      const acceptedAttempt = await client.query<{ count: number }>(
        `SELECT count(*)::integer AS count
         FROM ${qualified(schema, 'pairing_attempts')}
         WHERE pairing_request_id = $1 AND outcome = 'accepted'`,
        [claimable.id],
      );
      expect(requiredRow(acceptedAttempt.rows, 'accepted attempt count').count).toBe(1);

      const lockedDeviceId = await createDevice(client, schema, '64');
      const lockable = await createOrRefresh(client, schema, lockedDeviceId, '06', 2);
      const rejectedOnce = await client.query<PairingRow>(
        `SELECT * FROM ${qualified(schema, 'veetee_claim_pairing_request')}(
           $1, $2, decode('ff', 'hex'), decode('c106', 'hex')
         )`,
        [lockable.id, claimantOneId],
      );
      expect(requiredRow(rejectedOnce.rows, 'first rejected claim').state).toBe('pending');
      const rejectedTwice = await client.query<PairingRow>(
        `SELECT * FROM ${qualified(schema, 'veetee_claim_pairing_request')}(
           $1, $2, decode('ff', 'hex'), decode('c106', 'hex')
         )`,
        [lockable.id, claimantOneId],
      );
      const locked = requiredRow(rejectedTwice.rows, 'second rejected claim');
      expect(locked.state).toBe('locked');
      expect(locked.attempt_count).toBe(2);

      const consumption = await client.query<ConsumptionRow>(
        `SELECT * FROM ${qualified(schema, 'veetee_consume_pairing_request')}(
           $1, $2, decode('beef', 'hex')
         )`,
        [claimable.id, claimDeviceId],
      );
      expect(requiredRow(consumption.rows, 'pairing consumption').pairing_request_id).toBe(claimable.id);
      await expect(
        client.query(
          `SELECT * FROM ${qualified(schema, 'veetee_consume_pairing_request')}(
             $1, $2, decode('beef', 'hex')
           )`,
          [claimable.id, claimDeviceId],
        ),
      ).rejects.toThrow();

      const consumed = await client.query<PairingRow>(
        `SELECT * FROM ${qualified(schema, 'pairing_requests')} WHERE id = $1`,
        [claimable.id],
      );
      const consumedRow = requiredRow(consumed.rows, 'consumed pairing request');
      expect(consumedRow.state).toBe('consumed');
      expect(consumedRow.consumed_at).not.toBeNull();
      expect(consumedRow.claimed_by_operator_id).toBe(winningPairing.claimed_by_operator_id);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await client.end();
    }
  }, 30_000);
});
