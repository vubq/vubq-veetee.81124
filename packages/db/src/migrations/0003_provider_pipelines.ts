import type { MigrationBuilder } from 'node-pg-migrate';

export const id = '0003_provider_pipelines';

export const upSql = `
CREATE TABLE provider_catalogs (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  provider_key varchar(128) NOT NULL,
  display_name varchar(255) NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_catalogs_provider_key_unique UNIQUE (provider_key),
  CONSTRAINT provider_catalogs_state_check CHECK (state IN ('active', 'disabled'))
);

CREATE TABLE provider_catalog_revisions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  catalog_id uuid NOT NULL REFERENCES provider_catalogs (id) ON DELETE CASCADE,
  revision integer NOT NULL,
  role varchar(32) NOT NULL,
  configuration_schema jsonb NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT provider_catalog_revisions_catalog_revision_unique UNIQUE (catalog_id, revision),
  CONSTRAINT provider_catalog_revisions_id_role_unique UNIQUE (id, role),
  CONSTRAINT provider_catalog_revisions_role_check CHECK (role IN ('llm', 'asr', 'tts', 'vad', 'memory', 'intent')),
  CONSTRAINT provider_catalog_revisions_state_check CHECK (state IN ('draft', 'published')),
  CONSTRAINT provider_catalog_revisions_lifecycle_check CHECK (
    (state = 'draft' AND published_at IS NULL)
    OR (state = 'published' AND published_at IS NOT NULL)
  ),
  CONSTRAINT provider_catalog_revisions_revision_positive_check CHECK (revision > 0)
);

CREATE TABLE provider_instances (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  instance_key varchar(128) NOT NULL,
  display_name varchar(255) NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_instances_instance_key_unique UNIQUE (instance_key),
  CONSTRAINT provider_instances_state_check CHECK (state IN ('active', 'disabled'))
);

CREATE TABLE provider_instance_revisions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES provider_instances (id) ON DELETE CASCADE,
  catalog_revision_id uuid NOT NULL REFERENCES provider_catalog_revisions (id) ON DELETE RESTRICT,
  role varchar(32) NOT NULL,
  revision integer NOT NULL,
  endpoint varchar(2048) NOT NULL,
  model varchar(512),
  timeout_ms integer,
  request_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  network_scope varchar(32) NOT NULL,
  network_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  health_check jsonb NOT NULL DEFAULT '{}'::jsonb,
  health_status varchar(32) NOT NULL DEFAULT 'unknown',
  health_checked_at timestamptz,
  configuration jsonb NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT provider_instance_revisions_instance_revision_unique UNIQUE (instance_id, revision),
  CONSTRAINT provider_instance_revisions_role_unique UNIQUE (id, role),
  CONSTRAINT provider_instance_revisions_catalog_role_fk FOREIGN KEY (catalog_revision_id, role)
    REFERENCES provider_catalog_revisions (id, role) ON DELETE RESTRICT,
  CONSTRAINT provider_instance_revisions_role_check CHECK (role IN ('llm', 'asr', 'tts', 'vad', 'memory', 'intent')),
  CONSTRAINT provider_instance_revisions_network_scope_check CHECK (network_scope IN ('public', 'local-allowlisted', 'disabled')),
  CONSTRAINT provider_instance_revisions_timeout_positive_check CHECK (timeout_ms IS NULL OR timeout_ms > 0),
  CONSTRAINT provider_instance_revisions_health_status_check CHECK (health_status IN ('unknown', 'healthy', 'degraded', 'unhealthy')),
  CONSTRAINT provider_instance_revisions_state_check CHECK (state IN ('draft', 'published')),
  CONSTRAINT provider_instance_revisions_lifecycle_check CHECK (
    (state = 'draft' AND published_at IS NULL)
    OR (state = 'published' AND published_at IS NOT NULL)
  ),
  CONSTRAINT provider_instance_revisions_revision_positive_check CHECK (revision > 0)
);

CREATE TABLE provider_credentials (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  provider_instance_id uuid NOT NULL REFERENCES provider_instances (id) ON DELETE RESTRICT,
  ciphertext bytea NOT NULL,
  nonce bytea NOT NULL,
  auth_tag bytea NOT NULL,
  algorithm varchar(64) NOT NULL,
  envelope_version integer NOT NULL,
  key_version varchar(128) NOT NULL,
  fingerprint varchar(128) NOT NULL,
  label varchar(255) NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz NOT NULL DEFAULT now(),
  quarantined_at timestamptz,
  revoked_at timestamptz,
  last_validated_at timestamptz,
  last_used_at timestamptz,
  CONSTRAINT provider_credentials_instance_fingerprint_unique UNIQUE (provider_instance_id, fingerprint),
  CONSTRAINT provider_credentials_instance_label_unique UNIQUE (provider_instance_id, label),
  CONSTRAINT provider_credentials_algorithm_not_empty_check CHECK (length(algorithm) > 0),
  CONSTRAINT provider_credentials_envelope_version_positive_check CHECK (envelope_version > 0),
  CONSTRAINT provider_credentials_key_version_not_empty_check CHECK (length(key_version) > 0),
  CONSTRAINT provider_credentials_nonce_not_empty_check CHECK (octet_length(nonce) > 0),
  CONSTRAINT provider_credentials_auth_tag_not_empty_check CHECK (octet_length(auth_tag) > 0),
  CONSTRAINT provider_credentials_state_check CHECK (state IN ('active', 'quarantined', 'revoked')),
  CONSTRAINT provider_credentials_lifecycle_check CHECK (
    (state = 'active' AND activated_at IS NOT NULL AND revoked_at IS NULL)
    OR (state = 'quarantined' AND activated_at IS NOT NULL AND quarantined_at IS NOT NULL AND revoked_at IS NULL)
    OR (state = 'revoked' AND activated_at IS NOT NULL AND revoked_at IS NOT NULL)
  )
);

CREATE TABLE pipeline_profiles (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  profile_key varchar(128) NOT NULL,
  display_name varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_profiles_profile_key_unique UNIQUE (profile_key)
);

CREATE TABLE pipeline_revisions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  pipeline_profile_id uuid NOT NULL REFERENCES pipeline_profiles (id) ON DELETE CASCADE,
  revision integer NOT NULL,
  policy jsonb NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT pipeline_revisions_profile_revision_unique UNIQUE (pipeline_profile_id, revision),
  CONSTRAINT pipeline_revisions_state_check CHECK (state IN ('draft', 'published')),
  CONSTRAINT pipeline_revisions_lifecycle_check CHECK (
    (state = 'draft' AND published_at IS NULL)
    OR (state = 'published' AND published_at IS NOT NULL)
  ),
  CONSTRAINT pipeline_revisions_revision_positive_check CHECK (revision > 0)
);

CREATE TABLE retention_policies (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  policy_key varchar(128) NOT NULL,
  conversation_days integer NOT NULL,
  event_days integer NOT NULL,
  audit_days integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retention_policies_policy_key_unique UNIQUE (policy_key),
  CONSTRAINT retention_policies_nonnegative_check CHECK (conversation_days >= 0 AND event_days >= 0 AND audit_days >= 0)
);

CREATE TABLE assistant_revisions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  assistant_id uuid NOT NULL REFERENCES assistants (id) ON DELETE CASCADE,
  pipeline_profile_id uuid NOT NULL REFERENCES pipeline_profiles (id) ON DELETE RESTRICT,
  retention_policy_id uuid NOT NULL REFERENCES retention_policies (id) ON DELETE RESTRICT,
  revision integer NOT NULL,
  configuration jsonb NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT assistant_revisions_assistant_revision_unique UNIQUE (assistant_id, revision),
  CONSTRAINT assistant_revisions_state_check CHECK (state IN ('draft', 'published')),
  CONSTRAINT assistant_revisions_lifecycle_check CHECK (
    (state = 'draft' AND published_at IS NULL)
    OR (state = 'published' AND published_at IS NOT NULL)
  ),
  CONSTRAINT assistant_revisions_revision_positive_check CHECK (revision > 0)
);

CREATE TABLE pipeline_bindings (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  pipeline_revision_id uuid NOT NULL REFERENCES pipeline_revisions (id) ON DELETE CASCADE,
  provider_instance_revision_id uuid NOT NULL REFERENCES provider_instance_revisions (id) ON DELETE RESTRICT,
  role varchar(32) NOT NULL,
  position integer NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_bindings_revision_role_position_unique UNIQUE (pipeline_revision_id, role, position),
  CONSTRAINT pipeline_bindings_provider_role_fk FOREIGN KEY (provider_instance_revision_id, role)
    REFERENCES provider_instance_revisions (id, role) ON DELETE RESTRICT,
  CONSTRAINT pipeline_bindings_role_check CHECK (role IN ('llm', 'asr', 'tts', 'vad', 'memory', 'intent')),
  CONSTRAINT pipeline_bindings_position_nonnegative_check CHECK (position >= 0)
);
CREATE UNIQUE INDEX pipeline_bindings_one_default_per_revision_role
  ON pipeline_bindings (pipeline_revision_id, role)
  WHERE is_default = true;

CREATE TABLE runtime_snapshots (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  pipeline_revision_id uuid NOT NULL REFERENCES pipeline_revisions (id) ON DELETE RESTRICT,
  snapshot jsonb NOT NULL,
  content_digest varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT runtime_snapshots_content_digest_unique UNIQUE (content_digest)
);

CREATE FUNCTION veetee_enforce_provider_credential_lifecycle() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'provider credential deletion is not permitted; revoke it instead';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.state = 'revoked' THEN
      RAISE EXCEPTION 'revoked provider credential cannot be altered';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.provider_instance_id IS DISTINCT FROM OLD.provider_instance_id
      OR NEW.ciphertext IS DISTINCT FROM OLD.ciphertext
      OR NEW.nonce IS DISTINCT FROM OLD.nonce
      OR NEW.auth_tag IS DISTINCT FROM OLD.auth_tag
      OR NEW.algorithm IS DISTINCT FROM OLD.algorithm
      OR NEW.envelope_version IS DISTINCT FROM OLD.envelope_version
      OR NEW.key_version IS DISTINCT FROM OLD.key_version
      OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint
      OR NEW.label IS DISTINCT FROM OLD.label
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.activated_at IS DISTINCT FROM OLD.activated_at THEN
      RAISE EXCEPTION 'provider credential envelope and identity fields are immutable';
    END IF;

    IF OLD.state = 'active' AND NEW.state NOT IN ('active', 'quarantined', 'revoked') THEN
      RAISE EXCEPTION 'invalid provider credential lifecycle transition';
    END IF;

    IF OLD.state = 'quarantined' AND NEW.state NOT IN ('quarantined', 'active', 'revoked') THEN
      RAISE EXCEPTION 'invalid provider credential lifecycle transition';
    END IF;

    IF NEW.quarantined_at IS DISTINCT FROM OLD.quarantined_at
      AND NOT (NEW.state = 'quarantined' AND OLD.state <> 'quarantined' AND OLD.quarantined_at IS NULL) THEN
      RAISE EXCEPTION 'provider credential quarantine timestamp is immutable after quarantine';
    END IF;

    IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
      AND NOT (NEW.state = 'revoked' AND OLD.state <> 'revoked' AND OLD.revoked_at IS NULL) THEN
      RAISE EXCEPTION 'provider credential revocation timestamp only changes on revocation';
    END IF;
  END IF;

  IF NEW.state = 'quarantined' AND NEW.quarantined_at IS NULL THEN
    NEW.quarantined_at := now();
  END IF;

  IF NEW.state = 'revoked' AND NEW.revoked_at IS NULL THEN
    NEW.revoked_at := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION veetee_prevent_published_revision_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.state = 'published' THEN
    RAISE EXCEPTION 'published revision cannot be changed';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION veetee_prevent_published_pipeline_binding_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1
      FROM pipeline_revisions
      WHERE id = OLD.pipeline_revision_id AND state = 'published'
    ) THEN
      RAISE EXCEPTION 'published pipeline revision cannot be changed';
    END IF;
    RETURN OLD;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pipeline_revisions
    WHERE state = 'published'
      AND (
        id = NEW.pipeline_revision_id
        OR (TG_OP = 'UPDATE' AND id = OLD.pipeline_revision_id)
      )
  ) THEN
    RAISE EXCEPTION 'published pipeline revision cannot be changed';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION veetee_prevent_immutable_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'immutable record cannot be changed';
END;
$$;

CREATE TRIGGER provider_credentials_lifecycle
  BEFORE INSERT OR UPDATE OR DELETE ON provider_credentials
  FOR EACH ROW EXECUTE FUNCTION veetee_enforce_provider_credential_lifecycle();
CREATE TRIGGER provider_catalog_revisions_published_immutable
  BEFORE UPDATE OR DELETE ON provider_catalog_revisions
  FOR EACH ROW EXECUTE FUNCTION veetee_prevent_published_revision_mutation();
CREATE TRIGGER provider_instance_revisions_published_immutable
  BEFORE UPDATE OR DELETE ON provider_instance_revisions
  FOR EACH ROW EXECUTE FUNCTION veetee_prevent_published_revision_mutation();
CREATE TRIGGER pipeline_revisions_published_immutable
  BEFORE UPDATE OR DELETE ON pipeline_revisions
  FOR EACH ROW EXECUTE FUNCTION veetee_prevent_published_revision_mutation();
CREATE TRIGGER assistant_revisions_published_immutable
  BEFORE UPDATE OR DELETE ON assistant_revisions
  FOR EACH ROW EXECUTE FUNCTION veetee_prevent_published_revision_mutation();
CREATE TRIGGER pipeline_bindings_published_revision_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON pipeline_bindings
  FOR EACH ROW EXECUTE FUNCTION veetee_prevent_published_pipeline_binding_mutation();
CREATE TRIGGER runtime_snapshots_immutable
  BEFORE UPDATE OR DELETE ON runtime_snapshots
  FOR EACH ROW EXECUTE FUNCTION veetee_prevent_immutable_mutation();
`;

