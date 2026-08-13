import { getTableConfig, type AnyPgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';

import { discoverMigrations, migrationGlob } from '../src/migration-manifest.js';
import * as schema from '../src/schema.js';

function columns(table: AnyPgTable): readonly string[] {
  return getTableConfig(table).columns.map(({ name }) => name);
}

function uniqueColumns(table: AnyPgTable): readonly (readonly string[])[] {
  return getTableConfig(table).uniqueConstraints.map(({ columns: constraintColumns }) => (
    constraintColumns.map(({ name }) => name)
  ));
}

function checkNames(table: AnyPgTable): readonly string[] {
  return getTableConfig(table).checks.map(({ name }) => name);
}

function indexNames(table: AnyPgTable): readonly string[] {
  return getTableConfig(table).indexes.flatMap(({ config }) => (
    config.name === undefined ? [] : [config.name]
  ));
}

interface ForeignKeyShape {
  name: string;
  columns: readonly string[];
  foreignTable: string;
  foreignColumns: readonly string[];
  onDelete: string | undefined;
}

function foreignKeys(table: AnyPgTable): readonly ForeignKeyShape[] {
  return getTableConfig(table).foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();
    return {
      name: foreignKey.getName(),
      columns: reference.columns.map(({ name }) => name),
      foreignTable: getTableConfig(reference.foreignTable).name,
      foreignColumns: reference.foreignColumns.map(({ name }) => name),
      onDelete: foreignKey.onDelete,
    };
  });
}

function primaryKeyColumns(table: AnyPgTable): readonly string[] {
  const config = getTableConfig(table);
  const compositeColumns = config.primaryKeys.flatMap(({ columns: keyColumns }) => (
    keyColumns.map(({ name }) => name)
  ));
  return compositeColumns.length > 0
    ? compositeColumns
    : config.columns.filter(({ primary }) => primary).map(({ name }) => name);
}

function expectForeignKey(
  table: AnyPgTable,
  expected: Omit<ForeignKeyShape, 'name'> & { name?: string },
): void {
  expect(foreignKeys(table)).toEqual(expect.arrayContaining([
    expect.objectContaining(expected),
  ]));
}

function expectColumns(table: AnyPgTable, expected: readonly string[]): void {
  expect(columns(table)).toEqual(expect.arrayContaining([...expected]));
}


function migration(migrations: Awaited<ReturnType<typeof discoverMigrations>>, id: string) {
  const found = migrations.find((candidate) => candidate.id === id);
  expect(found, `expected migration ${id}`).toBeDefined();
  return found!;
}

