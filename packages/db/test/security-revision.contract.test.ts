import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { downSql as accessControlDown, upSql as accessControlUp } from '../src/migrations/0001_access_control.js';
import { upSql as devicesPairingUp } from '../src/migrations/0002_devices_pairing.js';
import { downSql as providerPipelinesDown, upSql as providerPipelinesUp } from '../src/migrations/0003_provider_pipelines.js';

const databaseUrl = process.env.DATABASE_URL;
const integrationTest = databaseUrl === undefined ? it.skip : it;

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function qualified(schema: string, relation: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(relation)}`;
}

describe('access-control signing key migration', () => {
  it('stores public verification material and an external private-key handle only', () => {
    expect(accessControlUp).not.toContain('CREATE EXTENSION');
    expect(accessControlUp).toContain('public_key bytea NOT NULL');
    expect(accessControlUp).toContain('private_key_handle varchar(512) NOT NULL');
    expect(accessControlUp).not.toContain('private_key_ciphertext');
    expect(accessControlUp).not.toContain('encrypted_dek');
    expect(accessControlUp).toContain("state IN ('staged', 'active', 'retired', 'revoked')");
    expect(accessControlUp).toContain('CREATE FUNCTION veetee_enforce_signing_key_lifecycle()');
    expect(accessControlUp).toContain('signing key identity and verification fields are immutable');
    expect(accessControlUp).toContain('revoked signing key cannot be altered');
    expect(accessControlUp).toContain('signing key deletion is not permitted');
    expect(accessControlUp).toContain("OLD.state = 'staged' AND NEW.state NOT IN ('staged', 'active', 'revoked')");
    expect(accessControlUp).toContain("OLD.state = 'active' AND NEW.state NOT IN ('active', 'retired', 'revoked')");
    expect(accessControlUp).toContain("OLD.state = 'retired' AND NEW.state NOT IN ('retired', 'revoked')");
    expect(accessControlDown).toContain('DROP TRIGGER IF EXISTS signing_keys_lifecycle');
    expect(accessControlDown).toContain('DROP FUNCTION IF EXISTS veetee_enforce_signing_key_lifecycle()');
    expect(accessControlDown).toContain('DROP TABLE IF EXISTS signing_keys');
  });
});

describe('provider pipeline migration', () => {
  it('persists a complete versioned AEAD envelope and rotation lifecycle', () => {
    for (const column of [
      'ciphertext bytea NOT NULL',
      'nonce bytea NOT NULL',
      'auth_tag bytea NOT NULL',
      'algorithm varchar(64) NOT NULL',
      'envelope_version integer NOT NULL',
      'key_version varchar(128) NOT NULL',
      'fingerprint varchar(128) NOT NULL',
      'label varchar(255) NOT NULL',
      'quarantined_at timestamptz',
      'revoked_at timestamptz',
    ]) {
      expect(providerPipelinesUp).toContain(column);
    }
    expect(providerPipelinesUp).toContain("state IN ('active', 'quarantined', 'revoked')");
    expect(providerPipelinesUp).not.toContain('encrypted_dek');
  });

  it('makes provider execution configuration and health data explicit and provider-neutral', () => {
    for (const column of [
      'endpoint varchar(2048) NOT NULL',
      'model varchar(512)',
      'timeout_ms integer',
      'request_profile jsonb NOT NULL',
      'response_mapping jsonb NOT NULL',
      'network_policy jsonb NOT NULL',
      'health_check jsonb NOT NULL',
      'health_status varchar(32) NOT NULL',
    ]) {
      expect(providerPipelinesUp).toContain(column);
    }
    expect(providerPipelinesUp).not.toMatch(/groq|openai|whisper|vieneu/i);
  });

  it('protects published revisions and their pipeline bindings while drafts remain mutable', () => {
    for (const relation of [
      'provider_catalog_revisions',
      'provider_instance_revisions',
      'pipeline_revisions',
      'assistant_revisions',
    ]) {
      expect(providerPipelinesUp).toContain(`${relation}_published_immutable`);
    }
    expect(providerPipelinesUp).toContain('pipeline_bindings_published_revision_immutable');
    expect(providerPipelinesUp).toContain("OLD.state = 'published'");
    expect(providerPipelinesDown).toContain('DROP TRIGGER IF EXISTS pipeline_bindings_published_revision_immutable');
    expect(providerPipelinesDown).toContain('DROP FUNCTION IF EXISTS veetee_prevent_published_revision_mutation()');
  });

  it('guards provider credential envelope identity and lifecycle mutations', () => {
    expect(providerPipelinesUp).toContain('provider credential deletion is not permitted');
    expect(providerPipelinesUp).toContain('revoked provider credential cannot be altered');
    expect(providerPipelinesUp).toContain('provider credential envelope and identity fields are immutable');
    expect(providerPipelinesUp).toContain('provider credential quarantine timestamp is immutable after quarantine');
    expect(providerPipelinesUp).toContain("OLD.state = 'active' AND NEW.state NOT IN ('active', 'quarantined', 'revoked')");
    expect(providerPipelinesUp).toContain("OLD.state = 'quarantined' AND NEW.state NOT IN ('quarantined', 'active', 'revoked')");
    expect(providerPipelinesDown).toContain('DROP FUNCTION IF EXISTS veetee_enforce_provider_credential_lifecycle()');
  });
});

describe('PostgreSQL credential and signing-key lifecycle behavior', () => {
  integrationTest('keeps envelope and signing-key identity immutable and blocks destructive lifecycle changes', async () => {
    const schema = `security_${randomUUID().replaceAll('-', '')}`;
    const client = new Client({ connectionString: databaseUrl });
    await client.connect();

    try {
      await client.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
      await client.query(`SET search_path TO ${quoteIdentifier(schema)}, public`);
      await client.query(accessControlUp);
      await client.query(devicesPairingUp);
      await client.query(providerPipelinesUp);

      const signingKey = await client.query<{ id: string }>(
        `INSERT INTO ${qualified(schema, 'signing_keys')}
           (key_id, algorithm, public_key, private_key_handle, fingerprint, state, not_before, not_after)
         VALUES ('security-key', 'Ed25519', decode('aa', 'hex'), 'kms://security-key', 'security-fingerprint', 'staged', now(), now() + interval '1 hour')
         RETURNING id`,
      );
      const signingKeyId = signingKey.rows[0]?.id;
      expect(signingKeyId).toBeDefined();

      await client.query(
        `UPDATE ${qualified(schema, 'signing_keys')} SET state = 'active' WHERE id = $1`,
        [signingKeyId],
      );
      await client.query(
        `UPDATE ${qualified(schema, 'signing_keys')} SET state = 'retired' WHERE id = $1`,
        [signingKeyId],
      );
      await client.query(
        `UPDATE ${qualified(schema, 'signing_keys')} SET state = 'revoked' WHERE id = $1`,
        [signingKeyId],
      );
      await expect(client.query(
        `UPDATE ${qualified(schema, 'signing_keys')} SET fingerprint = 'rewritten' WHERE id = $1`,
        [signingKeyId],
      )).rejects.toThrow();
      await expect(client.query(
        `UPDATE ${qualified(schema, 'signing_keys')} SET state = 'active' WHERE id = $1`,
        [signingKeyId],
      )).rejects.toThrow();
      await expect(client.query(
        `DELETE FROM ${qualified(schema, 'signing_keys')} WHERE id = $1`,
        [signingKeyId],
      )).rejects.toThrow();

      const catalog = await client.query<{ id: string }>(
        `INSERT INTO ${qualified(schema, 'provider_catalogs')} (provider_key, display_name)
         VALUES ('security-provider', 'Security provider') RETURNING id`,
      );
      const catalogId = catalog.rows[0]?.id;
      expect(catalogId).toBeDefined();
      const catalogRevision = await client.query<{ id: string }>(
        `INSERT INTO ${qualified(schema, 'provider_catalog_revisions')}
           (catalog_id, revision, role, configuration_schema, state, published_at)
         VALUES ($1, 1, 'llm', '{}'::jsonb, 'published', now()) RETURNING id`,
        [catalogId],
      );
      const instance = await client.query<{ id: string }>(
        `INSERT INTO ${qualified(schema, 'provider_instances')} (instance_key, display_name)
         VALUES ('security-instance', 'Security instance') RETURNING id`,
      );
      const credential = await client.query<{ id: string }>(
        `INSERT INTO ${qualified(schema, 'provider_credentials')}
           (provider_instance_id, ciphertext, nonce, auth_tag, algorithm, envelope_version, key_version, fingerprint, label)
         VALUES ($1, decode('0102', 'hex'), decode('0304', 'hex'), decode('0506', 'hex'), 'AES-256-GCM', 1, 'k1', 'credential-fingerprint', 'primary')
         RETURNING id`,
        [instance.rows[0]?.id],
      );
      const credentialId = credential.rows[0]?.id;
      expect(credentialId).toBeDefined();

      await expect(client.query(
        `UPDATE ${qualified(schema, 'provider_credentials')} SET ciphertext = decode('ffff', 'hex') WHERE id = $1`,
        [credentialId],
      )).rejects.toThrow();
      await client.query(
        `UPDATE ${qualified(schema, 'provider_credentials')} SET state = 'quarantined' WHERE id = $1`,
        [credentialId],
      );
      await client.query(
        `UPDATE ${qualified(schema, 'provider_credentials')} SET last_validated_at = now(), last_used_at = now() WHERE id = $1`,
        [credentialId],
      );
      await client.query(
        `UPDATE ${qualified(schema, 'provider_credentials')} SET state = 'revoked' WHERE id = $1`,
        [credentialId],
      );
      await expect(client.query(
        `UPDATE ${qualified(schema, 'provider_credentials')} SET label = 'rewritten' WHERE id = $1`,
        [credentialId],
      )).rejects.toThrow();
      await expect(client.query(
        `DELETE FROM ${qualified(schema, 'provider_credentials')} WHERE id = $1`,
        [credentialId],
      )).rejects.toThrow();
      expect(catalogRevision.rows[0]?.id).toBeDefined();
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
      await client.end();
    }
  }, 30_000);
});
