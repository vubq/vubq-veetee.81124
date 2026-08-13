# TASK-004: Design database schema and migrations

## Goal

Implement PostgreSQL schema for operators, devices, pairing, firmware, providers, pipelines, sessions, MCP, audit, and outbox.

## Scope and exclusions

Implement only this task's bounded responsibilities. Do not copy restricted reference assets, embed provider credentials, or enable destructive hardware actions implicitly.

## Dependencies

TASK-002

## Intended files

packages/db/

## Test-first sequence

1. Write the smallest failing behavior/contract test.
2. Run it and confirm the expected RED reason.
3. Implement minimal production behavior.
4. Run focused and surrounding suites.
5. Refactor only while green and update `.ai/STATE.md`.

## Acceptance criteria

Migrations are reversible; constraints/indexes protect pairing and provider invariants; schema analysis is clean.

## Verification

Run focused tests, lint/type checks, relevant integration/E2E tests, diff inspection, secret/branding/reference checks, and the acceptance criteria above.

## Security considerations

Use least privilege, validate all external input, redact sensitive data, and preserve explicit approval for user-only/destructive MCP or hardware operations.

## Agent tier

Architect

## Rollback / recovery

Use additive/reversible changes and green commits. If verification fails, keep the task active, record the failure in `.ai/STATE.md`, and revert only the unverified slice rather than hiding it.
