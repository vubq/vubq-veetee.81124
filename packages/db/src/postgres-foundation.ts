import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

import { createDatabaseClient } from './client.js';
import { discoverMigrations } from './migrations/index.js';
import { runDatabaseMigrations } from './migration-runner.js';

export const foundationInvariants = [
  'canonical-device-hardware-id-is-unique',
  'client-id-is-non-global',
  'one-live-pairing-request-per-device',
  'pairing-claims-are-transactional',
  'provider-binding-role-matches-provider-revision',
  'provider-credential-envelope-identity-is-immutable',
  'firmware-publication-requires-signed-approved-artifact',
  'firmware-download-tickets-are-device-bound-and-single-use',
  'conversation-session-identity-is-authoritative',
  'conversation-turn-abort-lifecycle-is-coherent',
  'conversation-events-are-metadata-only-and-immutable',
  'mcp-call-identity-is-session-direction-request-attempt',
  'mcp-policy-derives-approval',
  'mcp-terminal-calls-cannot-be-approved',
  'outbox-events-are-immutable',
  'outbox-deliveries-are-mutable',
  'audit-events-are-immutable',
  'migrations-rollback-and-reapply-cleanly',
] as const;

export interface PostgresFoundationVerification {
  appliedMigrationIds: readonly string[];
  invariants: readonly (typeof foundationInvariants)[number][];
}

export async function verifyPostgresFoundation(
  databaseUrl: string,
): Promise<PostgresFoundationVerification> {
  const schema = `task004_${randomUUID().replaceAll('-', '')}`;
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const appliedMigrationIds = await runDatabaseMigrations({ databaseUrl, schema });
    await client.query(`SET search_path TO ${quoteIdentifier(schema)}, public`);
    const expectedMigrationIds = (await discoverMigrations()).map(({ id }) => id);
    assertEqual(appliedMigrationIds, expectedMigrationIds, 'migration application order');

    await verifyCatalog(client, schema);
    const context = await createVerificationContext(client, schema);
    await verifyCanonicalDeviceIdentity(client, schema, context);
    await verifyPairingLifecycle(client, databaseUrl, schema, context);
    await verifyProviderRoleCompatibility(client, schema, context);
    await verifyFirmwareLifecycle(client, schema, context);
    await verifyConversationLifecycle(client, schema, context);
    await verifyMcpApprovalLifecycle(client, schema, context);
    await verifyOutboxAndAuditMutability(client, schema);

    const rolledBackMigrationIds = await runDatabaseMigrations({
      databaseUrl,
      schema,
      direction: 'down',
      count: expectedMigrationIds.length,
    });
    assertEqual(rolledBackMigrationIds, [...expectedMigrationIds].reverse(), 'migration rollback order');
    await verifySchemaIsEmpty(client, schema);

    const reappliedMigrationIds = await runDatabaseMigrations({ databaseUrl, schema });
    assertEqual(reappliedMigrationIds, expectedMigrationIds, 'migration reapplication order');

    return {
      appliedMigrationIds: reappliedMigrationIds,
      invariants: foundationInvariants,
    };
  } finally {
    await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await client.end();
  }
}

interface SessionIdentitySeed {
  deviceId: string;
  assistantRevisionId: string;
  runtimeSnapshotId: string;
  retentionPolicyId: string;
}

interface VerificationContext extends SessionIdentitySeed {
  operatorId: string;
  contenderOperatorId: string;
  alternateDeviceId: string;
  pipelineRevisionId: string;
  sessionId: string;
}

interface TimeWindow {
  atTime: Date;
  deadline: Date;
}

interface PairingRequestRow {
  id: string;
  device_id: string;
  state: string;
  attempt_count: number;
  claimed_at: Date | null;
  claimed_by_operator_id: string | null;
  consumed_at: Date | null;
}

interface PairingConsumptionRow {
  pairing_request_id: string;
  device_id: string;
}

interface McpToolBinding {
  sessionId: string;
  deviceId: string;
  toolId: string;
  revisionId: string;
  sessionToolId: string;
  namespace: string;
  toolName: string;
}

interface McpCallRow {
  id: string;
  session_id: string;
  device_id: string;
  session_mcp_tool_id: string;
  mcp_tool_id: string;
  mcp_tool_revision_id: string;
  request_id: number;
  direction: string;
  attempt: number;
  deadline_at: Date;
  approval_required: boolean;
  approval_expires_at: Date | null;
  state: string;
  completed_at: Date | null;
}

interface McpApprovalRow {
  id: string;
  mcp_call_id: string;
  state: string;
  expires_at: Date;
  operator_id: string | null;
  decided_at: Date | null;
}

async function createVerificationContext(client: Client, schema: string): Promise<VerificationContext> {
  const operator = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'operators')} (email, display_name)
     VALUES ('operator@example.test', 'Operator') RETURNING id`,
  );
  const contender = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'operators')} (email, display_name)
     VALUES ('contender@example.test', 'Contender') RETURNING id`,
  );
  const device = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'devices')} (hardware_id, client_id, board_type)
     VALUES ('00:11:22:33:44:55', 'shared-client', 'board-a') RETURNING id`,
  );
  const alternateDevice = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'devices')} (hardware_id, client_id, board_type)
     VALUES ('00:11:22:33:44:56', 'shared-client', 'board-a') RETURNING id`,
  );
  const profile = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'pipeline_profiles')} (profile_key, display_name)
     VALUES ('foundation-pipeline', 'Foundation pipeline') RETURNING id`,
  );
  const retentionPolicy = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'retention_policies')}
       (policy_key, conversation_days, event_days, audit_days)
     VALUES ('foundation-retention', 30, 30, 365) RETURNING id`,
  );
  const assistant = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'assistants')} (assistant_key, display_name)
     VALUES ('foundation-assistant', 'Foundation assistant') RETURNING id`,
  );
  const pipeline = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'pipeline_revisions')} (pipeline_profile_id, revision, policy)
     VALUES ($1, 1, '{}'::jsonb) RETURNING id`,
    [requiredRow(profile.rows, 'pipeline profile').id],
  );
  const snapshot = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'runtime_snapshots')} (pipeline_revision_id, snapshot, content_digest)
     VALUES ($1, '{}'::jsonb, 'foundation-runtime-snapshot') RETURNING id`,
    [requiredRow(pipeline.rows, 'pipeline revision').id],
  );
  const assistantRevision = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'assistant_revisions')}
       (assistant_id, pipeline_profile_id, retention_policy_id, revision, configuration)
     VALUES ($1, $2, $3, 1, '{}'::jsonb) RETURNING id`,
    [
      requiredRow(assistant.rows, 'assistant').id,
      requiredRow(profile.rows, 'pipeline profile').id,
      requiredRow(retentionPolicy.rows, 'retention policy').id,
    ],
  );

  const sessionIdentity: SessionIdentitySeed = {
    deviceId: requiredRow(device.rows, 'device').id,
    assistantRevisionId: requiredRow(assistantRevision.rows, 'assistant revision').id,
    runtimeSnapshotId: requiredRow(snapshot.rows, 'runtime snapshot').id,
    retentionPolicyId: requiredRow(retentionPolicy.rows, 'retention policy').id,
  };
  const sessionId = await createSession(client, schema, sessionIdentity, 'foundation-wire-session');

  return {
    operatorId: requiredRow(operator.rows, 'operator').id,
    contenderOperatorId: requiredRow(contender.rows, 'contender operator').id,
    alternateDeviceId: requiredRow(alternateDevice.rows, 'alternate device').id,
    pipelineRevisionId: requiredRow(pipeline.rows, 'pipeline revision').id,
    sessionId,
    ...sessionIdentity,
  };
}

