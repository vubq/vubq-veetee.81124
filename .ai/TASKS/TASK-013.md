# TASK-013: Build management console and browser simulator

## Goal

Create the original Vietnamese-first Veetee Vue console and clean-room browser simulator using shared API/contracts. Implement the information architecture, interaction states, accessibility requirements, and security boundaries in `docs/MANAGEMENT_CONSOLE.md`; external consoles are behavioral research only and are not visual/source assets.

## Scope and exclusions

Implement only this task's bounded responsibilities. Do not copy restricted reference assets, embed provider credentials, or enable destructive hardware actions implicitly.

## Dependencies

TASK-005, TASK-006, TASK-010, TASK-012

## Intended files

apps/web/, apps/simulator/

## Test-first sequence

1. Write the smallest failing behavior/contract test.
2. Run it and confirm the expected RED reason.
3. Implement minimal production behavior.
4. Run focused and surrounding suites.
5. Refactor only while green and update `.ai/STATE.md`.

## Acceptance criteria

Core workflows work keyboard-first at responsive sizes; server capabilities govern route/action visibility; loading/error/empty/conflict states are implemented; secrets are write-only; no restricted source, branding, screenshots, or assets are copied; simulator passes E2E.

## Verification

Run focused tests, lint/type checks, relevant integration/E2E tests, diff inspection, secret/branding/reference checks, and the acceptance criteria above.

## Security considerations

Use least privilege, validate all external input, redact sensitive data, and preserve explicit approval for user-only/destructive MCP or hardware operations.

## Agent tier

Implementer/Routine

## Rollback / recovery

Use additive/reversible changes and green commits. If verification fails, keep the task active, record the failure in `.ai/STATE.md`, and revert only the unverified slice rather than hiding it.
