# Veetee Management Console

## Product intent

The management console is a Vietnamese-first operations workspace for configuring assistants, pairing devices, composing provider pipelines, reviewing realtime sessions, approving tools, and managing firmware safely.

The design is clean-room and original. External consoles and pinned study sources are used only to understand useful workflows and state handling. Veetee does not copy their source code, assets, product names, exact styling, screenshots, route names, or distinctive visual trade dress.

## Research evidence

Research completed on 2026-08-13 included:

- A read-only audit of the pinned management frontend and API source.
- A read-only review of an authenticated reference console using a loopback-only browser debugging session.
- Desktop and 390×844 responsive observations of the assistant directory.
- Read-only inspection of the device-pairing dialog, assistant configuration panel, voice-clone entry point, and knowledge-base entry point.

No form was submitted. No resource was created, edited, or deleted. Cookies, credentials, local storage, conversations, prompts, device identifiers, and provider secrets were not extracted. Temporary screenshots and structural captures stayed in the session job directory and are not project inputs or visual-regression fixtures.

## Design direction

Veetee should preserve the reference workflows that reduce operator effort while using its own visual identity and information architecture.

### Visual character

- A calm, high-contrast operations workspace rather than a consumer dashboard.
- Deep slate navigation surfaces, neutral content panels, and emerald/cyan status accents.
- Dense enough for fleet operations, but with progressive disclosure for advanced settings.
- Clear semantic status colors with text or icons; color is never the only signal.
- Responsive layouts from the same route and component system rather than a separate mobile application.
- Motion is limited to state transitions, progress, and relationship changes.

### Layout

Desktop:

- Persistent navigation rail with workspace and environment context.
- Compact top bar for global search, health, approvals, language, theme, and operator session.
- Content width optimized for operational tables and detail panes rather than a fixed marketing container.
- Assistant and device directories support both cards and tables.

Mobile:

- Compact top bar and bottom navigation or an accessible drawer.
- Cards become one column.
- Wide tables become stacked summaries with an explicit detail route.
- Pairing, approvals, device health, and active-session review remain fully usable.
- Edit dialogs become full-screen sheets with persistent save/cancel actions.

## Information architecture

Primary navigation:

1. **Tổng quan**
2. **Trợ lý**
3. **Thiết bị**
4. **Runtime**
   - Danh mục nhà cung cấp
   - Phiên bản cấu hình nhà cung cấp
   - Hồ sơ pipeline
   - Thông tin xác thực
5. **Tri thức & bộ nhớ**
6. **Công cụ & phê duyệt**
7. **Phiên & quan sát**
8. **Vận hành đội thiết bị**
   - Firmware
   - Đợt triển khai
   - Sức khỏe thiết bị
9. **Quản trị**
   - Điều hành viên
   - Vai trò và quyền
   - Nhật ký kiểm toán
   - Cài đặt hệ thống

Assistant detail navigation:

- Tổng quan
- Hành vi
- Pipeline
- Giọng nói
- Bộ nhớ
- Công cụ
- Thiết bị
- Phiên
- Phiên bản
- Kiểm toán

This deliberately separates assistant behavior, runtime composition, fleet operations, and administration instead of placing unrelated platform controls in one menu.

## MVP screens

### 1. Overview

Operator questions answered immediately:

- Are control, realtime, PostgreSQL, and Redis healthy?
- How many devices are online, stale, pairing, or update-failed?
- Are provider instances healthy?
- Which sessions, rollouts, ingestion jobs, or tool approvals need attention?

Widgets:

- Active assistants
- Connected devices
- Sessions in progress
- Provider health
- Pending approvals
- Firmware rollout status
- Recent failures and audit alerts

Every widget has independent loading, stale, error, empty, and retry states.

### 2. Assistant directory

Useful observed patterns retained functionally:

- Compact assistant cards.
- Search across assistant and device relationships.
- Direct actions for configuration, history, and bound devices.
- A split create/pair action.
- Responsive one-column cards on mobile.

Veetee improvements:

- Card/table view toggle.
- Server-side filters and cursor pagination.
- Health, owner, pipeline version, device count, last session, and deployment state.
- Search history is opt-in and does not persist hardware identifiers by default.
- Bulk archive and profile assignment with impact summaries.

### 3. Assistant configuration

The reference console uses a focused configuration panel with role, model/memory, speaker recognition, and extension sections. Veetee expands this into domain-specific tabs and a draft/publish lifecycle.

Behavior:

- Persona and system instructions
- Response style
- Default and supported languages
- Safety and escalation policy
- Test-prompt preview

Pipeline:

- Ordered ASR, VAD, memory, intent, LLM, tool, and TTS stages
- Provider instance and model per stage
- Fallbacks, timeouts, retry policy, and streaming behavior
- Compatibility and health warnings
- Immutable runtime snapshot preview

Voice:

- Language and voice dependency
- Preview
- Speed, pitch, and volume
- Pronunciation dictionaries
- Availability and training state

Memory:

- Retention and transcript policy
- Summarization policy
- Knowledge assignments
- User/session memory controls
- Deletion and export boundaries

Tools:

- Bound tools and MCP servers
- Input schema and parameter defaults
- Risk class and scopes
- Approval mode
- Timeout, rate limit, and audit behavior

Save behavior:

1. Save draft.
2. Validate dependencies.
3. Show effective configuration and diff.
4. Publish a version for future sessions.
5. Preserve the prior immutable snapshot for active sessions.

