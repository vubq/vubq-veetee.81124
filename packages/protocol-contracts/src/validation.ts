import { ActivationCodeError, ProtocolValidationError } from './errors.js';
import type {
  AbortMessage,
  ActivationPollRequest,
  ActivationPollResponse,
  ActivationPollResponseBody,
  ActivationRequestHeaders,
  ActivationResponse,
  AlertMessage,
  BootstrapRequest,
  BootstrapRequestHeaders,
  BootstrapResponse,
  ClientAudioParams,
  ClientHelloMessage,
  ClientMessage,
  JsonObject,
  JsonValue,
  KnownTransportMessage,
  ListenMessage,
  ListenMode,
  LlmMessage,
  ClientMcpEnvelope,
  McpEnvelope,
  McpInitializeParams,
  McpInitializeResult,
  McpJsonRpcError,
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpJsonRpcResult,
  McpPayload,
  McpResult,
  McpTool,
  McpToolSchema,
  McpToolsCallParams,
  McpToolsCallResult,
  McpToolsListParams,
  McpToolsListResult,
  ServerAudioParams,
  ServerHelloMessage,
  ServerMcpEnvelope,
  ServerMessage,
  ServerTime,
  SttMessage,
  SystemMessage,
  TtsMessage,
  UnknownTransportMessage,
  WebSocketBootstrapConfig,
  WebSocketUpgradeHeaders,
} from './types.js';

export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const DEFAULT_ACTIVATION_TIMEOUT_MS = 30_000;
const MAX_MCP_REQUEST_ID = 0x7fffffff;
const MAC_ADDRESS_PATTERN = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/u;
const HMAC_SHA256_HEX_PATTERN = /^(?:[0-9a-f]{64})?$/u;
const MESSAGE_TYPES = new Set([
  'hello',
  'listen',
  'abort',
  'stt',
  'tts',
  'llm',
  'mcp',
  'system',
  'alert',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, property);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ProtocolValidationError('must be an object', path);
  }
  return value;
}

function requireString(value: unknown, path: string, { allowEmpty = false } = {}): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw new ProtocolValidationError(`must be ${allowEmpty ? '' : 'a non-empty '}string`, path);
  }
  return value;
}

function requireInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new ProtocolValidationError('must be a safe integer', path);
  }
  return value;
}

function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ProtocolValidationError('must be a finite number', path);
  }
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new ProtocolValidationError('must be a boolean', path);
  }
  return value;
}

function requireLiteral<T extends string | number | boolean>(value: unknown, expected: T, path: string): T {
  if (value !== expected) {
    throw new ProtocolValidationError(`must equal ${JSON.stringify(expected)}`, path);
  }
  return expected;
}

function toJsonValue(value: unknown, path: string): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => toJsonValue(item, `${path}[${index}]`));
  }
  if (isRecord(value)) {
    const result: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = toJsonValue(item, `${path}.${key}`);
    }
    return result;
  }
  throw new ProtocolValidationError('must be JSON-compatible', path);
}

function requireJsonObject(value: unknown, path: string): JsonObject {
  return toJsonValue(requireRecord(value, path), path) as JsonObject;
}

function optionalProperty<T>(key: string, value: T | undefined): Record<string, T> {
  return value === undefined ? {} : { [key]: value };
}

function withAdditiveJsonFields<T extends object>(
  source: Record<string, unknown>,
  path: string,
  known: T,
): T {
  return { ...requireJsonObject(source, path), ...known } as T;
}

function normalizeHeaders(value: unknown, path: string): Record<string, unknown> {
  const headers = requireRecord(value, path);
  const normalized: Record<string, unknown> = {};
  for (const [name, headerValue] of Object.entries(headers)) {
    const normalizedName = name.toLowerCase();
    if (hasOwn(normalized, normalizedName) && normalized[normalizedName] !== headerValue) {
      throw new ProtocolValidationError('must not contain conflicting case-insensitive duplicates', path);
    }
    normalized[normalizedName] = headerValue;
  }
  return normalized;
}

function requiredHeader(headers: Record<string, unknown>, name: string, path: string): string {
  return requireString(headers[name.toLowerCase()], `${path}.${name}`);
}

function optionalHeader(headers: Record<string, unknown>, name: string, path: string): string | undefined {
  const value = headers[name.toLowerCase()];
  return value === undefined ? undefined : requireString(value, `${path}.${name}`);
}

function parseActivationVersion(value: unknown, path: string): '1' | '2' {
  const version = requireString(value, path);
  if (version !== '1' && version !== '2') {
    throw new ProtocolValidationError('must equal "1" or "2"', path);
  }
  return version;
}

