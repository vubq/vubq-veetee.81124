import type { MigrationBuilder } from 'node-pg-migrate';

export const id = '0006_mcp_audit_outbox';

export const upSql = `
SELECT pg_catalog.set_config(
  'search_path',
  pg_catalog.format('%I, pg_catalog, pg_temp', pg_catalog.current_schema()),
  true
);

CREATE FUNCTION veetee_prevent_mcp_tool_identity_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.device_id IS DISTINCT FROM OLD.device_id
    OR NEW.namespace IS DISTINCT FROM OLD.namespace
    OR NEW.tool_name IS DISTINCT FROM OLD.tool_name
    OR NEW.audience IS DISTINCT FROM OLD.audience THEN
    RAISE EXCEPTION 'MCP tool identity and audience are immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TABLE mcp_tools (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  namespace varchar(128) NOT NULL,
  tool_name varchar(255) NOT NULL,
  audience varchar(32) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_tools_device_namespace_name_unique UNIQUE (device_id, namespace, tool_name),
  CONSTRAINT mcp_tools_id_device_unique UNIQUE (id, device_id),
  CONSTRAINT mcp_tools_audience_check CHECK (audience IN ('system', 'user'))
);
CREATE TRIGGER mcp_tools_identity_immutable
  BEFORE UPDATE ON mcp_tools
  FOR EACH ROW EXECUTE FUNCTION veetee_prevent_mcp_tool_identity_mutation();

ALTER TABLE sessions
  ADD CONSTRAINT sessions_id_device_unique UNIQUE (id, device_id);

CREATE TABLE mcp_tool_revisions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  mcp_tool_id uuid NOT NULL,
  device_id uuid NOT NULL,
  revision integer NOT NULL,
  audience varchar(32) NOT NULL DEFAULT 'user',
  risk_class varchar(32) NOT NULL DEFAULT 'medium',
  approval_policy varchar(32) NOT NULL DEFAULT 'required',
  input_schema jsonb NOT NULL,
  output_schema jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_tool_revisions_tool_revision_unique UNIQUE (mcp_tool_id, revision),
  CONSTRAINT mcp_tool_revisions_id_tool_device_unique UNIQUE (id, mcp_tool_id, device_id),
  CONSTRAINT mcp_tool_revisions_tool_device_fk FOREIGN KEY (mcp_tool_id, device_id)
    REFERENCES mcp_tools (id, device_id) ON DELETE CASCADE,
  CONSTRAINT mcp_tool_revisions_revision_positive_check CHECK (revision > 0),
  CONSTRAINT mcp_tool_revisions_audience_check CHECK (audience IN ('system', 'user')),
  CONSTRAINT mcp_tool_revisions_risk_class_check CHECK (risk_class IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT mcp_tool_revisions_approval_policy_check CHECK (approval_policy IN ('none', 'required')),
  CONSTRAINT mcp_tool_revisions_policy_coherent_check CHECK (
    (audience <> 'user' OR approval_policy = 'required')
    AND (risk_class NOT IN ('high', 'critical') OR approval_policy = 'required')
  )
);

CREATE FUNCTION veetee_bind_mcp_tool_revision_identity() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  tool_record mcp_tools;
BEGIN
  SELECT * INTO tool_record
  FROM mcp_tools
  WHERE id = NEW.mcp_tool_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MCP tool revision references an unknown tool';
  END IF;

  IF NEW.device_id IS NULL THEN
    NEW.device_id := tool_record.device_id;
  ELSIF NEW.device_id <> tool_record.device_id THEN
    RAISE EXCEPTION 'MCP tool revision does not match tool device';
  END IF;

  IF NEW.audience <> tool_record.audience THEN
    RAISE EXCEPTION 'MCP tool revision audience must match tool audience';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER mcp_tool_revisions_bind_identity
  BEFORE INSERT ON mcp_tool_revisions
  FOR EACH ROW EXECUTE FUNCTION veetee_bind_mcp_tool_revision_identity();

CREATE TABLE session_mcp_tools (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  session_id uuid NOT NULL,
  device_id uuid NOT NULL,
  mcp_tool_id uuid NOT NULL,
  mcp_tool_revision_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_mcp_tools_session_tool_revision_unique UNIQUE (session_id, mcp_tool_revision_id),
  CONSTRAINT session_mcp_tools_id_identity_unique UNIQUE (
    id,
    session_id,
    device_id,
    mcp_tool_id,
    mcp_tool_revision_id
  ),
  CONSTRAINT session_mcp_tools_session_device_fk FOREIGN KEY (session_id, device_id)
    REFERENCES sessions (id, device_id) ON DELETE CASCADE,
  CONSTRAINT session_mcp_tools_revision_identity_fk FOREIGN KEY (
    mcp_tool_revision_id,
    mcp_tool_id,
    device_id
  ) REFERENCES mcp_tool_revisions (id, mcp_tool_id, device_id) ON DELETE RESTRICT
);

CREATE FUNCTION veetee_bind_session_mcp_tool_identity() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  session_record sessions;
  revision_record mcp_tool_revisions;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.session_id IS DISTINCT FROM OLD.session_id
      OR NEW.device_id IS DISTINCT FROM OLD.device_id
      OR NEW.mcp_tool_id IS DISTINCT FROM OLD.mcp_tool_id
      OR NEW.mcp_tool_revision_id IS DISTINCT FROM OLD.mcp_tool_revision_id THEN
      RAISE EXCEPTION 'session MCP tool identity is immutable';
    END IF;

    RETURN NEW;
  END IF;

  SELECT * INTO session_record
  FROM sessions
  WHERE id = NEW.session_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session MCP tool references an unknown session';
  END IF;

  SELECT * INTO revision_record
  FROM mcp_tool_revisions
  WHERE id = NEW.mcp_tool_revision_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'session MCP tool references an unknown tool revision';
  END IF;

  IF NEW.device_id IS NULL THEN
    NEW.device_id := session_record.device_id;
  ELSIF NEW.device_id <> session_record.device_id THEN
    RAISE EXCEPTION 'session MCP tool does not match session device';
  END IF;

  IF NEW.mcp_tool_id IS NULL THEN
    NEW.mcp_tool_id := revision_record.mcp_tool_id;
  ELSIF NEW.mcp_tool_id <> revision_record.mcp_tool_id THEN
    RAISE EXCEPTION 'session MCP tool does not match tool revision';
  END IF;

  IF revision_record.device_id <> NEW.device_id THEN
    RAISE EXCEPTION 'session MCP tool tool revision does not match session device';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER session_mcp_tools_bind_identity
  BEFORE INSERT OR UPDATE ON session_mcp_tools
  FOR EACH ROW EXECUTE FUNCTION veetee_bind_session_mcp_tool_identity();

CREATE TABLE mcp_calls (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  session_id uuid NOT NULL,
  device_id uuid NOT NULL,
  session_mcp_tool_id uuid NOT NULL,
  mcp_tool_id uuid NOT NULL,
  mcp_tool_revision_id uuid NOT NULL,
  method varchar(255) NOT NULL DEFAULT 'tools/call',
  tool_namespace varchar(128) NOT NULL,
  tool_name varchar(255) NOT NULL,
  request_id integer NOT NULL,
  direction varchar(32) NOT NULL,
  attempt integer NOT NULL DEFAULT 0,
  deadline_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  approval_required boolean NOT NULL DEFAULT false,
  approval_expires_at timestamptz,
  state varchar(32) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT mcp_calls_session_request_unique UNIQUE (session_id, direction, request_id, attempt),
  CONSTRAINT mcp_calls_session_device_fk FOREIGN KEY (session_id, device_id)
    REFERENCES sessions (id, device_id) ON DELETE CASCADE,
  CONSTRAINT mcp_calls_session_tool_identity_fk FOREIGN KEY (
    session_mcp_tool_id,
    session_id,
    device_id,
    mcp_tool_id,
    mcp_tool_revision_id
  ) REFERENCES session_mcp_tools (
    id,
    session_id,
    device_id,
    mcp_tool_id,
    mcp_tool_revision_id
  ) ON DELETE RESTRICT,
  CONSTRAINT mcp_calls_request_id_nonnegative_check CHECK (
    request_id >= 0 AND request_id <= 2147483647
  ),
  CONSTRAINT mcp_calls_direction_check CHECK (direction IN ('server_to_device', 'device_to_server')),
  CONSTRAINT mcp_calls_attempt_nonnegative_check CHECK (attempt >= 0),
  CONSTRAINT mcp_calls_method_nonempty_check CHECK (length(btrim(method)) > 0),
  CONSTRAINT mcp_calls_tool_identity_nonempty_check CHECK (
    length(btrim(tool_namespace)) > 0 AND length(btrim(tool_name)) > 0
  ),
  CONSTRAINT mcp_calls_deadline_after_creation_check CHECK (deadline_at > created_at),
  CONSTRAINT mcp_calls_approval_state_coherent_check CHECK (
    (approval_required = false AND approval_expires_at IS NULL)
    OR (
      approval_required = true
      AND direction = 'server_to_device'
      AND approval_expires_at IS NOT NULL
    )
  ),
  CONSTRAINT mcp_calls_state_check CHECK (
    state IN (
      'pending',
      'awaiting_approval',
      'approved',
      'denied',
      'expired',
      'dispatched',
      'succeeded',
      'failed',
      'completed',
      'cancelled'
    )
  ),
  CONSTRAINT mcp_calls_completion_state_coherent_check CHECK (
    (
      state IN ('pending', 'awaiting_approval', 'approved', 'dispatched')
      AND completed_at IS NULL
    )
    OR (
      state IN ('denied', 'expired', 'succeeded', 'failed', 'completed', 'cancelled')
      AND completed_at IS NOT NULL
    )
  )
);

CREATE TABLE mcp_approvals (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  mcp_call_id uuid NOT NULL REFERENCES mcp_calls (id) ON DELETE CASCADE,
  operator_id uuid REFERENCES operators (id) ON DELETE RESTRICT,
  state varchar(32) NOT NULL DEFAULT 'pending',
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mcp_approvals_state_check CHECK (state IN ('pending', 'approved', 'denied', 'expired')),
  CONSTRAINT mcp_approvals_expiry_after_creation_check CHECK (expires_at > created_at),
  CONSTRAINT mcp_approvals_state_coherent_check CHECK (
    (state = 'pending' AND operator_id IS NULL AND decided_at IS NULL)
    OR (state IN ('approved', 'denied') AND operator_id IS NOT NULL AND decided_at IS NOT NULL)
    OR (state = 'expired' AND operator_id IS NULL AND decided_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX mcp_approvals_one_active_per_call
  ON mcp_approvals (mcp_call_id)
  WHERE state = 'pending';
CREATE INDEX mcp_approvals_pending_expiry_idx
  ON mcp_approvals (expires_at)
  WHERE state = 'pending';

CREATE TABLE mcp_approval_transition_guards (
  approval_id uuid PRIMARY KEY REFERENCES mcp_approvals (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON TABLE mcp_approval_transition_guards FROM PUBLIC;

CREATE FUNCTION veetee_enforce_mcp_call_policy() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  session_tool_record session_mcp_tools;
  revision_record mcp_tool_revisions;
  tool_record mcp_tools;
  requires_approval boolean;
  approval_state varchar(32);
  has_approved_approval boolean;
  approval_transition boolean;
BEGIN
  SELECT * INTO session_tool_record
  FROM session_mcp_tools
  WHERE id = NEW.session_mcp_tool_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MCP call references an unknown session tool';
  END IF;

  SELECT * INTO revision_record
  FROM mcp_tool_revisions
  WHERE id = session_tool_record.mcp_tool_revision_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MCP call references an unknown tool revision';
  END IF;

  SELECT * INTO tool_record
  FROM mcp_tools
  WHERE id = session_tool_record.mcp_tool_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MCP call references an unknown tool';
  END IF;

  IF NEW.session_id <> session_tool_record.session_id THEN
    RAISE EXCEPTION 'MCP call session does not match session tool';
  END IF;

  IF NEW.device_id IS NULL THEN
    NEW.device_id := session_tool_record.device_id;
  ELSIF NEW.device_id <> session_tool_record.device_id THEN
    RAISE EXCEPTION 'MCP call device does not match session tool';
  END IF;

  IF NEW.mcp_tool_id IS NULL THEN
    NEW.mcp_tool_id := session_tool_record.mcp_tool_id;
  ELSIF NEW.mcp_tool_id <> session_tool_record.mcp_tool_id THEN
    RAISE EXCEPTION 'MCP call tool does not match session tool';
  END IF;

  IF NEW.mcp_tool_revision_id IS NULL THEN
    NEW.mcp_tool_revision_id := session_tool_record.mcp_tool_revision_id;
  ELSIF NEW.mcp_tool_revision_id <> session_tool_record.mcp_tool_revision_id THEN
    RAISE EXCEPTION 'MCP call tool revision does not match session tool';
  END IF;

  IF NEW.tool_namespace IS NULL THEN
    NEW.tool_namespace := tool_record.namespace;
  ELSIF NEW.tool_namespace <> tool_record.namespace THEN
    RAISE EXCEPTION 'MCP call namespace does not match tool identity';
  END IF;

  IF NEW.tool_name IS NULL THEN
    NEW.tool_name := tool_record.tool_name;
  ELSIF NEW.tool_name <> tool_record.tool_name THEN
    RAISE EXCEPTION 'MCP call name does not match tool identity';
  END IF;

  requires_approval := revision_record.approval_policy = 'required';
  NEW.approval_required := requires_approval;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.session_id IS DISTINCT FROM OLD.session_id
      OR NEW.device_id IS DISTINCT FROM OLD.device_id
      OR NEW.session_mcp_tool_id IS DISTINCT FROM OLD.session_mcp_tool_id
      OR NEW.mcp_tool_id IS DISTINCT FROM OLD.mcp_tool_id
      OR NEW.mcp_tool_revision_id IS DISTINCT FROM OLD.mcp_tool_revision_id
      OR NEW.method IS DISTINCT FROM OLD.method
      OR NEW.tool_namespace IS DISTINCT FROM OLD.tool_namespace
      OR NEW.tool_name IS DISTINCT FROM OLD.tool_name
      OR NEW.request_id IS DISTINCT FROM OLD.request_id
      OR NEW.direction IS DISTINCT FROM OLD.direction
      OR NEW.attempt IS DISTINCT FROM OLD.attempt
      OR NEW.deadline_at IS DISTINCT FROM OLD.deadline_at
      OR NEW.approval_expires_at IS DISTINCT FROM OLD.approval_expires_at THEN
      RAISE EXCEPTION 'MCP call identity and deadline are immutable';
    END IF;

    IF OLD.state IN ('denied', 'expired', 'succeeded', 'failed', 'completed', 'cancelled')
      OR OLD.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'terminal MCP call cannot transition';
    END IF;
  END IF;

  IF requires_approval THEN
    IF NEW.direction <> 'server_to_device' THEN
      RAISE EXCEPTION 'approval-required MCP calls must be server_to_device';
    END IF;

    IF NEW.approval_expires_at IS NULL THEN
      NEW.approval_expires_at := NEW.deadline_at;
    ELSE
      NEW.approval_expires_at := LEAST(NEW.approval_expires_at, NEW.deadline_at);
    END IF;

    IF TG_OP = 'INSERT' THEN
      IF NEW.state IN ('pending', 'awaiting_approval') THEN
        NEW.state := 'awaiting_approval';
      ELSE
        RAISE EXCEPTION 'approval-required MCP call must await approval';
      END IF;
    ELSE
      SELECT state INTO approval_state
      FROM mcp_approvals
      WHERE mcp_call_id = NEW.id
        AND state IN ('approved', 'denied', 'expired')
      ORDER BY decided_at DESC
      LIMIT 1;

      SELECT EXISTS (
        SELECT 1
        FROM mcp_approvals
        WHERE mcp_call_id = NEW.id AND state = 'approved'
      ) INTO has_approved_approval;

      SELECT EXISTS (
        SELECT 1
        FROM mcp_approval_transition_guards
        WHERE approval_id IN (
          SELECT id FROM mcp_approvals WHERE mcp_call_id = NEW.id
        )
      ) INTO approval_transition;

      IF NEW.state IN ('approved', 'denied', 'expired') THEN
        IF OLD.state <> 'awaiting_approval'
          OR NOT approval_transition
          OR approval_state IS DISTINCT FROM NEW.state THEN
          RAISE EXCEPTION 'MCP approval state may only be changed by approval decision';
        END IF;
      ELSIF NEW.state = 'dispatched' THEN
        IF OLD.state <> 'approved' OR NOT has_approved_approval THEN
          RAISE EXCEPTION 'approval-required MCP call must be approved before dispatch';
        END IF;
      ELSIF NEW.state IN ('succeeded', 'failed', 'completed') THEN
        IF OLD.state NOT IN ('approved', 'dispatched') OR NOT has_approved_approval THEN
          RAISE EXCEPTION 'approval-required MCP call must be approved before completion';
        END IF;
      ELSIF NEW.state = 'awaiting_approval' THEN
        IF OLD.state <> 'awaiting_approval' THEN
          RAISE EXCEPTION 'MCP call cannot return to awaiting approval';
        END IF;
      ELSIF NEW.state <> 'cancelled' THEN
        RAISE EXCEPTION 'invalid approval-required MCP call state transition';
      END IF;
    END IF;
  ELSE
    NEW.approval_expires_at := NULL;

    IF NEW.state IN ('awaiting_approval', 'approved', 'denied', 'expired') THEN
      RAISE EXCEPTION 'MCP call approval state conflicts with tool approval policy';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER mcp_calls_enforce_policy
  BEFORE INSERT OR UPDATE ON mcp_calls
  FOR EACH ROW EXECUTE FUNCTION veetee_enforce_mcp_call_policy();

CREATE FUNCTION veetee_enforce_mcp_approval_lifecycle() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  call_record mcp_calls;
  policy varchar(32);
  approval_transition boolean;
  effective_expiry timestamptz;
BEGIN
  SELECT * INTO call_record
  FROM mcp_calls
  WHERE id = NEW.mcp_call_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MCP approval references an unknown call';
  END IF;

  SELECT approval_policy INTO policy
  FROM mcp_tool_revisions
  WHERE id = call_record.mcp_tool_revision_id
  FOR KEY SHARE;

  IF NOT FOUND OR policy <> 'required' OR NOT call_record.approval_required THEN
    RAISE EXCEPTION 'MCP call does not require approval';
  END IF;

  effective_expiry := LEAST(
    NEW.expires_at,
    call_record.deadline_at,
    call_record.approval_expires_at
  );

  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'pending' OR NEW.operator_id IS NOT NULL OR NEW.decided_at IS NOT NULL THEN
      RAISE EXCEPTION 'new MCP approval must be pending';
    END IF;

    IF call_record.state <> 'awaiting_approval' THEN
      RAISE EXCEPTION 'MCP call is not awaiting approval';
    END IF;

    NEW.expires_at := LEAST(
      NEW.expires_at,
      call_record.deadline_at,
      call_record.approval_expires_at
    );

    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM mcp_approval_transition_guards
    WHERE approval_id = OLD.id
  ) INTO approval_transition;

  IF NOT approval_transition THEN
    RAISE EXCEPTION 'MCP approval decisions must use veetee_decide_mcp_approval';
  END IF;

  IF OLD.mcp_call_id IS DISTINCT FROM NEW.mcp_call_id
    OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
    OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'MCP approval identity and expiry are immutable';
  END IF;

  IF OLD.state <> 'pending' THEN
    RAISE EXCEPTION 'MCP approval is not pending';
  END IF;

  IF NEW.state IN ('approved', 'denied') THEN
    IF NEW.operator_id IS NULL OR NEW.decided_at IS NULL OR NEW.decided_at >= effective_expiry THEN
      RAISE EXCEPTION 'MCP approval cannot be decided after expiry';
    END IF;
  ELSIF NEW.state = 'expired' THEN
    IF NEW.operator_id IS NOT NULL OR NEW.decided_at IS NULL OR NEW.decided_at < effective_expiry THEN
      RAISE EXCEPTION 'MCP approval may only expire at its effective expiry';
    END IF;
  ELSE
    RAISE EXCEPTION 'invalid MCP approval state transition';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER mcp_approvals_enforce_lifecycle
  BEFORE INSERT OR UPDATE ON mcp_approvals
  FOR EACH ROW EXECUTE FUNCTION veetee_enforce_mcp_approval_lifecycle();

CREATE FUNCTION veetee_decide_mcp_approval(
  approval_id uuid,
  deciding_operator_id uuid,
  decision varchar,
  at_time timestamptz DEFAULT now()
) RETURNS mcp_approvals
LANGUAGE plpgsql
AS $$
DECLARE
  approval_record mcp_approvals;
  call_record mcp_calls;
  tool_approval_policy varchar(32);
BEGIN
  IF decision NOT IN ('approved', 'denied') THEN
    RAISE EXCEPTION 'invalid MCP approval decision';
  END IF;

  IF deciding_operator_id IS NULL THEN
    RAISE EXCEPTION 'MCP approval decision requires an operator';
  END IF;

  SELECT * INTO approval_record
  FROM mcp_approvals
  WHERE id = approval_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MCP approval not found';
  END IF;

  SELECT * INTO call_record
  FROM mcp_calls
  WHERE id = approval_record.mcp_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MCP approval call not found';
  END IF;

  IF call_record.state IN ('denied', 'expired', 'succeeded', 'failed', 'completed', 'cancelled')
    OR call_record.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'terminal, cancelled, or completed MCP call cannot be approved';
  END IF;

  SELECT revision.approval_policy INTO tool_approval_policy
  FROM mcp_tool_revisions AS revision
  WHERE revision.id = call_record.mcp_tool_revision_id
  FOR KEY SHARE;

  IF NOT FOUND OR tool_approval_policy <> 'required' OR NOT call_record.approval_required THEN
    RAISE EXCEPTION 'MCP call approval bypasses tool policy';
  END IF;

  IF approval_record.state <> 'pending' OR call_record.state <> 'awaiting_approval' THEN
    RAISE EXCEPTION 'MCP approval is not pending for an awaiting call';
  END IF;

  INSERT INTO mcp_approval_transition_guards (approval_id)
  VALUES (approval_id);

  IF approval_record.expires_at <= at_time
    OR call_record.deadline_at <= at_time
    OR call_record.approval_expires_at <= at_time THEN
    UPDATE mcp_approvals
    SET state = 'expired', operator_id = NULL, decided_at = at_time
    WHERE id = approval_id
    RETURNING * INTO approval_record;

    UPDATE mcp_calls
    SET state = 'expired', completed_at = at_time
    WHERE id = call_record.id;

    DELETE FROM mcp_approval_transition_guards
    WHERE mcp_approval_transition_guards.approval_id = approval_record.id;

    RETURN approval_record;
  END IF;

  UPDATE mcp_approvals
  SET state = decision, operator_id = deciding_operator_id, decided_at = at_time
  WHERE id = approval_id
  RETURNING * INTO approval_record;

  UPDATE mcp_calls
  SET state = decision,
      completed_at = CASE WHEN decision = 'denied' THEN at_time ELSE NULL END
  WHERE id = call_record.id;

  DELETE FROM mcp_approval_transition_guards
  WHERE mcp_approval_transition_guards.approval_id = approval_record.id;

  RETURN approval_record;
END;
$$;

CREATE FUNCTION veetee_expire_mcp_approval(
  approval_id uuid,
  at_time timestamptz DEFAULT now()
) RETURNS mcp_approvals
LANGUAGE plpgsql
AS $$
DECLARE
  approval_record mcp_approvals;
  call_record mcp_calls;
BEGIN
  SELECT * INTO approval_record
  FROM mcp_approvals
  WHERE id = approval_id
  FOR UPDATE;

  IF NOT FOUND OR approval_record.state <> 'pending' THEN
    RAISE EXCEPTION 'MCP approval is not pending';
  END IF;

  SELECT * INTO call_record
  FROM mcp_calls
  WHERE id = approval_record.mcp_call_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MCP approval call not found';
  END IF;

  IF approval_record.expires_at > at_time
    AND call_record.deadline_at > at_time
    AND call_record.approval_expires_at > at_time THEN
    RAISE EXCEPTION 'MCP approval has not expired';
  END IF;

  INSERT INTO mcp_approval_transition_guards (approval_id)
  VALUES (approval_id);

  UPDATE mcp_approvals
  SET state = 'expired', operator_id = NULL, decided_at = at_time
  WHERE id = approval_id
  RETURNING * INTO approval_record;

  IF call_record.state NOT IN ('denied', 'expired', 'succeeded', 'failed', 'completed', 'cancelled')
    AND call_record.completed_at IS NULL THEN
    UPDATE mcp_calls
    SET state = 'expired', completed_at = at_time
    WHERE id = call_record.id;
  END IF;

  DELETE FROM mcp_approval_transition_guards
  WHERE mcp_approval_transition_guards.approval_id = approval_record.id;

  RETURN approval_record;
END;
$$;

CREATE FUNCTION veetee_prevent_direct_mcp_authorization_delete() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'MCP authorization records must not be deleted directly';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER mcp_approvals_prevent_direct_delete
  BEFORE DELETE ON mcp_approvals
  FOR EACH ROW EXECUTE FUNCTION veetee_prevent_direct_mcp_authorization_delete();
CREATE TRIGGER mcp_calls_prevent_direct_delete
  BEFORE DELETE ON mcp_calls
  FOR EACH ROW EXECUTE FUNCTION veetee_prevent_direct_mcp_authorization_delete();

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_type varchar(32) NOT NULL,
  actor_id uuid,
  action varchar(128) NOT NULL,
  subject_type varchar(128) NOT NULL,
  subject_id uuid,
  metadata jsonb NOT NULL
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  topic varchar(255) NOT NULL,
  payload jsonb NOT NULL,
  deduplication_key varchar(255) NOT NULL,
  CONSTRAINT outbox_events_deduplication_key_unique UNIQUE (deduplication_key)
);

CREATE TABLE outbox_deliveries (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  outbox_event_id uuid NOT NULL REFERENCES outbox_events (id) ON DELETE CASCADE,
  destination varchar(255) NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  last_error_code varchar(128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT outbox_deliveries_event_destination_unique UNIQUE (outbox_event_id, destination),
  CONSTRAINT outbox_deliveries_state_check CHECK (state IN ('pending', 'retrying', 'published', 'failed')),
  CONSTRAINT outbox_deliveries_attempt_count_nonnegative_check CHECK (attempt_count >= 0)
);
CREATE INDEX outbox_deliveries_pending_idx
  ON outbox_deliveries (next_attempt_at)
  WHERE state IN ('pending', 'retrying');

CREATE TRIGGER mcp_tool_revisions_immutable
  BEFORE UPDATE OR DELETE ON mcp_tool_revisions
  FOR EACH ROW EXECUTE FUNCTION veetee_prevent_immutable_mutation();
CREATE TRIGGER audit_events_immutable
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION veetee_prevent_immutable_mutation();
CREATE TRIGGER outbox_events_immutable
  BEFORE UPDATE OR DELETE ON outbox_events
  FOR EACH ROW EXECUTE FUNCTION veetee_prevent_immutable_mutation();
`;

