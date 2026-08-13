# Development

## Toolchain

- Node.js 24.18.0 with npm 11.16.0 and npm workspaces.
- Python 3.12.3 with `uv` 0.11.29.
- PostgreSQL and Redis through Docker Compose.
- ESP-IDF 6.0.2 for the pinned firmware reference when firmware work begins.

Activate ESP-IDF only for firmware commands:

```bash
source /home/vubq/.espressif/v6.0.2/esp-idf/export.sh
```

## Test-driven development

For production behavior:

1. Write one failing test.
2. Run it and confirm the intended failure.
3. Implement the minimum behavior.
4. Run the focused and surrounding suites.
5. Refactor only while green.

RED/GREEN commands and verification status are recorded in `.ai/STATE.md` at milestones.

## Local services

Planned commands:

```bash
npm ci
uv sync --project apps/realtime --locked
cp .env.example .env
# Set unique POSTGRES_PASSWORD and REDIS_PASSWORD values in .env.
docker compose up -d postgres redis
```

Run each service explicitly in a separate terminal; the root package intentionally has no `dev` orchestrator:

```bash
npm run dev --workspace @veetee/control-api
npm run dev --workspace @veetee/web
npm run dev --workspace @veetee/simulator
uv run --locked --no-sync --project apps/realtime uvicorn app.main:app --reload
```

The root Python lint, typecheck, and test scripts use `uv run --locked --no-sync`; run `uv sync --project apps/realtime --locked` first to create or refresh the environment from the lockfile. Compose rejects empty datastore passwords, publishes PostgreSQL and Redis only on the loopback interface, and pins the reviewed multi-architecture image indexes: PostgreSQL `17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193` and Redis `7.4-alpine@sha256:e7723ff73d963f5cc6d9c4643ea3d989527a402a319239054e9472a7fb9219a2`. No provider hostname, port, key, or model belongs in source. Configure them through validated provider instances.

## Test layers

- Unit: pure policy, parsing, crypto, provider selection, sentence segmentation.
- Contract: bootstrap, WebSocket, MCP and binary frame fixtures.
- Integration: PostgreSQL/Redis transactions and API routes.
- Realtime: FastAPI WebSocket and fake-provider pipeline.
- E2E: CLI simulator first, browser simulator second.
- Hardware: separate gated run after a serial device is safely identified.

## Hardware safety

Do not flash, reboot, erase NVS, or force OTA merely because a serial port appears. First identify the device and obtain an existing-config backup where possible. Harmless bootstrap, hello, audio, and MCP status tests precede any write.

## Reference policy

`references/` is ignored by the root repository. It is study-only input. Do not copy restricted Live2D/model/audio/font assets into Veetee. Runtime branding scans exclude legal provenance documents but reject upstream product naming in new application source.
