import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { discoverMigrations } from '../src/migration-manifest.js';
import { runDatabaseMigrations } from '../src/migration-runner.js';
import { downSql, upSql } from '../src/migrations/0006_mcp_audit_outbox.js';

const databaseUrl = process.env.DATABASE_URL;
const integrationTest = databaseUrl === undefined ? it.skip : it;

const mcpHelperFunctions = [
  'veetee_prevent_mcp_tool_identity_mutation',
  'veetee_bind_mcp_tool_revision_identity',
  'veetee_bind_session_mcp_tool_identity',
  'veetee_enforce_mcp_call_policy',
  'veetee_enforce_mcp_approval_lifecycle',
  'veetee_decide_mcp_approval',
  'veetee_expire_mcp_approval',
  'veetee_prevent_direct_mcp_authorization_delete',
] as const;

const mcpHelperRelations = [
  'mcp_approval_transition_guards',
  'mcp_approvals',
  'mcp_calls',
  'session_mcp_tools',
  'mcp_tool_revisions',
  'mcp_tools',
] as const;

describe('MCP audit/outbox migration authorization contract', () => {
  it('pins tool policy and chains session, device, tool, and revision identities', () => {
    expect(upSql).toContain('risk_class varchar(32) NOT NULL');
    expect(upSql).toContain('approval_policy varchar(32) NOT NULL');
    expect(upSql).toContain("audience varchar(32) NOT NULL DEFAULT 'user'");
    expect(upSql).toContain('mcp_tool_revisions_policy_coherent_check');
    expect(upSql).toContain('mcp_tools_identity_immutable');
    expect(upSql).toContain('MCP tool identity and audience are immutable');
    expect(upSql).not.toContain('mcp_tools (\n  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),\n  device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,\n  namespace varchar(128) NOT NULL,\n  tool_name varchar(255) NOT NULL,\n  audience varchar(32) NOT NULL,\n  approval_required');
    expect(upSql).toContain('mcp_tool_revisions_immutable');
    expect(upSql).toContain('sessions_id_device_unique UNIQUE (id, device_id)');
    expect(upSql).toContain('session_mcp_tools_session_device_fk FOREIGN KEY (session_id, device_id)');
    expect(upSql).toContain('session_mcp_tools_revision_identity_fk FOREIGN KEY');
    expect(upSql).toContain('mcp_calls_session_tool_identity_fk FOREIGN KEY');
  });

  it('correlates calls by session, direction, request identifier, and attempt', () => {
    expect(upSql).toContain('method varchar(255) NOT NULL');
    expect(upSql).toContain('tool_namespace varchar(128) NOT NULL');
    expect(upSql).toContain('tool_name varchar(255) NOT NULL');
    expect(upSql).toContain('deadline_at timestamptz NOT NULL');
    expect(upSql).toContain('UNIQUE (session_id, direction, request_id, attempt)');
    expect(upSql).toContain('request_id >= 0 AND request_id <= 2147483647');
  });

  it('requires a locked, policy-derived approval decision and preserves event mutability boundaries', () => {
    expect(upSql).toContain('mcp_approvals_one_active_per_call');
    expect(upSql).toContain("WHERE state = 'pending'");
    expect(upSql).toContain('mcp_approval_transition_guards');
    expect(upSql).toContain('call_record.approval_expires_at');
    expect(upSql).toContain('effective_expiry := LEAST(');
    expect(upSql).toContain('FOR UPDATE;');
    expect(upSql).toContain('terminal, cancelled, or completed MCP call cannot be approved');
    expect(upSql).toContain('MCP call approval bypasses tool policy');
    expect(upSql).toContain('MCP authorization records must not be deleted directly');
    expect(upSql).toContain('DELETE FROM mcp_approval_transition_guards');
    expect(upSql).toContain('audit_events_immutable');
    expect(upSql).toContain('outbox_events_immutable');
    expect(upSql).not.toContain('outbox_deliveries_immutable');
    expect(downSql).toContain('DROP FUNCTION IF EXISTS veetee_decide_mcp_approval');
    expect(downSql).toContain('DROP TABLE IF EXISTS mcp_approval_transition_guards');
    expect(downSql.indexOf('DROP TABLE IF EXISTS mcp_approval_transition_guards')).toBeLessThan(
      downSql.indexOf('DROP TABLE IF EXISTS mcp_approvals'),
    );
    expect(downSql).toContain('DROP TABLE IF EXISTS mcp_tools');
  });

  integrationTest('enforces policy, identity, lifecycle, concurrency, and clean rollback (requires DATABASE_URL)', async () => {
    const schema = `mcp37_${randomUUID().replaceAll('-', '')}`;
    const client = new Client({ connectionString: databaseUrl! });
    await client.connect();

    try {
      await runDatabaseMigrations({ databaseUrl: databaseUrl!, schema });
      await client.query(`SET search_path TO ${quoteIdentifier(schema)}, public`);
      const context = await createContext(client, schema);
      await verifyPolicyAndIdentity(client, schema, context);
      await verifyDecisionLifecycle(client, schema, context);
      await verifyConcurrentDecisions(databaseUrl!, schema, context);

      const migrationCount = (await discoverMigrations()).length;
      await runDatabaseMigrations({
        databaseUrl: databaseUrl!,
        schema,
        direction: 'down',
        count: migrationCount,
      });
      await verifyMcpHelpersAreGone(client, schema);

      await runDatabaseMigrations({ databaseUrl: databaseUrl!, schema });
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await client.end();
    }
  });
});

