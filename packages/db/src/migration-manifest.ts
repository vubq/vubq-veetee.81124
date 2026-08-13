import {
  downSql as accessControlDown,
  id as accessControlId,
  upSql as accessControlUp,
} from './migrations/0001_access_control.js';
import {
  downSql as devicesPairingDown,
  id as devicesPairingId,
  upSql as devicesPairingUp,
} from './migrations/0002_devices_pairing.js';
import {
  downSql as providerPipelinesDown,
  id as providerPipelinesId,
  upSql as providerPipelinesUp,
} from './migrations/0003_provider_pipelines.js';
import {
  downSql as firmwareDeliveryDown,
  id as firmwareDeliveryId,
  upSql as firmwareDeliveryUp,
} from './migrations/0004_firmware_delivery.js';
import {
  downSql as conversationRetentionDown,
  id as conversationRetentionId,
  upSql as conversationRetentionUp,
} from './migrations/0005_conversation_retention.js';
import {
  downSql as mcpAuditOutboxDown,
  id as mcpAuditOutboxId,
  upSql as mcpAuditOutboxUp,
} from './migrations/0006_mcp_audit_outbox.js';

export interface DiscoveredMigration {
  id: string;
  up: string;
  down: string;
}

const migrations: readonly DiscoveredMigration[] = [
  { id: accessControlId, up: accessControlUp, down: accessControlDown },
  { id: devicesPairingId, up: devicesPairingUp, down: devicesPairingDown },
  { id: providerPipelinesId, up: providerPipelinesUp, down: providerPipelinesDown },
  { id: firmwareDeliveryId, up: firmwareDeliveryUp, down: firmwareDeliveryDown },
  { id: conversationRetentionId, up: conversationRetentionUp, down: conversationRetentionDown },
  { id: mcpAuditOutboxId, up: mcpAuditOutboxUp, down: mcpAuditOutboxDown },
];

export async function discoverMigrations(): Promise<readonly DiscoveredMigration[]> {
  return migrations;
}

const migrationExtension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';

export const migrationGlob = decodeURIComponent(new URL(
  `./migrations/[0-9][0-9][0-9][0-9]_*.${migrationExtension}`,
  import.meta.url,
).pathname);