function parseWebSocketVersion(value: unknown, path: string): 1 | 2 | 3 {
  const version = typeof value === 'string' ? Number(value) : value;
  if (version !== 1 && version !== 2 && version !== 3) {
    throw new ProtocolValidationError('must equal 1, 2, or 3', path);
  }
  return version;
}

function parseClientAudioParams(value: unknown): ClientAudioParams {
  const audio = requireRecord(value, 'message.audio_params');
  requireLiteral(audio.format, 'opus', 'message.audio_params.format');
  requireLiteral(audio.sample_rate, 16000, 'message.audio_params.sample_rate');
  requireLiteral(audio.channels, 1, 'message.audio_params.channels');
  requireLiteral(audio.frame_duration, 60, 'message.audio_params.frame_duration');
  return { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 };
}

function parseServerAudioParams(value: unknown): ServerAudioParams {
  const audio = requireRecord(value, 'message.audio_params');
  requireLiteral(audio.format, 'opus', 'message.audio_params.format');
  const sampleRate = audio.sample_rate;
  if (sampleRate !== 16000 && sampleRate !== 24000) {
    throw new ProtocolValidationError('must equal 16000 or 24000', 'message.audio_params.sample_rate');
  }
  requireLiteral(audio.channels, 1, 'message.audio_params.channels');
  requireLiteral(audio.frame_duration, 60, 'message.audio_params.frame_duration');
  return { format: 'opus', sample_rate: sampleRate, channels: 1, frame_duration: 60 };
}

function parseOptionalSessionId(value: unknown): string | undefined {
  return value === undefined ? undefined : requireString(value, 'message.session_id');
}

function parseOptionalBoolean(value: unknown, path: string): boolean | undefined {
  return value === undefined ? undefined : requireBoolean(value, path);
}

export function parseWebSocketUpgradeHeaders(value: unknown): WebSocketUpgradeHeaders {
  const headers = normalizeHeaders(value, 'websocket.headers');
  const authorization = optionalHeader(headers, 'Authorization', 'websocket.headers');
  if (authorization !== undefined && (!authorization.startsWith('Bearer ') || authorization.length === 'Bearer '.length)) {
    throw new ProtocolValidationError('must be a non-empty Bearer token', 'websocket.headers.Authorization');
  }

  return {
    ...(authorization === undefined ? {} : { authorization }),
    protocolVersion: parseWebSocketVersion(
      requiredHeader(headers, 'Protocol-Version', 'websocket.headers'),
      'websocket.headers.Protocol-Version',
    ),
    deviceId: requiredHeader(headers, 'Device-Id', 'websocket.headers'),
    clientId: requiredHeader(headers, 'Client-Id', 'websocket.headers'),
    ...optionalProperty('serialNumber', optionalHeader(headers, 'Serial-Number', 'websocket.headers')),
  };
}

export function validateActivationCode(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9]{6}$/u.test(value)) {
    throw new ActivationCodeError();
  }
  return value;
}

function parseActivation(value: unknown): ActivationResponse {
  const activation = requireRecord(value, 'activation');
  const timeoutMs = activation.timeout_ms === undefined
    ? DEFAULT_ACTIVATION_TIMEOUT_MS
    : requireInteger(activation.timeout_ms, 'activation.timeout_ms');
  if (timeoutMs <= 0) {
    throw new ProtocolValidationError('must be positive', 'activation.timeout_ms');
  }

  return withAdditiveJsonFields(activation, 'activation', {
    message: requireString(activation.message, 'activation.message'),
    code: validateActivationCode(activation.code),
    challenge: requireString(activation.challenge, 'activation.challenge'),
    timeout_ms: timeoutMs,
  });
}