export const downSql = `
DROP TRIGGER IF EXISTS outbox_events_immutable ON outbox_events;
DROP TRIGGER IF EXISTS audit_events_immutable ON audit_events;
DROP TRIGGER IF EXISTS mcp_tool_revisions_immutable ON mcp_tool_revisions;
DROP TRIGGER IF EXISTS mcp_calls_prevent_direct_delete ON mcp_calls;
DROP TRIGGER IF EXISTS mcp_approvals_prevent_direct_delete ON mcp_approvals;
DROP TRIGGER IF EXISTS mcp_approvals_enforce_lifecycle ON mcp_approvals;
DROP TRIGGER IF EXISTS mcp_calls_enforce_policy ON mcp_calls;
DROP TRIGGER IF EXISTS session_mcp_tools_bind_identity ON session_mcp_tools;
DROP TRIGGER IF EXISTS mcp_tool_revisions_bind_identity ON mcp_tool_revisions;
DROP TRIGGER IF EXISTS mcp_tools_identity_immutable ON mcp_tools;
DROP FUNCTION IF EXISTS veetee_prevent_direct_mcp_authorization_delete();
DROP FUNCTION IF EXISTS veetee_expire_mcp_approval(uuid, timestamptz);
DROP FUNCTION IF EXISTS veetee_decide_mcp_approval(uuid, uuid, varchar, timestamptz);
DROP FUNCTION IF EXISTS veetee_enforce_mcp_approval_lifecycle();
DROP FUNCTION IF EXISTS veetee_enforce_mcp_call_policy();
DROP FUNCTION IF EXISTS veetee_bind_session_mcp_tool_identity();
DROP FUNCTION IF EXISTS veetee_bind_mcp_tool_revision_identity();
DROP FUNCTION IF EXISTS veetee_prevent_mcp_tool_identity_mutation();
DROP TABLE IF EXISTS outbox_deliveries;
DROP TABLE IF EXISTS outbox_events;
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS mcp_approval_transition_guards;
DROP TABLE IF EXISTS mcp_approvals;
DROP TABLE IF EXISTS mcp_calls;
DROP TABLE IF EXISTS session_mcp_tools;
DROP TABLE IF EXISTS mcp_tool_revisions;
DROP TABLE IF EXISTS mcp_tools;
ALTER TABLE IF EXISTS sessions
  DROP CONSTRAINT IF EXISTS sessions_id_device_unique;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(upSql);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(downSql);
}