interface McpContext {
  operatorId: string;
  deviceId: string;
  otherDeviceId: string;
  sessionId: string;
  otherSessionId: string;
  userSessionToolId: string;
  systemSessionToolId: string;
}

async function createContext(client: Client, schema: string): Promise<McpContext> {
  const operatorId = await insertId(
    client,
    `INSERT INTO ${qualified(schema, 'operators')} (email, display_name)
     VALUES ('mcp37@example.test', 'MCP operator') RETURNING id`,
  );
  const deviceId = await insertId(
    client,
    `INSERT INTO ${qualified(schema, 'devices')} (hardware_id, client_id, board_type)
     VALUES ('00:11:22:33:44:55', 'mcp37-primary', 'board') RETURNING id`,
  );
  const otherDeviceId = await insertId(
    client,
    `INSERT INTO ${qualified(schema, 'devices')} (hardware_id, client_id, board_type)
     VALUES ('00:11:22:33:44:56', 'mcp37-secondary', 'board') RETURNING id`,
  );
  const profileId = await insertId(
    client,
    `INSERT INTO ${qualified(schema, 'pipeline_profiles')} (profile_key, display_name)
     VALUES ('mcp37', 'MCP policy test') RETURNING id`,
  );
  const pipelineId = await insertId(
    client,
    `INSERT INTO ${qualified(schema, 'pipeline_revisions')} (pipeline_profile_id, revision, policy)
     VALUES ($1, 1, '{}'::jsonb) RETURNING id`,
    [profileId],
  );
  const snapshotId = await insertId(
    client,
    `INSERT INTO ${qualified(schema, 'runtime_snapshots')} (pipeline_revision_id, snapshot, content_digest)
     VALUES ($1, '{}'::jsonb, 'mcp37-snapshot') RETURNING id`,
    [pipelineId],
  );
  const sessionId = await insertId(
    client,
    `INSERT INTO ${qualified(schema, 'sessions')} (device_id, runtime_snapshot_id)
     VALUES ($1, $2) RETURNING id`,
    [deviceId, snapshotId],
  );
  const otherSessionId = await insertId(
    client,
    `INSERT INTO ${qualified(schema, 'sessions')} (device_id, runtime_snapshot_id)
     VALUES ($1, $2) RETURNING id`,
    [otherDeviceId, snapshotId],
  );
  const userToolId = await insertId(
    client,
    `INSERT INTO ${qualified(schema, 'mcp_tools')} (device_id, namespace, tool_name, audience)
     VALUES ($1, 'mcp37', 'dangerous', 'user') RETURNING id`,
    [deviceId],
  );
  const userRevisionId = await insertId(
    client,
    `INSERT INTO ${qualified(schema, 'mcp_tool_revisions')}
       (mcp_tool_id, revision, input_schema, output_schema)
     VALUES ($1, 1, '{}'::jsonb, '{}'::jsonb) RETURNING id`,
    [userToolId],
  );
  const userSessionToolId = await insertId(
    client,
    `INSERT INTO ${qualified(schema, 'session_mcp_tools')} (session_id, mcp_tool_revision_id)
     VALUES ($1, $2) RETURNING id`,
    [sessionId, userRevisionId],
  );
  const systemToolId = await insertId(
    client,
    `INSERT INTO ${qualified(schema, 'mcp_tools')} (device_id, namespace, tool_name, audience)
     VALUES ($1, 'mcp37', 'status', 'system') RETURNING id`,
    [deviceId],
  );
  const systemRevisionId = await insertId(
    client,
    `INSERT INTO ${qualified(schema, 'mcp_tool_revisions')}
       (mcp_tool_id, revision, audience, approval_policy, input_schema, output_schema)
     VALUES ($1, 1, 'system', 'none', '{}'::jsonb, '{}'::jsonb) RETURNING id`,
    [systemToolId],
  );
  const systemSessionToolId = await insertId(
    client,
    `INSERT INTO ${qualified(schema, 'session_mcp_tools')} (session_id, mcp_tool_revision_id)
     VALUES ($1, $2) RETURNING id`,
    [sessionId, systemRevisionId],
  );
  return {
    operatorId,
    deviceId,
    otherDeviceId,
    sessionId,
    otherSessionId,
    userSessionToolId,
    systemSessionToolId,
  };
}

