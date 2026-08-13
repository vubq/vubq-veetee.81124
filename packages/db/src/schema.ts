import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

const primaryUuid = () => uuid('id').default(sql`pg_catalog.gen_random_uuid()`).primaryKey();
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();
const jsonObjectDefault = () => sql`'{}'::jsonb`;

export const roles = pgTable('roles', {
  id: primaryUuid(),
  roleKey: varchar('role_key', { length: 128 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  state: varchar('state', { length: 32 }).default('active').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique('roles_role_key_unique').on(table.roleKey),
  check('roles_state_check', sql`${table.state} IN ('active', 'disabled')`),
]);

export const permissions = pgTable('permissions', {
  id: primaryUuid(),
  permissionKey: varchar('permission_key', { length: 128 }).notNull(),
  description: text('description'),
  createdAt: createdAt(),
}, (table) => [
  unique('permissions_permission_key_unique').on(table.permissionKey),
]);

export const operators = pgTable('operators', {
  id: primaryUuid(),
  email: varchar('email', { length: 320 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  state: varchar('state', { length: 32 }).default('active').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique('operators_email_unique').on(table.email),
  check('operators_state_check', sql`${table.state} IN ('active', 'disabled')`),
]);

export const servicePrincipals = pgTable('service_principals', {
  id: primaryUuid(),
  principalKey: varchar('principal_key', { length: 128 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  state: varchar('state', { length: 32 }).default('active').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique('service_principals_principal_key_unique').on(table.principalKey),
  check('service_principals_state_check', sql`${table.state} IN ('active', 'disabled')`),
]);

export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.roleId, table.permissionId], name: 'role_permissions_primary_key' }),
]);

export const operatorRoleGrants = pgTable('operator_role_grants', {
  operatorId: uuid('operator_id').notNull().references(() => operators.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'restrict' }),
  grantedByOperatorId: uuid('granted_by_operator_id').references(() => operators.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.operatorId, table.roleId], name: 'operator_role_grants_primary_key' }),
]);

export const servicePrincipalRoleGrants = pgTable('service_principal_role_grants', {
  servicePrincipalId: uuid('service_principal_id').notNull().references(() => servicePrincipals.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'restrict' }),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.servicePrincipalId, table.roleId], name: 'service_principal_role_grants_primary_key' }),
]);