export function parseBootstrapRequest(value: unknown): BootstrapRequest {
  const request = requireRecord(value, 'bootstrap');
  const headers = normalizeHeaders(request.headers, 'bootstrap.headers');
  requireLiteral(
    requiredHeader(headers, 'Content-Type', 'bootstrap.headers'),
    'application/json',
    'bootstrap.headers.Content-Type',
  );

  const activationVersion = parseActivationVersion(
    requiredHeader(headers, 'Activation-Version', 'bootstrap.headers'),
    'bootstrap.headers.Activation-Version',
  );
  const deviceId = requiredHeader(headers, 'Device-Id', 'bootstrap.headers');
  if (!MAC_ADDRESS_PATTERN.test(deviceId)) {
    throw new ProtocolValidationError('must be a lowercase colon-delimited MAC address', 'bootstrap.headers.Device-Id');
  }
  const serialNumber = optionalHeader(headers, 'Serial-Number', 'bootstrap.headers');
  if (activationVersion === '1' && serialNumber !== undefined) {
    throw new ProtocolValidationError('must be omitted for activation version 1', 'bootstrap.headers.Serial-Number');
  }
  if (activationVersion === '2' && serialNumber === undefined) {
    throw new ProtocolValidationError('is required for activation version 2', 'bootstrap.headers.Serial-Number');
  }

  const normalizedHeaders: BootstrapRequestHeaders = activationVersion === '1'
    ? {
      'Activation-Version': '1',
      'Device-Id': deviceId,
      'Client-Id': requiredHeader(headers, 'Client-Id', 'bootstrap.headers'),
      'User-Agent': requiredHeader(headers, 'User-Agent', 'bootstrap.headers'),
      'Accept-Language': requiredHeader(headers, 'Accept-Language', 'bootstrap.headers'),
      'Content-Type': 'application/json',
    }
    : {
      'Activation-Version': '2',
      'Device-Id': deviceId,
      'Client-Id': requiredHeader(headers, 'Client-Id', 'bootstrap.headers'),
      'Serial-Number': requiredHeader(headers, 'Serial-Number', 'bootstrap.headers'),
      'User-Agent': requiredHeader(headers, 'User-Agent', 'bootstrap.headers'),
      'Accept-Language': requiredHeader(headers, 'Accept-Language', 'bootstrap.headers'),
      'Content-Type': 'application/json',
    };

  const body = requireJsonObject(request.body, 'bootstrap.body');
  const application = requireRecord(body.application, 'bootstrap.body.application');
  requireString(application.version, 'bootstrap.body.application.version');
  const board = requireRecord(body.board, 'bootstrap.body.board');
  requireString(board.type, 'bootstrap.body.board.type');
  return { headers: normalizedHeaders, body };
}

function parseActivationRequestHeaders(value: unknown): ActivationRequestHeaders {
  const headers = normalizeHeaders(value, 'activation_poll.headers');
  const activationVersion = parseActivationVersion(
    requiredHeader(headers, 'Activation-Version', 'activation_poll.headers'),
    'activation_poll.headers.Activation-Version',
  );
  const deviceId = requiredHeader(headers, 'Device-Id', 'activation_poll.headers');
  if (!MAC_ADDRESS_PATTERN.test(deviceId)) {
    throw new ProtocolValidationError('must be a lowercase colon-delimited MAC address', 'activation_poll.headers.Device-Id');
  }
  const clientId = requiredHeader(headers, 'Client-Id', 'activation_poll.headers');
  const serialNumber = optionalHeader(headers, 'Serial-Number', 'activation_poll.headers');
  if (activationVersion === '1') {
    if (serialNumber !== undefined) {
      throw new ProtocolValidationError('must be omitted for activation version 1', 'activation_poll.headers.Serial-Number');
    }
    return {
      'Activation-Version': '1',
      'Device-Id': deviceId,
      'Client-Id': clientId,
    };
  }
  if (serialNumber === undefined) {
    throw new ProtocolValidationError('is required for activation version 2', 'activation_poll.headers.Serial-Number');
  }
  return {
    'Activation-Version': '2',
    'Device-Id': deviceId,
    'Client-Id': clientId,
    'Serial-Number': serialNumber,
  };
}

export function parseActivationPollRequest(value: unknown): ActivationPollRequest {
  const request = requireRecord(value, 'activation_poll');
  const headers = parseActivationRequestHeaders(request.headers);
  const body = requireRecord(request.body, 'activation_poll.body');

  if (headers['Activation-Version'] === '1') {
    if (Object.keys(body).length !== 0) {
      throw new ProtocolValidationError('v1 activation body must be an empty object', 'activation_poll.body');
    }
    return { headers: { ...headers, 'Activation-Version': '1' }, body: {} };
  }

  const serialNumber = headers['Serial-Number'];
  requireLiteral(body.algorithm, 'hmac-sha256', 'activation_poll.body.algorithm');
  const bodySerialNumber = requireString(body.serial_number, 'activation_poll.body.serial_number');
  if (bodySerialNumber !== serialNumber) {
    throw new ProtocolValidationError('must match Serial-Number header', 'activation_poll.body.serial_number');
  }
  const hmac = requireString(body.hmac, 'activation_poll.body.hmac', { allowEmpty: true });
  if (!HMAC_SHA256_HEX_PATTERN.test(hmac)) {
    throw new ProtocolValidationError(
      'must be empty or 64 lowercase hexadecimal characters',
      'activation_poll.body.hmac',
    );
  }

  return {
    headers,
    body: {
      algorithm: 'hmac-sha256',
      serial_number: bodySerialNumber,
      challenge: requireString(body.challenge, 'activation_poll.body.challenge'),
      hmac,
    },
  };
}

