import { describe, expect, it } from 'vitest';

import {
  downSql as firmwareDownSql,
  upSql as firmwareUpSql,
} from '../src/migrations/0004_firmware_delivery.js';
import {
  downSql as conversationDownSql,
  upSql as conversationUpSql,
} from '../src/migrations/0005_conversation_retention.js';

function expectSqlFields(sql: string, fields: readonly string[]): void {
  for (const field of fields) {
    expect(sql).toContain(field);
  }
}

describe('firmware delivery lifecycle migration', () => {
  it('persists signed compatibility, approved releases, controlled rollout, and observed assignment lifecycle', () => {
    expectSqlFields(firmwareUpSql, [
      'signature_algorithm',
      'signature bytea',
      'signature_key_id',
      'compatibility_metadata',
      'minimum_protocol_version',
      'minimum_bootloader_version',
      'approval_state',
      'approved_by_operator_id',
      'approved_at',
      'target_policy',
      'staged_percentage',
      'failure_threshold_percentage',
      'maintenance_window',
      'force_reason',
      'force_approved_by_operator_id',
      'rollback_policy',
      'rollback_state',
      'offered_at',
      'download_started_at',
      'downloaded_at',
      'install_started_at',
      'installed_at',
      'failed_at',
      'rollback_started_at',
      'rolled_back_at',
      'observed_version',
      'observed_result',
    ]);
    expect(firmwareUpSql).toContain('veetee_validate_firmware_release');
    expect(firmwareUpSql).toContain('veetee_validate_firmware_rollout');
  });

  it('serializes artifact publication and mutation and preserves every published release field on withdrawal', () => {
    expect(firmwareUpSql).toContain('firmware_artifacts_published_immutable');
    expect(firmwareUpSql).toContain('firmware_releases_published_immutable');
    expect(firmwareUpSql).toContain('firmware artifact referenced by a published release cannot be changed');
    expect(firmwareUpSql).toContain('published firmware release cannot be changed except withdrawal');
    expect(firmwareUpSql).toContain("NEW.state = 'withdrawn'");
    expect(firmwareUpSql).toContain('WHERE id = NEW.firmware_artifact_id\n    FOR UPDATE');
    expect(firmwareUpSql).toContain('WHERE id = OLD.id\n  FOR UPDATE');

    for (const column of [
      'id',
      'firmware_artifact_id',
      'board_type',
      'version',
      'minimum_protocol_version',
      'minimum_bootloader_version',
      'approval_state',
      'approved_by_operator_id',
      'approval_reason',
      'approved_at',
      'published_at',
      'created_at',
    ]) {
      expect(firmwareUpSql).toContain(`NEW.${column} IS NOT DISTINCT FROM OLD.${column}`);
    }

    expect(firmwareDownSql).toContain('DROP TRIGGER IF EXISTS firmware_artifacts_published_immutable');
    expect(firmwareDownSql).toContain('DROP TRIGGER IF EXISTS firmware_releases_published_immutable');
  });

  it('rejects missing ticket device identity and compares ticket devices null-safely', () => {
    expect(firmwareUpSql).toContain('IF expected_device_id IS NULL THEN');
    expect(firmwareUpSql).toContain('ticket.device_id IS DISTINCT FROM expected_device_id');
    expect(firmwareUpSql).toContain('assignment.device_id IS DISTINCT FROM expected_device_id');
  });

  it('binds each ticket to its assignment device and consumes it atomically', () => {
    expect(firmwareUpSql).toContain('UNIQUE (id, device_id)');
    expect(firmwareUpSql).toContain('firmware_download_tickets_assignment_device_fk');
    expect(firmwareUpSql).toContain('REFERENCES firmware_rollout_assignments (id, device_id)');
    expect(firmwareUpSql).toContain('veetee_consume_firmware_download_ticket');
    expect(firmwareUpSql).toContain('requested_ticket_digest bytea');
    expect(firmwareUpSql).not.toContain('requested_ticket_id uuid');
    expect(firmwareUpSql.split('CREATE FUNCTION veetee_consume_firmware_download_ticket(').length - 1).toBe(1);
    expect(firmwareDownSql).not.toContain('veetee_consume_firmware_download_ticket(uuid, uuid');
    expect(firmwareUpSql).toContain('FOR UPDATE');
    expect(firmwareUpSql).toContain('veetee_expire_firmware_download_tickets');
    expect(firmwareDownSql).toContain('DROP FUNCTION IF EXISTS veetee_consume_firmware_download_ticket(bytea, uuid, timestamptz)');
    expect(firmwareDownSql).toContain('DROP TABLE IF EXISTS firmware_download_tickets');
  });
});

describe('conversation retention lifecycle migration', () => {
  it('makes the wire session authoritative for conversation identity and retention', () => {
    expectSqlFields(conversationUpSql, [
      'wire_session_id',
      'device_id',
      'assistant_revision_id',
      'runtime_snapshot_id',
      'protocol_version',
      'transport',
      'end_reason',
      'retention_mode',
      'retention_policy_id',
      'expires_at',
      'error_code',
      'error_metadata',
      'conversations_session_identity_fk',
      'REFERENCES sessions (',
    ]);
    expect(conversationUpSql).toContain('sessions_wire_session_id_unique UNIQUE (wire_session_id)');
  });

  it('keeps turn cancellation independent and makes events metadata-only', () => {
    expectSqlFields(conversationUpSql, [
      'conversation_turns_state_check',
      'abort_state',
      'abort_requested_at',
      'aborted_at',
      'conversation_turns_abort_lifecycle_coherent_check',
      'conversation_turns_completion_coherent_check',
      'conversation_turns_state_abort_lifecycle_coherent_check',
      'conversation_events_metadata_only_check',
      'conversation_events_immutable',
    ]);
    expect(conversationUpSql).toContain("(state = 'aborted' AND abort_state = 'aborted')");
    expect(conversationUpSql).toContain("(state <> 'aborted' AND abort_state <> 'aborted')");
    expect(conversationUpSql).not.toContain('conversation_turns_immutable');
    expect(conversationDownSql).toContain('DROP TABLE IF EXISTS conversation_events');
    expect(conversationDownSql).toContain('DROP TABLE IF EXISTS sessions');
  });
});
