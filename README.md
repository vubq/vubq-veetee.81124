# Veetee

Veetee is a Vietnamese-first, realtime voice-assistant platform for embedded devices and browser-based protocol simulators. It provides a configurable control plane, a low-latency Python conversation service, an approachable Vue administration console, firmware bootstrap/OTA compatibility, and MCP-based device tools.

## Direction

- Natural, streaming conversation rather than command-only hard-coded flows.
- Vietnamese first, with BCP 47 locale metadata and multilingual extension points.
- Configurable ASR, LLM, TTS, VAD, memory, and intent providers.
- Local speech services remain URL/key/model configurable; no fixed hostnames or ports.
- Direct WebSocket protocol v1 is the first compatibility target. Versions 2 and 3 are isolated behind framing adapters and contract tests.
- Simulator-first verification when hardware is unavailable; real ESP32-S3 validation remains a separate acceptance gate.
- New runtime code, routes, modules, UI copy, and log tags use Veetee naming only.

## Planned services

| Service | Technology | Responsibility |
|---|---|---|
| `apps/control-api` | Node.js, TypeScript, Fastify, PostgreSQL, Redis | Devices, pairing, providers, pipelines, firmware, audit, administration APIs |
| `apps/realtime` | Python, FastAPI | WebSocket sessions, Opus audio, ASR/LLM/TTS streaming, MCP |
| `apps/web` | Vue 3, Vite, TypeScript, Tailwind CSS 4, shadcn-vue | Friendly management console |
| `apps/simulator` | Vue 3 | Clean-room browser protocol client without restricted third-party character assets |
| `tools/device-simulator` | TypeScript CLI | Deterministic protocol conformance and CI client |

## Current status

The upstream protocol and provider-management references have been audited and pinned. The repository foundation and first compatibility walking skeleton are now being implemented. No connected ESP32-S3 was detected during the initial environment inspection, so the browser/CLI simulator is the active test path.

## Documentation

- [Project overview](docs/PROJECT_OVERVIEW.md)
- [Protocol compatibility](docs/PROTOCOL_COMPATIBILITY.md)
- [Security model](docs/SECURITY.md)
- [Development workflow](docs/DEVELOPMENT.md)
- [Operations and SLOs](docs/OPERATIONS.md)
- [Architecture](.ai/ARCHITECTURE.md)
- [Delivery plan](.ai/PLAN.md)
- [Current state](.ai/STATE.md)
- [Reference provenance](.ai/PROVENANCE.md)

## Security notice

Do not commit provider credentials. Any key shared in chat should be treated as exposed and rotated. Only placeholders belong in `.env.example`; runtime credentials will be encrypted at rest and never returned after creation.