function parseActivationPollResponseBody(value: unknown): ActivationPollResponseBody {
  if (value === undefined || value === '') {
    return '';
  }
  if (value === 'success') {
    return 'success';
  }
  return requireJsonObject(value, 'activation_poll_response.body');
}

export function parseActivationPollResponse(value: unknown): ActivationPollResponse {
  const response = requireRecord(value, 'activation_poll_response');
  if (response.status !== 200 && response.status !== 202) {
    throw new ProtocolValidationError('must be 200 or 202', 'activation_poll_response.status');
  }
  return {
    status: response.status,
    body: parseActivationPollResponseBody(response.body),
  };
}

function parseServerTime(value: unknown): ServerTime {
  const serverTime = requireRecord(value, 'bootstrap_response.server_time');
  const timezoneOffset = serverTime.timezone_offset === undefined
    ? undefined
    : requireInteger(serverTime.timezone_offset, 'bootstrap_response.server_time.timezone_offset');
  return {
    timestamp: requireFiniteNumber(serverTime.timestamp, 'bootstrap_response.server_time.timestamp'),
    ...optionalProperty('timezone_offset', timezoneOffset),
  };
}

function parseWebSocketConfig(value: unknown): WebSocketBootstrapConfig {
  const websocket = requireRecord(value, 'bootstrap_response.websocket');
  const version = websocket.version === undefined
    ? 1
    : parseWebSocketVersion(websocket.version, 'bootstrap_response.websocket.version');
  return {
    url: requireString(websocket.url, 'bootstrap_response.websocket.url'),
    // A firmware-compatible unauthenticated endpoint can intentionally issue an empty token.
    token: requireString(websocket.token, 'bootstrap_response.websocket.token', { allowEmpty: true }),
    version,
  };
}

export function parseBootstrapResponse(value: unknown): BootstrapResponse {
  const response = requireRecord(value, 'bootstrap_response');
  if (response.websocket !== undefined && response.mqtt !== undefined) {
    throw new ProtocolValidationError('direct WebSocket responses must omit mqtt', 'bootstrap_response');
  }

  const normalized = requireJsonObject(response, 'bootstrap_response') as BootstrapResponse;
  if (response.server_time !== undefined) {
    normalized.server_time = parseServerTime(response.server_time);
  }
  if (response.activation !== undefined) {
    normalized.activation = parseActivation(response.activation);
  }
  if (response.firmware !== undefined) {
    normalized.firmware = requireJsonObject(response.firmware, 'bootstrap_response.firmware');
  }
  if (response.websocket !== undefined) {
    normalized.websocket = parseWebSocketConfig(response.websocket);
  }
  if (response.mqtt !== undefined) {
    normalized.mqtt = requireJsonObject(response.mqtt, 'bootstrap_response.mqtt');
  }
  return normalized;
}

function parseClientHello(value: Record<string, unknown>): ClientHelloMessage {
  requireLiteral(value.type, 'hello', 'message.type');
  const version = parseWebSocketVersion(value.version, 'message.version');
  requireLiteral(value.transport, 'websocket', 'message.transport');
  const features = requireRecord(value.features, 'message.features');
  requireLiteral(features.mcp, true, 'message.features.mcp');
  return withAdditiveJsonFields(value, 'message', {
    type: 'hello',
    version,
    transport: 'websocket',
    features: withAdditiveJsonFields(features, 'message.features', { mcp: true }),
    audio_params: parseClientAudioParams(value.audio_params),
  });
}

function parseServerHello(value: Record<string, unknown>): ServerHelloMessage {
  requireLiteral(value.type, 'hello', 'message.type');
  requireLiteral(value.transport, 'websocket', 'message.transport');
  return withAdditiveJsonFields(value, 'message', {
    type: 'hello',
    transport: 'websocket',
    session_id: requireString(value.session_id, 'message.session_id'),
    audio_params: parseServerAudioParams(value.audio_params),
  });
}

function parseListenMode(value: unknown): ListenMode {
  if (value !== 'auto' && value !== 'manual' && value !== 'realtime') {
    throw new ProtocolValidationError('must be auto, manual, or realtime', 'message.mode');
  }
  return value;
}