async function verifyPolicyAndIdentity(client: Client, schema: string, context: McpContext): Promise<void> {
  const call = await client.query<{
    id: string;
    state: string;
    approval_required: boolean;
    device_id: string;
    tool_namespace: string;
    tool_name: string;
  }>(
    `INSERT INTO ${qualified(schema, 'mcp_calls')}
       (session_id, session_mcp_tool_id, request_id, direction, approval_required, approval_expires_at)
     VALUES ($1, $2, 17, 'server_to_device', false, now() + interval '1 hour')
     RETURNING id, state, approval_required, device_id, tool_namespace, tool_name`,
    [context.sessionId, context.userSessionToolId],
  );
  const protectedCall = requiredRow(call.rows, 'policy-derived MCP call');
  expect(protectedCall.state).toBe('awaiting_approval');
  expect(protectedCall.approval_required).toBe(true);
  expect(protectedCall.device_id).toBe(context.deviceId);
  expect(protectedCall.tool_namespace).toBe('mcp37');
  expect(protectedCall.tool_name).toBe('dangerous');

  await expectQueryFailure(
    client,
    `UPDATE ${qualified(schema, 'mcp_tools')}
     SET audience = 'system'
     WHERE id = (SELECT mcp_tool_id FROM ${qualified(schema, 'session_mcp_tools')} WHERE id = $1)`,
    [context.userSessionToolId],
  );

  await expectQueryFailure(
    client,
    `INSERT INTO ${qualified(schema, 'mcp_calls')}
       (session_id, device_id, session_mcp_tool_id, request_id, direction)
     VALUES ($1, $2, $3, 18, 'server_to_device')`,
    [context.sessionId, context.otherDeviceId, context.userSessionToolId],
  );
  await expectQueryFailure(
    client,
    `INSERT INTO ${qualified(schema, 'session_mcp_tools')} (session_id, mcp_tool_revision_id)
     SELECT $1, mcp_tool_revision_id
     FROM ${qualified(schema, 'session_mcp_tools')}
     WHERE id = $2`,
    [context.otherSessionId, context.userSessionToolId],
  );

  await insertCall(client, schema, context.sessionId, context.userSessionToolId, 19, 'server_to_device', 0);
  await insertCall(client, schema, context.sessionId, context.userSessionToolId, 19, 'server_to_device', 1);
  await insertCall(client, schema, context.sessionId, context.systemSessionToolId, 19, 'device_to_server', 0, false);
  await expectQueryFailure(
    client,
    `INSERT INTO ${qualified(schema, 'mcp_calls')}
       (session_id, session_mcp_tool_id, request_id, direction, attempt)
     VALUES ($1, $2, 19, 'server_to_device', 0)`,
    [context.sessionId, context.userSessionToolId],
  );
  await expectQueryFailure(
    client,
    `INSERT INTO ${qualified(schema, 'mcp_calls')}
       (session_id, session_mcp_tool_id, request_id, direction)
     VALUES ($1, $2, -1, 'server_to_device')`,
    [context.sessionId, context.userSessionToolId],
  );
  await expectQueryFailure(
    client,
    `INSERT INTO ${qualified(schema, 'mcp_calls')}
       (session_id, session_mcp_tool_id, request_id, direction)
     VALUES ($1, $2, 2147483648, 'server_to_device')`,
    [context.sessionId, context.userSessionToolId],
  );
}

