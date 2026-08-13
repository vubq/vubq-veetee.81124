# TASK-041: Define PostgreSQL role separation

## Goal

Separate migration/schema ownership from normal application runtime access so production control and realtime services cannot connect as the schema owner.

## Scope and exclusions

Define and verify the PostgreSQL ownership and grant model for the TASK-004 schema. Cover migration-owner responsibilities, runtime role capabilities, default privileges, sequence/function/table access, and revocation of unsafe rights. Do not add operator authentication, bootstrap routes, provider endpoints, deployment credentials, or production role passwords in this task.

## Dependencies

TASK-004

## Intended files

- `packages/db/src/migrations/`
- `packages/db/src/postgres-foundation.ts`
- `packages/db/test/`
- `scripts/postgres-harness.mjs`
- `docs/DEVELOPMENT.md`
- `docs/OPERATIONS.md`
- `.ai/STATE.md`

## Implementation requirements

- Keep migration execution and object ownership under a dedicated migration owner.
- Give application runtime roles only the table, sequence, and approved function privileges required by reviewed workflows.
- Prevent runtime roles from creating, altering, dropping, re-owning, or bypassing protected database objects.
- Revoke broad `PUBLIC` privileges where PostgreSQL defaults would cross the intended trust boundary.
- Configure future-object default privileges so later migrations do not silently restore unsafe access.
- Preserve read/write distinctions where they materially reduce authority, without introducing hard-coded deployment usernames, passwords, hosts, or database names.
- Keep role provisioning/configuration injectable and deployment-specific; migrations may grant to configured role identifiers but must not embed credentials.
- Ensure procedural APIs that enforce locked lifecycle transitions cannot be bypassed by direct runtime table mutation.

## Acceptance criteria

- A migration owner can apply and roll back the complete schema.
- A normal runtime role can execute only the explicitly approved application operations.
- Runtime roles cannot perform DDL, mutate immutable/event-history records directly, weaken triggers/constraints, or grant themselves additional rights.
- Default privileges protect objects created by future migrations.
- PostgreSQL 17 tests prove allowed and denied behavior from separate connections/roles.
- Existing TASK-004 migration reversibility and behavior remain green.

## Test-first sequence

1. Add PostgreSQL 17 tests that create isolated migration-owner and runtime roles and demonstrate the current over-privilege boundary.
2. Confirm the expected RED failures for missing grants/revocations or direct-table bypasses.
3. Add the minimal reversible privilege migration and configurable role inputs.
4. Verify allowed runtime workflows and explicit permission-denied cases.
5. Run full rollback/reapply, repository checks, and independent architect review.

## Verification

- Focused PostgreSQL role/privilege integration tests.
- `npm run db:check`.
- `DATABASE_URL=<isolated-owner-db> npm run db:verify`.
- `DATABASE_URL=<isolated-owner-db> npm run test:integration:postgres`.
- `npm run check`.
- Inspect ownership, ACLs, default ACLs, function security attributes, and migration rollback.
- `git diff --check` plus branding, secret, and reference guards.

## Security considerations

Treat database roles as a primary trust boundary. Runtime connections must follow least privilege, credentials stay outside Git and logs, role identifiers are validated before interpolation, and no caller-controlled flag may weaken database-enforced lifecycle or approval policy.

## Agent tier

Architect design and final review; implementer execution after the contract is frozen.

## Rollback / recovery

Privilege changes must be reversible without dropping domain data. If verification fails, retain owner access for recovery, revoke newly introduced runtime grants, record the failed boundary in `.ai/STATE.md`, and do not connect application services until the role model is approved.