async function createSession(
  client: Client,
  schema: string,
  identity: SessionIdentitySeed,
  wireSessionId: string,
): Promise<string> {
  const session = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'sessions')}
       (
         wire_session_id,
         device_id,
         assistant_revision_id,
         runtime_snapshot_id,
         retention_mode,
         retention_policy_id,
         expires_at
       )
     VALUES ($1, $2, $3, $4, 'policy', $5, now() + interval '1 day')
     RETURNING id`,
    [
      wireSessionId,
      identity.deviceId,
      identity.assistantRevisionId,
      identity.runtimeSnapshotId,
      identity.retentionPolicyId,
    ],
  );
  return requiredRow(session.rows, 'session').id;
}

async function verifyCatalog(client: Client, schema: string): Promise<void> {
  const requiredTables = [
    'roles',
    'permissions',
    'operators',
    'service_principals',
    'signing_keys',
    'assistants',
    'devices',
    'device_identity_history',
    'pairing_requests',
    'pairing_attempts',
    'pairing_consumptions',
    'provider_catalogs',
    'provider_catalog_revisions',
    'provider_instances',
    'provider_instance_revisions',
    'provider_credentials',
    'pipeline_profiles',
    'pipeline_revisions',
    'retention_policies',
    'assistant_revisions',
    'pipeline_bindings',
    'runtime_snapshots',
    'firmware_artifacts',
    'firmware_releases',
    'firmware_rollouts',
    'firmware_rollout_assignments',
    'firmware_download_tickets',
    'sessions',
    'conversations',
    'conversation_turns',
    'conversation_events',
    'mcp_tools',
    'mcp_tool_revisions',
    'session_mcp_tools',
    'mcp_calls',
    'mcp_approvals',
    'audit_events',
    'outbox_events',
    'outbox_deliveries',
  ];
  const tables = await client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
    [schema],
  );
  const actualTables = new Set(tables.rows.map(({ table_name }) => table_name));

  for (const table of requiredTables) {
    if (!actualTables.has(table)) {
      throw new Error(`Missing required foundation table: ${table}`);
    }
  }

  const expectedConstraints = [
    'devices_hardware_id_canonical_mac_check',
    'pairing_requests_state_coherent_check',
    'provider_instance_revisions_catalog_role_fk',
    'pipeline_bindings_provider_role_fk',
    'firmware_artifacts_signature_coherent_check',
    'firmware_releases_approval_coherent_check',
    'firmware_download_tickets_assignment_device_fk',
    'conversations_session_identity_fk',
    'conversation_turns_abort_lifecycle_coherent_check',
    'conversation_turns_state_abort_lifecycle_coherent_check',
    'conversation_events_metadata_only_check',
    'mcp_calls_session_request_unique',
    'mcp_calls_session_tool_identity_fk',
    'mcp_calls_approval_state_coherent_check',
    'mcp_approvals_state_coherent_check',
    'outbox_events_deduplication_key_unique',
  ];
  const constraints = await client.query<{ constraint_name: string }>(
    `SELECT constraint_name
     FROM information_schema.table_constraints
     WHERE constraint_schema = $1`,
    [schema],
  );
  const availableConstraints = new Set(constraints.rows.map(({ constraint_name }) => constraint_name));

  for (const constraint of expectedConstraints) {
    if (!availableConstraints.has(constraint)) {
      throw new Error(`Missing required foundation constraint: ${constraint}`);
    }
  }

  const requiredFunctions = [
    'veetee_create_or_refresh_pairing_request',
    'veetee_claim_pairing_request',
    'veetee_consume_pairing_request',
    'veetee_consume_firmware_download_ticket',
    'veetee_decide_mcp_approval',
  ];
  const routines = await client.query<{ routine_name: string }>(
    `SELECT routine_name
     FROM information_schema.routines
     WHERE routine_schema = $1 AND routine_type = 'FUNCTION'`,
    [schema],
  );
  const availableFunctions = new Set(routines.rows.map(({ routine_name }) => routine_name));

  for (const routine of requiredFunctions) {
    if (!availableFunctions.has(routine)) {
      throw new Error(`Missing required foundation function: ${routine}`);
    }
  }

  const requiredTriggers = [
    'provider_credentials_lifecycle',
    'firmware_artifacts_published_immutable',
    'firmware_releases_published_immutable',
    'firmware_releases_validate_publication',
    'firmware_rollouts_validate_release',
    'conversation_events_immutable',
    'mcp_tools_identity_immutable',
    'mcp_calls_enforce_policy',
    'mcp_approvals_enforce_lifecycle',
    'mcp_approvals_prevent_direct_delete',
    'mcp_calls_prevent_direct_delete',
  ];
  const triggers = await client.query<{ trigger_name: string }>(
    `SELECT trigger_name
     FROM information_schema.triggers
     WHERE event_object_schema = $1`,
    [schema],
  );
  const availableTriggers = new Set(triggers.rows.map(({ trigger_name }) => trigger_name));

  for (const trigger of requiredTriggers) {
    if (!availableTriggers.has(trigger)) {
      throw new Error(`Missing required foundation trigger: ${trigger}`);
    }
  }
}

async function verifyCanonicalDeviceIdentity(
  client: Client,
  schema: string,
  context: VerificationContext,
): Promise<void> {
  await client.query(
    `INSERT INTO ${qualified(schema, 'devices')} (hardware_id, client_id, board_type)
     VALUES ($1, $2, $3)`,
    ['00:11:22:33:44:57', 'shared-client', 'board-a'],
  );

  await expectQueryFailure(
    client,
    `INSERT INTO ${qualified(schema, 'devices')} (hardware_id, client_id, board_type)
     VALUES ($1, $2, $3)`,
    ['00:11:22:33:44:55', 'another-client', 'board-a'],
    'duplicate canonical hardware ID',
  );
  await expectQueryFailure(
    client,
    `INSERT INTO ${qualified(schema, 'devices')} (hardware_id, client_id, board_type)
     VALUES ($1, $2, $3)`,
    ['00-11-22-33-44-58', 'format-client', 'board-a'],
    'noncanonical MAC address',
  );

  const found = await client.query<{ id: string }>(
    `SELECT id FROM ${qualified(schema, 'devices')} WHERE id = $1`,
    [context.deviceId],
  );
  requiredRow(found.rows, 'canonical device');

  const sharedClientDevices = await client.query<{ count: number }>(
    `SELECT count(*)::integer AS count
     FROM ${qualified(schema, 'devices')}
     WHERE client_id = 'shared-client'`,
  );
  if (requiredRow(sharedClientDevices.rows, 'shared-client device count').count < 2) {
    throw new Error('Client ID unexpectedly behaves as a global device identity');
  }
}

async function verifyPairingLifecycle(
  client: Client,
  databaseUrl: string,
  schema: string,
  context: VerificationContext,
): Promise<void> {
  const pairingWindow = await createTimeWindow(client, '10 minutes');
  const created = await createOrRefreshPairingRequest(
    client,
    schema,
    context.deviceId,
    '01',
    pairingWindow,
  );
  const refreshed = await createOrRefreshPairingRequest(
    client,
    schema,
    context.deviceId,
    '02',
    pairingWindow,
  );

  if (created.id !== refreshed.id || refreshed.state !== 'pending') {
    throw new Error('Pairing refresh did not retain a single pending request');
  }

  const activeRequests = await client.query<{ count: number }>(
    `SELECT count(*)::integer AS count
     FROM ${qualified(schema, 'pairing_requests')}
     WHERE device_id = $1 AND state IN ('pending', 'claimed')`,
    [context.deviceId],
  );
  if (requiredRow(activeRequests.rows, 'active pairing request count').count !== 1) {
    throw new Error('Pairing refresh left more than one live request');
  }

  const claimOutcomes = await Promise.allSettled([
    claimPairingRequest(
      databaseUrl,
      schema,
      refreshed.id,
      context.operatorId,
      'a102',
      'c102',
      pairingWindow.atTime,
    ),
    claimPairingRequest(
      databaseUrl,
      schema,
      refreshed.id,
      context.contenderOperatorId,
      'a102',
      'c102',
      pairingWindow.atTime,
    ),
  ]);
  const successfulClaims = claimOutcomes.filter(
    (outcome): outcome is PromiseFulfilledResult<PairingRequestRow> => outcome.status === 'fulfilled',
  );
  const rejectedClaims = claimOutcomes.filter((outcome) => outcome.status === 'rejected');

  if (successfulClaims.length !== 1 || rejectedClaims.length !== 1) {
    throw new Error('Concurrent pairing claims did not produce exactly one claimant');
  }

  const winningClaim = successfulClaims[0];
  if (winningClaim === undefined) {
    throw new Error('Expected an atomic pairing claim winner');
  }
  const winner = winningClaim.value;
  if (
    winner.state !== 'claimed'
    || (winner.claimed_by_operator_id !== context.operatorId
      && winner.claimed_by_operator_id !== context.contenderOperatorId)
  ) {
    throw new Error('Pairing claim did not bind the request to its winning operator');
  }

  const acceptedAttempts = await client.query<{ count: number }>(
    `SELECT count(*)::integer AS count
     FROM ${qualified(schema, 'pairing_attempts')}
     WHERE pairing_request_id = $1 AND outcome = 'accepted'`,
    [refreshed.id],
  );
  if (requiredRow(acceptedAttempts.rows, 'accepted pairing attempt count').count !== 1) {
    throw new Error('Atomic pairing claim did not record exactly one accepted attempt');
  }

  const consumption = await client.query<PairingConsumptionRow>(
    `SELECT * FROM ${qualified(schema, 'veetee_consume_pairing_request')}(
       $1,
       $2,
       decode('beef', 'hex'),
       $3
     )`,
    [refreshed.id, context.deviceId, pairingWindow.atTime],
  );
  const consumedRequest = requiredRow(consumption.rows, 'pairing consumption');
  if (consumedRequest.pairing_request_id !== refreshed.id || consumedRequest.device_id !== context.deviceId) {
    throw new Error('Pairing consumption did not retain the claimed request identity');
  }

  const consumed = await client.query<Pick<PairingRequestRow, 'state' | 'attempt_count' | 'consumed_at'>>(
    `SELECT state, attempt_count, consumed_at
     FROM ${qualified(schema, 'pairing_requests')}
     WHERE id = $1`,
    [refreshed.id],
  );
  const consumedRow = requiredRow(consumed.rows, 'consumed pairing request');
  if (consumedRow.state !== 'consumed' || consumedRow.attempt_count !== 1 || consumedRow.consumed_at === null) {
    throw new Error('Pairing lifecycle did not claim and consume coherently');
  }
}

async function createOrRefreshPairingRequest(
  client: Client,
  schema: string,
  deviceId: string,
  discriminator: string,
  window: TimeWindow,
): Promise<PairingRequestRow> {
  const result = await client.query<PairingRequestRow>(
    `SELECT * FROM ${qualified(schema, 'veetee_create_or_refresh_pairing_request')}(
       $1,
       decode($2, 'hex'),
       decode($3, 'hex'),
       decode($4, 'hex'),
       decode($5, 'hex'),
       $6,
       $7,
       $8
     )`,
    [
      deviceId,
      `a1${discriminator}`,
      `b1${discriminator}`,
      `c1${discriminator}`,
      `d1${discriminator}`,
      window.deadline,
      5,
      window.atTime,
    ],
  );
  return requiredRow(result.rows, 'created or refreshed pairing request');
}

async function claimPairingRequest(
  databaseUrl: string,
  schema: string,
  pairingRequestId: string,
  operatorId: string,
  codeDigest: string,
  challengeDigest: string,
  atTime: Date,
): Promise<PairingRequestRow> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query(`SET search_path TO ${quoteIdentifier(schema)}, public`);
    const result = await client.query<PairingRequestRow>(
      `SELECT * FROM ${qualified(schema, 'veetee_claim_pairing_request')}(
         $1,
         $2,
         decode($3, 'hex'),
         decode($4, 'hex'),
         $5
       )`,
      [pairingRequestId, operatorId, codeDigest, challengeDigest, atTime],
    );
    return requiredRow(result.rows, 'atomic pairing claim');
  } finally {
    await client.end();
  }
}

async function verifyProviderRoleCompatibility(
  client: Client,
  schema: string,
  context: VerificationContext,
): Promise<void> {
  const catalog = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'provider_catalogs')} (provider_key, display_name)
     VALUES ('foundation-provider', 'Foundation provider') RETURNING id`,
  );
  const catalogRevision = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'provider_catalog_revisions')}
       (catalog_id, revision, role, configuration_schema)
     VALUES ($1, 1, 'llm', '{}'::jsonb) RETURNING id`,
    [requiredRow(catalog.rows, 'provider catalog').id],
  );
  const instance = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'provider_instances')} (instance_key, display_name)
     VALUES ('foundation-instance', 'Foundation instance') RETURNING id`,
  );
  const instanceId = requiredRow(instance.rows, 'provider instance').id;
  const catalogRevisionId = requiredRow(catalogRevision.rows, 'catalog revision').id;
  const instanceRevision = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'provider_instance_revisions')}
       (instance_id, catalog_revision_id, role, revision, endpoint, network_scope, configuration)
     VALUES ($1, $2, 'llm', 1, 'https://provider.invalid', 'disabled', '{}'::jsonb) RETURNING id`,
    [instanceId, catalogRevisionId],
  );

  const credential = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'provider_credentials')}
       (
         provider_instance_id,
         ciphertext,
         nonce,
         auth_tag,
         algorithm,
         envelope_version,
         key_version,
         fingerprint,
         label
       )
     VALUES ($1, decode('c001', 'hex'), decode('c002', 'hex'), decode('c003', 'hex'), 'aes-256-gcm', 1, 'foundation-v1', 'foundation-credential', 'foundation')
     RETURNING id`,
    [instanceId],
  );
  const credentialId = requiredRow(credential.rows, 'provider credential').id;
  await expectQueryFailure(
    client,
    `UPDATE ${qualified(schema, 'provider_credentials')}
     SET ciphertext = decode('c101', 'hex')
     WHERE id = $1`,
    [credentialId],
    'provider credential envelope mutation',
  );
  await client.query(
    `INSERT INTO ${qualified(schema, 'pipeline_bindings')}
       (pipeline_revision_id, provider_instance_revision_id, role, position, is_default)
     VALUES ($1, $2, 'llm', 0, true)`,
    [context.pipelineRevisionId, requiredRow(instanceRevision.rows, 'provider instance revision').id],
  );
  await expectQueryFailure(
    client,
    `INSERT INTO ${qualified(schema, 'pipeline_bindings')}
       (pipeline_revision_id, provider_instance_revision_id, role, position)
     VALUES ($1, $2, 'tts', 0)`,
    [context.pipelineRevisionId, requiredRow(instanceRevision.rows, 'provider instance revision').id],
    'mismatched provider binding role',
  );
}

