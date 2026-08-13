# Veetee State

Updated: 2026-08-14

## Current objective

Implement TASK-004 PostgreSQL schemas and reversible migrations for the data and security foundations required by bootstrap, pairing, device identity, providers, pipelines, sessions, MCP, audit, and outbox workflows.

## Current phase

The architect-approved TASK-003 baseline was published on 2026-08-13 as commit `09af09275dd8a21dac19fd55d3bf98427f16b6bc`; `origin/main` matched the local commit, CI run `31696474159` succeeded, and Dependency Graph run `31696474740` succeeded. The CI action-runtime maintenance checkpoint was merged as `10dd483d6cac91e74fde784924f31143d15c6c5f` and its post-merge CI run `31697317751` succeeded without the deprecated Node.js 20 runtime warning. TASK-004 implementation is now active on `feat/task-004-database-foundation`.

## Completed task scope

- Strict protocol contracts cover case-insensitive HTTP/WS headers, firmware-shaped bootstrap and v1/v2 activation wire variants, server-time/WebSocket defaults, realtime messages, direction-aware MCP, v1 raw Opus, and exact v2/v3 network-order frames.
- Bootstrap requests require a lower-case colon-delimited MAC `Device-Id`, object `application` with a non-empty string `application.version`, and object `board` with a non-empty string `board.type`. Additive JSON fields remain preserved.
- The deterministic device simulator models pairing, pagination-aware MCP discovery/calls, user-only explicit approval hardening, cached-wakeup TTS, raw Opus placement, nonterminal speech-turn abort, and follow-up listen behavior.
- Speech-turn abort keeps independent pending MCP requests. A matching late client result or error remains correlated; unmatched and wrong-result-family responses are rejected. Speech/audio restrictions remain in force until `tts/stop` and a later `listen/start`.
- The npm bin builds on demand from source and is covered in a source-only workspace after `npm ci --ignore-scripts` followed by `npm exec -- veetee-device-simulator`.
- Python fixture parity remains one focused test; the full realtime Python suite remains two tests.
- TASK-004 RED contract evidence: `NO_COLOR=1 npm test --workspace @veetee/db -- --reporter=verbose` fails because the planned `src/schema.js` module is absent; the PostgreSQL integration case is explicitly skipped without `DATABASE_URL`. Typecheck reports the same intentionally missing schema, migration-discovery, and foundation-verifier modules.

## Important decisions and boundaries

- Direct WebSocket v1 is the enabled release transport. Strict byte-exact v2/v3 framing tests already exist; those adapters remain disabled for rollout.
- Literal deployment variants and compatible hardening are distinguished in `docs/PROTOCOL_COMPATIBILITY.md`. Explicit approval for user-only MCP calls is a Veetee hardening boundary, not a claimed firmware approval interaction.
- MCP timeout execution is deferred to TASK-009. TASK-003 validates shapes, direction, correlation, and simulator order only.
- The simulator is fixture-driven and opens no network connection or audio device.
- Pinned reference worktrees are read-only protocol evidence and must remain unmodified.

## TDD evidence

### Final narrow remediation RED

- `npm test --workspace @veetee/protocol-contracts -- --reporter=verbose` failed the new bootstrap metadata regression because `parseBootstrapRequest` accepted an empty body. The assertion failure was labeled `empty body`.
- `npm test --workspace @veetee/device-simulator -- --reporter=verbose` failed the new late-MCP regression because a matching client result after abort was blocked with `only tts/stop acknowledgement or a subsequent listen/start is valid after abort`.

### Final narrow remediation GREEN

- Focused protocol and simulator suites are green after requiring nested bootstrap metadata and retaining/correlating pending MCP requests through abort. Final whole-repository verification is the authority for current counts below and must be recorded only after it completes.

## Authoritative current verification record

Final narrow remediation verification passed on 2026-08-13.

- `npm run check` passed end to end: root/workspace lint, TypeScript and Vue type checks, Python Ruff, strict mypy, all tests, all workspace builds, and branding/secrets/reference guards.
- Protocol contracts: 3 files, 24 tests passed.
- Device simulator/CLI: 2 files, 10 tests passed. This includes the clean source workspace regression: `npm ci --ignore-scripts`, then `npm exec -- veetee-device-simulator`, before manual build.
- Repository guards: 9 passed.
- Realtime Python: 2 total tests passed, including exactly 1 focused fixture-parity test.
- Strict mypy passed with no issues in 4 source files.
- Focused RED evidence was recorded before implementation; focused GREEN suites and full `npm run check` passed afterward.
- Final hygiene passed: `git diff --check`, no-index whitespace checks for the final-remediation files, runtime-term/link inspection, and both pinned-reference worktree status checks were clean.
- Final independent architect re-review approved TASK-003 for inclusion in the initial Git baseline. Historical 21/6/3/4 TASK-003 count claims are superseded and must not be used as current evidence.
- Baseline commit `09af09275dd8a21dac19fd55d3bf98427f16b6bc` was pushed to `origin/main`; GitHub CI run `31696474159` and Dependency Graph run `31696474740` both completed successfully.