describe('PostgreSQL foundation Drizzle schema', () => {
  it('uses Drizzle declarations as the only exported schema metadata source', () => {
    expect('databaseSchema' in schema).toBe(false);

    const tables = [
      schema.roles,
      schema.permissions,
      schema.operators,
      schema.servicePrincipals,
      schema.signingKeys,
      schema.assistants,
      schema.devices,
      schema.deviceIdentityHistory,
      schema.pairingRequests,
      schema.pairingAttempts,
      schema.pairingConsumptions,
      schema.providerCatalogs,
      schema.providerCatalogRevisions,
      schema.providerInstances,
      schema.providerInstanceRevisions,
      schema.providerCredentials,
      schema.pipelineProfiles,
      schema.pipelineRevisions,
      schema.assistantRevisions,
      schema.pipelineBindings,
      schema.runtimeSnapshots,
      schema.firmwareArtifacts,
      schema.firmwareReleases,
      schema.firmwareRollouts,
      schema.firmwareRolloutAssignments,
      schema.firmwareDownloadTickets,
      schema.sessions,
      schema.conversations,
      schema.conversationTurns,
      schema.conversationEvents,
      schema.mcpTools,
      schema.mcpToolRevisions,
      schema.mcpApprovalTransitionGuards,
      schema.sessionMcpTools,
      schema.mcpCalls,
      schema.mcpApprovals,
      schema.auditEvents,
      schema.outboxEvents,
      schema.outboxDeliveries,
    ];

    expect(tables.map((table) => getTableConfig(table).name)).toEqual(expect.arrayContaining([
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
      'mcp_approval_transition_guards',
      'session_mcp_tools',
      'mcp_calls',
      'mcp_approvals',
      'audit_events',
      'outbox_events',
      'outbox_deliveries',
    ]));
  });

  it('models RBAC, service authentication, and signing material without plaintext credentials', () => {
    expectColumns(schema.roles, ['id', 'role_key', 'state']);
    expectColumns(schema.permissions, ['id', 'permission_key']);
    expectColumns(schema.rolePermissions, ['role_id', 'permission_id']);
    expectColumns(schema.operatorRoleGrants, ['operator_id', 'role_id', 'granted_by_operator_id']);
    expectColumns(schema.servicePrincipalRoleGrants, ['service_principal_id', 'role_id']);
    expectColumns(schema.operatorAuthenticators, [
      'operator_id',
      'verifier_digest',
      'verifier_salt',
      'algorithm',
      'auth_version',
      'revoked_at',
    ]);
    expectColumns(schema.operatorSessions, [
      'operator_id',
      'session_digest',
      'session_salt',
      'auth_version',
      'expires_at',
      'revoked_at',
    ]);
    expectColumns(schema.servicePrincipalCredentials, [
      'service_principal_id',
      'verifier_digest',
      'verifier_salt',
      'fingerprint',
    ]);
    expectColumns(schema.signingKeys, [
      'key_id',
      'algorithm',
      'public_key',
      'private_key_handle',
      'fingerprint',
      'state',
      'not_before',
      'not_after',
      'activated_at',
      'retired_at',
      'revoked_at',
    ]);
    expect(columns(schema.signingKeys)).not.toEqual(expect.arrayContaining([
      'private_key_ciphertext',
      'encrypted_dek',
    ]));
    expect(uniqueColumns(schema.signingKeys)).toEqual(expect.arrayContaining([
      ['private_key_handle'],
    ]));
    expect(checkNames(schema.signingKeys)).toEqual(expect.arrayContaining([
      'signing_keys_state_check',
      'signing_keys_lifecycle_check',
    ]));

    for (const table of [
      schema.operatorAuthenticators,
      schema.operatorSessions,
      schema.servicePrincipalCredentials,
      schema.signingKeys,
    ]) {
      expect(columns(table)).not.toEqual(expect.arrayContaining([
        'password',
        'secret',
        'token',
        'private_key',
        'api_key',
      ]));
    }
  });

  it('uses a canonical MAC identity and allows client identifiers to recur across devices', () => {
    expectColumns(schema.devices, [
      'hardware_id',
      'client_id',
      'serial_number',
      'board_type',
      'token_version',
      'paired_at',
      'revoked_at',
    ]);
    expect(uniqueColumns(schema.devices)).toEqual(expect.arrayContaining([
      ['hardware_id'],
    ]));
    expect(uniqueColumns(schema.devices)).not.toEqual(expect.arrayContaining([
      ['client_id'],
    ]));
    expect(indexNames(schema.devices)).toContain('devices_client_id_idx');
    expect(checkNames(schema.devices)).toContain('devices_hardware_id_canonical_mac_check');
    expectColumns(schema.deviceIdentityHistory, [
      'device_id',
      'hardware_id',
      'client_id',
      'observed_at',
    ]);
  });

  it('persists pairing verifiers, challenge state, attempts, and consumption as coherent records', () => {
    expectColumns(schema.pairingRequests, [
      'device_id',
      'code_digest',
      'code_salt',
      'challenge_digest',
      'challenge_salt',
      'state',
      'max_attempts',
      'attempt_count',
      'claimed_at',
      'claimed_by_operator_id',
      'consumed_at',
    ]);
    expectColumns(schema.pairingAttempts, [
      'pairing_request_id',
      'attempt_number',
      'outcome',
      'attempted_at',
    ]);
    expectColumns(schema.pairingConsumptions, [
      'pairing_request_id',
      'device_id',
      'activation_proof_digest',
      'consumed_at',
    ]);
    expect(columns(schema.pairingRequests)).not.toEqual(expect.arrayContaining([
      'code',
      'pairing_code',
      'challenge',
      'activation_code',
    ]));
    expect(indexNames(schema.pairingRequests)).toContain('pairing_requests_one_live_per_device');
    expect(checkNames(schema.pairingRequests)).toContain('pairing_requests_state_coherent_check');
  });

  it('pins provider, pipeline, assistant, and runtime configuration to immutable revisions', () => {
    expectColumns(schema.providerCatalogRevisions, [
      'catalog_id',
      'revision',
      'role',
      'configuration_schema',
      'state',
      'published_at',
    ]);
    expectColumns(schema.providerInstanceRevisions, [
      'instance_id',
      'catalog_revision_id',
      'role',
      'revision',
      'endpoint',
      'model',
      'timeout_ms',
      'request_profile',
      'response_mapping',
      'network_scope',
      'network_policy',
      'health_check',
      'health_status',
      'health_checked_at',
      'configuration',
      'state',
      'published_at',
    ]);
    expectColumns(schema.providerCredentials, [
      'provider_instance_id',
      'ciphertext',
      'nonce',
      'auth_tag',
      'algorithm',
      'envelope_version',
      'key_version',
      'fingerprint',
      'label',
      'state',
      'activated_at',
      'quarantined_at',
      'revoked_at',
      'last_validated_at',
      'last_used_at',
    ]);
    expectColumns(schema.pipelineRevisions, ['pipeline_profile_id', 'revision', 'policy', 'state', 'published_at']);
    expectColumns(schema.assistantRevisions, [
      'assistant_id',
      'pipeline_profile_id',
      'retention_policy_id',
      'revision',
      'configuration',
      'state',
      'published_at',
    ]);
    expect(uniqueColumns(schema.providerCredentials)).toEqual(expect.arrayContaining([
      ['provider_instance_id', 'fingerprint'],
      ['provider_instance_id', 'label'],
    ]));
    expect(foreignKeys(schema.providerInstanceRevisions)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'provider_instance_revisions_catalog_role_fk' }),
    ]));
    expectColumns(schema.pipelineBindings, [
      'pipeline_revision_id',
      'provider_instance_revision_id',
      'role',
      'position',
      'is_default',
    ]);
    expect(indexNames(schema.pipelineBindings)).toContain(
      'pipeline_bindings_one_default_per_revision_role',
    );
    expectColumns(schema.runtimeSnapshots, ['pipeline_revision_id', 'snapshot', 'content_digest']);
  });

  it('models firmware rollout, device-scoped ticket verifiers, retention metadata, and metadata-only conversations', () => {
    expectColumns(schema.firmwareArtifacts, [
      'storage_key',
      'sha256_digest',
      'byte_size',
      'media_type',
      'signature_algorithm',
      'signature',
      'signature_key_id',
      'compatibility_metadata',
    ]);
    expectColumns(schema.firmwareReleases, [
      'firmware_artifact_id',
      'board_type',
      'version',
      'minimum_protocol_version',
      'minimum_bootloader_version',
      'state',
      'approval_state',
      'approved_by_operator_id',
      'approval_reason',
      'approved_at',
      'published_at',
    ]);
    expectColumns(schema.firmwareRollouts, [
      'firmware_release_id',
      'state',
      'strategy',
      'target_policy',
      'staged_percentage',
      'failure_threshold_percentage',
      'maintenance_window',
      'maintenance_window_start_at',
      'maintenance_window_end_at',
      'force_update',
      'force_reason',
      'force_approved_by_operator_id',
      'force_approved_at',
      'rollback_policy',
      'rollback_state',
      'rollback_reason',
    ]);
    expectColumns(schema.firmwareRolloutAssignments, [
      'firmware_rollout_id',
      'device_id',
      'state',
      'attempt_count',
      'last_error_code',
      'failure_reason',
      'observed_version',
      'observed_result',
      'offered_at',
      'download_started_at',
      'downloaded_at',
      'install_started_at',
      'installed_at',
      'failed_at',
      'rollback_started_at',
      'rolled_back_at',
      'completed_at',
    ]);
    expectColumns(schema.firmwareDownloadTickets, [
      'firmware_rollout_assignment_id',
      'device_id',
      'state',
      'ticket_digest',
      'ticket_salt',
      'expires_at',
      'consumed_at',
      'expired_at',
      'revoked_at',
    ]);
    expect(uniqueColumns(schema.firmwareRolloutAssignments)).toEqual(expect.arrayContaining([
      ['id', 'device_id'],
    ]));
    expect(foreignKeys(schema.firmwareDownloadTickets)).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'firmware_download_tickets_assignment_device_fk' }),
    ]));
    expect(columns(schema.firmwareDownloadTickets)).not.toContain('ticket');
    expectColumns(schema.retentionPolicies, ['conversation_days', 'event_days', 'audit_days']);
    expectColumns(schema.sessions, [
      'wire_session_id',
      'device_id',
      'assistant_revision_id',
      'runtime_snapshot_id',
      'protocol_version',
      'transport',
      'state',
      'end_reason',
      'retention_mode',
      'retention_policy_id',
      'started_at',
      'ended_at',
      'expires_at',
      'error_code',
      'error_metadata',
    ]);
    expect(uniqueColumns(schema.sessions)).toEqual(expect.arrayContaining([
      ['wire_session_id'],
      ['id', 'device_id', 'assistant_revision_id', 'runtime_snapshot_id', 'retention_policy_id', 'retention_mode'],
      ['id', 'device_id'],
    ]));
    expect(indexNames(schema.sessions)).toEqual(expect.arrayContaining([
      'sessions_device_started_idx',
      'sessions_expiry_idx',
    ]));
    expectColumns(schema.conversations, [
      'session_id',
      'device_id',
      'assistant_revision_id',
      'runtime_snapshot_id',
      'retention_mode',
      'retention_policy_id',
      'started_at',
      'ended_at',
      'expires_at',
    ]);
    expectForeignKey(schema.conversations, {
      name: 'conversations_session_identity_fk',
      columns: [
        'session_id',
        'device_id',
        'assistant_revision_id',
        'runtime_snapshot_id',
        'retention_policy_id',
        'retention_mode',
      ],
      foreignTable: 'sessions',
      foreignColumns: [
        'id',
        'device_id',
        'assistant_revision_id',
        'runtime_snapshot_id',
        'retention_policy_id',
        'retention_mode',
      ],
      onDelete: 'cascade',
    });
    expectColumns(schema.conversationTurns, [
      'conversation_id',
      'sequence',
      'kind',
      'state',
      'abort_state',
      'content_digest',
      'error_code',
      'error_metadata',
      'abort_requested_at',
      'aborted_at',
      'completed_at',
    ]);
    expect(indexNames(schema.conversationTurns)).toContain('conversation_turns_conversation_state_idx');
    expectColumns(schema.conversationEvents, ['conversation_id', 'sequence', 'event_type', 'metadata']);
    expect(checkNames(schema.conversationEvents)).toContain('conversation_events_metadata_only_check');

    for (const table of [schema.conversations, schema.conversationTurns, schema.conversationEvents]) {
      expect(columns(table)).not.toEqual(expect.arrayContaining([
        'audio',
        'audio_url',
        'raw_audio',
        'transcript',
        'content',
      ]));
    }
  });

  it('normalizes MCP discovery, calls, and approvals, with immutable events and mutable delivery state', () => {
    expectColumns(schema.mcpTools, ['device_id', 'namespace', 'tool_name', 'audience']);
    expect(uniqueColumns(schema.mcpTools)).toEqual(expect.arrayContaining([
      ['id', 'device_id'],
    ]));
    expectColumns(schema.mcpToolRevisions, [
      'mcp_tool_id',
      'device_id',
      'revision',
      'audience',
      'risk_class',
      'approval_policy',
      'input_schema',
      'output_schema',
    ]);
    expectForeignKey(schema.mcpToolRevisions, {
      name: 'mcp_tool_revisions_tool_device_fk',
      columns: ['mcp_tool_id', 'device_id'],
      foreignTable: 'mcp_tools',
      foreignColumns: ['id', 'device_id'],
      onDelete: 'cascade',
    });
    expectColumns(schema.mcpApprovalTransitionGuards, ['approval_id', 'created_at']);
    expect(primaryKeyColumns(schema.mcpApprovalTransitionGuards)).toEqual(['approval_id']);
    expectColumns(schema.sessionMcpTools, [
      'session_id',
      'device_id',
      'mcp_tool_id',
      'mcp_tool_revision_id',
    ]);
    expectForeignKey(schema.sessionMcpTools, {
      name: 'session_mcp_tools_session_device_fk',
      columns: ['session_id', 'device_id'],
      foreignTable: 'sessions',
      foreignColumns: ['id', 'device_id'],
      onDelete: 'cascade',
    });
    expectForeignKey(schema.sessionMcpTools, {
      name: 'session_mcp_tools_revision_identity_fk',
      columns: ['mcp_tool_revision_id', 'mcp_tool_id', 'device_id'],
      foreignTable: 'mcp_tool_revisions',
      foreignColumns: ['id', 'mcp_tool_id', 'device_id'],
      onDelete: 'restrict',
    });
    expectColumns(schema.mcpCalls, [
      'session_id',
      'device_id',
      'session_mcp_tool_id',
      'mcp_tool_id',
      'mcp_tool_revision_id',
      'method',
      'tool_namespace',
      'tool_name',
      'request_id',
      'direction',
      'attempt',
      'deadline_at',
      'approval_required',
      'approval_expires_at',
      'state',
      'completed_at',
    ]);
    expect(uniqueColumns(schema.mcpCalls)).toEqual(expect.arrayContaining([
      ['session_id', 'direction', 'request_id', 'attempt'],
    ]));
    expectForeignKey(schema.mcpCalls, {
      name: 'mcp_calls_session_tool_identity_fk',
      columns: ['session_mcp_tool_id', 'session_id', 'device_id', 'mcp_tool_id', 'mcp_tool_revision_id'],
      foreignTable: 'session_mcp_tools',
      foreignColumns: ['id', 'session_id', 'device_id', 'mcp_tool_id', 'mcp_tool_revision_id'],
      onDelete: 'restrict',
    });
    expectColumns(schema.mcpApprovals, [
      'mcp_call_id',
      'operator_id',
      'state',
      'expires_at',
      'decided_at',
    ]);
    expect(indexNames(schema.mcpApprovals)).toEqual(expect.arrayContaining([
      'mcp_approvals_one_active_per_call',
      'mcp_approvals_pending_expiry_idx',
    ]));
    expectColumns(schema.outboxEvents, ['topic', 'payload', 'deduplication_key', 'occurred_at']);
    expect(columns(schema.outboxEvents)).not.toContain('published_at');
    expectColumns(schema.outboxDeliveries, [
      'outbox_event_id',
      'destination',
      'state',
      'attempt_count',
      'next_attempt_at',
      'published_at',
    ]);
  });
});