async function verifyFirmwareLifecycle(
  client: Client,
  schema: string,
  context: VerificationContext,
): Promise<void> {
  const firmwareWindow = await createTimeWindow(client, '10 minutes');
  const signingKey = await client.query<{ key_id: string }>(
    `INSERT INTO ${qualified(schema, 'signing_keys')}
       (
         key_id,
         algorithm,
         public_key,
         private_key_handle,
         fingerprint,
         state,
         not_before,
         not_after,
         activated_at
       )
     VALUES (
       'foundation-ed25519',
       'ed25519',
       decode('a101', 'hex'),
       'kms://foundation/ed25519',
       'foundation-ed25519-fingerprint',
       'active',
       now() - interval '1 day',
       now() + interval '1 day',
       now()
     )
     RETURNING key_id`,
  );
  const signingKeyId = requiredRow(signingKey.rows, 'active signing key').key_id;

  const unsignedArtifact = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'firmware_artifacts')}
       (storage_key, sha256_digest, byte_size, media_type)
     VALUES (
       'firmware/foundation-unsigned.bin',
       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
       1024,
       'application/octet-stream'
     )
     RETURNING id`,
  );
  await expectQueryFailure(
    client,
    `INSERT INTO ${qualified(schema, 'firmware_releases')}
       (
         firmware_artifact_id,
         board_type,
         version,
         state,
         approval_state,
         approved_by_operator_id,
         approved_at,
         published_at
       )
     VALUES ($1, 'board-a', '0.0.1-unsigned', 'published', 'approved', $2, $3, $3)`,
    [requiredRow(unsignedArtifact.rows, 'unsigned firmware artifact').id, context.operatorId, firmwareWindow.atTime],
    'publication of an unsigned firmware artifact',
  );

  const signedArtifact = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'firmware_artifacts')}
       (
         storage_key,
         sha256_digest,
         byte_size,
         media_type,
         signature_algorithm,
         signature,
         signature_key_id,
         compatibility_metadata
       )
     VALUES (
       'firmware/foundation-signed.bin',
       'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
       2048,
       'application/octet-stream',
       'ed25519',
       decode('f001', 'hex'),
       $1,
       '{"board_type":"board-a"}'::jsonb
     )
     RETURNING id`,
    [signingKeyId],
  );
  const signedArtifactId = requiredRow(signedArtifact.rows, 'signed firmware artifact').id;

  await expectQueryFailure(
    client,
    `INSERT INTO ${qualified(schema, 'firmware_releases')}
       (firmware_artifact_id, board_type, version, state, approval_state, published_at)
     VALUES ($1, 'board-a', '0.0.2-unapproved', 'published', 'pending', $2)`,
    [signedArtifactId, firmwareWindow.atTime],
    'publication of an unapproved firmware release',
  );

  const release = await client.query<{ id: string; state: string; approval_state: string }>(
    `INSERT INTO ${qualified(schema, 'firmware_releases')}
       (
         firmware_artifact_id,
         board_type,
         version,
         state,
         approval_state,
         approved_by_operator_id,
         approval_reason,
         approved_at,
         published_at
       )
     VALUES ($1, 'board-a', '0.0.3-approved', 'published', 'approved', $2, 'initial approval', $3, $3)
     RETURNING id, state, approval_state`,
    [signedArtifactId, context.operatorId, firmwareWindow.atTime],
  );
  const publishedRelease = requiredRow(release.rows, 'signed approved firmware release');
  if (publishedRelease.state !== 'published' || publishedRelease.approval_state !== 'approved') {
    throw new Error('Signed approved firmware release was not published coherently');
  }

  await expectQueryFailure(
    client,
    `UPDATE ${qualified(schema, 'firmware_artifacts')}
     SET sha256_digest = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
     WHERE id = $1`,
    [signedArtifactId],
    'published firmware artifact mutation',
  );
  await expectQueryFailure(
    client,
    `UPDATE ${qualified(schema, 'firmware_releases')}
     SET version = '0.0.3-mutated'
     WHERE id = $1`,
    [publishedRelease.id],
    'published firmware release mutation',
  );
  const rollout = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'firmware_rollouts')}
       (firmware_release_id, state, strategy, created_by_operator_id)
     VALUES ($1, 'active', 'manual', $2)
     RETURNING id`,
    [publishedRelease.id, context.operatorId],
  );
  const assignment = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'firmware_rollout_assignments')}
       (firmware_rollout_id, device_id)
     VALUES ($1, $2)
     RETURNING id`,
    [requiredRow(rollout.rows, 'active firmware rollout').id, context.deviceId],
  );
  const ticket = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'firmware_download_tickets')}
       (
         firmware_rollout_assignment_id,
         device_id,
         ticket_digest,
         ticket_salt,
         expires_at
       )
     VALUES ($1, $2, decode('f101', 'hex'), decode('f102', 'hex'), $3)
     RETURNING id`,
    [requiredRow(assignment.rows, 'firmware rollout assignment').id, context.deviceId, firmwareWindow.deadline],
  );
  const ticketId = requiredRow(ticket.rows, 'firmware download ticket').id;
  const consumeAt = await currentDatabaseTime(client);

  await expectQueryFailure(
    client,
    `SELECT * FROM ${qualified(schema, 'veetee_consume_firmware_download_ticket')}(
       decode('f101', 'hex'),
       NULL,
       $1
     )`,
    [consumeAt],
    'firmware ticket consumption without an expected device',
  );
  await expectQueryFailure(
    client,
    `SELECT * FROM ${qualified(schema, 'veetee_consume_firmware_download_ticket')}(
       decode('f101', 'hex'),
       $1,
       $2
     )`,
    [context.alternateDeviceId, consumeAt],
    'firmware ticket consumption by another device',
  );

  await client.query(
    `SELECT * FROM ${qualified(schema, 'veetee_consume_firmware_download_ticket')}(
       decode('f101', 'hex'),
       $1,
       $2
     )`,
    [context.deviceId, consumeAt],
  );
  await expectQueryFailure(
    client,
    `SELECT * FROM ${qualified(schema, 'veetee_consume_firmware_download_ticket')}(
       decode('f101', 'hex'),
       $1,
       $2
     )`,
    [context.deviceId, consumeAt],
    'repeat firmware ticket consumption',
  );

  const consumedTicket = await client.query<{ ticket_state: string; consumed_at: Date | null; assignment_state: string }>(
    `SELECT
       ticket.state AS ticket_state,
       ticket.consumed_at,
       assignment.state AS assignment_state
     FROM ${qualified(schema, 'firmware_download_tickets')} AS ticket
     JOIN ${qualified(schema, 'firmware_rollout_assignments')} AS assignment
       ON assignment.id = ticket.firmware_rollout_assignment_id
     WHERE ticket.id = $1`,
    [ticketId],
  );
  const ticketState = requiredRow(consumedTicket.rows, 'consumed firmware ticket');
  if (
    ticketState.ticket_state !== 'consumed'
    || ticketState.consumed_at === null
    || ticketState.assignment_state !== 'downloading'
  ) {
    throw new Error('Firmware ticket consumption did not advance its assigned device lifecycle');
  }

  await expectQueryFailure(
    client,
    `UPDATE ${qualified(schema, 'firmware_releases')}
     SET state = 'withdrawn', approval_reason = 'rewritten history'
     WHERE id = $1`,
    [publishedRelease.id],
    'published firmware release withdrawal with changed approval reason',
  );
  await expectQueryFailure(
    client,
    `UPDATE ${qualified(schema, 'firmware_releases')}
     SET state = 'withdrawn', created_at = created_at + interval '1 second'
     WHERE id = $1`,
    [publishedRelease.id],
    'published firmware release withdrawal with changed creation time',
  );
  await client.query(
    `UPDATE ${qualified(schema, 'firmware_releases')}
     SET state = 'withdrawn'
     WHERE id = $1`,
    [publishedRelease.id],
  );
  const withdrawnRelease = await client.query<{ state: string; approval_reason: string | null }>(
    `SELECT state, approval_reason
     FROM ${qualified(schema, 'firmware_releases')}
     WHERE id = $1`,
    [publishedRelease.id],
  );
  const withdrawnReleaseRow = requiredRow(withdrawnRelease.rows, 'withdrawn firmware release');
  if (withdrawnReleaseRow.state !== 'withdrawn' || withdrawnReleaseRow.approval_reason !== 'initial approval') {
    throw new Error('Firmware release withdrawal rewrote published history');
  }
}

async function verifyConversationLifecycle(
  client: Client,
  schema: string,
  context: VerificationContext,
): Promise<void> {
  const conversationWindow = await createTimeWindow(client, '10 minutes');
  const conversation = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'conversations')}
       (
         session_id,
         device_id,
         assistant_revision_id,
         runtime_snapshot_id,
         retention_mode,
         retention_policy_id,
         expires_at
       )
     VALUES ($1, $2, $3, $4, 'policy', $5, $6)
     RETURNING id`,
    [
      context.sessionId,
      context.deviceId,
      context.assistantRevisionId,
      context.runtimeSnapshotId,
      context.retentionPolicyId,
      conversationWindow.deadline,
    ],
  );
  const conversationId = requiredRow(conversation.rows, 'authoritative conversation').id;

  await expectQueryFailure(
    client,
    `INSERT INTO ${qualified(schema, 'conversations')}
       (
         session_id,
         device_id,
         assistant_revision_id,
         runtime_snapshot_id,
         retention_mode,
         retention_policy_id,
         expires_at
       )
     VALUES ($1, $2, $3, $4, 'policy', $5, $6)`,
    [
      context.sessionId,
      context.alternateDeviceId,
      context.assistantRevisionId,
      context.runtimeSnapshotId,
      context.retentionPolicyId,
      conversationWindow.deadline,
    ],
    'conversation whose device does not match its session identity',
  );

  const abortRequestedTurn = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'conversation_turns')}
       (conversation_id, sequence, kind, state, abort_state, abort_requested_at)
     VALUES ($1, 1, 'assistant', 'processing', 'requested', $2)
     RETURNING id`,
    [conversationId, conversationWindow.atTime],
  );
  const abortRequestedTurnId = requiredRow(abortRequestedTurn.rows, 'abort-requested turn').id;
  await client.query(
    `UPDATE ${qualified(schema, 'conversation_turns')}
     SET state = 'aborted',
         abort_state = 'aborted',
         aborted_at = $2,
         completed_at = $2
     WHERE id = $1`,
    [abortRequestedTurnId, conversationWindow.atTime],
  );
  const abortedTurn = await client.query<{
    state: string;
    abort_state: string;
    abort_requested_at: Date | null;
    aborted_at: Date | null;
    completed_at: Date | null;
  }>(
    `SELECT state, abort_state, abort_requested_at, aborted_at, completed_at
     FROM ${qualified(schema, 'conversation_turns')}
     WHERE id = $1`,
    [abortRequestedTurnId],
  );
  const abortedTurnRow = requiredRow(abortedTurn.rows, 'aborted turn');
  if (
    abortedTurnRow.state !== 'aborted'
    || abortedTurnRow.abort_state !== 'aborted'
    || abortedTurnRow.abort_requested_at === null
    || abortedTurnRow.aborted_at === null
    || abortedTurnRow.completed_at === null
  ) {
    throw new Error('Conversation turn abort lifecycle is not coherent');
  }

  await client.query(
    `INSERT INTO ${qualified(schema, 'conversation_turns')}
       (conversation_id, sequence, kind, state, abort_state, completed_at)
     VALUES ($1, 2, 'assistant', 'cancelled', 'not_requested', $2)`,
    [conversationId, conversationWindow.atTime],
  );
  await expectQueryFailure(
    client,
    `INSERT INTO ${qualified(schema, 'conversation_turns')}
       (conversation_id, sequence, kind, state, abort_state, completed_at)
     VALUES ($1, 3, 'assistant', 'aborted', 'not_requested', $2)`,
    [conversationId, conversationWindow.atTime],
    'aborted conversation turn without an aborted lifecycle state',
  );

  const metadataEvent = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'conversation_events')}
       (conversation_id, sequence, event_type, metadata)
     VALUES ($1, 1, 'turn.started', '{"source":"foundation"}'::jsonb)
     RETURNING id`,
    [conversationId],
  );
  const metadataEventId = requiredRow(metadataEvent.rows, 'metadata-only conversation event').id;
  await expectQueryFailure(
    client,
    `INSERT INTO ${qualified(schema, 'conversation_events')}
       (conversation_id, sequence, event_type, metadata)
     VALUES ($1, 2, 'turn.content', '{"content":"must-not-be-retained"}'::jsonb)`,
    [conversationId],
    'conversation event with retained content',
  );
  await expectQueryFailure(
    client,
    `UPDATE ${qualified(schema, 'conversation_events')}
     SET metadata = '{"source":"mutated"}'::jsonb
     WHERE id = $1`,
    [metadataEventId],
    'conversation event mutation',
  );
}

