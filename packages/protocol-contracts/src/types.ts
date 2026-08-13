export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

interface IdentityRequestHeaders {
  'Device-Id': string;
  'Client-Id': string;
}

export interface BootstrapV1RequestHeaders extends IdentityRequestHeaders {
  'Activation-Version': '1';
  'User-Agent': string;
  'Accept-Language': string;
  'Content-Type': 'application/json';
  'Serial-Number'?: never;
}

export interface BootstrapV2RequestHeaders extends IdentityRequestHeaders {
  'Activation-Version': '2';
  'Serial-Number': string;
  'User-Agent': string;
  'Accept-Language': string;
  'Content-Type': 'application/json';
}

export type BootstrapRequestHeaders = BootstrapV1RequestHeaders | BootstrapV2RequestHeaders;

export interface ActivationV1RequestHeaders extends IdentityRequestHeaders {
  'Activation-Version': '1';
  'Serial-Number'?: never;
}

export interface ActivationV2RequestHeaders extends IdentityRequestHeaders {
  'Activation-Version': '2';
  'Serial-Number': string;
}

export type ActivationRequestHeaders = ActivationV1RequestHeaders | ActivationV2RequestHeaders;

export interface BootstrapRequest {
  headers: BootstrapRequestHeaders;
  body: JsonObject;
}

export interface ActivationV1Request {
  headers: ActivationV1RequestHeaders;
  body: Record<string, never>;
}

export interface ActivationV2Request {
  headers: ActivationV2RequestHeaders;
  body: {
    algorithm: 'hmac-sha256';
    serial_number: string;
    challenge: string;
    /** Firmware may emit an empty value where a secure HMAC peripheral is unavailable. */
    hmac: string;
  };
}

export type ActivationPollRequest = ActivationV1Request | ActivationV2Request;

/** Pairing data supplied by bootstrap, distinct from the /activate request wire body. */
export interface ActivationResponse {
  message: string;
  code: string;
  challenge: string;
  timeout_ms: number;
}

export interface ServerTime {
  timestamp: number;
  timezone_offset?: number;
}

export interface WebSocketBootstrapConfig {
  url: string;
  token: string;
  version: 1 | 2 | 3;
}

export interface BootstrapResponse {
  server_time?: ServerTime;
  activation?: ActivationResponse;
  firmware?: JsonObject;
  websocket?: WebSocketBootstrapConfig;
  mqtt?: JsonObject;
  [key: string]: JsonValue | ActivationResponse | ServerTime | WebSocketBootstrapConfig | undefined;
}

/** The activation endpoint commonly uses plain text rather than a JSON envelope. */
export type ActivationPollResponseBody = JsonObject | '' | 'success';

export interface ActivationPollResponse {
  status: 200 | 202;
  body: ActivationPollResponseBody;
}

export interface WebSocketUpgradeHeaders {
  authorization?: string;
  protocolVersion: 1 | 2 | 3;
  deviceId: string;
  clientId: string;
  serialNumber?: string;
}

export interface ClientAudioParams {
  format: 'opus';
  sample_rate: 16000;
  channels: 1;
  frame_duration: 60;
}

/** The deployed server may negotiate 16 kHz from the client hello; 24 kHz remains the Veetee target. */
export interface ServerAudioParams {
  format: 'opus';
  sample_rate: 16000 | 24000;
  channels: 1;
  frame_duration: 60;
}

export interface ClientHelloMessage {
  type: 'hello';
  version: 1 | 2 | 3;
  transport: 'websocket';
  features: { mcp: true; [key: string]: JsonValue };
  audio_params: ClientAudioParams;
}

export interface ServerHelloMessage {
  type: 'hello';
  transport: 'websocket';
  session_id: string;
  audio_params: ServerAudioParams;
}

export type ListenMode = 'auto' | 'manual' | 'realtime';

export interface ListenMessage {
  type: 'listen';
  state: 'start' | 'stop' | 'detect';
  mode?: ListenMode;
  text?: string;
  session_id?: string;
}

export interface AbortMessage {
  type: 'abort';
  reason?: string;
  session_id?: string;
}

export interface SttMessage {
  type: 'stt';
  text: string;
  session_id?: string;
  is_final?: boolean;
}

