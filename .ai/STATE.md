# Veetee State

Updated: 2026-08-13

## Current objective

Design TASK-004 PostgreSQL schemas and reversible migrations for the data and security foundations required by bootstrap, pairing, device identity, providers, pipelines, sessions, MCP, audit, and outbox workflows.

## Current phase

The architect-approved TASK-003 baseline was published on 2026-08-13 as commit `09af09275dd8a21dac19fd55d3bf98427f16b6bc`; `origin/main` matched the local commit, CI run `31696474159` succeeded, and Dependency Graph run `31696474740` succeeded. Publication is complete. A small CI-maintenance checkpoint is replacing deprecated Node.js 20 action runtimes before TASK-004 implementation begins.

## Completed task scope

- Strict protocol contracts cover case-insensitive HTTP/WS headers, firmware-shaped bootstrap and v1/v2 activation wire variants, server-time/WebSocket defaults, realtime messages, direction-aware MCP, v1 raw Opus, and exact v2/v3 network-order frames.
- Bootstrap requests require a lower-case colon-delimited MAC `Device-Id`, object `application` with a non-empty string `application.version`, and object `board` with a non-empty string `board.type`. Additive JSON fields remain preserved.
- The deterministic device simulator models pairing, pagination-aware MCP discovery/calls, user-only explicit approval hardening, cached-wakeup TTS, raw Opus placement, nonterminal speech-turn abort, and follow-up listen behavior.
- Speech-turn abort keeps independent pending MCP requests. A matching late client result or error remains correlated; unmatched and wrong-result-family responses are rejected. Speech/audio restrictions remain in force until `tts/stop` and a later `listen/start`.
- The npm bin builds on demand from source and is covered in a source-only workspace after `npm ci --ignore-scripts` followed by `npm exec -- veetee-device-simulator`.
- Python fixture parity remains one focused test; the full realtime Python suite remains two tests.

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

## Deferred or blocked

- No hardware device is attached; simulator verification is not hardware acceptance.
- Local ASR/TTS HTTP adapters require dedicated fixtures before implementation.
- MCP timeout execution is deferred to TASK-009.
- Restricted model/media assets are not approved for redistribution.
- Provider credentials must remain outside Git.
- The baseline CI emitted a non-blocking deprecated Node.js 20 action-runtime warning. A maintenance branch replaces all four action pins with immutable Node.js 24 releases; local repository checks, Compose validation, and pin verification passed, with remote CI pending.

## Next recommended task

Merge the CI action-runtime maintenance checkpoint after remote verification, then execute TASK-004 database schema and migration planning before implementing TASK-006 bootstrap, pairing, and device-token behavior.
