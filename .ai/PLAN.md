# Veetee Delivery Plan

## Goal

Deliver a secure walking skeleton proving firmware-compatible bootstrap, six-digit pairing, device authentication, WebSocket v1 hello, deterministic realtime dialogue, and MCP. Then replace fake providers with configurable Groq/local speech providers and build the management console.

## Phases

### 1. Foundation

- Create overview, architecture, protocol, security, development, operations, provenance, state, and task documents.
- Ignore `references/`, secrets, runtime data, models, firmware binaries, and generated output.
- Initialize local Git on `main`; the verified empty GitHub remote is configured, but do not claim a push until one is explicitly performed.

### 2. Monorepo and test harness

- npm workspaces for TypeScript applications/packages.
- `uv` project for Python realtime.
- Docker Compose PostgreSQL/Redis.
- Shared lint, typecheck, unit, integration, contract, branding, and secret checks.

### 3. Protocol contracts and simulator

- Golden bootstrap, activation, hello, listen, TTS, abort, MCP, and v1 audio fixtures.
- TypeScript CLI simulator as the primary conformance client.
- Clean-room browser simulator later.

### 4. Data and security foundations

- Drizzle schema and reversible migrations.
- Operator authentication and internal service authentication.
- Encrypted provider credential storage.
- Audit and rate-limit conventions.

### 5. Compatibility walking skeleton

- Unknown device bootstrap → stable six-digit pairing request.
- Atomic operator claim.
- Activation `202` → `200`.
- Re-bootstrap returns signed v1 WebSocket config.
- Realtime verifies token/header identity and replies to hello.
- Fake providers produce ordered `stt`, `tts/start`, `sentence_start`, audio, `tts/stop`.
- Abort cancels work.
- MCP initializes, lists a harmless status tool, and calls it.

### 6. Configurable providers

- Provider catalog, instances, credentials, profiles, and session snapshots.
- Groq-compatible streaming LLM with bounded credential failover/cooldown.
- Configurable PhoASR/Whisper-compatible HTTP ASR.
- Configurable VieNeu-compatible HTTP TTS with audio normalization.
- VAD, no-memory, no-intent, and tool-call adapters.

### 7. Firmware and management UI

- Artifact upload, board/version policy, SHA-256, publication lifecycle, and scoped download tickets.
- Build the original Vietnamese-first Vue console from `docs/MANAGEMENT_CONSOLE.md`: overview, assistants, devices, runtime/provider pipelines, knowledge, tools/approvals, sessions, firmware rollouts, audit, and administration.
- Preserve useful behavioral patterns learned from clean-room research—direct assistant actions, focused configuration panels, responsive cards, pairing dialogs, and clear language/theme controls—without copying source, assets, branding, screenshots, exact styling, or route names.

### 8. Hardening and acceptance

- Observability, backups/restores, load tests, security review, SBOM/license inventory.
- Simulator E2E first.
- ESP32-S3 bootstrap/audio/MCP/OTA check after a safe serial identity is detected.

## TDD rule

Every production behavior begins with a focused failing test and observed expected failure. Only minimal code is added to turn it green; refactoring happens afterward. `.ai/STATE.md` records milestone RED/GREEN evidence.

## Acceptance for milestone 1

- Docs and provenance complete.
- Root local Git excludes references and secrets.
- Reproducible workspace installs.
- Tests demonstrate bootstrap/pairing/activation/token/hello behavior.
- CLI simulator completes the pairing and WebSocket hello flow.
- No supplied credential or upstream product branding appears in runtime source.
