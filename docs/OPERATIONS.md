# Operations

## Initial deployment

Veetee targets a self-hosted Docker Compose deployment with PostgreSQL, Redis, control API, realtime service, web console, and optional local ASR/TTS services. TLS termination and public routing sit behind a reverse proxy.

## Provisional SLOs

- Monthly availability: 99.5%.
- Bootstrap p99: 500 ms.
- WebSocket hello p99 after accepted connection: 300 ms.
- Groq-compatible LLM first token p99: 2.5 s.
- Local ASR final p99: 3 s.
- Local TTS first audio p99: 3 s.
- End-of-utterance to first downlink audio p99: 5 s.
- RPO: 24 hours.
- RTO: 4 hours.

The owner/operator initially owns the error budget. Provider outage time is labeled separately in infrastructure metrics, while user-visible conversation success includes provider failures.

## Backups

- Nightly encrypted PostgreSQL backups.
- Firmware artifact volume backup.
- Provider master key backup through an operator-controlled secret store.
- Quarterly restore drills.

## PostgreSQL migrations, backups, and recovery

Every migration has an explicit reversible down action and is applied with migration-order validation in a single transaction. Treat migrations as production changes: review both directions, test the exact release on an isolated PostgreSQL 17 database, and record the migration identifiers deployed.

Before a production migration, take and verify a restorable, encrypted PostgreSQL backup. Keep the backup location, restore procedure, migration identifiers, operator, and UTC timestamp in the change record. A successful backup job alone is not sufficient; restore drills validate recovery.

For an additive or otherwise safely reversible migration, the operator may roll back only the most recently applied migration after stopping writers and confirming the down action preserves required data. For destructive or data-transforming changes, do not rely on schema rollback: restore the verified backup or execute the documented forward repair plan. Never run development rollback commands against production without the approved recovery decision and a verified backup.

CI first validates compiled migration discovery offline, then runs the frozen PostgreSQL foundation verifier and integration contract on an isolated pinned PostgreSQL 17 service. The live job uses only compiled migration artifacts and rejects declaration files that could otherwise be loaded as migrations. Its disposable credentials are scoped to that job and are not deployment credentials.

## Key rotation

- Rotate provider keys without exposing old values.
- Mark rate-limited credentials in cooldown using `Retry-After`.
- Quarantine credentials on `401/403` and alert the operator.
- Rotate device signing keys with overlapping verification windows.
- Increment device token version for targeted revocation.

## Provider health

Health checks distinguish DNS/connect/TLS, authentication, quota, model, and payload failures. Key pools improve authorized resilience but are not used to bypass provider terms or quotas.

## Observability

- Structured redacted logs.
- OpenTelemetry traces across Node and Python.
- Metrics for bootstrap, pairing, hello, audio frames, ASR/LLM/TTS latency, provider cooldown, MCP calls, and dropped frames.
- Trace, request, session, device, and provider IDs; no secret or full conversation payload.

## Incident defaults

- Provider unhealthy: fall back according to pipeline policy or return a concise Vietnamese service message.
- PostgreSQL unavailable: readiness fails; new pairing/config changes stop.
- Redis unavailable: degrade non-authoritative presence/rate-limit behavior safely; do not lose authoritative device state.
- Realtime overloaded: reject before heavy allocation and return a reconnectable close reason.
- OTA service unavailable after a firmware update: prioritize restoration because firmware rollback validation can depend on a successful bootstrap.
