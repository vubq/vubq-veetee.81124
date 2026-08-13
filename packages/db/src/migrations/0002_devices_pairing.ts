import type { MigrationBuilder } from 'node-pg-migrate';

export const id = '0002_devices_pairing';

export const upSql = `
CREATE TABLE assistants (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  assistant_key varchar(128) NOT NULL,
  display_name varchar(255) NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assistants_assistant_key_unique UNIQUE (assistant_key),
  CONSTRAINT assistants_state_check CHECK (state IN ('active', 'disabled'))
);

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  hardware_id varchar(17) NOT NULL,
  client_id varchar(255) NOT NULL,
  serial_number varchar(255),
  board_type varchar(128) NOT NULL,
  assistant_id uuid REFERENCES assistants (id) ON DELETE SET NULL,
  token_version integer NOT NULL DEFAULT 0,
  paired_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT devices_hardware_id_unique UNIQUE (hardware_id),
  CONSTRAINT devices_serial_number_unique UNIQUE (serial_number),
  CONSTRAINT devices_hardware_id_canonical_mac_check CHECK (hardware_id ~ '^[0-9a-f]{2}(:[0-9a-f]{2}){5}$'),
  CONSTRAINT devices_token_version_nonnegative_check CHECK (token_version >= 0)
);
CREATE INDEX devices_client_id_idx ON devices (client_id);
CREATE INDEX devices_assistant_id_idx ON devices (assistant_id);

CREATE TABLE device_identity_history (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  hardware_id varchar(17) NOT NULL,
  client_id varchar(255) NOT NULL,
  serial_number varchar(255),
  observed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT device_identity_history_hardware_id_canonical_mac_check CHECK (hardware_id ~ '^[0-9a-f]{2}(:[0-9a-f]{2}){5}$')
);
CREATE INDEX device_identity_history_device_observed_idx ON device_identity_history (device_id, observed_at);

CREATE TABLE pairing_requests (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  code_digest bytea NOT NULL,
  code_salt bytea NOT NULL,
  challenge_digest bytea NOT NULL,
  challenge_salt bytea NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'pending',
  max_attempts integer NOT NULL DEFAULT 5,
  attempt_count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  claimed_by_operator_id uuid REFERENCES operators (id) ON DELETE RESTRICT,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pairing_requests_attempt_count_check CHECK (max_attempts > 0 AND attempt_count >= 0 AND attempt_count <= max_attempts),
  CONSTRAINT pairing_requests_state_check CHECK (state IN ('pending', 'claimed', 'consumed', 'expired', 'cancelled', 'locked')),
  CONSTRAINT pairing_requests_state_coherent_check CHECK (
    (state = 'pending' AND claimed_at IS NULL AND claimed_by_operator_id IS NULL AND consumed_at IS NULL)
    OR (state = 'claimed' AND claimed_at IS NOT NULL AND claimed_by_operator_id IS NOT NULL AND consumed_at IS NULL)
    OR (state = 'consumed' AND claimed_at IS NOT NULL AND claimed_by_operator_id IS NOT NULL AND consumed_at IS NOT NULL)
    OR (state IN ('expired', 'cancelled', 'locked') AND consumed_at IS NULL)
  )
);
CREATE UNIQUE INDEX pairing_requests_one_live_per_device
  ON pairing_requests (device_id)
  WHERE state IN ('pending', 'claimed');
CREATE INDEX pairing_requests_expiry_idx ON pairing_requests (expires_at);

CREATE TABLE pairing_attempts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  pairing_request_id uuid NOT NULL REFERENCES pairing_requests (id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  outcome varchar(32) NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pairing_attempts_request_number_unique UNIQUE (pairing_request_id, attempt_number),
  CONSTRAINT pairing_attempts_number_positive_check CHECK (attempt_number > 0),
  CONSTRAINT pairing_attempts_outcome_check CHECK (outcome IN ('accepted', 'rejected', 'expired', 'locked'))
);

CREATE TABLE pairing_consumptions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  pairing_request_id uuid NOT NULL REFERENCES pairing_requests (id) ON DELETE RESTRICT,
  device_id uuid NOT NULL REFERENCES devices (id) ON DELETE RESTRICT,
  activation_proof_digest bytea NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pairing_consumptions_request_unique UNIQUE (pairing_request_id)
);

-- PostgreSQL cannot use now() in a partial-index predicate. Serialize direct
-- inserts on the device row and retire stale active rows before the unique
-- index is checked, so an expired row cannot block a subsequent request.
CREATE FUNCTION veetee_expire_stale_pairing_requests_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.state IN ('pending', 'claimed') AND NEW.expires_at <= now() THEN
    NEW.state := 'expired';
    NEW.claimed_at := NULL;
    NEW.claimed_by_operator_id := NULL;
    RETURN NEW;
  END IF;

  IF NEW.state IN ('pending', 'claimed') THEN
    PERFORM 1
    FROM devices
    WHERE id = NEW.device_id
    FOR UPDATE;

    UPDATE pairing_requests
    SET state = 'expired'
    WHERE device_id = NEW.device_id
      AND state IN ('pending', 'claimed')
      AND expires_at <= COALESCE(NEW.created_at, now());
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER pairing_requests_expire_stale_before_insert
  BEFORE INSERT ON pairing_requests
  FOR EACH ROW
  EXECUTE FUNCTION veetee_expire_stale_pairing_requests_before_insert();

-- Create a new pending request, or refresh the existing pending request for a
-- device. The device row is the serialization point for concurrent callers.
-- Digests and salts are verifier material; plaintext code/challenge values are
-- never accepted or persisted by this function.
CREATE FUNCTION veetee_create_or_refresh_pairing_request(
  p_device_id uuid,
  p_code_digest bytea,
  p_code_salt bytea,
  p_challenge_digest bytea,
  p_challenge_salt bytea,
  p_expires_at timestamptz,
  p_max_attempts integer DEFAULT 5,
  p_at_time timestamptz DEFAULT now()
) RETURNS pairing_requests
LANGUAGE plpgsql
AS $$
DECLARE
  pairing pairing_requests;
  active_count integer;
BEGIN
  IF p_device_id IS NULL THEN
    RAISE EXCEPTION 'pairing device is required';
  END IF;

  IF p_code_digest IS NULL OR octet_length(p_code_digest) = 0
     OR p_code_salt IS NULL OR octet_length(p_code_salt) = 0
     OR p_challenge_digest IS NULL OR octet_length(p_challenge_digest) = 0
     OR p_challenge_salt IS NULL OR octet_length(p_challenge_salt) = 0 THEN
    RAISE EXCEPTION 'pairing verifier material is required';
  END IF;

  IF p_at_time IS NULL OR p_expires_at IS NULL OR p_expires_at <= p_at_time THEN
    RAISE EXCEPTION 'pairing request must expire after the request time';
  END IF;

  IF p_max_attempts IS NULL OR p_max_attempts <= 0 THEN
    RAISE EXCEPTION 'pairing max attempts must be positive';
  END IF;

  -- Every create/refresh call takes this lock before inspecting or changing
  -- pairing rows. This makes the active-row invariant transactional even when
  -- two bootstrap requests arrive at the same time.
  PERFORM 1
  FROM devices
  WHERE id = p_device_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'pairing device not found';
  END IF;

  UPDATE pairing_requests
  SET state = 'expired'
  WHERE device_id = p_device_id
    AND state IN ('pending', 'claimed')
    AND expires_at <= p_at_time;

  SELECT count(*) INTO active_count
  FROM pairing_requests
  WHERE device_id = p_device_id
    AND state IN ('pending', 'claimed');

  IF active_count > 1 THEN
    RAISE EXCEPTION 'more than one active pairing request exists for device';
  END IF;

  IF active_count = 1 THEN
    SELECT * INTO pairing
    FROM pairing_requests
    WHERE device_id = p_device_id
      AND state IN ('pending', 'claimed')
    FOR UPDATE;

    -- A claimed request is already bound to an operator. Do not replace its
    -- verifier or claimant during a bootstrap refresh; activation owns it.
    IF pairing.state = 'claimed' THEN
      RETURN pairing;
    END IF;

    IF p_max_attempts < pairing.attempt_count THEN
      RAISE EXCEPTION 'pairing max attempts cannot be below recorded attempts';
    END IF;

    UPDATE pairing_requests
    SET code_digest = p_code_digest,
        code_salt = p_code_salt,
        challenge_digest = p_challenge_digest,
        challenge_salt = p_challenge_salt,
        max_attempts = p_max_attempts,
        expires_at = p_expires_at
    WHERE id = pairing.id
    RETURNING * INTO pairing;

    RETURN pairing;
  END IF;

  INSERT INTO pairing_requests (
    device_id,
    code_digest,
    code_salt,
    challenge_digest,
    challenge_salt,
    max_attempts,
    expires_at
  )
  VALUES (
    p_device_id,
    p_code_digest,
    p_code_salt,
    p_challenge_digest,
    p_challenge_salt,
    p_max_attempts,
    p_expires_at
  )
  RETURNING * INTO pairing;

  RETURN pairing;
END;
$$;

-- Atomically verify digest inputs, account for the attempt, and bind the
-- successful claimant. A pending row is locked before any verifier decision;
-- therefore concurrent claimers cannot both transition the row to claimed.
-- The returned row is authoritative: a caller wins only when
-- claimed_by_operator_id equals its claimant id.
CREATE FUNCTION veetee_claim_pairing_request(
  p_request_id uuid,
  p_claimant_operator_id uuid,
  p_code_digest bytea,
  p_challenge_digest bytea,
  p_at_time timestamptz DEFAULT now()
) RETURNS pairing_requests
LANGUAGE plpgsql
AS $$
DECLARE
  pairing pairing_requests;
  claimant_state varchar(32);
  next_attempt integer;
  next_state varchar(32);
BEGIN
  IF p_request_id IS NULL OR p_claimant_operator_id IS NULL THEN
    RAISE EXCEPTION 'pairing request and claimant are required';
  END IF;

  IF p_code_digest IS NULL OR octet_length(p_code_digest) = 0
     OR p_challenge_digest IS NULL OR octet_length(p_challenge_digest) = 0 THEN
    RAISE EXCEPTION 'pairing verifier digests are required';
  END IF;

  IF p_at_time IS NULL THEN
    RAISE EXCEPTION 'pairing claim time is required';
  END IF;

  SELECT state INTO claimant_state
  FROM operators
  WHERE id = p_claimant_operator_id
  FOR SHARE;

  IF NOT FOUND OR claimant_state <> 'active' THEN
    RAISE EXCEPTION 'pairing claimant is not active';
  END IF;

  SELECT * INTO pairing
  FROM pairing_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'pairing request not found';
  END IF;

  IF pairing.state IN ('pending', 'claimed') AND pairing.expires_at <= p_at_time THEN
    UPDATE pairing_requests
    SET state = 'expired'
    WHERE id = p_request_id
    RETURNING * INTO pairing;
    RETURN pairing;
  END IF;

  -- A retry by the winner is idempotent, but another claimant must receive an
  -- error rather than a claimed row that it could mistake for success.
  IF pairing.state = 'claimed' THEN
    IF pairing.claimed_by_operator_id = p_claimant_operator_id THEN
      RETURN pairing;
    END IF;
    RAISE EXCEPTION 'pairing request is already claimed';
  END IF;

  IF pairing.state <> 'pending' THEN
    RAISE EXCEPTION 'pairing request cannot be claimed';
  END IF;

  IF pairing.attempt_count >= pairing.max_attempts THEN
    UPDATE pairing_requests
    SET state = 'locked'
    WHERE id = p_request_id
    RETURNING * INTO pairing;
    RETURN pairing;
  END IF;

  next_attempt := pairing.attempt_count + 1;

  IF pairing.code_digest IS DISTINCT FROM p_code_digest
     OR pairing.challenge_digest IS DISTINCT FROM p_challenge_digest THEN
    next_state := CASE
      WHEN next_attempt >= pairing.max_attempts THEN 'locked'
      ELSE 'pending'
    END;

    UPDATE pairing_requests
    SET attempt_count = next_attempt,
        state = next_state
    WHERE id = p_request_id
    RETURNING * INTO pairing;

    INSERT INTO pairing_attempts (
      pairing_request_id,
      attempt_number,
      outcome,
      attempted_at
    )
    VALUES (
      p_request_id,
      next_attempt,
      CASE WHEN next_state = 'locked' THEN 'locked' ELSE 'rejected' END,
      p_at_time
    );

    RETURN pairing;
  END IF;

  UPDATE pairing_requests
  SET attempt_count = next_attempt,
      state = 'claimed',
      claimed_at = p_at_time,
      claimed_by_operator_id = p_claimant_operator_id
  WHERE id = p_request_id
  RETURNING * INTO pairing;

  INSERT INTO pairing_attempts (
    pairing_request_id,
    attempt_number,
    outcome,
    attempted_at
  )
  VALUES (p_request_id, next_attempt, 'accepted', p_at_time);

  RETURN pairing;
END;
$$;

CREATE FUNCTION veetee_record_pairing_attempt(
  request_id uuid,
  attempt_outcome varchar,
  at_time timestamptz DEFAULT now()
) RETURNS pairing_requests
LANGUAGE plpgsql
AS $$
DECLARE
  pairing pairing_requests;
  next_attempt integer;
  next_state varchar(32);
BEGIN
  IF attempt_outcome NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'invalid pairing attempt outcome';
  END IF;

  IF at_time IS NULL THEN
    RAISE EXCEPTION 'pairing attempt time is required';
  END IF;

  SELECT * INTO pairing
  FROM pairing_requests
  WHERE id = request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'pairing request not found';
  END IF;

  IF pairing.state IN ('pending', 'claimed') AND pairing.expires_at <= at_time THEN
    UPDATE pairing_requests
    SET state = 'expired'
    WHERE id = request_id
    RETURNING * INTO pairing;
    RETURN pairing;
  END IF;

  IF pairing.state NOT IN ('pending', 'claimed') THEN
    RETURN pairing;
  END IF;

  IF pairing.attempt_count >= pairing.max_attempts THEN
    UPDATE pairing_requests
    SET state = 'locked'
    WHERE id = request_id
    RETURNING * INTO pairing;
    RETURN pairing;
  END IF;

  IF attempt_outcome = 'accepted'
     AND (pairing.state <> 'claimed'
          OR pairing.claimed_at IS NULL
          OR pairing.claimed_by_operator_id IS NULL) THEN
    RAISE EXCEPTION 'only a claimant-bound pairing request can record acceptance';
  END IF;

  next_attempt := pairing.attempt_count + 1;
  next_state := CASE
    WHEN attempt_outcome = 'rejected' AND next_attempt >= pairing.max_attempts THEN 'locked'
    ELSE pairing.state
  END;

  UPDATE pairing_requests
  SET attempt_count = next_attempt,
      state = next_state
  WHERE id = request_id
  RETURNING * INTO pairing;

  INSERT INTO pairing_attempts (
    pairing_request_id,
    attempt_number,
    outcome,
    attempted_at
  )
  VALUES (
    request_id,
    next_attempt,
    CASE WHEN next_state = 'locked' THEN 'locked' ELSE attempt_outcome END,
    at_time
  );

  RETURN pairing;
END;
$$;

CREATE FUNCTION veetee_consume_pairing_request(
  request_id uuid,
  expected_device_id uuid,
  proof_digest bytea,
  at_time timestamptz DEFAULT now()
) RETURNS pairing_consumptions
LANGUAGE plpgsql
AS $$
DECLARE
  pairing pairing_requests;
  consumption pairing_consumptions;
BEGIN
  IF proof_digest IS NULL OR octet_length(proof_digest) = 0 THEN
    RAISE EXCEPTION 'activation proof digest is required';
  END IF;

  IF at_time IS NULL THEN
    RAISE EXCEPTION 'pairing consumption time is required';
  END IF;

  SELECT * INTO pairing
  FROM pairing_requests
  WHERE id = request_id
  FOR UPDATE;

  IF NOT FOUND OR pairing.device_id <> expected_device_id THEN
    RAISE EXCEPTION 'pairing request does not match device';
  END IF;

  IF pairing.state = 'claimed' AND pairing.expires_at <= at_time THEN
    RAISE EXCEPTION 'pairing request expired';
  END IF;

  IF pairing.state <> 'claimed'
     OR pairing.claimed_at IS NULL
     OR pairing.claimed_by_operator_id IS NULL
     OR pairing.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'pairing request cannot be consumed';
  END IF;

  UPDATE pairing_requests
  SET state = 'consumed',
      consumed_at = at_time
  WHERE id = request_id
  RETURNING * INTO pairing;

  UPDATE devices
  SET paired_at = at_time,
      updated_at = at_time
  WHERE id = expected_device_id;

  INSERT INTO pairing_consumptions (
    pairing_request_id,
    device_id,
    activation_proof_digest,
    consumed_at
  )
  VALUES (request_id, expected_device_id, proof_digest, at_time)
  RETURNING * INTO consumption;

  RETURN consumption;
END;
$$;
`;

export const downSql = `
DROP FUNCTION IF EXISTS veetee_consume_pairing_request(uuid, uuid, bytea, timestamptz);
DROP FUNCTION IF EXISTS veetee_record_pairing_attempt(uuid, varchar, timestamptz);
DROP FUNCTION IF EXISTS veetee_claim_pairing_request(uuid, uuid, bytea, bytea, timestamptz);
DROP FUNCTION IF EXISTS veetee_create_or_refresh_pairing_request(uuid, bytea, bytea, bytea, bytea, timestamptz, integer, timestamptz);
DROP TRIGGER IF EXISTS pairing_requests_expire_stale_before_insert ON pairing_requests;
DROP FUNCTION IF EXISTS veetee_expire_stale_pairing_requests_before_insert();
DROP TABLE IF EXISTS pairing_consumptions;
DROP TABLE IF EXISTS pairing_attempts;
DROP TABLE IF EXISTS pairing_requests;
DROP TABLE IF EXISTS device_identity_history;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS assistants;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(upSql);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(downSql);
}