async function verifyDecisionLifecycle(client: Client, schema: string, context: McpContext): Promise<void> {
  const callId = await insertCall(client, schema, context.sessionId, context.userSessionToolId, 20, 'server_to_device');
  const approvalId = await insertApproval(client, schema, callId);
  await expectQueryFailure(
    client,
    `UPDATE ${qualified(schema, 'mcp_approvals')}
     SET state = 'approved', operator_id = $2, decided_at = now()
     WHERE id = $1`,
    [approvalId, context.operatorId],
  );
  await expectQueryFailure(
    client,
    `UPDATE ${qualified(schema, 'mcp_calls')} SET state = 'approved' WHERE id = $1`,
    [callId],
  );
  await client.query(
    `SELECT ${qualified(schema, 'veetee_decide_mcp_approval')}($1, $2, 'approved')`,
    [approvalId, context.operatorId],
  );
  const guardCount = await client.query<{ count: number }>(
    `SELECT count(*)::integer AS count
     FROM ${qualified(schema, 'mcp_approval_transition_guards')}
     WHERE approval_id = $1`,
    [approvalId],
  );
  expect(requiredRow(guardCount.rows, 'cleared MCP transition guard').count).toBe(0);
  await expectQueryFailure(
    client,
    `DELETE FROM ${qualified(schema, 'mcp_approvals')} WHERE id = $1`,
    [approvalId],
  );
  await client.query(
    `UPDATE ${qualified(schema, 'mcp_calls')} SET state = 'dispatched' WHERE id = $1`,
    [callId],
  );

  const lateCallId = await insertCall(client, schema, context.sessionId, context.userSessionToolId, 21, 'server_to_device');
  const lateApprovalId = await insertApproval(client, schema, lateCallId);
  await client.query(
    `SELECT ${qualified(schema, 'veetee_decide_mcp_approval')}($1, $2, 'approved', now() + interval '2 hours')`,
    [lateApprovalId, context.operatorId],
  );
  const lateState = await client.query<{ approval_state: string; call_state: string }>(
    `SELECT approval.state AS approval_state, call.state AS call_state
     FROM ${qualified(schema, 'mcp_approvals')} AS approval
     JOIN ${qualified(schema, 'mcp_calls')} AS call ON call.id = approval.mcp_call_id
     WHERE approval.id = $1`,
    [lateApprovalId],
  );
  expect(requiredRow(lateState.rows, 'expired approval')).toEqual({
    approval_state: 'expired',
    call_state: 'expired',
  });

  const boundedDecisionCallId = await insertBoundedCall(client, schema, context, 24);
  const boundedDecisionApprovalId = await insertApproval(client, schema, boundedDecisionCallId);
  const boundedDecision = await client.query<{ approval_state: string; call_state: string }>(
    `SELECT approval.state AS approval_state, call.state AS call_state
     FROM ${qualified(schema, 'mcp_approvals')} AS approval
     JOIN ${qualified(schema, 'mcp_calls')} AS call ON call.id = approval.mcp_call_id
     WHERE approval.id = $1`,
    [boundedDecisionApprovalId],
  );
  const boundedDecisionRow = requiredRow(boundedDecision.rows, 'approval bounded by MCP call expiry');
  await client.query(
    `SELECT ${qualified(schema, 'veetee_decide_mcp_approval')}($1, $2, 'approved', now() + interval '2 minutes')`,
    [boundedDecisionApprovalId, context.operatorId],
  );
  const boundedDecisionAfter = await client.query<{ approval_state: string; call_state: string }>(
    `SELECT approval.state AS approval_state, call.state AS call_state
     FROM ${qualified(schema, 'mcp_approvals')} AS approval
     JOIN ${qualified(schema, 'mcp_calls')} AS call ON call.id = approval.mcp_call_id
     WHERE approval.id = $1`,
    [boundedDecisionApprovalId],
  );
  expect(boundedDecisionRow).toEqual({ approval_state: 'pending', call_state: 'awaiting_approval' });
  expect(requiredRow(boundedDecisionAfter.rows, 'approval expired at MCP call approval expiry')).toEqual({
    approval_state: 'expired',
    call_state: 'expired',
  });

  const boundedExpirationCallId = await insertBoundedCall(client, schema, context, 25);
  const boundedExpirationApprovalId = await insertApproval(client, schema, boundedExpirationCallId);
  await client.query(
    `SELECT ${qualified(schema, 'veetee_expire_mcp_approval')}($1, now() + interval '2 minutes')`,
    [boundedExpirationApprovalId],
  );
  const boundedExpiration = await client.query<{ approval_state: string; call_state: string }>(
    `SELECT approval.state AS approval_state, call.state AS call_state
     FROM ${qualified(schema, 'mcp_approvals')} AS approval
     JOIN ${qualified(schema, 'mcp_calls')} AS call ON call.id = approval.mcp_call_id
     WHERE approval.id = $1`,
    [boundedExpirationApprovalId],
  );
  expect(requiredRow(boundedExpiration.rows, 'explicitly expired bounded approval')).toEqual({
    approval_state: 'expired',
    call_state: 'expired',
  });

  const cancelledCallId = await insertCall(client, schema, context.sessionId, context.userSessionToolId, 22, 'server_to_device');
  const cancelledApprovalId = await insertApproval(client, schema, cancelledCallId);
  await client.query(
    `UPDATE ${qualified(schema, 'mcp_calls')} SET state = 'cancelled', completed_at = now() WHERE id = $1`,
    [cancelledCallId],
  );
  await expectQueryFailure(
    client,
    `SELECT ${qualified(schema, 'veetee_decide_mcp_approval')}($1, $2, 'approved')`,
    [cancelledApprovalId, context.operatorId],
  );
}

