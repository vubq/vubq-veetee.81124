import type { MigrationBuilder } from 'node-pg-migrate';

export const id = '0001_access_control';

export const upSql = `
CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  role_key varchar(128) NOT NULL,
  display_name varchar(255) NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_role_key_unique UNIQUE (role_key),
  CONSTRAINT roles_state_check CHECK (state IN ('active', 'disabled'))
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  permission_key varchar(128) NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT permissions_permission_key_unique UNIQUE (permission_key)
);

CREATE TABLE operators (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  email varchar(320) NOT NULL,
  display_name varchar(255) NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operators_email_unique UNIQUE (email),
  CONSTRAINT operators_state_check CHECK (state IN ('active', 'disabled'))
);

CREATE TABLE service_principals (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  principal_key varchar(128) NOT NULL,
  display_name varchar(255) NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_principals_principal_key_unique UNIQUE (principal_key),
  CONSTRAINT service_principals_state_check CHECK (state IN ('active', 'disabled'))
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_permissions_primary_key PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE operator_role_grants (
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  granted_by_operator_id uuid REFERENCES operators (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operator_role_grants_primary_key PRIMARY KEY (operator_id, role_id)
);

CREATE TABLE service_principal_role_grants (
  service_principal_id uuid NOT NULL REFERENCES service_principals (id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_principal_role_grants_primary_key PRIMARY KEY (service_principal_id, role_id)
);

CREATE TABLE operator_authenticators (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE CASCADE,
  verifier_digest bytea NOT NULL,
  verifier_salt bytea NOT NULL,
  algorithm varchar(64) NOT NULL,
  auth_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT operator_authenticators_operator_unique UNIQUE (operator_id),
  CONSTRAINT operator_authenticators_auth_version_positive_check CHECK (auth_version > 0)
);

CREATE TABLE operator_sessions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  operator_id uuid NOT NULL REFERENCES operators (id) ON DELETE CASCADE,
  session_digest bytea NOT NULL,
  session_salt bytea NOT NULL,
  auth_version integer NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT operator_sessions_digest_unique UNIQUE (session_digest),
  CONSTRAINT operator_sessions_auth_version_positive_check CHECK (auth_version > 0)
);
CREATE INDEX operator_sessions_operator_expiry_idx ON operator_sessions (operator_id, expires_at);

CREATE TABLE service_principal_credentials (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  service_principal_id uuid NOT NULL REFERENCES service_principals (id) ON DELETE CASCADE,
  verifier_digest bytea NOT NULL,
  verifier_salt bytea NOT NULL,
  fingerprint varchar(128) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT service_principal_credentials_fingerprint_unique UNIQUE (fingerprint)
);

CREATE TABLE signing_keys (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  key_id varchar(128) NOT NULL,
  algorithm varchar(64) NOT NULL,
  public_key bytea NOT NULL,
  private_key_handle varchar(512) NOT NULL,
  fingerprint varchar(128) NOT NULL,
  state varchar(32) NOT NULL,
  not_before timestamptz NOT NULL,
  not_after timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  retired_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT signing_keys_key_id_unique UNIQUE (key_id),
  CONSTRAINT signing_keys_fingerprint_unique UNIQUE (fingerprint),
  CONSTRAINT signing_keys_private_key_handle_unique UNIQUE (private_key_handle),
  CONSTRAINT signing_keys_state_check CHECK (state IN ('staged', 'active', 'retired', 'revoked')),
  CONSTRAINT signing_keys_lifetime_check CHECK (not_after > not_before),
  CONSTRAINT signing_keys_lifecycle_check CHECK (
    (state = 'staged' AND activated_at IS NULL AND retired_at IS NULL AND revoked_at IS NULL)
    OR (state = 'active' AND activated_at IS NOT NULL AND retired_at IS NULL AND revoked_at IS NULL)
    OR (state = 'retired' AND activated_at IS NOT NULL AND retired_at IS NOT NULL AND revoked_at IS NULL)
    OR (state = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE FUNCTION veetee_enforce_signing_key_lifecycle() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'signing key deletion is not permitted; revoke it instead';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.state = 'revoked' THEN
      RAISE EXCEPTION 'revoked signing key cannot be altered';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.key_id IS DISTINCT FROM OLD.key_id
      OR NEW.algorithm IS DISTINCT FROM OLD.algorithm
      OR NEW.public_key IS DISTINCT FROM OLD.public_key
      OR NEW.private_key_handle IS DISTINCT FROM OLD.private_key_handle
      OR NEW.fingerprint IS DISTINCT FROM OLD.fingerprint
      OR NEW.not_before IS DISTINCT FROM OLD.not_before
      OR NEW.not_after IS DISTINCT FROM OLD.not_after
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'signing key identity and verification fields are immutable';
    END IF;

    IF OLD.state = 'staged' AND NEW.state NOT IN ('staged', 'active', 'revoked') THEN
      RAISE EXCEPTION 'invalid signing key lifecycle transition';
    END IF;

    IF OLD.state = 'active' AND NEW.state NOT IN ('active', 'retired', 'revoked') THEN
      RAISE EXCEPTION 'invalid signing key lifecycle transition';
    END IF;

    IF OLD.state = 'retired' AND NEW.state NOT IN ('retired', 'revoked') THEN
      RAISE EXCEPTION 'invalid signing key lifecycle transition';
    END IF;

    IF NEW.activated_at IS DISTINCT FROM OLD.activated_at
      AND NOT (OLD.state = 'staged' AND NEW.state = 'active') THEN
      RAISE EXCEPTION 'signing key activation timestamp only changes on activation';
    END IF;

    IF NEW.retired_at IS DISTINCT FROM OLD.retired_at
      AND NOT (OLD.state = 'active' AND NEW.state = 'retired') THEN
      RAISE EXCEPTION 'signing key retirement timestamp only changes on retirement';
    END IF;

    IF NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
      AND NEW.state <> 'revoked' THEN
      RAISE EXCEPTION 'signing key revocation timestamp only changes on revocation';
    END IF;
  END IF;

  IF NEW.state = 'active' AND NEW.activated_at IS NULL THEN
    NEW.activated_at := now();
  END IF;

  IF NEW.state = 'retired' AND NEW.retired_at IS NULL THEN
    NEW.retired_at := now();
  END IF;

  IF NEW.state = 'revoked' AND NEW.revoked_at IS NULL THEN
    NEW.revoked_at := now();
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER signing_keys_lifecycle
  BEFORE INSERT OR UPDATE OR DELETE ON signing_keys
  FOR EACH ROW EXECUTE FUNCTION veetee_enforce_signing_key_lifecycle();
`;

export const downSql = `
DROP TRIGGER IF EXISTS signing_keys_lifecycle ON signing_keys;
DROP FUNCTION IF EXISTS veetee_enforce_signing_key_lifecycle();
DROP TABLE IF EXISTS signing_keys;
DROP TABLE IF EXISTS service_principal_credentials;
DROP TABLE IF EXISTS operator_sessions;
DROP TABLE IF EXISTS operator_authenticators;
DROP TABLE IF EXISTS service_principal_role_grants;
DROP TABLE IF EXISTS operator_role_grants;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS service_principals;
DROP TABLE IF EXISTS operators;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(upSql);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(downSql);
}
