import type { MigrationBuilder } from 'node-pg-migrate';

export const id = '0004_firmware_delivery';

export const upSql = `
CREATE TABLE firmware_artifacts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  storage_key varchar(512) NOT NULL,
  sha256_digest varchar(64) NOT NULL,
  byte_size integer NOT NULL,
  media_type varchar(255) NOT NULL,
  signature_algorithm varchar(64) NOT NULL DEFAULT 'none',
  signature bytea,
  signature_key_id varchar(128) REFERENCES signing_keys (key_id) ON DELETE RESTRICT,
  compatibility_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT firmware_artifacts_storage_key_unique UNIQUE (storage_key),
  CONSTRAINT firmware_artifacts_sha256_digest_unique UNIQUE (sha256_digest),
  CONSTRAINT firmware_artifacts_byte_size_positive_check CHECK (byte_size > 0),
  CONSTRAINT firmware_artifacts_compatibility_metadata_object_check CHECK (
    jsonb_typeof(compatibility_metadata) = 'object'
  ),
  CONSTRAINT firmware_artifacts_signature_coherent_check CHECK (
    (signature_algorithm IN ('none', 'unsigned') AND signature IS NULL AND signature_key_id IS NULL)
    OR (signature_algorithm NOT IN ('none', 'unsigned') AND signature IS NOT NULL AND signature_key_id IS NOT NULL)
  ),
  CONSTRAINT firmware_artifacts_signature_nonempty_check CHECK (
    signature IS NULL OR octet_length(signature) > 0
  )
);

CREATE TABLE firmware_releases (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  firmware_artifact_id uuid NOT NULL REFERENCES firmware_artifacts (id) ON DELETE RESTRICT,
  board_type varchar(128) NOT NULL,
  version varchar(128) NOT NULL,
  minimum_protocol_version integer NOT NULL DEFAULT 1,
  minimum_bootloader_version varchar(128) NOT NULL DEFAULT '0',
  state varchar(32) NOT NULL DEFAULT 'draft',
  approval_state varchar(32) NOT NULL DEFAULT 'pending',
  approved_by_operator_id uuid REFERENCES operators (id) ON DELETE RESTRICT,
  approval_reason text,
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT firmware_releases_board_version_unique UNIQUE (board_type, version),
  CONSTRAINT firmware_releases_state_check CHECK (state IN ('draft', 'published', 'withdrawn')),
  CONSTRAINT firmware_releases_approval_state_check CHECK (
    approval_state IN ('pending', 'approved', 'rejected', 'revoked')
  ),
  CONSTRAINT firmware_releases_minimum_protocol_version_positive_check CHECK (
    minimum_protocol_version > 0
  ),
  CONSTRAINT firmware_releases_minimum_bootloader_version_nonempty_check CHECK (
    length(btrim(minimum_bootloader_version)) > 0
  ),
  CONSTRAINT firmware_releases_approval_coherent_check CHECK (
    approval_state <> 'approved'
    OR (approved_by_operator_id IS NOT NULL AND approved_at IS NOT NULL)
  ),
  CONSTRAINT firmware_releases_published_at_coherent_check CHECK (
    state <> 'published' OR published_at IS NOT NULL
  )
);

CREATE FUNCTION veetee_prevent_published_firmware_artifact_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  artifact firmware_artifacts;
BEGIN
  SELECT * INTO artifact
  FROM firmware_artifacts
  WHERE id = OLD.id
  FOR UPDATE;

  IF EXISTS (
    SELECT 1
    FROM firmware_releases
    WHERE firmware_artifact_id = OLD.id
      AND published_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'firmware artifact referenced by a published release cannot be changed';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER firmware_artifacts_published_immutable
  BEFORE UPDATE OR DELETE ON firmware_artifacts
  FOR EACH ROW EXECUTE FUNCTION veetee_prevent_published_firmware_artifact_mutation();

CREATE FUNCTION veetee_validate_firmware_release() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  artifact firmware_artifacts;
BEGIN
  IF NEW.state = 'published' THEN
    IF NEW.approval_state <> 'approved'
      OR NEW.approved_by_operator_id IS NULL
      OR NEW.approved_at IS NULL
      OR NEW.published_at IS NULL THEN
      RAISE EXCEPTION 'firmware release requires approval before publication';
    END IF;

    SELECT * INTO artifact
    FROM firmware_artifacts
    WHERE id = NEW.firmware_artifact_id
    FOR UPDATE;

    IF NOT FOUND
      OR artifact.signature IS NULL
      OR artifact.signature_key_id IS NULL
      OR artifact.signature_algorithm IN ('none', 'unsigned') THEN
      RAISE EXCEPTION 'published firmware release requires a signed artifact';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION veetee_prevent_published_firmware_release_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    IF TG_OP = 'UPDATE'
      AND OLD.state = 'published'
      AND NEW.state = 'withdrawn'
      AND NEW.id IS NOT DISTINCT FROM OLD.id
      AND NEW.firmware_artifact_id IS NOT DISTINCT FROM OLD.firmware_artifact_id
      AND NEW.board_type IS NOT DISTINCT FROM OLD.board_type
      AND NEW.version IS NOT DISTINCT FROM OLD.version
      AND NEW.minimum_protocol_version IS NOT DISTINCT FROM OLD.minimum_protocol_version
      AND NEW.minimum_bootloader_version IS NOT DISTINCT FROM OLD.minimum_bootloader_version
      AND NEW.approval_state IS NOT DISTINCT FROM OLD.approval_state
      AND NEW.approved_by_operator_id IS NOT DISTINCT FROM OLD.approved_by_operator_id
      AND NEW.approval_reason IS NOT DISTINCT FROM OLD.approval_reason
      AND NEW.approved_at IS NOT DISTINCT FROM OLD.approved_at
      AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at
      AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'published firmware release cannot be changed except withdrawal';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER firmware_releases_published_immutable
  BEFORE UPDATE OR DELETE ON firmware_releases
  FOR EACH ROW EXECUTE FUNCTION veetee_prevent_published_firmware_release_mutation();

CREATE TRIGGER firmware_releases_validate_publication
  BEFORE INSERT OR UPDATE ON firmware_releases
  FOR EACH ROW EXECUTE FUNCTION veetee_validate_firmware_release();

CREATE TABLE firmware_rollouts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  firmware_release_id uuid NOT NULL REFERENCES firmware_releases (id) ON DELETE RESTRICT,
  state varchar(32) NOT NULL DEFAULT 'draft',
  strategy varchar(32) NOT NULL,
  target_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  staged_percentage integer NOT NULL DEFAULT 100,
  failure_threshold_percentage integer NOT NULL DEFAULT 10,
  maintenance_window jsonb NOT NULL DEFAULT '{}'::jsonb,
  maintenance_window_start_at timestamptz,
  maintenance_window_end_at timestamptz,
  force_update boolean NOT NULL DEFAULT false,
  force_reason text,
  force_approved_by_operator_id uuid REFERENCES operators (id) ON DELETE RESTRICT,
  force_approved_at timestamptz,
  rollback_policy varchar(32) NOT NULL DEFAULT 'none',
  rollback_state varchar(32) NOT NULL DEFAULT 'not_started',
  rollback_reason text,
  created_by_operator_id uuid REFERENCES operators (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT firmware_rollouts_state_check CHECK (
    state IN (
      'draft', 'active', 'paused', 'completed', 'cancelled',
      'rolling_back', 'rolled_back', 'rollback_failed'
    )
  ),
  CONSTRAINT firmware_rollouts_strategy_check CHECK (strategy IN ('manual', 'phased')),
  CONSTRAINT firmware_rollouts_target_policy_object_check CHECK (
    jsonb_typeof(target_policy) = 'object'
  ),
  CONSTRAINT firmware_rollouts_staged_percentage_check CHECK (
    staged_percentage BETWEEN 0 AND 100
  ),
  CONSTRAINT firmware_rollouts_failure_threshold_percentage_check CHECK (
    failure_threshold_percentage BETWEEN 0 AND 100
  ),
  CONSTRAINT firmware_rollouts_maintenance_window_object_check CHECK (
    jsonb_typeof(maintenance_window) = 'object'
  ),
  CONSTRAINT firmware_rollouts_maintenance_window_order_check CHECK (
    maintenance_window_start_at IS NULL
    OR maintenance_window_end_at IS NULL
    OR maintenance_window_end_at > maintenance_window_start_at
  ),
  CONSTRAINT firmware_rollouts_force_approval_coherent_check CHECK (
    (force_update = false AND force_reason IS NULL AND force_approved_by_operator_id IS NULL AND force_approved_at IS NULL)
    OR (
      force_update = true
      AND force_reason IS NOT NULL
      AND length(btrim(force_reason)) > 0
      AND force_approved_by_operator_id IS NOT NULL
      AND force_approved_at IS NOT NULL
    )
  ),
  CONSTRAINT firmware_rollouts_rollback_policy_check CHECK (
    rollback_policy IN ('none', 'manual', 'automatic', 'automatic_on_threshold')
  ),
  CONSTRAINT firmware_rollouts_rollback_state_check CHECK (
    rollback_state IN ('not_started', 'not_required', 'pending', 'in_progress', 'completed', 'failed', 'rolled_back')
  ),
  CONSTRAINT firmware_rollouts_rollback_coherent_check CHECK (
    rollback_policy <> 'none'
    OR rollback_state IN ('not_started', 'not_required')
  ),
  CONSTRAINT firmware_rollouts_completion_order_check CHECK (
    completed_at IS NULL OR started_at IS NOT NULL
  )
);

CREATE FUNCTION veetee_validate_firmware_rollout() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  release firmware_releases;
BEGIN
  IF NEW.state IN ('active', 'paused', 'completed', 'rolling_back', 'rolled_back', 'rollback_failed') THEN
    SELECT * INTO release
    FROM firmware_releases
    WHERE id = NEW.firmware_release_id;

    IF NOT FOUND OR release.state <> 'published' OR release.approval_state <> 'approved' THEN
      RAISE EXCEPTION 'firmware rollout requires a published approved release';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER firmware_rollouts_validate_release
  BEFORE INSERT OR UPDATE ON firmware_rollouts
  FOR EACH ROW EXECUTE FUNCTION veetee_validate_firmware_rollout();

CREATE TABLE firmware_rollout_assignments (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  firmware_rollout_id uuid NOT NULL REFERENCES firmware_rollouts (id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  state varchar(32) NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  last_error_code varchar(128),
  failure_reason text,
  observed_version varchar(128),
  observed_result jsonb,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  offered_at timestamptz,
  download_started_at timestamptz,
  downloaded_at timestamptz,
  install_started_at timestamptz,
  installed_at timestamptz,
  failed_at timestamptz,
  rollback_started_at timestamptz,
  rolled_back_at timestamptz,
  completed_at timestamptz,
  CONSTRAINT firmware_rollout_assignments_rollout_device_unique UNIQUE (firmware_rollout_id, device_id),
  CONSTRAINT firmware_rollout_assignments_id_device_unique UNIQUE (id, device_id),
  CONSTRAINT firmware_rollout_assignments_state_check CHECK (
    state IN (
      'pending', 'offered', 'downloading', 'downloaded', 'installing',
      'installed', 'failed', 'download_failed', 'install_failed',
      'rollback_pending', 'rolling_back', 'rolled_back', 'rollback_failed', 'cancelled'
    )
  ),
  CONSTRAINT firmware_rollout_assignments_attempt_count_nonnegative_check CHECK (attempt_count >= 0),
  CONSTRAINT firmware_rollout_assignments_completion_coherent_check CHECK (
    (
      state IN ('pending', 'offered', 'downloading', 'downloaded', 'installing', 'rollback_pending', 'rolling_back')
      AND completed_at IS NULL
    )
    OR (
      state IN ('installed', 'failed', 'download_failed', 'install_failed', 'rolled_back', 'rollback_failed', 'cancelled')
      AND completed_at IS NOT NULL
    )
  ),
  CONSTRAINT firmware_rollout_assignments_observed_result_object_check CHECK (
    observed_result IS NULL OR jsonb_typeof(observed_result) = 'object'
  )
);
CREATE INDEX firmware_rollout_assignments_state_idx
  ON firmware_rollout_assignments (state);

CREATE TABLE firmware_download_tickets (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  firmware_rollout_assignment_id uuid NOT NULL,
  device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  state varchar(32) NOT NULL DEFAULT 'issued',
  ticket_digest bytea NOT NULL,
  ticket_salt bytea NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  expired_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT firmware_download_tickets_assignment_device_fk
    FOREIGN KEY (firmware_rollout_assignment_id, device_id)
    REFERENCES firmware_rollout_assignments (id, device_id) ON DELETE CASCADE,
  CONSTRAINT firmware_download_tickets_digest_unique UNIQUE (ticket_digest),
  CONSTRAINT firmware_download_tickets_state_check CHECK (
    state IN ('issued', 'active', 'consumed', 'expired', 'revoked')
  ),
  CONSTRAINT firmware_download_tickets_lifecycle_coherent_check CHECK (
    (state IN ('issued', 'active') AND consumed_at IS NULL AND expired_at IS NULL AND revoked_at IS NULL)
    OR (state = 'consumed' AND consumed_at IS NOT NULL AND expired_at IS NULL AND revoked_at IS NULL)
    OR (state = 'expired' AND consumed_at IS NULL AND expired_at IS NOT NULL AND revoked_at IS NULL)
    OR (state = 'revoked' AND consumed_at IS NULL AND expired_at IS NULL AND revoked_at IS NOT NULL)
  )
);
CREATE INDEX firmware_download_tickets_device_expiry_idx
  ON firmware_download_tickets (device_id, expires_at);
CREATE INDEX firmware_download_tickets_active_expiry_idx
  ON firmware_download_tickets (expires_at)
  WHERE state IN ('issued', 'active');

CREATE FUNCTION veetee_consume_firmware_download_ticket(
  requested_ticket_digest bytea,
  expected_device_id uuid,
  at_time timestamptz DEFAULT now()
) RETURNS firmware_download_tickets
LANGUAGE plpgsql
AS $$
DECLARE
  ticket firmware_download_tickets;
  assignment firmware_rollout_assignments;
BEGIN
  IF expected_device_id IS NULL THEN
    RAISE EXCEPTION 'firmware download ticket requires an expected device';
  END IF;

  SELECT * INTO ticket
  FROM firmware_download_tickets
  WHERE ticket_digest = requested_ticket_digest
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'firmware download ticket not found';
  END IF;

  IF ticket.device_id IS DISTINCT FROM expected_device_id THEN
    RAISE EXCEPTION 'firmware download ticket does not match device';
  END IF;

  IF ticket.state NOT IN ('issued', 'active') THEN
    RAISE EXCEPTION 'firmware download ticket is not active';
  END IF;

  IF ticket.expires_at <= at_time THEN
    RAISE EXCEPTION 'firmware download ticket expired';
  END IF;

  SELECT * INTO assignment
  FROM firmware_rollout_assignments
  WHERE id = ticket.firmware_rollout_assignment_id
  FOR UPDATE;

  IF NOT FOUND OR assignment.device_id IS DISTINCT FROM expected_device_id THEN
    RAISE EXCEPTION 'firmware download ticket assignment does not match device';
  END IF;

  IF assignment.state NOT IN ('pending', 'offered', 'downloading', 'downloaded', 'installing') THEN
    RAISE EXCEPTION 'firmware rollout assignment cannot be downloaded';
  END IF;

  UPDATE firmware_download_tickets
  SET state = 'consumed', consumed_at = at_time
  WHERE id = ticket.id
  RETURNING * INTO ticket;

  IF assignment.state IN ('pending', 'offered') THEN
    UPDATE firmware_rollout_assignments
    SET state = 'downloading',
        download_started_at = COALESCE(download_started_at, at_time)
    WHERE id = assignment.id;
  END IF;

  RETURN ticket;
END;
$$;

CREATE FUNCTION veetee_expire_firmware_download_tickets(
  at_time timestamptz DEFAULT now()
) RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  expired_count integer;
BEGIN
  UPDATE firmware_download_tickets
  SET state = 'expired', expired_at = at_time
  WHERE state IN ('issued', 'active')
    AND expires_at <= at_time;

  GET DIAGNOSTICS expired_count = ROW_COUNT;
  RETURN expired_count;
END;
$$;
`;