function parseListen(value: Record<string, unknown>): ListenMessage {
  requireLiteral(value.type, 'listen', 'message.type');
  const state = value.state;
  if (state !== 'start' && state !== 'stop' && state !== 'detect') {
    throw new ProtocolValidationError('must be start, stop, or detect', 'message.state');
  }
  const mode = value.mode === undefined ? undefined : parseListenMode(value.mode);
  const text = value.text === undefined
    ? undefined
    : requireString(value.text, 'message.text', { allowEmpty: true });
  if (state === 'start' && mode === undefined) {
    throw new ProtocolValidationError('is required when state is start', 'message.mode');
  }
  if (state === 'detect' && (text === undefined || text.length === 0)) {
    throw new ProtocolValidationError('must be a non-empty string when state is detect', 'message.text');
  }

  return withAdditiveJsonFields(value, 'message', {
    type: 'listen',
    state,
    ...optionalProperty('mode', mode),
    ...optionalProperty('text', text),
    ...optionalProperty('session_id', parseOptionalSessionId(value.session_id)),
  });
}

function parseAbort(value: Record<string, unknown>): AbortMessage {
  requireLiteral(value.type, 'abort', 'message.type');
  const reason = value.reason === undefined ? undefined : requireString(value.reason, 'message.reason');
  return withAdditiveJsonFields(value, 'message', {
    type: 'abort',
    ...optionalProperty('reason', reason),
    ...optionalProperty('session_id', parseOptionalSessionId(value.session_id)),
  });
}

function parseStt(value: Record<string, unknown>): SttMessage {
  requireLiteral(value.type, 'stt', 'message.type');
  return withAdditiveJsonFields(value, 'message', {
    type: 'stt',
    text: requireString(value.text, 'message.text', { allowEmpty: true }),
    ...optionalProperty('session_id', parseOptionalSessionId(value.session_id)),
    ...optionalProperty('is_final', parseOptionalBoolean(value.is_final, 'message.is_final')),
  });
}

function parseTts(value: Record<string, unknown>): TtsMessage {
  requireLiteral(value.type, 'tts', 'message.type');
  const state = value.state;
  if (state !== 'start' && state !== 'sentence_start' && state !== 'stop') {
    throw new ProtocolValidationError('must be start, sentence_start, or stop', 'message.state');
  }
  const text = value.text === undefined
    ? undefined
    : requireString(value.text, 'message.text', { allowEmpty: true });
  if (state === 'sentence_start' && text === undefined) {
    throw new ProtocolValidationError('is required when state is sentence_start', 'message.text');
  }
  return withAdditiveJsonFields(value, 'message', {
    type: 'tts',
    state,
    ...optionalProperty('session_id', parseOptionalSessionId(value.session_id)),
    ...optionalProperty('text', text),
  });
}

function parseLlm(value: Record<string, unknown>): LlmMessage {
  requireLiteral(value.type, 'llm', 'message.type');
  const emotion = value.emotion === undefined
    ? undefined
    : requireString(value.emotion, 'message.emotion', { allowEmpty: true });
  return withAdditiveJsonFields(value, 'message', {
    type: 'llm',
    text: requireString(value.text, 'message.text', { allowEmpty: true }),
    ...optionalProperty('emotion', emotion),
    ...optionalProperty('session_id', parseOptionalSessionId(value.session_id)),
    ...optionalProperty('is_final', parseOptionalBoolean(value.is_final, 'message.is_final')),
  });
}

function parseSystem(value: Record<string, unknown>): SystemMessage {
  requireLiteral(value.type, 'system', 'message.type');
  return withAdditiveJsonFields(value, 'message', {
    type: 'system',
    command: requireString(value.command, 'message.command'),
    ...optionalProperty('session_id', parseOptionalSessionId(value.session_id)),
  });
}

function parseAlert(value: Record<string, unknown>): AlertMessage {
  requireLiteral(value.type, 'alert', 'message.type');
  return withAdditiveJsonFields(value, 'message', {
    type: 'alert',
    status: requireString(value.status, 'message.status'),
    message: requireString(value.message, 'message.message'),
    emotion: requireString(value.emotion, 'message.emotion'),
    ...optionalProperty('session_id', parseOptionalSessionId(value.session_id)),
  });
}

function parseMcpId(value: unknown): number {
  const id = requireInteger(value, 'message.payload.id');
  if (id < 0 || id > MAX_MCP_REQUEST_ID) {
    throw new ProtocolValidationError('must be a non-negative signed 32-bit integer', 'message.payload.id');
  }
  return id;
}

