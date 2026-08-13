# TASK-003: Define protocol contracts and simulator fixtures

## Goal

Create canonical schemas, golden fixtures, v1 framing utilities, and deterministic CLI simulator.

## Scope and exclusions

Implement only this task's bounded responsibilities. Do not copy restricted reference assets, embed provider credentials, or enable destructive hardware actions implicitly.

## Dependencies

TASK-002

## Intended files

packages/protocol-contracts/, tools/device-simulator/

## Test-first sequence

1. Write the smallest failing behavior/contract test.
2. Run it and confirm the expected RED reason.
3. Implement minimal production behavior.
4. Run focused and surrounding suites.
5. Refactor only while green and update `.ai/STATE.md`.

## Acceptance criteria

Contract tests cover firmware-compatible bootstrap and v1/v2 activation wire shapes, case-insensitive HTTP/WS identity headers, v2/v3 byte-exact framing, realtime state messages, strict direction-aware MCP requests/responses, raw-buffer copy isolation, and an original raw 60 ms Opus fixture. The deterministic simulator replays fixture-driven pairing, paginated bidirectional MCP discovery/call, cached-wakeup TTS/binary-audio ordering, session identity checks, and turn cancellation that preserves the connection for a subsequent listen turn. Its npm bin must run deterministically and in a source-only clean workspace immediately after `npm ci`, without pre-existing protocol-contract or simulator `dist/` output.

## Remediation status

- Architect review rejected the original TASK-003 implementation for protocol/fixture, framing, realtime/MCP, simulator, CLI/build, buffer-copy, Opus-fixture, and parity-evidence defects.
- A second architect `NEEDS_FIX` review identified literal deployment variants and state-machine gaps after the first remediation. The final narrow remediation added strict bootstrap body metadata validation and preserved independent pending MCP correlation through speech-turn abort.
- Final independent architect re-review approved TASK-003 on 2026-08-13 after fresh source-only, literal pinned-wire, Opus, framing, simulator, and full repository verification.

## Verification

Run focused tests, lint/type checks, relevant integration/E2E tests, diff inspection, secret/branding/reference checks, and the acceptance criteria above.

## Security considerations

Use least privilege, validate all external input, redact sensitive data, and preserve explicit approval for user-only/destructive MCP or hardware operations.

## Agent tier

Architect + Implementer

## Rollback / recovery

Use additive/reversible changes and green commits. If verification fails, keep the task active, record the failure in `.ai/STATE.md`, and revert only the unverified slice rather than hiding it.
