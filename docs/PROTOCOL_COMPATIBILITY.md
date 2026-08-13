# Protocol Compatibility

## Reference boundary

The compatibility contract is derived from pinned reference behavior recorded in `.ai/PROVENANCE.md`. Runtime source does not copy reference naming or implementation. Protocol field names required by existing firmware remain unchanged.

## Bootstrap / OTA

The device normally sends `POST /ota/` with JSON system information and these identity headers:

- `Activation-Version`
- `Device-Id`
- `Client-Id`
- v2-required `Serial-Number` (omitted for v1)
- `User-Agent`
- `Accept-Language`
- `Content-Type: application/json`

The response may contain `server_time`, `activation`, `firmware`, and `websocket`. `server_time` is an object with millisecond `timestamp` and optional minute `timezone_offset`. A WebSocket-only response must omit `mqtt`, because firmware selects MQTT when both sections are present. The WebSocket configuration uses `version`; omission defaults safely to v1. Literal deployment requests use lower-case colon-delimited MAC addresses for `Device-Id` and require object `application.version` plus object `board.type`, each a non-empty string; all other JSON body fields remain additive.

### Pairing

Unknown devices receive:

```json
{
  "activation": {
    "message": "Mã ghép nối Veetee: 123456",
    "code": "123456",
    "challenge": "opaque-challenge",
    "timeout_ms": 30000
  }
}
```

The code is exactly six ASCII digits by Veetee policy. The firmware itself does not enforce this. A challenge must accompany a code so the device can poll `/ota/activate`. When `timeout_ms` is omitted, compatible handling uses the firmware default of `30000` milliseconds.

`POST /ota/activate` uses the same identity headers. Version 1 sends `{}` and must omit `Serial-Number`. Version 2 requires `Serial-Number` and sends `algorithm`, `serial_number`, `challenge`, and `hmac`; `hmac` is either empty or exactly 64 lower-case hexadecimal characters. The pairing `code` remains bootstrap-response data and is not part of this activation body.

Literal response variants are an empty body for `202` and plain text `success` for `200`; JSON response objects remain accepted as additive compatible handling.

After `200`, the device bootstraps again. The subsequent response omits activation data and includes its WebSocket configuration.

## WebSocket

Initial endpoint: `/ws/v1`.

Upgrade identity:

- `Authorization: Bearer <device-token>`
- `Protocol-Version`
- `Device-Id`
- `Client-Id`

The first client text frame is `hello`. Veetee replies within the handshake SLO:

```json
{
  "type": "hello",
  "transport": "websocket",
  "session_id": "fresh-session-id",
  "audio_params": {
    "format": "opus",
    "sample_rate": 16000,
    "channels": 1,
    "frame_duration": 60
  }
}
```

The literal deployed server hello may negotiate 16 kHz. Veetee retains 24 kHz as the intended downlink target, so the compatibility parser accepts either 16 kHz or 24 kHz server negotiation.

### Framing

- Version 1: one raw Opus packet per binary WebSocket message.
- Version 2: a strict 16-byte network-order header: `uint16 version`, `uint16 type`, `uint32 reserved`, `uint32 timestamp`, `uint32 payload_size`. Version must be 2 and reserved must be zero.
- Version 3: a strict 4-byte network-order header: `uint8 type`, `uint8 reserved`, `uint16 payload_size`. Reserved must be zero; payload size is bounded by both the 16-bit wire limit and local policy.

The first release advertises version 1. Veetee keeps framing behind a `FrameAdapter` interface; strict byte-exact v2/v3 conformance tests already exist, while v2/v3 adapters remain disabled for rollout.

## Audio

- Uplink: Opus, 16 kHz, mono, 60 ms, 960 PCM samples per packet before encoding.
- Downlink: Opus, 24 kHz, mono, 60 ms, 1,440 PCM samples per packet after decoding.
- Send `tts/start` before the first downlink packet.
- Send `tts/stop` only after the final audio packet.
- `abort` cancels the current ASR/LLM/TTS turn and queued downlink audio; it does not terminate the established WebSocket connection or clear independent pending MCP requests. A correlated late MCP result or error remains valid. A subsequent `tts/stop` acknowledgement and later `listen/start` begin the next turn.
- Cached-wakeup flows may receive `tts/start` without a preceding LLM message.

## JSON messages

First-release support:

- Device to server: `hello`, `listen/start`, `listen/stop`, `listen/detect`, `abort`, `mcp`.
- Server to device: `hello`, `stt`, `tts/start`, `tts/sentence_start`, `tts/stop`, `llm`, `mcp`, `system`, `alert`.

Unknown additive fields are ignored. Unknown types are safely logged without payload contents.

## MCP

MCP messages are JSON-RPC 2.0 objects wrapped in a transport message with `type: "mcp"`. Direction is significant: literal server-to-device requests may omit `session_id`, while device-to-server responses require the established `session_id`.

Device compatibility requires:

- Protocol version `2024-11-05` and non-negative signed 32-bit numeric request IDs.
- `initialize`, paginated `tools/list`, and `tools/call` with method-specific request/result shapes.
- Omitted initial `tools/list` parameters normalize to `{}`; later pages use the server-provided `nextCursor`, including the observed real tool-name cursor variant.
- Dynamic discovery rather than hard-coded tool names.
- User-audience tools appear only in `tools/list` requests with `withUserTools: true`.

The simulator tracks the pending request method and expected result family, prevents calls until ordinary discovery pagination finishes, and preserves discovered audience metadata. Explicit approval before a user-only call is a Veetee hardening boundary; it is not claimed as a literal firmware approval interaction. Veetee validates advertised argument schemas and correlates calls. MCP timeout execution is deferred to TASK-009 and is not applied by this TASK-003 contract or simulator.

## Simulator parity

The CLI simulator can set WebSocket headers and is the primary CI conformance client. The browser simulator obtains a one-time simulator ticket and uses the same golden fixtures. Hardware acceptance remains separate from simulator success.