async function verifyConcurrentDecisions(
  connectionString: string,
  schema: string,
  context: McpContext,
): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`SET search_path TO ${quoteIdentifier(schema)}, public`);
    const callId = await insertCall(client, schema, context.sessionId, context.userSessionToolId, 23, 'server_to_device');
    const approvalId = await insertApproval(client, schema, callId);
    const decisions = await Promise.allSettled([
      decideApproval(connectionString, schema, approvalId, context.operatorId, 'approved'),
      decideApproval(connectionString, schema, approvalId, context.operatorId, 'denied'),
    ]);
    expect(decisions.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(decisions.filter(({ status }) => status === 'rejected')).toHaveLength(1);
  } finally {
    await client.end();
  }
}

async function decideApproval(
  connectionString: string,
  schema: string,
  approvalId: string,
  operatorId: string,
  decision: 'approved' | 'denied',
): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`SET search_path TO ${quoteIdentifier(schema)}, public`);
    await client.query(
      `SELECT ${qualified(schema, 'veetee_decide_mcp_approval')}($1, $2, $3)`,
      [approvalId, operatorId, decision],
    );
  } finally {
    await client.end();
  }
}

async function verifyMcpHelpersAreGone(client: Client, schema: string): Promise<void> {
  const relations = await client.query<{ relname: string }>(
    `SELECT relname
     FROM pg_catalog.pg_class
     WHERE relnamespace = $1::regnamespace
       AND relname = ANY($2::text[])`,
    [schema, [...mcpHelperRelations]],
  );
  expect(relations.rows).toEqual([]);

  const functions = await client.query<{ proname: string }>(
    `SELECT proname
     FROM pg_catalog.pg_proc
     WHERE pronamespace = $1::regnamespace
       AND proname = ANY($2::text[])`,
    [schema, [...mcpHelperFunctions]],
  );
  expect(functions.rows).toEqual([]);

  const triggers = await client.query<{ tgname: string }>(
    `SELECT trigger.tgname
     FROM pg_catalog.pg_trigger AS trigger
     JOIN pg_catalog.pg_class AS relation ON relation.oid = trigger.tgrelid
     WHERE relation.relnamespace = $1::regnamespace
       AND trigger.tgname IN (
         'mcp_tools_identity_immutable',
         'mcp_tool_revisions_bind_identity',
         'session_mcp_tools_bind_identity',
         'mcp_calls_enforce_policy',
         'mcp_approvals_enforce_lifecycle',
         'mcp_approvals_prevent_direct_delete',
         'mcp_calls_prevent_direct_delete',
         'mcp_tool_revisions_immutable'
       )`,
    [schema],
  );
  expect(triggers.rows).toEqual([]);
}

