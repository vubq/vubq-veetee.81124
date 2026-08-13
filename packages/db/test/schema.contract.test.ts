import { describe, expect, it } from 'vitest';

import { databaseSchema as exportedDatabaseSchema } from '../src/schema.js';
import { discoverMigrations as exportedDiscoverMigrations } from '../src/migrations/index.js';

type ConstraintKind = 'check' | 'foreignKey' | 'partialUnique' | 'unique';
type DeleteAction = 'cascade' | 'restrict' | 'setNull';

interface SchemaColumn {
  name: string;
  nullable: boolean;
  default?: unknown;
}

interface SchemaConstraint {
  kind: ConstraintKind;
  columns: readonly string[];
  nullsDistinct?: boolean;
  onDelete?: DeleteAction;
  predicate?: string;
  references?: string;
}

interface SchemaTable {
  name: string;
  columns: readonly SchemaColumn[];
  constraints: readonly SchemaConstraint[];
  mutability?: 'appendOnly' | 'mutable';
}

interface DatabaseSchema {
  tables: readonly SchemaTable[];
}

interface Migration {
  id: string;
  up: string;
  down: string;
}

const databaseSchema = exportedDatabaseSchema as DatabaseSchema;
const discoverMigrations = exportedDiscoverMigrations as () => Promise<readonly Migration[]>;

function table(schema: DatabaseSchema, name: string): SchemaTable {
  const found = schema.tables.find((candidate) => candidate.name === name);
  expect(found, `expected exported table ${name}`).toBeDefined();
  return found!;
}

function column(schema: DatabaseSchema, tableName: string, columnName: string): SchemaColumn {
  const found = table(schema, tableName).columns.find((candidate) => candidate.name === columnName);
  expect(found, `expected ${tableName}.${columnName}`).toBeDefined();
  return found!;
}

function constraint(
  schema: DatabaseSchema,
  tableName: string,
  kind: SchemaConstraint['kind'],
  columns: readonly string[],
  options: Partial<SchemaConstraint> = {},
): SchemaConstraint {
  const found = table(schema, tableName).constraints.find((candidate) => (
    candidate.kind === kind
    && candidate.columns.length === columns.length
    && candidate.columns.every((name, index) => name === columns[index])
    && Object.entries(options).every(([key, value]) => (
      candidate[key as keyof SchemaConstraint] === value
    ))
  ));
  expect(
    found,
    `expected ${kind} constraint on ${tableName}(${columns.join(', ')})`,
  ).toBeDefined();
  return found!;
}

function expectColumns(
  schema: DatabaseSchema,
  tableName: string,
  expected: readonly string[],
): void {
  expect(table(schema, tableName).columns.map(({ name }) => name)).toEqual(
    expect.arrayContaining([...expected]),
  );
}

function expectNoPlaintextSecretColumns(
  schema: DatabaseSchema,
  tableName: string,
  prohibited: readonly string[],
): void {
  const names = table(schema, tableName).columns.map(({ name }) => name);
  for (const name of prohibited) {
    expect(names, `must not expose plaintext ${tableName}.${name}`).not.toContain(name);
  }
}