async function verifyMcpApprovalLifecycle(
  client: Client,
  schema: string,
  context: VerificationContext,
): Promise<void> {
  // One server-derived deadline is passed to the call and every approval fixture,
  // so approval expiry is never calculated independently from the call deadline.
  const mcpWindow = await createTimeWindow(client, '10 minutes');
  const requiredBinding = await createMcpToolBinding(client, schema, {
    sessionId: context.sessionId,
    deviceId: context.deviceId,
    namespace: 'foundation',
    toolName: 'status',
    audience: 'user',
    riskClass: 'medium',
    approvalPolicy: 'required',
  });

  const policyCall = await createMcpCall(client, schema, requiredBinding, {
    requestId: 7,
    direction: 'server_to_device',
    attempt: 0,
    deadline: mcpWindow.deadline,
    approvalExpiresAt: mcpWindow.deadline,
    approvalRequired: false,
  });
  assertMcpCallHasPolicyDerivedApproval(policyCall, mcpWindow.deadline);

  await client.query(
    `UPDATE ${qualified(schema, 'mcp_calls')}
     SET approval_required = false
     WHERE id = $1`,
    [policyCall.id],
  );
  const persistedPolicyCall = await getMcpCall(client, schema, policyCall.id);
  assertMcpCallHasPolicyDerivedApproval(persistedPolicyCall, mcpWindow.deadline);

  const policyApproval = await createMcpApproval(client, schema, policyCall.id, mcpWindow.deadline);
  assertSameInstant(policyApproval.expires_at, mcpWindow.deadline, 'MCP approval expiry');
  const approvalDecisionAt = await currentDatabaseTime(client);
  const approved = await decideMcpApproval(
    client,
    schema,
    policyApproval.id,
    context.operatorId,
    'approved',
    approvalDecisionAt,
  );
  if (approved.state !== 'approved') {
    throw new Error('MCP approval did not record the approved decision');
  }
  const approvedCall = await getMcpCall(client, schema, policyCall.id);
  if (approvedCall.state !== 'approved' || approvedCall.completed_at !== null) {
    throw new Error('MCP approval did not advance the call to approved');
  }

  const approvalGuardCount = await client.query<{ count: number }>(
    `SELECT count(*)::integer AS count
     FROM ${qualified(schema, 'mcp_approval_transition_guards')}`,
  );
  if (requiredRow(approvalGuardCount.rows, 'MCP approval evidence count').count !== 0) {
    throw new Error('MCP approval transition evidence was not consumed after the decision');
  }

  const requestIdentity = await createMcpCall(client, schema, requiredBinding, {
    requestId: 41,
    direction: 'server_to_device',
    attempt: 0,
    deadline: mcpWindow.deadline,
    approvalExpiresAt: mcpWindow.deadline,
    approvalRequired: false,
  });
  await expectFailure(
    () => createMcpCall(client, schema, requiredBinding, {
      requestId: 41,
      direction: 'server_to_device',
      attempt: 0,
      deadline: mcpWindow.deadline,
      approvalExpiresAt: mcpWindow.deadline,
      approvalRequired: false,
    }),
    'duplicate MCP session, direction, request, and attempt identity',
  );
  const retryIdentity = await createMcpCall(client, schema, requiredBinding, {
    requestId: 41,
    direction: 'server_to_device',
    attempt: 1,
    deadline: mcpWindow.deadline,
    approvalExpiresAt: mcpWindow.deadline,
    approvalRequired: false,
  });

  const unapprovedBinding = await createMcpToolBinding(client, schema, {
    sessionId: context.sessionId,
    deviceId: context.deviceId,
    namespace: 'foundation',
    toolName: 'telemetry',
    audience: 'system',
    riskClass: 'low',
    approvalPolicy: 'none',
  });
  const oppositeDirectionIdentity = await createMcpCall(client, schema, unapprovedBinding, {
    requestId: 41,
    direction: 'device_to_server',
    attempt: 0,
    deadline: mcpWindow.deadline,
    approvalExpiresAt: null,
    approvalRequired: true,
  });
  if (oppositeDirectionIdentity.approval_required || oppositeDirectionIdentity.state !== 'pending') {
    throw new Error('MCP tool policy did not remove approval from an approval-free call');
  }

  const secondSessionId = await createSession(
    client,
    schema,
    context,
    'foundation-second-wire-session',
  );
  const secondSessionBinding = await createMcpToolBinding(client, schema, {
    sessionId: secondSessionId,
    deviceId: context.deviceId,
    namespace: 'foundation',
    toolName: 'second-session-status',
    audience: 'system',
    riskClass: 'low',
    approvalPolicy: 'none',
  });
  const secondSessionIdentity = await createMcpCall(client, schema, secondSessionBinding, {
    requestId: 41,
    direction: 'server_to_device',
    attempt: 0,
    deadline: mcpWindow.deadline,
    approvalExpiresAt: null,
    approvalRequired: false,
  });
  if (
    requestIdentity.attempt !== 0
    || retryIdentity.attempt !== 1
    || oppositeDirectionIdentity.direction !== 'device_to_server'
    || secondSessionIdentity.session_id !== secondSessionId
  ) {
    throw new Error('MCP request correlation did not preserve the full request identity');
  }

  const deniedCall = await createMcpCall(client, schema, requiredBinding, {
    requestId: 51,
    direction: 'server_to_device',
    attempt: 0,
    deadline: mcpWindow.deadline,
    approvalExpiresAt: mcpWindow.deadline,
    approvalRequired: false,
  });
  const deniedApproval = await createMcpApproval(client, schema, deniedCall.id, mcpWindow.deadline);
  const deniedAt = await currentDatabaseTime(client);
  const denied = await decideMcpApproval(
    client,
    schema,
    deniedApproval.id,
    context.operatorId,
    'denied',
    deniedAt,
  );
  if (denied.state !== 'denied') {
    throw new Error('MCP approval did not record the denied decision');
  }
  await expectQueryFailure(
    client,
    `SELECT * FROM ${qualified(schema, 'veetee_decide_mcp_approval')}($1, $2, 'approved', $3)`,
    [deniedApproval.id, context.operatorId, await currentDatabaseTime(client)],
    'approval overwrite of a terminal MCP call',
  );
  const terminalCall = await getMcpCall(client, schema, deniedCall.id);
  if (terminalCall.state !== 'denied' || terminalCall.completed_at === null) {
    throw new Error('Terminal MCP call was overwritten by a later approval');
  }

  const cancelledCall = await createMcpCall(client, schema, requiredBinding, {
    requestId: 52,
    direction: 'server_to_device',
    attempt: 0,
    deadline: mcpWindow.deadline,
    approvalExpiresAt: mcpWindow.deadline,
    approvalRequired: false,
  });
  const cancelledApproval = await createMcpApproval(client, schema, cancelledCall.id, mcpWindow.deadline);
  const cancelledAt = await currentDatabaseTime(client);
  await client.query(
    `UPDATE ${qualified(schema, 'mcp_calls')}
     SET state = 'cancelled', completed_at = $2
     WHERE id = $1`,
    [cancelledCall.id, cancelledAt],
  );
  await expectQueryFailure(
    client,
    `SELECT * FROM ${qualified(schema, 'veetee_decide_mcp_approval')}($1, $2, 'approved', $3)`,
    [cancelledApproval.id, context.operatorId, await currentDatabaseTime(client)],
    'approval overwrite of a cancelled MCP call',
  );
  const persistedCancelledCall = await getMcpCall(client, schema, cancelledCall.id);
  const persistedCancelledApproval = await getMcpApproval(client, schema, cancelledApproval.id);
  if (
    persistedCancelledCall.state !== 'cancelled'
    || persistedCancelledCall.completed_at === null
    || persistedCancelledApproval.state !== 'pending'
  ) {
    throw new Error('Cancelled MCP call or pending approval was overwritten by an approval decision');
  }
}

