# TASK-001: Establish documentation and provenance

## Goal

Create project overview, architecture, plan, state, provenance, ignore rules, and local Git guardrails.

## Scope and exclusions

Implement only this task's bounded responsibilities. Do not copy restricted reference assets, embed provider credentials, or enable destructive hardware actions implicitly.

## Dependencies

None

## Intended files

README.md, docs/, .ai/, .gitignore, provenance.lock.json

## Test-first sequence

1. Write the smallest failing behavior/contract test.
2. Run it and confirm the expected RED reason.
3. Implement minimal production behavior.
4. Run focused and surrounding suites.
5. Refactor only while green and update `.ai/STATE.md`.

## Acceptance criteria

Documentation links resolve; reference commits are exact; references and secrets are ignored; local Git initializes on main.

## Verification

Run focused tests, lint/type checks, relevant integration/E2E tests, diff inspection, secret/branding/reference checks, and the acceptance criteria above.

## Security considerations

Use least privilege, validate all external input, redact sensitive data, and preserve explicit approval for user-only/destructive MCP or hardware operations.

## Agent tier

Architect

## Rollback / recovery

Use additive/reversible changes and green commits. If verification fails, keep the task active, record the failure in `.ai/STATE.md`, and revert only the unverified slice rather than hiding it.