export const operatorAuthenticators = pgTable('operator_authenticators', {
  id: primaryUuid(),
  operatorId: uuid('operator_id').notNull().references(() => operators.id, { onDelete: 'cascade' }),
  verifierDigest: bytea('verifier_digest').notNull(),
  verifierSalt: bytea('verifier_salt').notNull(),
  algorithm: varchar('algorithm', { length: 64 }).notNull(),
  authVersion: integer('auth_version').default(1).notNull(),
  createdAt: createdAt(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  unique('operator_authenticators_operator_unique').on(table.operatorId),
  check('operator_authenticators_auth_version_positive_check', sql`${table.authVersion} > 0`),
]);

export const operatorSessions = pgTable('operator_sessions', {
  id: primaryUuid(),
  operatorId: uuid('operator_id').notNull().references(() => operators.id, { onDelete: 'cascade' }),
  sessionDigest: bytea('session_digest').notNull(),
  sessionSalt: bytea('session_salt').notNull(),
  authVersion: integer('auth_version').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  unique('operator_sessions_digest_unique').on(table.sessionDigest),
  index('operator_sessions_operator_expiry_idx').on(table.operatorId, table.expiresAt),
  check('operator_sessions_auth_version_positive_check', sql`${table.authVersion} > 0`),
]);

export const servicePrincipalCredentials = pgTable('service_principal_credentials', {
  id: primaryUuid(),
  servicePrincipalId: uuid('service_principal_id').notNull().references(() => servicePrincipals.id, { onDelete: 'cascade' }),
  verifierDigest: bytea('verifier_digest').notNull(),
  verifierSalt: bytea('verifier_salt').notNull(),
  fingerprint: varchar('fingerprint', { length: 128 }).notNull(),
  createdAt: createdAt(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  unique('service_principal_credentials_fingerprint_unique').on(table.fingerprint),
]);

export const signingKeys = pgTable('signing_keys', {
  id: primaryUuid(),
  keyId: varchar('key_id', { length: 128 }).notNull(),
  algorithm: varchar('algorithm', { length: 64 }).notNull(),
  publicKey: bytea('public_key').notNull(),
  privateKeyHandle: varchar('private_key_handle', { length: 512 }).notNull(),
  fingerprint: varchar('fingerprint', { length: 128 }).notNull(),
  state: varchar('state', { length: 32 }).notNull(),
  notBefore: timestamp('not_before', { withTimezone: true }).notNull(),
  notAfter: timestamp('not_after', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  retiredAt: timestamp('retired_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  unique('signing_keys_key_id_unique').on(table.keyId),
  unique('signing_keys_fingerprint_unique').on(table.fingerprint),
  unique('signing_keys_private_key_handle_unique').on(table.privateKeyHandle),
  check('signing_keys_state_check', sql`${table.state} IN ('staged', 'active', 'retired', 'revoked')`),
  check('signing_keys_lifetime_check', sql`${table.notAfter} > ${table.notBefore}`),
  check('signing_keys_lifecycle_check', sql`(
    (${table.state} = 'staged' AND ${table.activatedAt} IS NULL AND ${table.retiredAt} IS NULL AND ${table.revokedAt} IS NULL)
    OR (${table.state} = 'active' AND ${table.activatedAt} IS NOT NULL AND ${table.retiredAt} IS NULL AND ${table.revokedAt} IS NULL)
    OR (${table.state} = 'retired' AND ${table.activatedAt} IS NOT NULL AND ${table.retiredAt} IS NOT NULL AND ${table.revokedAt} IS NULL)
    OR (${table.state} = 'revoked' AND ${table.revokedAt} IS NOT NULL)
  )`),
]);

export const assistants = pgTable('assistants', {
  id: primaryUuid(),
  assistantKey: varchar('assistant_key', { length: 128 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  state: varchar('state', { length: 32 }).default('active').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique('assistants_assistant_key_unique').on(table.assistantKey),
  check('assistants_state_check', sql`${table.state} IN ('active', 'disabled')`),
]);

export const devices = pgTable('devices', {
  id: primaryUuid(),
  hardwareId: varchar('hardware_id', { length: 17 }).notNull(),
  clientId: varchar('client_id', { length: 255 }).notNull(),
  serialNumber: varchar('serial_number', { length: 255 }),
  boardType: varchar('board_type', { length: 128 }).notNull(),
  assistantId: uuid('assistant_id').references(() => assistants.id, { onDelete: 'set null' }),
  tokenVersion: integer('token_version').default(0).notNull(),
  pairedAt: timestamp('paired_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique('devices_hardware_id_unique').on(table.hardwareId),
  unique('devices_serial_number_unique').on(table.serialNumber),
  index('devices_client_id_idx').on(table.clientId),
  index('devices_assistant_id_idx').on(table.assistantId),
  check('devices_hardware_id_canonical_mac_check', sql`${table.hardwareId} ~ '^[0-9a-f]{2}(:[0-9a-f]{2}){5}$'`),
  check('devices_token_version_nonnegative_check', sql`${table.tokenVersion} >= 0`),
]);

export const deviceIdentityHistory = pgTable('device_identity_history', {
  id: primaryUuid(),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  hardwareId: varchar('hardware_id', { length: 17 }).notNull(),
  clientId: varchar('client_id', { length: 255 }).notNull(),
  serialNumber: varchar('serial_number', { length: 255 }),
  observedAt: timestamp('observed_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index('device_identity_history_device_observed_idx').on(table.deviceId, table.observedAt),
  check('device_identity_history_hardware_id_canonical_mac_check', sql`${table.hardwareId} ~ '^[0-9a-f]{2}(:[0-9a-f]{2}){5}$'`),
]);

export const pairingRequests = pgTable('pairing_requests', {
  id: primaryUuid(),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  codeDigest: bytea('code_digest').notNull(),
  codeSalt: bytea('code_salt').notNull(),
  challengeDigest: bytea('challenge_digest').notNull(),
  challengeSalt: bytea('challenge_salt').notNull(),
  state: varchar('state', { length: 32 }).default('pending').notNull(),
  maxAttempts: integer('max_attempts').default(5).notNull(),
  attemptCount: integer('attempt_count').default(0).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  claimedByOperatorId: uuid('claimed_by_operator_id').references(() => operators.id, { onDelete: 'restrict' }),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex('pairing_requests_one_live_per_device').on(table.deviceId).where(sql`${table.state} IN ('pending', 'claimed')`),
  index('pairing_requests_expiry_idx').on(table.expiresAt),
  check('pairing_requests_attempt_count_check', sql`${table.maxAttempts} > 0 AND ${table.attemptCount} >= 0 AND ${table.attemptCount} <= ${table.maxAttempts}`),
  check('pairing_requests_state_check', sql`${table.state} IN ('pending', 'claimed', 'consumed', 'expired', 'cancelled', 'locked')`),
  check('pairing_requests_state_coherent_check', sql`(
    (${table.state} = 'pending' AND ${table.claimedAt} IS NULL AND ${table.claimedByOperatorId} IS NULL AND ${table.consumedAt} IS NULL)
    OR (${table.state} = 'claimed' AND ${table.claimedAt} IS NOT NULL AND ${table.claimedByOperatorId} IS NOT NULL AND ${table.consumedAt} IS NULL)
    OR (${table.state} = 'consumed' AND ${table.claimedAt} IS NOT NULL AND ${table.claimedByOperatorId} IS NOT NULL AND ${table.consumedAt} IS NOT NULL)
    OR (${table.state} IN ('expired', 'cancelled', 'locked') AND ${table.consumedAt} IS NULL)
  )`),
]);

export const pairingAttempts = pgTable('pairing_attempts', {
  id: primaryUuid(),
  pairingRequestId: uuid('pairing_request_id').notNull().references(() => pairingRequests.id, { onDelete: 'cascade' }),
  attemptNumber: integer('attempt_number').notNull(),
  outcome: varchar('outcome', { length: 32 }).notNull(),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('pairing_attempts_request_number_unique').on(table.pairingRequestId, table.attemptNumber),
  check('pairing_attempts_number_positive_check', sql`${table.attemptNumber} > 0`),
  check('pairing_attempts_outcome_check', sql`${table.outcome} IN ('accepted', 'rejected', 'expired', 'locked')`),
]);

export const pairingConsumptions = pgTable('pairing_consumptions', {
  id: primaryUuid(),
  pairingRequestId: uuid('pairing_request_id').notNull().references(() => pairingRequests.id, { onDelete: 'restrict' }),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'restrict' }),
  activationProofDigest: bytea('activation_proof_digest').notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('pairing_consumptions_request_unique').on(table.pairingRequestId),
]);

export const providerCatalogs = pgTable('provider_catalogs', {
  id: primaryUuid(),
  providerKey: varchar('provider_key', { length: 128 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  state: varchar('state', { length: 32 }).default('active').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique('provider_catalogs_provider_key_unique').on(table.providerKey),
  check('provider_catalogs_state_check', sql`${table.state} IN ('active', 'disabled')`),
]);

export const providerCatalogRevisions = pgTable('provider_catalog_revisions', {
  id: primaryUuid(),
  catalogId: uuid('catalog_id').notNull().references(() => providerCatalogs.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  role: varchar('role', { length: 32 }).notNull(),
  configurationSchema: jsonb('configuration_schema').notNull(),
  state: varchar('state', { length: 32 }).default('draft').notNull(),
  createdAt: createdAt(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
}, (table) => [
  unique('provider_catalog_revisions_catalog_revision_unique').on(table.catalogId, table.revision),
  unique('provider_catalog_revisions_id_role_unique').on(table.id, table.role),
  check('provider_catalog_revisions_role_check', sql`${table.role} IN ('llm', 'asr', 'tts', 'vad', 'memory', 'intent')`),
  check('provider_catalog_revisions_state_check', sql`${table.state} IN ('draft', 'published')`),
  check('provider_catalog_revisions_lifecycle_check', sql`(
    (${table.state} = 'draft' AND ${table.publishedAt} IS NULL)
    OR (${table.state} = 'published' AND ${table.publishedAt} IS NOT NULL)
  )`),
  check('provider_catalog_revisions_revision_positive_check', sql`${table.revision} > 0`),
]);

export const providerInstances = pgTable('provider_instances', {
  id: primaryUuid(),
  instanceKey: varchar('instance_key', { length: 128 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  state: varchar('state', { length: 32 }).default('active').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique('provider_instances_instance_key_unique').on(table.instanceKey),
  check('provider_instances_state_check', sql`${table.state} IN ('active', 'disabled')`),
]);

export const providerInstanceRevisions = pgTable('provider_instance_revisions', {
  id: primaryUuid(),
  instanceId: uuid('instance_id').notNull().references(() => providerInstances.id, { onDelete: 'cascade' }),
  catalogRevisionId: uuid('catalog_revision_id').notNull().references(() => providerCatalogRevisions.id, { onDelete: 'restrict' }),
  role: varchar('role', { length: 32 }).notNull(),
  revision: integer('revision').notNull(),
  endpoint: varchar('endpoint', { length: 2048 }).notNull(),
  model: varchar('model', { length: 512 }),
  timeoutMs: integer('timeout_ms'),
  requestProfile: jsonb('request_profile').default(jsonObjectDefault()).notNull(),
  responseMapping: jsonb('response_mapping').default(jsonObjectDefault()).notNull(),
  networkScope: varchar('network_scope', { length: 32 }).notNull(),
  networkPolicy: jsonb('network_policy').default(jsonObjectDefault()).notNull(),
  healthCheck: jsonb('health_check').default(jsonObjectDefault()).notNull(),
  healthStatus: varchar('health_status', { length: 32 }).default('unknown').notNull(),
  healthCheckedAt: timestamp('health_checked_at', { withTimezone: true }),
  configuration: jsonb('configuration').notNull(),
  state: varchar('state', { length: 32 }).default('draft').notNull(),
  createdAt: createdAt(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
}, (table) => [
  unique('provider_instance_revisions_instance_revision_unique').on(table.instanceId, table.revision),
  unique('provider_instance_revisions_role_unique').on(table.id, table.role),
  foreignKey({
    name: 'provider_instance_revisions_catalog_role_fk',
    columns: [table.catalogRevisionId, table.role],
    foreignColumns: [providerCatalogRevisions.id, providerCatalogRevisions.role],
  }).onDelete('restrict'),
  check('provider_instance_revisions_role_check', sql`${table.role} IN ('llm', 'asr', 'tts', 'vad', 'memory', 'intent')`),
  check('provider_instance_revisions_network_scope_check', sql`${table.networkScope} IN ('public', 'local-allowlisted', 'disabled')`),
  check('provider_instance_revisions_timeout_positive_check', sql`${table.timeoutMs} IS NULL OR ${table.timeoutMs} > 0`),
  check('provider_instance_revisions_health_status_check', sql`${table.healthStatus} IN ('unknown', 'healthy', 'degraded', 'unhealthy')`),
  check('provider_instance_revisions_state_check', sql`${table.state} IN ('draft', 'published')`),
  check('provider_instance_revisions_lifecycle_check', sql`(
    (${table.state} = 'draft' AND ${table.publishedAt} IS NULL)
    OR (${table.state} = 'published' AND ${table.publishedAt} IS NOT NULL)
  )`),
  check('provider_instance_revisions_revision_positive_check', sql`${table.revision} > 0`),
]);

export const providerCredentials = pgTable('provider_credentials', {
  id: primaryUuid(),
  providerInstanceId: uuid('provider_instance_id').notNull().references(() => providerInstances.id, { onDelete: 'restrict' }),
  ciphertext: bytea('ciphertext').notNull(),
  nonce: bytea('nonce').notNull(),
  authTag: bytea('auth_tag').notNull(),
  algorithm: varchar('algorithm', { length: 64 }).notNull(),
  envelopeVersion: integer('envelope_version').notNull(),
  keyVersion: varchar('key_version', { length: 128 }).notNull(),
  fingerprint: varchar('fingerprint', { length: 128 }).notNull(),
  label: varchar('label', { length: 255 }).notNull(),
  state: varchar('state', { length: 32 }).default('active').notNull(),
  createdAt: createdAt(),
  activatedAt: timestamp('activated_at', { withTimezone: true }).defaultNow().notNull(),
  quarantinedAt: timestamp('quarantined_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  lastValidatedAt: timestamp('last_validated_at', { withTimezone: true }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
}, (table) => [
  unique('provider_credentials_instance_fingerprint_unique').on(table.providerInstanceId, table.fingerprint),
  unique('provider_credentials_instance_label_unique').on(table.providerInstanceId, table.label),
  check('provider_credentials_algorithm_not_empty_check', sql`length(${table.algorithm}) > 0`),
  check('provider_credentials_envelope_version_positive_check', sql`${table.envelopeVersion} > 0`),
  check('provider_credentials_key_version_not_empty_check', sql`length(${table.keyVersion}) > 0`),
  check('provider_credentials_nonce_not_empty_check', sql`octet_length(${table.nonce}) > 0`),
  check('provider_credentials_auth_tag_not_empty_check', sql`octet_length(${table.authTag}) > 0`),
  check('provider_credentials_state_check', sql`${table.state} IN ('active', 'quarantined', 'revoked')`),
  check('provider_credentials_lifecycle_check', sql`(
    (${table.state} = 'active' AND ${table.activatedAt} IS NOT NULL AND ${table.revokedAt} IS NULL)
    OR (${table.state} = 'quarantined' AND ${table.activatedAt} IS NOT NULL AND ${table.quarantinedAt} IS NOT NULL AND ${table.revokedAt} IS NULL)
    OR (${table.state} = 'revoked' AND ${table.activatedAt} IS NOT NULL AND ${table.revokedAt} IS NOT NULL)
  )`),
]);

export const pipelineProfiles = pgTable('pipeline_profiles', {
  id: primaryUuid(),
  profileKey: varchar('profile_key', { length: 128 }).notNull(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique('pipeline_profiles_profile_key_unique').on(table.profileKey),
]);

export const pipelineRevisions = pgTable('pipeline_revisions', {
  id: primaryUuid(),
  pipelineProfileId: uuid('pipeline_profile_id').notNull().references(() => pipelineProfiles.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  policy: jsonb('policy').notNull(),
  state: varchar('state', { length: 32 }).default('draft').notNull(),
  createdAt: createdAt(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
}, (table) => [
  unique('pipeline_revisions_profile_revision_unique').on(table.pipelineProfileId, table.revision),
  check('pipeline_revisions_state_check', sql`${table.state} IN ('draft', 'published')`),
  check('pipeline_revisions_lifecycle_check', sql`(
    (${table.state} = 'draft' AND ${table.publishedAt} IS NULL)
    OR (${table.state} = 'published' AND ${table.publishedAt} IS NOT NULL)
  )`),
  check('pipeline_revisions_revision_positive_check', sql`${table.revision} > 0`),
]);

export const retentionPolicies = pgTable('retention_policies', {
  id: primaryUuid(),
  policyKey: varchar('policy_key', { length: 128 }).notNull(),
  conversationDays: integer('conversation_days').notNull(),
  eventDays: integer('event_days').notNull(),
  auditDays: integer('audit_days').notNull(),
  createdAt: createdAt(),
}, (table) => [
  unique('retention_policies_policy_key_unique').on(table.policyKey),
  check('retention_policies_nonnegative_check', sql`${table.conversationDays} >= 0 AND ${table.eventDays} >= 0 AND ${table.auditDays} >= 0`),
]);

export const assistantRevisions = pgTable('assistant_revisions', {
  id: primaryUuid(),
  assistantId: uuid('assistant_id').notNull().references(() => assistants.id, { onDelete: 'cascade' }),
  pipelineProfileId: uuid('pipeline_profile_id').notNull().references(() => pipelineProfiles.id, { onDelete: 'restrict' }),
  retentionPolicyId: uuid('retention_policy_id').notNull().references(() => retentionPolicies.id, { onDelete: 'restrict' }),
  revision: integer('revision').notNull(),
  configuration: jsonb('configuration').notNull(),
  state: varchar('state', { length: 32 }).default('draft').notNull(),
  createdAt: createdAt(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
}, (table) => [
  unique('assistant_revisions_assistant_revision_unique').on(table.assistantId, table.revision),
  check('assistant_revisions_state_check', sql`${table.state} IN ('draft', 'published')`),
  check('assistant_revisions_lifecycle_check', sql`(
    (${table.state} = 'draft' AND ${table.publishedAt} IS NULL)
    OR (${table.state} = 'published' AND ${table.publishedAt} IS NOT NULL)
  )`),
  check('assistant_revisions_revision_positive_check', sql`${table.revision} > 0`),
]);

export const pipelineBindings = pgTable('pipeline_bindings', {
  id: primaryUuid(),
  pipelineRevisionId: uuid('pipeline_revision_id').notNull().references(() => pipelineRevisions.id, { onDelete: 'cascade' }),
  providerInstanceRevisionId: uuid('provider_instance_revision_id').notNull().references(() => providerInstanceRevisions.id, { onDelete: 'restrict' }),
  role: varchar('role', { length: 32 }).notNull(),
  position: integer('position').notNull(),
  isDefault: boolean('is_default').default(false).notNull(),
  createdAt: createdAt(),
}, (table) => [
  unique('pipeline_bindings_revision_role_position_unique').on(table.pipelineRevisionId, table.role, table.position),
  foreignKey({
    name: 'pipeline_bindings_provider_role_fk',
    columns: [table.providerInstanceRevisionId, table.role],
    foreignColumns: [providerInstanceRevisions.id, providerInstanceRevisions.role],
  }).onDelete('restrict'),
  uniqueIndex('pipeline_bindings_one_default_per_revision_role').on(table.pipelineRevisionId, table.role).where(sql`${table.isDefault} = true`),
  check('pipeline_bindings_role_check', sql`${table.role} IN ('llm', 'asr', 'tts', 'vad', 'memory', 'intent')`),
  check('pipeline_bindings_position_nonnegative_check', sql`${table.position} >= 0`),
]);

export const runtimeSnapshots = pgTable('runtime_snapshots', {
  id: primaryUuid(),
  pipelineRevisionId: uuid('pipeline_revision_id').notNull().references(() => pipelineRevisions.id, { onDelete: 'restrict' }),
  snapshot: jsonb('snapshot').notNull(),
  contentDigest: varchar('content_digest', { length: 128 }).notNull(),
  createdAt: createdAt(),
}, (table) => [
  unique('runtime_snapshots_content_digest_unique').on(table.contentDigest),
]);

export const firmwareArtifacts = pgTable('firmware_artifacts', {
  id: primaryUuid(),
  storageKey: varchar('storage_key', { length: 512 }).notNull(),
  sha256Digest: varchar('sha256_digest', { length: 64 }).notNull(),
  byteSize: integer('byte_size').notNull(),
  mediaType: varchar('media_type', { length: 255 }).notNull(),
  signatureAlgorithm: varchar('signature_algorithm', { length: 64 }).default('none').notNull(),
  signature: bytea('signature'),
  signatureKeyId: varchar('signature_key_id', { length: 128 }).references(() => signingKeys.keyId, { onDelete: 'restrict' }),
  compatibilityMetadata: jsonb('compatibility_metadata').default(jsonObjectDefault()).notNull(),
  createdAt: createdAt(),
}, (table) => [
  unique('firmware_artifacts_storage_key_unique').on(table.storageKey),
  unique('firmware_artifacts_sha256_digest_unique').on(table.sha256Digest),
  check('firmware_artifacts_byte_size_positive_check', sql`${table.byteSize} > 0`),
  check('firmware_artifacts_compatibility_metadata_object_check', sql`jsonb_typeof(${table.compatibilityMetadata}) = 'object'`),
  check('firmware_artifacts_signature_coherent_check', sql`(
    (${table.signatureAlgorithm} IN ('none', 'unsigned') AND ${table.signature} IS NULL AND ${table.signatureKeyId} IS NULL)
    OR (${table.signatureAlgorithm} NOT IN ('none', 'unsigned') AND ${table.signature} IS NOT NULL AND ${table.signatureKeyId} IS NOT NULL)
  )`),
  check('firmware_artifacts_signature_nonempty_check', sql`${table.signature} IS NULL OR octet_length(${table.signature}) > 0`),
]);

export const firmwareReleases = pgTable('firmware_releases', {
  id: primaryUuid(),
  firmwareArtifactId: uuid('firmware_artifact_id').notNull().references(() => firmwareArtifacts.id, { onDelete: 'restrict' }),
  boardType: varchar('board_type', { length: 128 }).notNull(),
  version: varchar('version', { length: 128 }).notNull(),
  minimumProtocolVersion: integer('minimum_protocol_version').default(1).notNull(),
  minimumBootloaderVersion: varchar('minimum_bootloader_version', { length: 128 }).default('0').notNull(),
  state: varchar('state', { length: 32 }).default('draft').notNull(),
  approvalState: varchar('approval_state', { length: 32 }).default('pending').notNull(),
  approvedByOperatorId: uuid('approved_by_operator_id').references(() => operators.id, { onDelete: 'restrict' }),
  approvalReason: text('approval_reason'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  unique('firmware_releases_board_version_unique').on(table.boardType, table.version),
  check('firmware_releases_state_check', sql`${table.state} IN ('draft', 'published', 'withdrawn')`),
  check('firmware_releases_approval_state_check', sql`${table.approvalState} IN ('pending', 'approved', 'rejected', 'revoked')`),
  check('firmware_releases_minimum_protocol_version_positive_check', sql`${table.minimumProtocolVersion} > 0`),
  check('firmware_releases_minimum_bootloader_version_nonempty_check', sql`length(btrim(${table.minimumBootloaderVersion})) > 0`),
  check('firmware_releases_approval_coherent_check', sql`${table.approvalState} <> 'approved' OR (${table.approvedByOperatorId} IS NOT NULL AND ${table.approvedAt} IS NOT NULL)`),
  check('firmware_releases_published_at_coherent_check', sql`${table.state} <> 'published' OR ${table.publishedAt} IS NOT NULL`),
]);

export const firmwareRollouts = pgTable('firmware_rollouts', {
  id: primaryUuid(),
  firmwareReleaseId: uuid('firmware_release_id').notNull().references(() => firmwareReleases.id, { onDelete: 'restrict' }),
  state: varchar('state', { length: 32 }).default('draft').notNull(),
  strategy: varchar('strategy', { length: 32 }).notNull(),
  targetPolicy: jsonb('target_policy').default(jsonObjectDefault()).notNull(),
  stagedPercentage: integer('staged_percentage').default(100).notNull(),
  failureThresholdPercentage: integer('failure_threshold_percentage').default(10).notNull(),
  maintenanceWindow: jsonb('maintenance_window').default(jsonObjectDefault()).notNull(),
  maintenanceWindowStartAt: timestamp('maintenance_window_start_at', { withTimezone: true }),
  maintenanceWindowEndAt: timestamp('maintenance_window_end_at', { withTimezone: true }),
  forceUpdate: boolean('force_update').default(false).notNull(),
  forceReason: text('force_reason'),
  forceApprovedByOperatorId: uuid('force_approved_by_operator_id').references(() => operators.id, { onDelete: 'restrict' }),
  forceApprovedAt: timestamp('force_approved_at', { withTimezone: true }),
  rollbackPolicy: varchar('rollback_policy', { length: 32 }).default('none').notNull(),
  rollbackState: varchar('rollback_state', { length: 32 }).default('not_started').notNull(),
  rollbackReason: text('rollback_reason'),
  createdByOperatorId: uuid('created_by_operator_id').references(() => operators.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  check('firmware_rollouts_state_check', sql`${table.state} IN ('draft', 'active', 'paused', 'completed', 'cancelled', 'rolling_back', 'rolled_back', 'rollback_failed')`),
  check('firmware_rollouts_strategy_check', sql`${table.strategy} IN ('manual', 'phased')`),
  check('firmware_rollouts_target_policy_object_check', sql`jsonb_typeof(${table.targetPolicy}) = 'object'`),
  check('firmware_rollouts_staged_percentage_check', sql`${table.stagedPercentage} BETWEEN 0 AND 100`),
  check('firmware_rollouts_failure_threshold_percentage_check', sql`${table.failureThresholdPercentage} BETWEEN 0 AND 100`),
  check('firmware_rollouts_maintenance_window_object_check', sql`jsonb_typeof(${table.maintenanceWindow}) = 'object'`),
  check('firmware_rollouts_maintenance_window_order_check', sql`${table.maintenanceWindowStartAt} IS NULL OR ${table.maintenanceWindowEndAt} IS NULL OR ${table.maintenanceWindowEndAt} > ${table.maintenanceWindowStartAt}`),
  check('firmware_rollouts_force_approval_coherent_check', sql`(
    (${table.forceUpdate} = false AND ${table.forceReason} IS NULL AND ${table.forceApprovedByOperatorId} IS NULL AND ${table.forceApprovedAt} IS NULL)
    OR (
      ${table.forceUpdate} = true
      AND ${table.forceReason} IS NOT NULL
      AND length(btrim(${table.forceReason})) > 0
      AND ${table.forceApprovedByOperatorId} IS NOT NULL
      AND ${table.forceApprovedAt} IS NOT NULL
    )
  )`),
  check('firmware_rollouts_rollback_policy_check', sql`${table.rollbackPolicy} IN ('none', 'manual', 'automatic', 'automatic_on_threshold')`),
  check('firmware_rollouts_rollback_state_check', sql`${table.rollbackState} IN ('not_started', 'not_required', 'pending', 'in_progress', 'completed', 'failed', 'rolled_back')`),
  check('firmware_rollouts_rollback_coherent_check', sql`${table.rollbackPolicy} <> 'none' OR ${table.rollbackState} IN ('not_started', 'not_required')`),
  check('firmware_rollouts_completion_order_check', sql`${table.completedAt} IS NULL OR ${table.startedAt} IS NOT NULL`),
]);

export const firmwareRolloutAssignments = pgTable('firmware_rollout_assignments', {
  id: primaryUuid(),
  firmwareRolloutId: uuid('firmware_rollout_id').notNull().references(() => firmwareRollouts.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  state: varchar('state', { length: 32 }).default('pending').notNull(),
  attemptCount: integer('attempt_count').default(0).notNull(),
  lastErrorCode: varchar('last_error_code', { length: 128 }),
  failureReason: text('failure_reason'),
  observedVersion: varchar('observed_version', { length: 128 }),
  observedResult: jsonb('observed_result'),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
  offeredAt: timestamp('offered_at', { withTimezone: true }),
  downloadStartedAt: timestamp('download_started_at', { withTimezone: true }),
  downloadedAt: timestamp('downloaded_at', { withTimezone: true }),
  installStartedAt: timestamp('install_started_at', { withTimezone: true }),
  installedAt: timestamp('installed_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  rollbackStartedAt: timestamp('rollback_started_at', { withTimezone: true }),
  rolledBackAt: timestamp('rolled_back_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  unique('firmware_rollout_assignments_rollout_device_unique').on(table.firmwareRolloutId, table.deviceId),
  unique('firmware_rollout_assignments_id_device_unique').on(table.id, table.deviceId),
  index('firmware_rollout_assignments_state_idx').on(table.state),
  check('firmware_rollout_assignments_state_check', sql`${table.state} IN ('pending', 'offered', 'downloading', 'downloaded', 'installing', 'installed', 'failed', 'download_failed', 'install_failed', 'rollback_pending', 'rolling_back', 'rolled_back', 'rollback_failed', 'cancelled')`),
  check('firmware_rollout_assignments_attempt_count_nonnegative_check', sql`${table.attemptCount} >= 0`),
  check('firmware_rollout_assignments_completion_coherent_check', sql`(
    (${table.state} IN ('pending', 'offered', 'downloading', 'downloaded', 'installing', 'rollback_pending', 'rolling_back') AND ${table.completedAt} IS NULL)
    OR (${table.state} IN ('installed', 'failed', 'download_failed', 'install_failed', 'rolled_back', 'rollback_failed', 'cancelled') AND ${table.completedAt} IS NOT NULL)
  )`),
  check('firmware_rollout_assignments_observed_result_object_check', sql`${table.observedResult} IS NULL OR jsonb_typeof(${table.observedResult}) = 'object'`),
]);

export const firmwareDownloadTickets = pgTable('firmware_download_tickets', {
  id: primaryUuid(),
  firmwareRolloutAssignmentId: uuid('firmware_rollout_assignment_id').notNull(),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  state: varchar('state', { length: 32 }).default('issued').notNull(),
  ticketDigest: bytea('ticket_digest').notNull(),
  ticketSalt: bytea('ticket_salt').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  expiredAt: timestamp('expired_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  foreignKey({
    name: 'firmware_download_tickets_assignment_device_fk',
    columns: [table.firmwareRolloutAssignmentId, table.deviceId],
    foreignColumns: [firmwareRolloutAssignments.id, firmwareRolloutAssignments.deviceId],
  }).onDelete('cascade'),
  unique('firmware_download_tickets_digest_unique').on(table.ticketDigest),
  index('firmware_download_tickets_device_expiry_idx').on(table.deviceId, table.expiresAt),
  index('firmware_download_tickets_active_expiry_idx').on(table.expiresAt).where(sql`${table.state} IN ('issued', 'active')`),
  check('firmware_download_tickets_state_check', sql`${table.state} IN ('issued', 'active', 'consumed', 'expired', 'revoked')`),
  check('firmware_download_tickets_lifecycle_coherent_check', sql`(
    (${table.state} IN ('issued', 'active') AND ${table.consumedAt} IS NULL AND ${table.expiredAt} IS NULL AND ${table.revokedAt} IS NULL)
    OR (${table.state} = 'consumed' AND ${table.consumedAt} IS NOT NULL AND ${table.expiredAt} IS NULL AND ${table.revokedAt} IS NULL)
    OR (${table.state} = 'expired' AND ${table.consumedAt} IS NULL AND ${table.expiredAt} IS NOT NULL AND ${table.revokedAt} IS NULL)
    OR (${table.state} = 'revoked' AND ${table.consumedAt} IS NULL AND ${table.expiredAt} IS NULL AND ${table.revokedAt} IS NOT NULL)
  )`),
]);

export const sessions = pgTable('sessions', {
  id: primaryUuid(),
  wireSessionId: varchar('wire_session_id', { length: 128 }).default(sql`pg_catalog.gen_random_uuid()::text`).notNull(),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  assistantRevisionId: uuid('assistant_revision_id').references(() => assistantRevisions.id, { onDelete: 'restrict' }),
  runtimeSnapshotId: uuid('runtime_snapshot_id').notNull().references(() => runtimeSnapshots.id, { onDelete: 'restrict' }),
  protocolVersion: integer('protocol_version').default(1).notNull(),
  transport: varchar('transport', { length: 32 }).default('websocket').notNull(),
  state: varchar('state', { length: 32 }).default('active').notNull(),
  endReason: varchar('end_reason', { length: 128 }),
  retentionMode: varchar('retention_mode', { length: 32 }).default('metadata').notNull(),
  retentionPolicyId: uuid('retention_policy_id').references(() => retentionPolicies.id, { onDelete: 'restrict' }),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).default(sql`(now() + interval '1 day')`).notNull(),
  errorCode: varchar('error_code', { length: 128 }),
  errorMetadata: jsonb('error_metadata'),
  createdAt: createdAt(),
}, (table) => [
  unique('sessions_wire_session_id_unique').on(table.wireSessionId),
  unique('sessions_id_device_assistant_runtime_retention_unique').on(
    table.id,
    table.deviceId,
    table.assistantRevisionId,
    table.runtimeSnapshotId,
    table.retentionPolicyId,
    table.retentionMode,
  ),
  unique('sessions_id_device_unique').on(table.id, table.deviceId),
  index('sessions_device_started_idx').on(table.deviceId, table.startedAt),
  index('sessions_expiry_idx').on(table.expiresAt).where(sql`${table.state} = 'active'`),
  check('sessions_wire_session_id_nonempty_check', sql`length(btrim(${table.wireSessionId})) > 0`),
  check('sessions_protocol_version_positive_check', sql`${table.protocolVersion} > 0`),
  check('sessions_transport_nonempty_check', sql`length(btrim(${table.transport})) > 0`),
  check('sessions_state_check', sql`${table.state} IN ('active', 'ended', 'failed', 'expired', 'terminated')`),
  check('sessions_retention_mode_check', sql`${table.retentionMode} IN ('none', 'metadata', 'policy')`),
  check('sessions_end_after_start_check', sql`${table.endedAt} IS NULL OR ${table.endedAt} >= ${table.startedAt}`),
  check('sessions_expiry_after_start_check', sql`${table.expiresAt} >= ${table.startedAt}`),
  check('sessions_error_metadata_object_check', sql`${table.errorMetadata} IS NULL OR jsonb_typeof(${table.errorMetadata}) = 'object'`),
  check('sessions_lifecycle_coherent_check', sql`(
    (${table.state} = 'active' AND ${table.endedAt} IS NULL AND ${table.endReason} IS NULL)
    OR (${table.state} IN ('ended', 'expired', 'terminated') AND ${table.endedAt} IS NOT NULL)
    OR (${table.state} = 'failed' AND ${table.endedAt} IS NOT NULL AND ${table.errorCode} IS NOT NULL)
  )`),
]);

export const conversations = pgTable('conversations', {
  id: primaryUuid(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  assistantRevisionId: uuid('assistant_revision_id').notNull().references(() => assistantRevisions.id, { onDelete: 'restrict' }),
  runtimeSnapshotId: uuid('runtime_snapshot_id').notNull().references(() => runtimeSnapshots.id, { onDelete: 'restrict' }),
  retentionMode: varchar('retention_mode', { length: 32 }).default('metadata').notNull(),
  retentionPolicyId: uuid('retention_policy_id').notNull().references(() => retentionPolicies.id, { onDelete: 'restrict' }),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (table) => [
  foreignKey({
    name: 'conversations_session_identity_fk',
    columns: [
      table.sessionId,
      table.deviceId,
      table.assistantRevisionId,
      table.runtimeSnapshotId,
      table.retentionPolicyId,
      table.retentionMode,
    ],
    foreignColumns: [
      sessions.id,
      sessions.deviceId,
      sessions.assistantRevisionId,
      sessions.runtimeSnapshotId,
      sessions.retentionPolicyId,
      sessions.retentionMode,
    ],
  }).onDelete('cascade'),
  index('conversations_session_started_idx').on(table.sessionId, table.startedAt),
  index('conversations_expiry_idx').on(table.expiresAt),
  check('conversations_retention_mode_check', sql`${table.retentionMode} IN ('none', 'metadata', 'policy')`),
  check('conversations_end_after_start_check', sql`${table.endedAt} IS NULL OR ${table.endedAt} >= ${table.startedAt}`),
  check('conversations_expiry_after_start_check', sql`${table.expiresAt} >= ${table.startedAt}`),
]);

export const conversationTurns = pgTable('conversation_turns', {
  id: primaryUuid(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  kind: varchar('kind', { length: 32 }).notNull(),
  state: varchar('state', { length: 32 }).default('pending').notNull(),
  abortState: varchar('abort_state', { length: 32 }).default('not_requested').notNull(),
  contentDigest: varchar('content_digest', { length: 128 }),
  errorCode: varchar('error_code', { length: 128 }),
  errorMetadata: jsonb('error_metadata'),
  abortRequestedAt: timestamp('abort_requested_at', { withTimezone: true }),
  abortedAt: timestamp('aborted_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('conversation_turns_conversation_sequence_unique').on(table.conversationId, table.sequence),
  index('conversation_turns_conversation_state_idx').on(table.conversationId, table.state),
  check('conversation_turns_sequence_positive_check', sql`${table.sequence} > 0`),
  check('conversation_turns_kind_check', sql`${table.kind} IN ('user', 'assistant', 'system', 'tool')`),
  check('conversation_turns_state_check', sql`${table.state} IN ('pending', 'processing', 'completed', 'failed', 'aborted', 'cancelled')`),
  check('conversation_turns_abort_state_check', sql`${table.abortState} IN ('not_requested', 'requested', 'acknowledged', 'aborted')`),
  check('conversation_turns_error_metadata_object_check', sql`${table.errorMetadata} IS NULL OR jsonb_typeof(${table.errorMetadata}) = 'object'`),
  check('conversation_turns_abort_lifecycle_coherent_check', sql`(
    (${table.abortState} = 'not_requested' AND ${table.abortRequestedAt} IS NULL AND ${table.abortedAt} IS NULL)
    OR (${table.abortState} IN ('requested', 'acknowledged') AND ${table.abortRequestedAt} IS NOT NULL AND ${table.abortedAt} IS NULL)
    OR (${table.abortState} = 'aborted' AND ${table.abortRequestedAt} IS NOT NULL AND ${table.abortedAt} IS NOT NULL)
  )`),
  check('conversation_turns_completion_coherent_check', sql`(
    (${table.state} IN ('pending', 'processing') AND ${table.completedAt} IS NULL)
    OR (${table.state} IN ('completed', 'failed', 'aborted', 'cancelled') AND ${table.completedAt} IS NOT NULL)
  )`),
  check('conversation_turns_state_abort_lifecycle_coherent_check', sql`(
    (${table.state} = 'aborted' AND ${table.abortState} = 'aborted')
    OR (${table.state} <> 'aborted' AND ${table.abortState} <> 'aborted')
  )`),
]);

export const conversationEvents = pgTable('conversation_events', {
  id: primaryUuid(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  sequence: integer('sequence').notNull(),
  eventType: varchar('event_type', { length: 64 }).notNull(),
  metadata: jsonb('metadata').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  unique('conversation_events_conversation_sequence_unique').on(table.conversationId, table.sequence),
  check('conversation_events_sequence_positive_check', sql`${table.sequence} > 0`),
  check('conversation_events_metadata_only_check', sql`jsonb_typeof(${table.metadata}) = 'object' AND NOT (${table.metadata} ?| ARRAY['audio', 'audio_url', 'content', 'raw_audio', 'transcript'])`),
]);

export const mcpTools = pgTable('mcp_tools', {
  id: primaryUuid(),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  namespace: varchar('namespace', { length: 128 }).notNull(),
  toolName: varchar('tool_name', { length: 255 }).notNull(),
  audience: varchar('audience', { length: 32 }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique('mcp_tools_device_namespace_name_unique').on(table.deviceId, table.namespace, table.toolName),
  unique('mcp_tools_id_device_unique').on(table.id, table.deviceId),
  check('mcp_tools_audience_check', sql`${table.audience} IN ('system', 'user')`),
]);

export const mcpToolRevisions = pgTable('mcp_tool_revisions', {
  id: primaryUuid(),
  mcpToolId: uuid('mcp_tool_id').notNull(),
  deviceId: uuid('device_id').notNull(),
  revision: integer('revision').notNull(),
  audience: varchar('audience', { length: 32 }).default('user').notNull(),
  riskClass: varchar('risk_class', { length: 32 }).default('medium').notNull(),
  approvalPolicy: varchar('approval_policy', { length: 32 }).default('required').notNull(),
  inputSchema: jsonb('input_schema').notNull(),
  outputSchema: jsonb('output_schema').notNull(),
  createdAt: createdAt(),
}, (table) => [
  unique('mcp_tool_revisions_tool_revision_unique').on(table.mcpToolId, table.revision),
  unique('mcp_tool_revisions_id_tool_device_unique').on(table.id, table.mcpToolId, table.deviceId),
  foreignKey({
    name: 'mcp_tool_revisions_tool_device_fk',
    columns: [table.mcpToolId, table.deviceId],
    foreignColumns: [mcpTools.id, mcpTools.deviceId],
  }).onDelete('cascade'),
  check('mcp_tool_revisions_revision_positive_check', sql`${table.revision} > 0`),
  check('mcp_tool_revisions_audience_check', sql`${table.audience} IN ('system', 'user')`),
  check('mcp_tool_revisions_risk_class_check', sql`${table.riskClass} IN ('low', 'medium', 'high', 'critical')`),
  check('mcp_tool_revisions_approval_policy_check', sql`${table.approvalPolicy} IN ('none', 'required')`),
  check('mcp_tool_revisions_policy_coherent_check', sql`(
    (${table.audience} <> 'user' OR ${table.approvalPolicy} = 'required')
    AND (${table.riskClass} NOT IN ('high', 'critical') OR ${table.approvalPolicy} = 'required')
  )`),
]);

export const sessionMcpTools = pgTable('session_mcp_tools', {
  id: primaryUuid(),
  sessionId: uuid('session_id').notNull(),
  deviceId: uuid('device_id').notNull(),
  mcpToolId: uuid('mcp_tool_id').notNull(),
  mcpToolRevisionId: uuid('mcp_tool_revision_id').notNull(),
  createdAt: createdAt(),
}, (table) => [
  unique('session_mcp_tools_session_tool_revision_unique').on(table.sessionId, table.mcpToolRevisionId),
  unique('session_mcp_tools_id_identity_unique').on(table.id, table.sessionId, table.deviceId, table.mcpToolId, table.mcpToolRevisionId),
  foreignKey({
    name: 'session_mcp_tools_session_device_fk',
    columns: [table.sessionId, table.deviceId],
    foreignColumns: [sessions.id, sessions.deviceId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'session_mcp_tools_revision_identity_fk',
    columns: [table.mcpToolRevisionId, table.mcpToolId, table.deviceId],
    foreignColumns: [mcpToolRevisions.id, mcpToolRevisions.mcpToolId, mcpToolRevisions.deviceId],
  }).onDelete('restrict'),
]);

export const mcpCalls = pgTable('mcp_calls', {
  id: primaryUuid(),
  sessionId: uuid('session_id').notNull(),
  deviceId: uuid('device_id').notNull(),
  sessionMcpToolId: uuid('session_mcp_tool_id').notNull(),
  mcpToolId: uuid('mcp_tool_id').notNull(),
  mcpToolRevisionId: uuid('mcp_tool_revision_id').notNull(),
  method: varchar('method', { length: 255 }).default('tools/call').notNull(),
  toolNamespace: varchar('tool_namespace', { length: 128 }).notNull(),
  toolName: varchar('tool_name', { length: 255 }).notNull(),
  requestId: integer('request_id').notNull(),
  direction: varchar('direction', { length: 32 }).notNull(),
  attempt: integer('attempt').default(0).notNull(),
  deadlineAt: timestamp('deadline_at', { withTimezone: true }).default(sql`(now() + interval '5 minutes')`).notNull(),
  approvalRequired: boolean('approval_required').default(false).notNull(),
  approvalExpiresAt: timestamp('approval_expires_at', { withTimezone: true }),
  state: varchar('state', { length: 32 }).default('pending').notNull(),
  createdAt: createdAt(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => [
  unique('mcp_calls_session_request_unique').on(table.sessionId, table.direction, table.requestId, table.attempt),
  foreignKey({
    name: 'mcp_calls_session_device_fk',
    columns: [table.sessionId, table.deviceId],
    foreignColumns: [sessions.id, sessions.deviceId],
  }).onDelete('cascade'),
  foreignKey({
    name: 'mcp_calls_session_tool_identity_fk',
    columns: [table.sessionMcpToolId, table.sessionId, table.deviceId, table.mcpToolId, table.mcpToolRevisionId],
    foreignColumns: [sessionMcpTools.id, sessionMcpTools.sessionId, sessionMcpTools.deviceId, sessionMcpTools.mcpToolId, sessionMcpTools.mcpToolRevisionId],
  }).onDelete('restrict'),
  check('mcp_calls_request_id_nonnegative_check', sql`${table.requestId} >= 0 AND ${table.requestId} <= 2147483647`),
  check('mcp_calls_direction_check', sql`${table.direction} IN ('server_to_device', 'device_to_server')`),
  check('mcp_calls_attempt_nonnegative_check', sql`${table.attempt} >= 0`),
  check('mcp_calls_method_nonempty_check', sql`length(btrim(${table.method})) > 0`),
  check('mcp_calls_tool_identity_nonempty_check', sql`length(btrim(${table.toolNamespace})) > 0 AND length(btrim(${table.toolName})) > 0`),
  check('mcp_calls_deadline_after_creation_check', sql`${table.deadlineAt} > ${table.createdAt}`),
  check('mcp_calls_approval_state_coherent_check', sql`(
    (${table.approvalRequired} = false AND ${table.approvalExpiresAt} IS NULL)
    OR (${table.approvalRequired} = true AND ${table.direction} = 'server_to_device' AND ${table.approvalExpiresAt} IS NOT NULL)
  )`),
  check('mcp_calls_state_check', sql`${table.state} IN ('pending', 'awaiting_approval', 'approved', 'denied', 'expired', 'dispatched', 'succeeded', 'failed', 'completed', 'cancelled')`),
  check('mcp_calls_completion_state_coherent_check', sql`(
    (${table.state} IN ('pending', 'awaiting_approval', 'approved', 'dispatched') AND ${table.completedAt} IS NULL)
    OR (${table.state} IN ('denied', 'expired', 'succeeded', 'failed', 'completed', 'cancelled') AND ${table.completedAt} IS NOT NULL)
  )`),
]);

export const mcpApprovals = pgTable('mcp_approvals', {
  id: primaryUuid(),
  mcpCallId: uuid('mcp_call_id').notNull().references(() => mcpCalls.id, { onDelete: 'cascade' }),
  operatorId: uuid('operator_id').references(() => operators.id, { onDelete: 'restrict' }),
  state: varchar('state', { length: 32 }).default('pending').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  decidedAt: timestamp('decided_at', { withTimezone: true }),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex('mcp_approvals_one_active_per_call').on(table.mcpCallId).where(sql`${table.state} = 'pending'`),
  index('mcp_approvals_pending_expiry_idx').on(table.expiresAt).where(sql`${table.state} = 'pending'`),
  check('mcp_approvals_state_check', sql`${table.state} IN ('pending', 'approved', 'denied', 'expired')`),
  check('mcp_approvals_expiry_after_creation_check', sql`${table.expiresAt} > ${table.createdAt}`),
  check('mcp_approvals_state_coherent_check', sql`(
    (${table.state} = 'pending' AND ${table.operatorId} IS NULL AND ${table.decidedAt} IS NULL)
    OR (${table.state} IN ('approved', 'denied') AND ${table.operatorId} IS NOT NULL AND ${table.decidedAt} IS NOT NULL)
    OR (${table.state} = 'expired' AND ${table.operatorId} IS NULL AND ${table.decidedAt} IS NOT NULL)
  )`),
]);

export const mcpApprovalTransitionGuards = pgTable('mcp_approval_transition_guards', {
  approvalId: uuid('approval_id').notNull().references(() => mcpApprovals.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
}, (table) => [
  primaryKey({ columns: [table.approvalId], name: 'mcp_approval_transition_guards_pkey' }),
]);

export const auditEvents = pgTable('audit_events', {
  id: primaryUuid(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  actorType: varchar('actor_type', { length: 32 }).notNull(),
  actorId: uuid('actor_id'),
  action: varchar('action', { length: 128 }).notNull(),
  subjectType: varchar('subject_type', { length: 128 }).notNull(),
  subjectId: uuid('subject_id'),
  metadata: jsonb('metadata').notNull(),
});

export const outboxEvents = pgTable('outbox_events', {
  id: primaryUuid(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  topic: varchar('topic', { length: 255 }).notNull(),
  payload: jsonb('payload').notNull(),
  deduplicationKey: varchar('deduplication_key', { length: 255 }).notNull(),
}, (table) => [
  unique('outbox_events_deduplication_key_unique').on(table.deduplicationKey),
]);

export const outboxDeliveries = pgTable('outbox_deliveries', {
  id: primaryUuid(),
  outboxEventId: uuid('outbox_event_id').notNull().references(() => outboxEvents.id, { onDelete: 'cascade' }),
  destination: varchar('destination', { length: 255 }).notNull(),
  state: varchar('state', { length: 32 }).default('pending').notNull(),
  attemptCount: integer('attempt_count').default(0).notNull(),
  nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  lastErrorCode: varchar('last_error_code', { length: 128 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  unique('outbox_deliveries_event_destination_unique').on(table.outboxEventId, table.destination),
  index('outbox_deliveries_pending_idx').on(table.nextAttemptAt).where(sql`${table.state} IN ('pending', 'retrying')`),
  check('outbox_deliveries_state_check', sql`${table.state} IN ('pending', 'retrying', 'published', 'failed')`),
  check('outbox_deliveries_attempt_count_nonnegative_check', sql`${table.attemptCount} >= 0`),
]);

export const databaseTables = {
  roles,
  permissions,
  operators,
  servicePrincipals,
  rolePermissions,
  operatorRoleGrants,
  servicePrincipalRoleGrants,
  operatorAuthenticators,
  operatorSessions,
  servicePrincipalCredentials,
  signingKeys,
  assistants,
  devices,
  deviceIdentityHistory,
  pairingRequests,
  pairingAttempts,
  pairingConsumptions,
  providerCatalogs,
  providerCatalogRevisions,
  providerInstances,
  providerInstanceRevisions,
  providerCredentials,
  pipelineProfiles,
  pipelineRevisions,
  retentionPolicies,
  assistantRevisions,
  pipelineBindings,
  runtimeSnapshots,
  firmwareArtifacts,
  firmwareReleases,
  firmwareRollouts,
  firmwareRolloutAssignments,
  firmwareDownloadTickets,
  sessions,
  conversations,
  conversationTurns,
  conversationEvents,
  mcpTools,
  mcpToolRevisions,
  mcpApprovalTransitionGuards,
  sessionMcpTools,
  mcpCalls,
  mcpApprovals,
  auditEvents,
  outboxEvents,
  outboxDeliveries,
} as const;