function parseInitializeParams(value: unknown): McpInitializeParams {
  const params = requireRecord(value, 'message.payload.params');
  requireLiteral(params.protocolVersion, MCP_PROTOCOL_VERSION, 'message.payload.params.protocolVersion');
  const clientInfo = params.clientInfo === undefined ? undefined : requireRecord(
    params.clientInfo,
    'message.payload.params.clientInfo',
  );
  return withAdditiveJsonFields(params, 'message.payload.params', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: requireJsonObject(params.capabilities, 'message.payload.params.capabilities'),
    ...optionalProperty(
      'clientInfo',
      clientInfo === undefined
        ? undefined
        : {
          name: requireString(clientInfo.name, 'message.payload.params.clientInfo.name'),
          version: requireString(clientInfo.version, 'message.payload.params.clientInfo.version'),
        },
    ),
  });
}

function parseToolsListParams(value: unknown): McpToolsListParams {
  const params = value === undefined
    ? {}
    : requireRecord(value, 'message.payload.params');
  const cursor = params.cursor === undefined
    ? undefined
    : requireString(params.cursor, 'message.payload.params.cursor', { allowEmpty: true });
  const withUserTools = params.withUserTools === undefined
    ? undefined
    : requireBoolean(params.withUserTools, 'message.payload.params.withUserTools');
  return withAdditiveJsonFields(params, 'message.payload.params', {
    ...optionalProperty('cursor', cursor),
    ...optionalProperty('withUserTools', withUserTools),
  });
}

function parseToolsCallParams(value: unknown): McpToolsCallParams {
  const params = requireRecord(value, 'message.payload.params');
  return withAdditiveJsonFields(params, 'message.payload.params', {
    name: requireString(params.name, 'message.payload.params.name'),
    arguments: requireJsonObject(params.arguments, 'message.payload.params.arguments'),
  });
}

function parseMcpRequest(payload: Record<string, unknown>, id: number): McpJsonRpcRequest {
  const method = requireString(payload.method, 'message.payload.method');
  switch (method) {
    case 'initialize':
      if (!hasOwn(payload, 'params')) {
        throw new ProtocolValidationError('is required for initialize requests', 'message.payload.params');
      }
      return withAdditiveJsonFields(payload, 'message.payload', {
        jsonrpc: '2.0', id, method: 'initialize', params: parseInitializeParams(payload.params),
      });
    case 'tools/list':
      return withAdditiveJsonFields(payload, 'message.payload', {
        jsonrpc: '2.0', id, method: 'tools/list', params: parseToolsListParams(payload.params),
      });
    case 'tools/call':
      if (!hasOwn(payload, 'params')) {
        throw new ProtocolValidationError('is required for tools/call requests', 'message.payload.params');
      }
      return withAdditiveJsonFields(payload, 'message.payload', {
        jsonrpc: '2.0', id, method: 'tools/call', params: parseToolsCallParams(payload.params),
      });
    default:
      throw new ProtocolValidationError('must be initialize, tools/list, or tools/call', 'message.payload.method');
  }
}

function parseToolSchema(value: unknown): McpToolSchema {
  const schema = requireRecord(value, 'message.payload.result.tools[].inputSchema');
  const required = schema.required === undefined ? undefined : schema.required;
  if (required !== undefined && (!Array.isArray(required) || required.some((item) => typeof item !== 'string'))) {
    throw new ProtocolValidationError('must be an array of strings', 'message.payload.result.tools[].inputSchema.required');
  }
  return withAdditiveJsonFields(schema, 'message.payload.result.tools[].inputSchema', {
    type: requireLiteral(schema.type, 'object', 'message.payload.result.tools[].inputSchema.type'),
    properties: requireJsonObject(schema.properties, 'message.payload.result.tools[].inputSchema.properties'),
    ...optionalProperty('required', required as string[] | undefined),
  });
}

