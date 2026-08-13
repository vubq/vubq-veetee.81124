# Veetee Architecture

## Context

Veetee needs to remain compatible with an existing ESP32-S3 voice client while replacing the reference management and AI backend with a configurable, secure, Vietnamese-first platform. The current root was empty, so the architecture begins with a modular monorepo and explicit protocol/provenance boundaries.

## Provisional operating profile

- Single owner/operator and single tenant.
- Below 50 p99 QPS in year one; roughly 10:1 reads to writes.
- Internal and secret-sensitive data.
- 99.5% monthly availability, RPO 24 hours, RTO 4 hours.
- Vertical scaling first; no Kubernetes, sharding, or replicas until measurement requires them.

## System shape

```text
ESP32 / CLI simulator / browser simulator
          │ bootstrap + pairing
          ▼
Node control API ───── PostgreSQL
          │              authoritative state
          ├─────────── Redis
          │              ephemeral routing, rate limits, cooldowns
          │ runtime config snapshots
          ▼
Python realtime service
          │
          ├─ VAD → ASR → memory/intent → LLM/tools → TTS
          └─ Device MCP client

Vue management console → Node control API
```

### Control plane

`apps/control-api` owns operators, devices, pairing, firmware, provider catalogs and instances, encrypted credentials, pipeline profiles, audit records, runtime config issuance, and device token signing.

### Realtime plane

`apps/realtime` owns WebSocket lifecycle, v1 framing, Opus, session state, cancellation/barge-in, provider orchestration, device MCP, paced audio, and latency metrics. It never queries control-plane tables directly.

### Web and simulators

`apps/web` is the administration console. `apps/simulator` and `tools/device-simulator` are clean-room protocol clients. Restricted character runtimes/models and copied digital-human assets are excluded.

## Protocol boundary

- `POST /ota/` and `POST /ota/activate` are frozen firmware-compatible endpoints.
- Direct WebSocket version 1 ships first.
- v2/v3 are isolated behind `FrameAdapter`, not spread through session logic.
- Uplink: Opus 16 kHz mono, 60 ms.
- Downlink: Opus 24 kHz mono, 60 ms.
- MCP: JSON-RPC 2.0 protocol version `2024-11-05` inside the device envelope.

## Provider architecture

Roles are explicit: LLM, ASR, TTS, VAD, Memory, Intent. The database separates:

1. Provider catalog and configuration schema.
2. Configured provider instance.
3. Encrypted credentials/key pool.
4. Pipeline profile and ordered bindings.
5. Immutable runtime session snapshot.

Adapters receive validated configuration and an injected client. They do not read arbitrary environment variables or embed hostnames, keys, ports, or model identifiers.

## Data ownership

PostgreSQL is authoritative. Redis is disposable and holds rate limits, presence, realtime routing, provider cooldowns, key selection cursors, and config invalidations.

Primary domains: operators, devices, pairing, firmware releases/artifacts, provider catalog/instances/credentials, pipeline profiles/bindings, conversation metadata, device tool snapshots/invocations, audit, and outbox.

## Security boundaries

- Secret encryption key lives outside Git and PostgreSQL.
- Device tokens are short-lived and identity-bound.
- Pairing is authenticated, rate-limited, expiring, and atomic.
- Provider URLs use SSRF-aware network policies.
- Browser simulation uses one-time tickets.
- User-only/destructive MCP tools require operator approval and audit.
- Raw audio and transcript retention are disabled by default.

## Deployment

Initial deployment uses Docker Compose with PostgreSQL, Redis, control API, realtime, and web. Local ASR/TTS are independent configurable endpoints. TLS termination is external to application containers.

## Evolution

- Add strict v2/v3 direct-WebSocket adapters after conformance fixtures.
- Add MQTT+UDP as a separate gateway, not inside the voice pipeline.
- Introduce additional locales through data/configuration.
- Scale realtime horizontally via Redis presence/routing while keeping control-plane consistency in PostgreSQL.
