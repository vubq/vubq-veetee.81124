import type { MigrationBuilder } from 'node-pg-migrate';

export const id = '0005_conversation_retention';

export const upSql = `
CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  wire_session_id varchar(128) NOT NULL DEFAULT pg_catalog.gen_random_uuid()::text,
  device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  assistant_revision_id uuid REFERENCES assistant_revisions (id) ON DELETE RESTRICT,
  runtime_snapshot_id uuid NOT NULL REFERENCES runtime_snapshots (id) ON DELETE RESTRICT,
  protocol_version integer NOT NULL DEFAULT 1,
  transport varchar(32) NOT NULL DEFAULT 'websocket',
  state varchar(32) NOT NULL DEFAULT 'active',
  end_reason varchar(128),
  retention_mode varchar(32) NOT NULL DEFAULT 'metadata',
  retention_policy_id uuid REFERENCES retention_policies (id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 day'),
  error_code varchar(128),
  error_metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_wire_session_id_unique UNIQUE (wire_session_id),
  CONSTRAINT sessions_id_device_assistant_runtime_retention_unique
    UNIQUE (id, device_id, assistant_revision_id, runtime_snapshot_id, retention_policy_id, retention_mode),
  CONSTRAINT sessions_wire_session_id_nonempty_check CHECK (
    length(btrim(wire_session_id)) > 0
  ),
  CONSTRAINT sessions_protocol_version_positive_check CHECK (protocol_version > 0),
  CONSTRAINT sessions_transport_nonempty_check CHECK (length(btrim(transport)) > 0),
  CONSTRAINT sessions_state_check CHECK (
    state IN ('active', 'ended', 'failed', 'expired', 'terminated')
  ),
  CONSTRAINT sessions_retention_mode_check CHECK (
    retention_mode IN ('none', 'metadata', 'policy')
  ),
  CONSTRAINT sessions_end_after_start_check CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT sessions_expiry_after_start_check CHECK (expires_at >= started_at),
  CONSTRAINT sessions_error_metadata_object_check CHECK (
    error_metadata IS NULL OR jsonb_typeof(error_metadata) = 'object'
  ),
  CONSTRAINT sessions_lifecycle_coherent_check CHECK (
    (state = 'active' AND ended_at IS NULL AND end_reason IS NULL)
    OR (state IN ('ended', 'expired', 'terminated') AND ended_at IS NOT NULL)
    OR (state = 'failed' AND ended_at IS NOT NULL AND error_code IS NOT NULL)
  )
);
CREATE INDEX sessions_device_started_idx ON sessions (device_id, started_at);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at) WHERE state = 'active';

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  assistant_revision_id uuid NOT NULL REFERENCES assistant_revisions (id) ON DELETE RESTRICT,
  runtime_snapshot_id uuid NOT NULL REFERENCES runtime_snapshots (id) ON DELETE RESTRICT,
  retention_mode varchar(32) NOT NULL DEFAULT 'metadata',
  retention_policy_id uuid NOT NULL REFERENCES retention_policies (id) ON DELETE RESTRICT,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_session_identity_fk
    FOREIGN KEY (
      session_id,
      device_id,
      assistant_revision_id,
      runtime_snapshot_id,
      retention_policy_id,
      retention_mode
    ) REFERENCES sessions (
      id,
      device_id,
      assistant_revision_id,
      runtime_snapshot_id,
      retention_policy_id,
      retention_mode
    ) ON DELETE CASCADE,
  CONSTRAINT conversations_retention_mode_check CHECK (
    retention_mode IN ('none', 'metadata', 'policy')
  ),
  CONSTRAINT conversations_end_after_start_check CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT conversations_expiry_after_start_check CHECK (expires_at >= started_at)
);
CREATE INDEX conversations_session_started_idx ON conversations (session_id, started_at);
CREATE INDEX conversations_expiry_idx ON conversations (expires_at);

CREATE TABLE conversation_turns (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  kind varchar(32) NOT NULL,
  state varchar(32) NOT NULL DEFAULT 'pending',
  abort_state varchar(32) NOT NULL DEFAULT 'not_requested',
  content_digest varchar(128),
  error_code varchar(128),
  error_metadata jsonb,
  abort_requested_at timestamptz,
  aborted_at timestamptz,
  completed_at timestamptz,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_turns_conversation_sequence_unique UNIQUE (conversation_id, sequence),
  CONSTRAINT conversation_turns_sequence_positive_check CHECK (sequence > 0),
  CONSTRAINT conversation_turns_kind_check CHECK (kind IN ('user', 'assistant', 'system', 'tool')),
  CONSTRAINT conversation_turns_state_check CHECK (
    state IN ('pending', 'processing', 'completed', 'failed', 'aborted', 'cancelled')
  ),
  CONSTRAINT conversation_turns_abort_state_check CHECK (
    abort_state IN ('not_requested', 'requested', 'acknowledged', 'aborted')
  ),
  CONSTRAINT conversation_turns_error_metadata_object_check CHECK (
    error_metadata IS NULL OR jsonb_typeof(error_metadata) = 'object'
  ),
  CONSTRAINT conversation_turns_abort_lifecycle_coherent_check CHECK (
    (abort_state = 'not_requested' AND abort_requested_at IS NULL AND aborted_at IS NULL)
    OR (abort_state IN ('requested', 'acknowledged') AND abort_requested_at IS NOT NULL AND aborted_at IS NULL)
    OR (abort_state = 'aborted' AND abort_requested_at IS NOT NULL AND aborted_at IS NOT NULL)
  ),
  CONSTRAINT conversation_turns_completion_coherent_check CHECK (
    (state IN ('pending', 'processing') AND completed_at IS NULL)
    OR (state IN ('completed', 'failed', 'aborted', 'cancelled') AND completed_at IS NOT NULL)
  ),
  CONSTRAINT conversation_turns_state_abort_lifecycle_coherent_check CHECK (
    (state = 'aborted' AND abort_state = 'aborted')
    OR (state <> 'aborted' AND abort_state <> 'aborted')
  )
);
CREATE INDEX conversation_turns_conversation_state_idx
  ON conversation_turns (conversation_id, state);

CREATE TABLE conversation_events (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  event_type varchar(64) NOT NULL,
  metadata jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_events_conversation_sequence_unique UNIQUE (conversation_id, sequence),
  CONSTRAINT conversation_events_sequence_positive_check CHECK (sequence > 0),
  CONSTRAINT conversation_events_metadata_only_check CHECK (
    jsonb_typeof(metadata) = 'object'
    AND NOT (metadata ?| ARRAY['audio', 'audio_url', 'content', 'raw_audio', 'transcript'])
  )
);

CREATE TRIGGER conversation_events_immutable
  BEFORE UPDATE OR DELETE ON conversation_events
  FOR EACH ROW EXECUTE FUNCTION veetee_prevent_immutable_mutation();
`;

export const downSql = `
DROP TRIGGER IF EXISTS conversation_events_immutable ON conversation_events;
DROP TABLE IF EXISTS conversation_events;
DROP TABLE IF EXISTS conversation_turns;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS sessions;
`;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(upSql);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.sql(downSql);
}