export const downSql = `
DROP FUNCTION IF EXISTS veetee_expire_firmware_download_tickets(timestamptz);
DROP FUNCTION IF EXISTS veetee_consume_firmware_download_ticket(bytea, uuid, timestamptz);
DROP TABLE IF EXISTS firmware_download_tickets;
DROP TABLE IF EXISTS firmware_rollout_assignments;
DROP TRIGGER IF EXISTS firmware_rollouts_validate_release ON firmware_rollouts;
DROP FUNCTION IF EXISTS veetee_validate_firmware_rollout();
DROP TABLE IF EXISTS firmware_rollouts;
DROP TRIGGER IF EXISTS firmware_releases_validate_publication ON firmware_releases;
DROP TRIGGER IF EXISTS firmware_releases_published_immutable ON firmware_releases;
DROP FUNCTION IF EXISTS veetee_prevent_published_firmware_release_mutation();
DROP FUNCTION IF EXISTS veetee_validate_firmware_release();
DROP TRIGGER IF EXISTS firmware_artifacts_published_immutable ON firmware_artifacts;
DROP FUNCTION IF EXISTS veetee_prevent_published_firmware_artifact_mutation();
DROP TABLE IF EXISTS firmware_releases;
DROP TABLE IF EXISTS firmware_artifacts;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(upSql);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(downSql);
}