interface McpToolBindingOptions {
  sessionId: string;
  deviceId: string;
  namespace: string;
  toolName: string;
  audience: 'system' | 'user';
  riskClass: 'low' | 'medium' | 'high' | 'critical';
  approvalPolicy: 'none' | 'required';
}

async function createMcpToolBinding(
  client: Client,
  schema: string,
  options: McpToolBindingOptions,
): Promise<McpToolBinding> {
  const tool = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'mcp_tools')}
       (device_id, namespace, tool_name, audience)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [options.deviceId, options.namespace, options.toolName, options.audience],
  );
  const toolId = requiredRow(tool.rows, 'MCP tool').id;
  const revision = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'mcp_tool_revisions')}
       (
         mcp_tool_id,
         device_id,
         revision,
         audience,
         risk_class,
         approval_policy,
         input_schema,
         output_schema
       )
     VALUES ($1, $2, 1, $3, $4, $5, '{}'::jsonb, '{}'::jsonb)
     RETURNING id`,
    [toolId, options.deviceId, options.audience, options.riskClass, options.approvalPolicy],
  );
  const revisionId = requiredRow(revision.rows, 'MCP tool revision').id;
  const sessionTool = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'session_mcp_tools')}
       (session_id, device_id, mcp_tool_id, mcp_tool_revision_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [options.sessionId, options.deviceId, toolId, revisionId],
  );

  return {
    sessionId: options.sessionId,
    deviceId: options.deviceId,
    toolId,
    revisionId,
    sessionToolId: requiredRow(sessionTool.rows, 'session MCP tool').id,
    namespace: options.namespace,
    toolName: options.toolName,
  };
}

interface McpCallOptions {
  requestId: number;
  direction: 'server_to_device' | 'device_to_server';
  attempt: number;
  deadline: Date;
  approvalExpiresAt: Date | null;
  approvalRequired: boolean;
}

async function createMcpCall(
  client: Client,
  schema: string,
  binding: McpToolBinding,
  options: McpCallOptions,
): Promise<McpCallRow> {
  const call = await client.query<McpCallRow>(
    `INSERT INTO ${qualified(schema, 'mcp_calls')}
       (
         session_id,
         device_id,
         session_mcp_tool_id,
         mcp_tool_id,
         mcp_tool_revision_id,
         method,
         tool_namespace,
         tool_name,
         request_id,
         direction,
         attempt,
         deadline_at,
         approval_required,
         approval_expires_at,
         state
       )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'pending'
     )
     RETURNING *`,
    [
      binding.sessionId,
      binding.deviceId,
      binding.sessionToolId,
      binding.toolId,
      binding.revisionId,
      'tools/call',
      binding.namespace,
      binding.toolName,
      options.requestId,
      options.direction,
      options.attempt,
      options.deadline,
      options.approvalRequired,
      options.approvalExpiresAt,
    ],
  );
  return requiredRow(call.rows, 'MCP call');
}

async function createMcpApproval(
  client: Client,
  schema: string,
  mcpCallId: string,
  expiresAt: Date,
): Promise<McpApprovalRow> {
  const approval = await client.query<McpApprovalRow>(
    `INSERT INTO ${qualified(schema, 'mcp_approvals')} (mcp_call_id, expires_at)
     VALUES ($1, $2)
     RETURNING *`,
    [mcpCallId, expiresAt],
  );
  return requiredRow(approval.rows, 'MCP approval');
}

async function decideMcpApproval(
  client: Client,
  schema: string,
  approvalId: string,
  operatorId: string,
  decision: 'approved' | 'denied',
  atTime: Date,
): Promise<McpApprovalRow> {
  const approval = await client.query<McpApprovalRow>(
    `SELECT * FROM ${qualified(schema, 'veetee_decide_mcp_approval')}($1, $2, $3, $4)`,
    [approvalId, operatorId, decision, atTime],
  );
  return requiredRow(approval.rows, 'MCP approval decision');
}

async function getMcpCall(client: Client, schema: string, callId: string): Promise<McpCallRow> {
  const call = await client.query<McpCallRow>(
    `SELECT * FROM ${qualified(schema, 'mcp_calls')} WHERE id = $1`,
    [callId],
  );
  return requiredRow(call.rows, 'persisted MCP call');
}

async function getMcpApproval(
  client: Client,
  schema: string,
  approvalId: string,
): Promise<McpApprovalRow> {
  const approval = await client.query<McpApprovalRow>(
    `SELECT * FROM ${qualified(schema, 'mcp_approvals')} WHERE id = $1`,
    [approvalId],
  );
  return requiredRow(approval.rows, 'persisted MCP approval');
}

function assertMcpCallHasPolicyDerivedApproval(call: McpCallRow, deadline: Date): void {
  if (!call.approval_required || call.state !== 'awaiting_approval') {
    throw new Error('MCP tool policy did not derive required approval for the call');
  }
  assertSameInstant(call.deadline_at, deadline, 'MCP call deadline');
  if (call.approval_expires_at === null) {
    throw new Error('Approval-required MCP call did not retain an approval expiry');
  }
  assertSameInstant(call.approval_expires_at, deadline, 'MCP call approval expiry');
}

async function verifyOutboxAndAuditMutability(client: Client, schema: string): Promise<void> {
  const outbox = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'outbox_events')} (topic, payload, deduplication_key)
     VALUES ('foundation.test', '{}'::jsonb, 'foundation-test-event') RETURNING id`,
  );
  const outboxEventId = requiredRow(outbox.rows, 'outbox event').id;
  const delivery = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'outbox_deliveries')} (outbox_event_id, destination)
     VALUES ($1, 'control-plane') RETURNING id`,
    [outboxEventId],
  );
  const deliveryId = requiredRow(delivery.rows, 'outbox delivery').id;

  await client.query(
    `UPDATE ${qualified(schema, 'outbox_deliveries')}
     SET state = 'published', attempt_count = 1, published_at = now()
     WHERE id = $1`,
    [deliveryId],
  );
  await expectQueryFailure(
    client,
    `UPDATE ${qualified(schema, 'outbox_events')} SET topic = 'changed' WHERE id = $1`,
    [outboxEventId],
    'outbox event mutation',
  );

  const audit = await client.query<{ id: string }>(
    `INSERT INTO ${qualified(schema, 'audit_events')}
       (actor_type, action, subject_type, metadata)
     VALUES ('service', 'foundation.check', 'database', '{}'::jsonb) RETURNING id`,
  );
  await expectQueryFailure(
    client,
    `UPDATE ${qualified(schema, 'audit_events')} SET action = 'changed' WHERE id = $1`,
    [requiredRow(audit.rows, 'audit event').id],
    'audit event mutation',
  );
}

async function verifySchemaIsEmpty(client: Client, schema: string): Promise<void> {
  const result = await client.query<{ table_name: string }>(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
    [schema],
  );
  const remaining = result.rows
    .map(({ table_name }) => table_name)
    .filter((tableName) => tableName !== 'schema_migrations');
  if (remaining.length > 0) {
    throw new Error(`Rollback left foundation tables behind: ${remaining.join(', ')}`);
  }
}

async function createTimeWindow(client: Client, interval: string): Promise<TimeWindow> {
  const result = await client.query<TimeWindow>(
    `SELECT now() AS "atTime", now() + $1::interval AS deadline`,
    [interval],
  );
  return requiredRow(result.rows, 'database time window');
}

async function currentDatabaseTime(client: Client): Promise<Date> {
  const result = await client.query<{ at_time: Date }>('SELECT now() AS at_time');
  return requiredRow(result.rows, 'database time').at_time;
}

async function expectQueryFailure(
  client: Client,
  text: string,
  values: readonly unknown[],
  description: string,
): Promise<void> {
  await expectFailure(() => client.query(text, [...values]), description);
}

async function expectFailure(operation: () => Promise<unknown>, description: string): Promise<void> {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error(`Expected PostgreSQL to reject ${description}`);
}

function assertSameInstant(actual: Date, expected: Date, description: string): void {
  if (actual.getTime() !== expected.getTime()) {
    throw new Error(`${description} did not retain the expected bounded timestamp`);
  }
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
    throw new Error(`Expected ${description} row`);
  }
  return row;
}

function assertEqual(
  actual: readonly string[],
  expected: readonly string[],
  description: string,
): void {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${description} mismatch: ${actual.join(', ')}`);
  }
}

export async function queryFoundationSchema(
  databaseUrl: string,
  schema: string,
): Promise<readonly string[]> {
  const { pool } = createDatabaseClient(databaseUrl);
  try {
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = $1 AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
      [schema],
    );
    return result.rows.map(({ table_name }) => table_name);
  } finally {
    await pool.end();
  }
}