function parseMcpTool(value: unknown): McpTool {
  const tool = requireRecord(value, 'message.payload.result.tools[]');
  const annotations = tool.annotations === undefined
    ? undefined
    : requireRecord(tool.annotations, 'message.payload.result.tools[].annotations');
  let normalizedAnnotations: McpTool['annotations'];
  if (annotations !== undefined) {
    const audience = annotations.audience === undefined ? undefined : annotations.audience;
    if (audience !== undefined && (!Array.isArray(audience) || audience.some((item) => typeof item !== 'string'))) {
      throw new ProtocolValidationError('must be an array of strings', 'message.payload.result.tools[].annotations.audience');
    }
    normalizedAnnotations = withAdditiveJsonFields(annotations, 'message.payload.result.tools[].annotations', {
      ...optionalProperty('audience', audience as string[] | undefined),
    });
  }
  return withAdditiveJsonFields(tool, 'message.payload.result.tools[]', {
    name: requireString(tool.name, 'message.payload.result.tools[].name'),
    description: requireString(tool.description, 'message.payload.result.tools[].description'),
    inputSchema: parseToolSchema(tool.inputSchema),
    ...optionalProperty('annotations', normalizedAnnotations),
  });
}

function parseInitializeResult(value: Record<string, unknown>): McpInitializeResult {
  const serverInfo = requireRecord(value.serverInfo, 'message.payload.result.serverInfo');
  return withAdditiveJsonFields(value, 'message.payload.result', {
    protocolVersion: requireLiteral(
      value.protocolVersion,
      MCP_PROTOCOL_VERSION,
      'message.payload.result.protocolVersion',
    ),
    capabilities: requireJsonObject(value.capabilities, 'message.payload.result.capabilities'),
    serverInfo: {
      name: requireString(serverInfo.name, 'message.payload.result.serverInfo.name'),
      version: requireString(serverInfo.version, 'message.payload.result.serverInfo.version'),
    },
  });
}

function parseToolsListResult(value: Record<string, unknown>): McpToolsListResult {
  if (!Array.isArray(value.tools)) {
    throw new ProtocolValidationError('must be an array', 'message.payload.result.tools');
  }
  const nextCursor = value.nextCursor === undefined
    ? undefined
    : requireString(value.nextCursor, 'message.payload.result.nextCursor');
  return withAdditiveJsonFields(value, 'message.payload.result', {
    tools: value.tools.map(parseMcpTool),
    ...optionalProperty('nextCursor', nextCursor),
  });
}

function parseToolsCallResult(value: Record<string, unknown>): McpToolsCallResult {
  if (!Array.isArray(value.content)) {
    throw new ProtocolValidationError('must be an array', 'message.payload.result.content');
  }
  const content = value.content.map((entry, index) => {
    const item = requireRecord(entry, `message.payload.result.content[${index}]`);
    if (item.type === 'text') {
      return withAdditiveJsonFields(item, `message.payload.result.content[${index}]`, {
        type: 'text' as const,
        text: requireString(item.text, `message.payload.result.content[${index}].text`, { allowEmpty: true }),
      });
    }
    if (item.type === 'image') {
      return withAdditiveJsonFields(item, `message.payload.result.content[${index}]`, {
        type: 'image' as const,
        image: requireString(item.image, `message.payload.result.content[${index}].image`),
      });
    }
    throw new ProtocolValidationError('must be text or image', `message.payload.result.content[${index}].type`);
  });
  return withAdditiveJsonFields(value, 'message.payload.result', {
    content,
    isError: requireBoolean(value.isError, 'message.payload.result.isError'),
  });
}

function parseMcpResult(value: unknown): McpResult {
  const result = requireRecord(value, 'message.payload.result');
  if (hasOwn(result, 'protocolVersion')) {
    return parseInitializeResult(result);
  }
  if (hasOwn(result, 'tools')) {
    return parseToolsListResult(result);
  }
  if (hasOwn(result, 'content') || hasOwn(result, 'isError')) {
    return parseToolsCallResult(result);
  }
  throw new ProtocolValidationError('must match initialize, tools/list, or tools/call result shape', 'message.payload.result');
}

function parseMcpResponse(payload: Record<string, unknown>, id: number): McpJsonRpcResponse {
  const hasResult = hasOwn(payload, 'result');
  const hasError = hasOwn(payload, 'error');
  if (hasResult === hasError) {
    throw new ProtocolValidationError('must contain exactly one of result or error', 'message.payload');
  }
  if (hasResult) {
    const result: McpJsonRpcResult = withAdditiveJsonFields(payload, 'message.payload', {
      jsonrpc: '2.0', id, result: parseMcpResult(payload.result),
    });
    return result;
  }

  const error = requireRecord(payload.error, 'message.payload.error');
  const code = error.code === undefined ? undefined : requireInteger(error.code, 'message.payload.error.code');
  const data = error.data === undefined ? undefined : toJsonValue(error.data, 'message.payload.error.data');
  const normalizedError = withAdditiveJsonFields(error, 'message.payload.error', {
    message: requireString(error.message, 'message.payload.error.message'),
    ...optionalProperty('code', code),
    ...optionalProperty('data', data),
  });
  const response: McpJsonRpcError = withAdditiveJsonFields(payload, 'message.payload', {
    jsonrpc: '2.0', id, error: normalizedError,
  });
  return response;
}

