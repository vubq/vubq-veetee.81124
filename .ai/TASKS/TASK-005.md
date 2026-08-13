# TASK-005: Implement operator and service authentication

## Goal

Add first-run operator setup, sessions, CSRF/rate limits, internal service authentication, and signing keys.

## Scope and exclusions

Implement only this task's bounded responsibilities. Do not copy restricted reference assets, embed provider credentials, or enable destructive hardware actions implicitly.

## Dependencies

TASK-004

## Intended files

apps/control-api/src/modules/auth/

## Test-first sequence

1. Write the smallest failing behavior/contract test.
2. Run it and confirm the expected RED reason.
3. Implement minimal production behavior.
4. Run focused and surrounding suites.
5. Refactor only while green and update `.ai/STATE.md`.

## Acceptance criteria

Authentication tests pass; no default password; cookies and internal calls use separate trust boundaries.

## Verification

Run focused tests, lint/type checks, relevant integration/E2E tests, diff inspection, secret/branding/reference checks, and the acceptance criteria above.

## Security considerations

Use least privilege, validate all external input, redact sensitive data, and preserve explicit approval for user-only/destructive MCP or hardware operations.

## Agent tier

Implementer + Architect review

## Rollback / recovery

Use additive/reversible changes and green commits. If verification fails, keep the task active, record the failure in `.ai/STATE.md`, and revert only the unverified slice rather than hiding it.