export const downSql = `
DROP TRIGGER IF EXISTS runtime_snapshots_immutable ON runtime_snapshots;
DROP TRIGGER IF EXISTS pipeline_bindings_published_revision_immutable ON pipeline_bindings;
DROP TRIGGER IF EXISTS assistant_revisions_published_immutable ON assistant_revisions;
DROP TRIGGER IF EXISTS pipeline_revisions_published_immutable ON pipeline_revisions;
DROP TRIGGER IF EXISTS provider_instance_revisions_published_immutable ON provider_instance_revisions;
DROP TRIGGER IF EXISTS provider_catalog_revisions_published_immutable ON provider_catalog_revisions;
DROP TRIGGER IF EXISTS provider_credentials_lifecycle ON provider_credentials;
DROP FUNCTION IF EXISTS veetee_prevent_immutable_mutation();
DROP FUNCTION IF EXISTS veetee_prevent_published_pipeline_binding_mutation();
DROP FUNCTION IF EXISTS veetee_prevent_published_revision_mutation();
DROP FUNCTION IF EXISTS veetee_enforce_provider_credential_lifecycle();
DROP TABLE IF EXISTS runtime_snapshots;
DROP TABLE IF EXISTS pipeline_bindings;
DROP TABLE IF EXISTS assistant_revisions;
DROP TABLE IF EXISTS retention_policies;
DROP TABLE IF EXISTS pipeline_revisions;
DROP TABLE IF EXISTS pipeline_profiles;
DROP TABLE IF EXISTS provider_credentials;
DROP TABLE IF EXISTS provider_instance_revisions;
DROP TABLE IF EXISTS provider_instances;
DROP TABLE IF EXISTS provider_catalog_revisions;
DROP TABLE IF EXISTS provider_catalogs;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(upSql);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(downSql);
}