export interface TtsMessage {
  type: 'tts';
  state: 'start' | 'sentence_start' | 'stop';
  session_id?: string;
  text?: string;
}

export interface LlmMessage {
  type: 'llm';
  text: string;
  emotion?: string;
  session_id?: string;
  is_final?: boolean;
}

export type McpRequestMethod = 'initialize' | 'tools/list' | 'tools/call';
export type McpRequestId = number;

export interface McpInitializeParams extends JsonObject {
  protocolVersion: '2024-11-05';
  capabilities: JsonObject;
  clientInfo?: { name: string; version: string };
}

export interface McpToolsListParams extends JsonObject {
  cursor?: string;
  withUserTools?: boolean;
}

export interface McpToolsCallParams extends JsonObject {
  name: string;
  arguments: JsonObject;
}

export interface McpInitializeRequest {
  jsonrpc: '2.0';
  id: McpRequestId;
  method: 'initialize';
  params: McpInitializeParams;
}

export interface McpToolsListRequest {
  jsonrpc: '2.0';
  id: McpRequestId;
  method: 'tools/list';
  params: McpToolsListParams;
}

export interface McpToolsCallRequest {
  jsonrpc: '2.0';
  id: McpRequestId;
  method: 'tools/call';
  params: McpToolsCallParams;
}

export type McpJsonRpcRequest = McpInitializeRequest | McpToolsListRequest | McpToolsCallRequest;

export interface McpToolSchema extends JsonObject {
  type: 'object';
  properties: JsonObject;
  required?: string[];
}

export interface McpTool extends JsonObject {
  name: string;
  description: string;
  inputSchema: McpToolSchema;
  annotations?: { audience?: string[]; [key: string]: JsonValue };
}

export interface McpInitializeResult extends JsonObject {
  protocolVersion: '2024-11-05';
  capabilities: JsonObject;
  serverInfo: { name: string; version: string };
}

export interface McpToolsListResult extends JsonObject {
  tools: McpTool[];
  nextCursor?: string;
}

export interface McpToolsCallResult extends JsonObject {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; image: string }>;
  isError: boolean;
}

export type McpResult = McpInitializeResult | McpToolsListResult | McpToolsCallResult;

export interface McpJsonRpcResult {
  jsonrpc: '2.0';
  id: McpRequestId;
  result: McpResult;
}

export interface McpJsonRpcError {
  jsonrpc: '2.0';
  id: McpRequestId;
  error: { message: string; code?: number; data?: JsonValue };
}

export type McpJsonRpcResponse = McpJsonRpcResult | McpJsonRpcError;
export type McpPayload = McpJsonRpcRequest | McpJsonRpcResponse;

/** Firmware receives server MCP requests; direct deployment envelopes may omit session_id. */
export interface ServerMcpEnvelope {
  type: 'mcp';
  session_id?: string;
  payload: McpJsonRpcRequest;
}

/** Firmware sends MCP responses to the server within the established session. */
export interface ClientMcpEnvelope {
  type: 'mcp';
  session_id: string;
  payload: McpJsonRpcResponse;
}

export type McpEnvelope = ServerMcpEnvelope | ClientMcpEnvelope;

export interface SystemMessage {
  type: 'system';
  command: string;
  session_id?: string;
}

export interface AlertMessage {
  type: 'alert';
  status: string;
  message: string;
  emotion: string;
  session_id?: string;
}

export type ClientMessage = ClientHelloMessage | ListenMessage | AbortMessage | ClientMcpEnvelope;
export type ServerMessage =
  | ServerHelloMessage
  | SttMessage
  | TtsMessage
  | LlmMessage
  | ServerMcpEnvelope
  | SystemMessage
  | AlertMessage;
export type KnownTransportMessage = ClientMessage | ServerMessage;

/** A safe diagnostic form that deliberately excludes an unknown message payload. */
export interface UnknownTransportMessage {
  type: string;
  known: false;
}

export type FrameType = 0 | 1;

export interface V2FrameMetadata {
  type: FrameType;
  timestamp: number;
}

export interface V3FrameMetadata {
  type: FrameType;
}

export interface FrameLimits {
  maxPayloadBytes?: number;
}

export interface DecodedFrame<TMetadata extends object = Record<string, never>> {
  payload: Uint8Array;
  metadata: TMetadata;
}