describe('reversible ordered PostgreSQL migrations', () => {
  it('discovers source or built migration modules without declaration-file matches', async () => {
    const migrations = await discoverMigrations();

    expect(migrations.map(({ id }) => id)).toEqual([
      '0001_access_control',
      '0002_devices_pairing',
      '0003_provider_pipelines',
      '0004_firmware_delivery',
      '0005_conversation_retention',
      '0006_mcp_audit_outbox',
    ]);
    expect(migrationGlob).toMatch(/\[0-9\].*\.(ts|js)$/);
    expect(migrationGlob).not.toContain('.d.ts');

    for (const entry of migrations) {
      expect(entry.id).toMatch(/^\d{4}_[a-z0-9_]+$/);
      expect(entry.up.trim(), `${entry.id} up migration`).not.toBe('');
      expect(entry.down.trim(), `${entry.id} down migration`).not.toBe('');
    }
  });

  it('declares the security and lifecycle constraints in the migrations that own them', async () => {
    const migrations = await discoverMigrations();
    const devicePairing = migration(migrations, '0002_devices_pairing').up;
    const providers = migration(migrations, '0003_provider_pipelines').up;
    const outbox = migration(migrations, '0006_mcp_audit_outbox').up;

    const accessControl = migration(migrations, '0001_access_control').up;
    const firmware = migration(migrations, '0004_firmware_delivery').up;
    const conversation = migration(migrations, '0005_conversation_retention').up;

    expect(accessControl).toContain('private_key_handle varchar(512) NOT NULL');
    expect(accessControl).toContain('signing_keys_private_key_handle_unique');
    expect(accessControl).toContain('signing_keys_lifecycle');
    expect(accessControl).toContain('veetee_enforce_signing_key_lifecycle');
    expect(devicePairing).toMatch(/hardware_id ~ '\^\[0-9a-f\]\{2\}/);
    expect(devicePairing).toContain("WHERE state IN ('pending', 'claimed')");
    expect(devicePairing).toContain('veetee_record_pairing_attempt');
    expect(devicePairing).toContain('veetee_consume_pairing_request');
    expect(providers).toContain('pipeline_bindings_one_default_per_revision_role');
    expect(providers).toContain('provider_instance_revisions_role_unique');
    expect(providers).toContain('provider_instance_revisions_catalog_role_fk');
    expect(providers).toContain('pipeline_bindings_provider_role_fk');
    expect(providers).toContain('provider_credentials_lifecycle');
    expect(providers).toContain('provider credential envelope and identity fields are immutable');
    expect(firmware).toContain('firmware_download_tickets_assignment_device_fk');
    expect(firmware).toContain('firmware_rollout_assignments_id_device_unique');
    expect(conversation).toContain('conversations_session_identity_fk');
    expect(conversation).toContain('conversation_turns_abort_lifecycle_coherent_check');
    expect(outbox).toContain('CREATE TABLE outbox_events');
    expect(outbox).toContain('CREATE TABLE outbox_deliveries');
    expect(outbox).toContain('mcp_approval_transition_guards');
    expect(outbox).toContain('mcp_approvals_one_active_per_call');
    expect(outbox).not.toContain('mcp_approval_transition_guards_prevent_direct_delete');
    expect(outbox).toContain('mcp_approvals_prevent_direct_delete');
    expect(outbox).toContain('mcp_calls_prevent_direct_delete');
    expect(outbox).toContain('outbox_events_immutable');
    expect(outbox).not.toContain('outbox_deliveries_immutable');
    expect(outbox).toContain('veetee_decide_mcp_approval');
    expect(outbox).toContain("'awaiting_approval'");
  });
});