## TASK-004 review status

- Initial schema/migration implementation turned the focused RED contract tests green, but an independent architect review returned `NEEDS_FIX`.
- The first remediation pass added six ordered migrations, built-artifact checks, isolated-schema verification, canonical device identity, provider-role foreign keys, MCP approval state, and separate immutable outbox events from mutable deliveries. Offline lint, typecheck, build, package tests, `npm run db:check`, and repository/harness guards pass; the live PostgreSQL test remains skipped without `DATABASE_URL`.
- A focused architect re-review still returned `NEEDS_FIX`. Release blockers now tracked as TASK-036 through TASK-040 are: expired pairing refresh plus atomic concurrent claim; MCP session/device/tool identity and policy-derived approval; complete provider credential envelopes plus external signing-key handles and immutable published revisions; staged firmware/ticket safety and authoritative conversation-session retention metadata; and ownership-aware database client construction.
- The system Docker daemon remains absent and rootless Docker is blocked by Ubuntu AppArmor unprivileged-user-namespace policy. To obtain live evidence without changing the host, PostgreSQL 16.14 Ubuntu packages and PostgreSQL 17.11 PGDG packages were downloaded and extracted only under `$CLAUDE_JOB_DIR/tmp`; temporary unprivileged clusters ran the built verifier and dedicated integration test successfully for the first remediation pass. These results must be repeated after TASK-036 through TASK-039 merge; CI remains the publication authority.
- TASK-036 through TASK-039 remediation is implemented: pairing refresh/claim/consume is serialized and claimant-bound; MCP calls are tied to immutable revision policy and composite session/device/tool identity; signing-key and provider-credential identity is immutable with monotonic lifecycle; firmware publication, rollout, and digest-authenticated ticket behavior is hardened; conversation sessions own retention and turn-abort metadata; and the database client respects caller-owned pools.
- Drizzle declarations and schema contract tests are reconciled with all six migrations. Procedural triggers/functions remain authoritative in the migration SQL and are covered by focused migration contracts and the live verifier.
- TASK-040 verification is green locally: `npm run db:check`, all 33 database tests against temporary PostgreSQL 17.11, compiled `npm run db:verify`, dedicated `npm run test:integration:postgres`, full `npm run check`, and `git diff --check` all pass.
- The final architect review found one Drizzle/migration mismatch: `mcp_calls.attempt_count` existed only in the Drizzle declaration. The redundant declaration, checks, and contract expectation were removed; `attempt` remains authoritative. The focused re-review then returned `VERDICT: APPROVE` with no remaining release blockers.
- TASK-004 has not been applied to any known shared database. Local review and verification are complete; feature-branch publication and the pinned PostgreSQL 17 CI job are the remaining release checkpoint.

## TASK-004 live verification evidence

- Temporary unprivileged PostgreSQL 16.14 and PostgreSQL 17.11 clusters were initialized under `$CLAUDE_JOB_DIR/tmp` and exposed only through job-local Unix sockets plus local ports `55432` and `55433`.
- The first remediation pass passed `db:verify` and the dedicated integration test on both PostgreSQL 16.14 and 17.11.
- After TASK-036 through TASK-040 integration and the final Drizzle reconciliation, PostgreSQL 17.11 passed all 33 database tests, including concurrent pairing/MCP decisions, digest-only firmware tickets, immutable credential/key/revision records, full migration rollback, schema cleanup, and reapply.
- The final compiled `npm run db:verify` and `npm run test:integration:postgres` both passed against PostgreSQL 17.11. The pinned PostgreSQL 17 CI job remains the publication authority.

## Deferred or blocked

- No hardware device is attached; simulator verification is not hardware acceptance.
- Local ASR/TTS HTTP adapters require dedicated fixtures before implementation.
- MCP timeout execution is deferred to TASK-009.
- Restricted model/media assets are not approved for redistribution.
- Provider credentials must remain outside Git.
- The baseline Node.js 20 action-runtime warning was resolved by merge commit `10dd483d6cac91e74fde784924f31143d15c6c5f`; post-merge CI run `31697317751` passed without that warning.
- Docker remains unavailable locally, but a job-local unprivileged PostgreSQL 17.11 cluster provides current live evidence. Feature-branch CI must still reproduce it on the pinned PostgreSQL 17 image.
- Full migration-owner/runtime-role separation is tracked as TASK-041 and blocks control-API database integration; production must not run the application as the schema owner.

## Next recommended task

Publish the architect-approved TASK-004 feature branch, open its pull request, and require the standard plus pinned PostgreSQL 17 CI jobs. After the publication checkpoint is green, implement TASK-041 migration-owner/runtime-role separation before TASK-005 authentication and TASK-006 bootstrap, pairing, and device-token behavior.