async function insertCall(
  client: Client,
  schema: string,
  sessionId: string,
  sessionToolId: string,
  requestId: number,
  direction: 'server_to_device' | 'device_to_server',
  attempt = 0,
  requiresApproval = true,
): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'mcp_calls')}
       (session_id, session_mcp_tool_id, request_id, direction, attempt, approval_expires_at)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 THEN now() + interval '1 hour' ELSE NULL END)
     RETURNING id`,
    [sessionId, sessionToolId, requestId, direction, attempt, requiresApproval],
  );
  return requiredRow(result.rows, 'MCP call').id;
}

async function insertBoundedCall(
  client: Client,
  schema: string,
  context: McpContext,
  requestId: number,
): Promise<string> {
  return insertId(
    client,
    `INSERT INTO ${qualified(schema, 'mcp_calls')}
       (session_id, session_mcp_tool_id, request_id, direction, deadline_at, approval_expires_at)
     VALUES ($1, $2, $3, 'server_to_device', now() + interval '1 hour', now() + interval '1 minute')
     RETURNING id`,
    [context.sessionId, context.userSessionToolId, requestId],
  );
}

async function insertApproval(client: Client, schema: string, callId: string): Promise<string> {
  return insertId(
    client,
    `INSERT INTO ${qualified(schema, 'mcp_approvals')} (mcp_call_id, expires_at)
     VALUES ($1, now() + interval '1 hour') RETURNING id`,
    [callId],
  );
}

async function insertId(client: Client, text: string, values: readonly unknown[] = []): Promise<string> {
  const result = await client.query<{ id: string }>(text, [...values]);
  return requiredRow(result.rows, 'inserted record').id;
}

async function expectQueryFailure(
  client: Client,
  text: string,
  values: readonly unknown[],
): Promise<void> {
  try {
    await client.query(text, [...values]);
  } catch {
    return;
  }
  throw new Error('Expected PostgreSQL query to fail');
}

function qualified(schema: string, relation: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(relation)}`;
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function requiredRow<T>(rows: readonly T[], description: string): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`Expected ${description}`);
  }
  return row;
}