describe('PostgreSQL foundation schema contract', () => {
  it('exports the control-plane tables and durable operational tables', () => {
    expect(databaseSchema.tables.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'operators',
      'devices',
      'pairing_requests',
      'firmware_artifacts',
      'firmware_releases',
      'provider_catalogs',
      'provider_instances',
      'provider_credentials',
      'pipeline_profiles',
      'pipeline_revisions',
      'pipeline_bindings',
      'runtime_snapshots',
      'sessions',
      'mcp_tool_snapshots',
      'mcp_invocations',
      'audit_events',
      'outbox_events',
    ]));
  });

  it('makes canonical hardware identity unique while retaining distinct client and serial identities', () => {
    expectColumns(databaseSchema, 'devices', [
      'id',
      'hardware_id',
      'client_id',
      'serial_number',
      'token_version',
      'paired_at',
      'revoked_at',
      'created_at',
      'updated_at',
    ]);
    expect(column(databaseSchema, 'devices', 'hardware_id').nullable).toBe(false);
    expect(column(databaseSchema, 'devices', 'client_id').nullable).toBe(false);
    expect(column(databaseSchema, 'devices', 'serial_number').nullable).toBe(true);
    constraint(databaseSchema, 'devices', 'unique', ['hardware_id']);
    constraint(databaseSchema, 'devices', 'unique', ['client_id']);
    constraint(databaseSchema, 'devices', 'unique', ['serial_number'], { nullsDistinct: true });
  });

  it('stores only pairing-code verifiers and protects the active pairing-request invariant', () => {
    expectColumns(databaseSchema, 'pairing_requests', [
      'id',
      'device_id',
      'code_digest',
      'code_salt',
      'expires_at',
      'claimed_at',
      'claimed_by_operator_id',
      'created_at',
    ]);
    expectNoPlaintextSecretColumns(databaseSchema, 'pairing_requests', [
      'code',
      'pairing_code',
      'activation_code',
      'plaintext_code',
    ]);
    expect(column(databaseSchema, 'pairing_requests', 'code_digest').nullable).toBe(false);
    expect(column(databaseSchema, 'pairing_requests', 'code_salt').nullable).toBe(false);
    constraint(databaseSchema, 'pairing_requests', 'foreignKey', ['device_id'], {
      references: 'devices.id',
      onDelete: 'cascade',
    });
    constraint(databaseSchema, 'pairing_requests', 'partialUnique', ['device_id'], {
      predicate: 'claimed_at IS NULL',
    });
  });

  it('keeps device tokens out of the schema', () => {
    const allColumns = databaseSchema.tables.flatMap((schemaTable) => (
      schemaTable.columns.map(({ name }) => `${schemaTable.name}.${name}`)
    ));

    expect(allColumns).not.toEqual(expect.arrayContaining([
      'devices.device_token',
      'devices.token',
      'sessions.device_token',
      'sessions.token',
    ]));
  });

  it('uses encrypted, write-only provider credential material rather than plaintext provider secrets', () => {
    expectColumns(databaseSchema, 'provider_credentials', [
      'id',
      'provider_instance_id',
      'ciphertext',
      'encrypted_dek',
      'fingerprint',
      'created_at',
      'revoked_at',
    ]);
    expectNoPlaintextSecretColumns(databaseSchema, 'provider_credentials', [
      'secret',
      'api_key',
      'token',
      'password',
      'provider_secret',
    ]);
    expect(column(databaseSchema, 'provider_credentials', 'ciphertext').nullable).toBe(false);
    expect(column(databaseSchema, 'provider_credentials', 'encrypted_dek').nullable).toBe(false);
    constraint(databaseSchema, 'provider_credentials', 'foreignKey', ['provider_instance_id'], {
      references: 'provider_instances.id',
      onDelete: 'restrict',
    });
  });

  it('makes pipeline binding order explicit and permits only one default binding per revision and role', () => {
    expectColumns(databaseSchema, 'pipeline_bindings', [
      'id',
      'pipeline_revision_id',
      'role',
      'provider_instance_id',
      'position',
      'is_default',
      'created_at',
    ]);
    expect(column(databaseSchema, 'pipeline_bindings', 'position').nullable).toBe(false);
    expect(column(databaseSchema, 'pipeline_bindings', 'is_default').default).toBe(false);
    constraint(databaseSchema, 'pipeline_bindings', 'unique', [
      'pipeline_revision_id',
      'role',
      'position',
    ]);
    constraint(databaseSchema, 'pipeline_bindings', 'partialUnique', [
      'pipeline_revision_id',
      'role',
    ], {
      predicate: 'is_default = true',
    });
  });

  it('pins immutable runtime snapshots and sessions to the configuration that started them', () => {
    expectColumns(databaseSchema, 'runtime_snapshots', [
      'id',
      'pipeline_revision_id',
      'snapshot',
      'content_digest',
      'created_at',
    ]);
    expectColumns(databaseSchema, 'sessions', [
      'id',
      'device_id',
      'runtime_snapshot_id',
      'started_at',
      'ended_at',
      'created_at',
    ]);
    expect(table(databaseSchema, 'runtime_snapshots').mutability).toBe('appendOnly');
    expect(column(databaseSchema, 'sessions', 'runtime_snapshot_id').nullable).toBe(false);
    constraint(databaseSchema, 'sessions', 'foreignKey', ['runtime_snapshot_id'], {
      references: 'runtime_snapshots.id',
      onDelete: 'restrict',
    });
  });

  it('scopes numeric MCP request identifiers to a session', () => {
    expectColumns(databaseSchema, 'mcp_invocations', [
      'id',
      'session_id',
      'request_id',
      'tool_snapshot_id',
      'status',
      'created_at',
      'completed_at',
    ]);
    expect(column(databaseSchema, 'mcp_invocations', 'request_id').nullable).toBe(false);
    constraint(databaseSchema, 'mcp_invocations', 'unique', ['session_id', 'request_id']);
    constraint(databaseSchema, 'mcp_invocations', 'foreignKey', ['session_id'], {
      references: 'sessions.id',
      onDelete: 'cascade',
    });
  });

  it('declares audit and outbox records append-only', () => {
    expectColumns(databaseSchema, 'audit_events', [
      'id',
      'occurred_at',
      'actor_type',
      'action',
      'subject_type',
      'subject_id',
      'metadata',
    ]);
    expectColumns(databaseSchema, 'outbox_events', [
      'id',
      'occurred_at',
      'topic',
      'payload',
      'deduplication_key',
      'published_at',
    ]);
    expect(table(databaseSchema, 'audit_events').mutability).toBe('appendOnly');
    expect(table(databaseSchema, 'outbox_events').mutability).toBe('appendOnly');
    constraint(databaseSchema, 'outbox_events', 'unique', ['deduplication_key']);
  });
});

describe('reversible PostgreSQL migrations contract', () => {
  it('discovers an ordered migration set with an explicit up and down action for every migration', async () => {
    const migrations = await discoverMigrations();

    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.map(({ id }) => id)).toEqual([...migrations]
      .map(({ id }) => id)
      .sort((left, right) => left.localeCompare(right)));
    for (const migration of migrations) {
      expectMigrationIsReversible(migration);
    }
  });
});

function expectMigrationIsReversible(migration: Migration): void {
  expect(migration.id).toMatch(/^\d{4}_[a-z0-9_]+$/);
  expect(migration.up.trim(), `${migration.id} must have an up migration`).not.toBe('');
  expect(migration.down.trim(), `${migration.id} must have a down migration`).not.toBe('');
}