function parseMcpRpc(value: unknown): McpPayload {
  const payload = requireRecord(value, 'message.payload');
  requireLiteral(payload.jsonrpc, '2.0', 'message.payload.jsonrpc');
  const id = parseMcpId(payload.id);
  const hasMethod = hasOwn(payload, 'method');
  const hasResult = hasOwn(payload, 'result');
  const hasError = hasOwn(payload, 'error');

  if (hasMethod) {
    if (hasResult || hasError) {
      throw new ProtocolValidationError('requests must not contain result or error', 'message.payload');
    }
    return parseMcpRequest(payload, id);
  }
  if (hasOwn(payload, 'params')) {
    throw new ProtocolValidationError('responses must not contain params', 'message.payload');
  }
  return parseMcpResponse(payload, id);
}

function parseMcpEnvelopePayload(value: Record<string, unknown>): McpPayload {
  return parseMcpRpc(value.payload);
}

export function parseMcpEnvelope(value: unknown): McpEnvelope {
  const envelope = requireRecord(value, 'message');
  requireLiteral(envelope.type, 'mcp', 'message.type');
  const payload = parseMcpEnvelopePayload(envelope);
  const sessionId = envelope.session_id === undefined
    ? undefined
    : requireString(envelope.session_id, 'message.session_id');
  if ('method' in payload) {
    return withAdditiveJsonFields(envelope, 'message', {
      type: 'mcp',
      payload,
      ...optionalProperty('session_id', sessionId),
    }) as ServerMcpEnvelope;
  }
  if (sessionId === undefined) {
    throw new ProtocolValidationError('is required for client MCP responses', 'message.session_id');
  }
  return withAdditiveJsonFields(envelope, 'message', {
    type: 'mcp',
    session_id: sessionId,
    payload,
  }) as ClientMcpEnvelope;
}

function parseClientMcpEnvelope(value: Record<string, unknown>): ClientMcpEnvelope {
  const envelope = parseMcpEnvelope(value);
  if ('method' in envelope.payload) {
    throw new ProtocolValidationError('client MCP messages must be responses', 'message.payload.method');
  }
  if (!('session_id' in envelope) || envelope.session_id === undefined) {
    throw new ProtocolValidationError('is required for client MCP responses', 'message.session_id');
  }
  return envelope as ClientMcpEnvelope;
}

function parseServerMcpEnvelope(value: Record<string, unknown>): ServerMcpEnvelope {
  const envelope = parseMcpEnvelope(value);
  if (!('method' in envelope.payload)) {
    throw new ProtocolValidationError('server MCP messages must be requests', 'message.payload');
  }
  return envelope as ServerMcpEnvelope;
}

export function parseClientMessage(value: unknown): ClientMessage {
  const message = requireRecord(value, 'message');
  switch (message.type) {
    case 'hello':
      return parseClientHello(message);
    case 'listen':
      return parseListen(message);
    case 'abort':
      return parseAbort(message);
    case 'mcp':
      return parseClientMcpEnvelope(message);
    default:
      throw new ProtocolValidationError('unsupported client message type', 'message.type');
  }
}

export function parseServerMessage(value: unknown): ServerMessage {
  const message = requireRecord(value, 'message');
  switch (message.type) {
    case 'hello':
      return parseServerHello(message);
    case 'stt':
      return parseStt(message);
    case 'tts':
      return parseTts(message);
    case 'llm':
      return parseLlm(message);
    case 'mcp':
      return parseServerMcpEnvelope(message);
    case 'system':
      return parseSystem(message);
    case 'alert':
      return parseAlert(message);
    default:
      throw new ProtocolValidationError('unsupported server message type', 'message.type');
  }
}

export function isKnownTransportMessage(value: unknown): value is KnownTransportMessage {
  if (!isRecord(value) || typeof value.type !== 'string' || !MESSAGE_TYPES.has(value.type)) {
    return false;
  }
  try {
    parseClientMessage(value);
    return true;
  } catch {
    try {
      parseServerMessage(value);
      return true;
    } catch {
      return false;
    }
  }
}

export function unknownTransportMessage(value: unknown): UnknownTransportMessage {
  const message = requireRecord(value, 'message');
  return { type: requireString(message.type, 'message.type'), known: false };
}
