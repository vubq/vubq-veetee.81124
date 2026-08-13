# Security

## Secret handling

- Credentials are never committed.
- Keys pasted into chat are considered exposed and should be rotated.
- `.env.example` contains placeholders only.
- Provider credentials are encrypted with an authenticated cipher and are write-only after creation.
- Logs, metrics, audit metadata, and errors use fingerprints rather than secrets.

## Device pairing

Six digits provide limited entropy, so pairing requires:

- Cryptographically secure generation.
- Ten-minute default expiry.
- One active request per device.
- Authenticated operator claim.
- Per-code, per-device, per-IP, and per-operator rate limits.
- Atomic single-use claim transaction.
- Constant-time digest comparison.
- No plaintext code in logs or audit events.

Initial pairing proves that an authenticated operator claimed a displayed code. It is not described as hardware attestation unless manufacturing key verification is actually deployed.

## Device tokens

- Issued only after pairing.
- Short-lived and bound to device record, normalized hardware ID, client ID, audience, token version, expiry, and allowed protocol versions.
- Realtime verifies a public key; it does not need the signing private key.
- Device revocation increments token version.

## Provider URLs and SSRF

Configurable local providers are necessary, but outbound access is policy-controlled:

- Provider network scope is `public`, `local-allowlisted`, or `disabled`.
- DNS results are validated.
- Link-local, multicast, metadata-service, and unexpected loopback targets are blocked.
- Private CIDRs require explicit allowlists.
- Redirects are disabled or every target is revalidated.
- Timeout, response-size, and concurrency limits are mandatory.

## OTA

- Artifacts use generated content-addressed storage keys.
- Validate size, MIME type, extension, SHA-256, board compatibility, and release state.
- Downloads use short-lived device-scoped tickets.
- Forced updates require confirmation and an audit event.
- MCP upgrade actions may use only approved artifact URLs.

## WebSocket and audio

- Authenticate before allocating codecs or providers.
- Enforce frame-size, buffered-duration, connection, idle, and maximum-session limits.
- Reject token/header identity mismatches.
- Raw audio retention is off by default.
- Browser simulation uses one-time tickets instead of reusable bearer tokens in query strings.

## MCP

- Dynamic tool discovery is namespaced to avoid silent collisions.
- Arguments are validated against device schemas.
- Calls have deadlines and pending-call limits.
- Non-idempotent calls are not automatically retried.
- User-only/destructive tools require authenticated operator approval and audit.

## Data retention

- Raw audio: disabled by default.
- Transcript: disabled or explicitly configured, recommended maximum 30 days initially.
- Audit metadata: 365 days initially.
- Provider payloads and full conversation text are excluded from logs.