### 4. Device fleet and pairing

Fleet fields:

- Device identity and model
- Pairing/activation state
- Assistant binding
- Desired and acknowledged configuration
- Firmware and release channel
- Last heartbeat and connectivity source
- Quarantine and revocation state

Pairing flow:

1. Choose assistant or workspace scope.
2. Create an expiring six-digit challenge.
3. Show expiry and attempt limits.
4. Device claims the challenge.
5. Display pending identity without exposing secrets.
6. Atomically bind and issue an identity-bound token.
7. Wait for re-bootstrap and first heartbeat.
8. Report success, timeout, or recovery action.

The UI never logs or persists plaintext pairing codes beyond the active operator flow.

### 5. Runtime configuration

Provider catalog:

- Type and supported roles
- Configuration schema
- Credential requirements
- Protocol/profile support
- Health-check capability

Provider instances:

- URL, model, request profile, response mapping, and timeout
- Network scope and SSRF policy
- Credential handle, validation state, and rotation state
- Used-by relationships

Pipeline profiles:

- Ordered stages and fallbacks
- Language/audio compatibility
- Rate, timeout, retry, and cancellation policy
- Published immutable versions

Credentials:

- Create, rotate, validate, and revoke
- Write-only secret submission
- Metadata, fingerprint, last validation, last use, and health only
- Plaintext is never returned after creation

### 6. Sessions and observability

Session list filters:

- Assistant, device, time, status, provider, tool usage, and error class

Session detail:

- WebSocket lifecycle
- Turn timeline
- VAD/ASR/LLM/TTS latency
- Cancellation and barge-in
- Tool requests, approvals, and results
- Effective runtime snapshot
- Transcript/audio availability and retention status

Exports require explicit permission and preserve redaction.

### 7. Tools and approvals

Tool registry:

- Namespace, source, schema, health, risk, required scopes, timeout, and idempotency

Approval queue:

- Requesting assistant/session
- Redacted arguments
- Risk summary
- Expiration
- Approve, deny, or escalate
- Resulting audit event

Destructive and user-only actions are never enabled merely because a tool is discoverable.

### 8. Firmware and rollout

Firmware release:

- Version and compatible hardware
- Artifact checksum and signature status
- Minimum protocol/bootloader
- Release notes and approval history

Rollout:

- Target cohort
- Maintenance window
- Staged percentage
- Failure threshold
- Pause/resume
- Rollback policy
- Per-device result

This replaces unsafe firmware CRUD with a controlled operational workflow.

## Reusable interaction patterns

### Tables

- Server-side search, filters, sorting, and pagination.
- Filter state is represented in the URL where useful.
- Selection distinguishes current page from all matching results.
- Bulk actions show exact affected counts and partial failures.
- Deleting the final row adjusts pagination safely.

### Forms

- Loading, dirty, validation, saving, saved, conflict, and failed states.
- Inherited/effective values are visible.
- Dependent-request failures preserve valid operator input.
- Concurrent edits use version checks rather than last-write-wins.

### Confirmation tiers

- Low impact: inline confirmation or undo.
- Medium impact: dialog with affected-resource count.
- High impact: reauthentication or typed phrase, impact summary, reason, and audit event.

High-impact examples include credential revocation, production-device unbinding, pipeline publication, firmware rollout, and service restart.

### Empty and error states

Differentiate:

- Nothing created yet
- No filter matches
- Permission denied
- Provisioning
- Feature disabled
- Dependency unavailable
- Stale cached data
- Partial failure

Errors include a recovery action and request/incident ID where available.

## Accessibility requirements

- Keyboard access to every workflow.
- Visible focus and reliable focus restoration after dialogs.
- No essential content available only on hover.
- Icon buttons have accessible names.
- Status includes text, not color alone.
- Copy/paste is not blocked in confirmation fields.
- Form errors are associated with fields.
- Touch targets are appropriately sized.
- Reduced-motion preferences are honored.

## Security and privacy boundaries

- Server-provided capabilities govern routes, navigation, actions, and APIs.
- Client-side visibility is never authorization.
- Operator sessions, end users, and service accounts are separate concepts.
- Provider secrets and device tokens never enter URLs, screenshots, logs, analytics, or audit payloads.
- Raw audio retention is off by default.
- Transcript access is explicit and auditable.
- Biometric and cloned-voice workflows require separate consent, provenance, retention, and deletion controls.

## Delivery priority

### MVP

- Authenticated responsive shell
- Overview
- Assistant directory and configuration drafts
- Provider instances and pipeline profiles
- Device fleet and secure pairing
- Basic sessions and audit
- Firmware release metadata and safe update controls

### P1

- Knowledge ingestion and retrieval debugger
- MCP/tool registry and approval queue
- Provider health and latency dashboards
- Assistant version diffs and rollback
- Staged firmware rollouts
- Pronunciation dictionaries

### P2

- Voice cloning
- Speaker verification
- Advanced device-sharing permissions
- Specialized internal dictionaries and service controls

## Task dependencies

- Data model: `TASK-004`
- Operator and internal authentication: `TASK-005`
- Pairing and device tokens: `TASK-006`
- Realtime sessions: `TASK-007` and `TASK-008`
- MCP and approvals: `TASK-009`
- Provider management: `TASK-010` and `TASK-011`
- Firmware lifecycle: `TASK-012`
- Console implementation: `TASK-013`
- Accessibility, security, observability, and E2E acceptance: `TASK-014`
