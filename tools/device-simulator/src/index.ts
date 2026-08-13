#!/usr/bin/env node

import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  parseActivationPollRequest,
  parseActivationPollResponse,
  parseBootstrapRequest,
  parseBootstrapResponse,
  parseClientMessage,
  parseServerMessage,
  rawOpusV1FrameAdapter,
  type ActivationPollRequest,
  type ActivationPollResponse,
  type BootstrapRequest,
  type BootstrapResponse,
  type ClientHelloMessage,
  type KnownTransportMessage,
  type McpEnvelope,
  type McpJsonRpcRequest,
  type McpJsonRpcResponse,
  type McpJsonRpcResult,
  type McpRequestMethod,
  type McpResult,
  type McpTool,
  type McpToolsListResult,
  type ServerHelloMessage,
  type TtsMessage,
} from '@veetee/protocol-contracts';

const MAC_ADDRESS_PATTERN = /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/u;

export type SimulatorState =
  | 'new'
  | 'pairing-pending'
  | 'activated'
  | 'bootstrapped'
  | 'hello-sent'
  | 'connected';

export interface DeviceSimulatorOptions {
  deviceId: string;
  clientId: string;
  activationVersion: string;
  serialNumber?: string;
}

export interface SimulatorSnapshot {
  state: SimulatorState;
  activationCode: string | undefined;
  challenge: string | undefined;
  websocketUrl: string | undefined;
  sessionId: string | undefined;
}

export interface FixtureReplayResult {
  states: SimulatorState[];
  bootstrapRequest: BootstrapRequest;
  activationRequest: ActivationPollRequest;
  helloHeaders: Record<string, string>;
  replayedTypes: string[];
  opusPacketBytes: number;
  completed: boolean;
}

interface PendingMcpRequest {
  method: McpRequestMethod;
  expectedResultFamily: McpResultFamily;
  cursor: string | undefined;
  withUserTools: boolean;
}

type McpResultFamily = 'initialize' | 'tools/list' | 'tools/call';

export class SimulatorStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulatorStateError';
  }
}

function requireNonEmpty(value: string, name: string): string {
  if (value.length === 0) {
    throw new SimulatorStateError(`${name} must be non-empty`);
  }
  return value;
}

function requireMacAddress(value: string, name: string): string {
  if (!MAC_ADDRESS_PATTERN.test(value)) {
    throw new SimulatorStateError(`${name} must be a lowercase colon-delimited MAC address`);
  }
  return value;
}

function requireActivationVersion(value: string): '1' | '2' {
  if (value !== '1' && value !== '2') {
    throw new SimulatorStateError('activationVersion must be "1" or "2"');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMcpRequest(value: McpEnvelope['payload']): value is McpJsonRpcRequest {
  return 'method' in value;
}

function isMcpResultResponse(value: McpJsonRpcResponse): value is McpJsonRpcResult {
  return 'result' in value;
}

function resultFamily(result: McpResult): McpResultFamily {
  if ('protocolVersion' in result) {
    return 'initialize';
  }
  if ('tools' in result) {
    return 'tools/list';
  }
  return 'tools/call';
}

function isToolsListResult(result: McpResult): result is McpToolsListResult {
  return 'tools' in result;
}

function toolIsUserOnly(tool: McpTool): boolean {
  return tool.annotations?.audience?.includes('user') ?? false;
}

function sessionIdFor(message: KnownTransportMessage): string | undefined {
  return 'session_id' in message ? message.session_id : undefined;
}

export class DeviceSimulator {
  readonly #options: Readonly<DeviceSimulatorOptions & { activationVersion: '1' | '2' }>;
  #state: SimulatorState = 'new';
  #activationCode: string | undefined;
  #challenge: string | undefined;
  #websocketConfig: BootstrapResponse['websocket'] | undefined;
  #sessionId: string | undefined;
  #ttsActive = false;
  #sentenceActive = false;
  #turnCancelled = false;
  #pendingMcpRequests = new Map<number, PendingMcpRequest>();
  #discoveredTools = new Map<string, McpTool>();
  #approvedUserTools = new Set<string>();
  #standardToolPaginationComplete = false;
  #standardNextCursor: string | undefined;
  #userNextCursor: string | undefined;

  constructor(options: DeviceSimulatorOptions) {
    const activationVersion = requireActivationVersion(options.activationVersion);
    const serialNumber = options.serialNumber === undefined
      ? undefined
      : requireNonEmpty(options.serialNumber, 'serialNumber');
    if (activationVersion === '1' && serialNumber !== undefined) {
      throw new SimulatorStateError('serialNumber must be omitted for activation version 1');
    }
    if (activationVersion === '2' && serialNumber === undefined) {
      throw new SimulatorStateError('serialNumber is required for activation version 2');
    }
    this.#options = {
      deviceId: requireMacAddress(requireNonEmpty(options.deviceId, 'deviceId'), 'deviceId'),
      clientId: requireNonEmpty(options.clientId, 'clientId'),
      activationVersion,
      ...(serialNumber === undefined ? {} : { serialNumber }),
    };
  }

  get state(): SimulatorState {
    return this.#state;
  }

  constructBootstrapRequest(): BootstrapRequest {
    const serialNumber = this.#options.serialNumber;
    const headers: BootstrapRequest['headers'] = this.#options.activationVersion === '1'
      ? {
        'Activation-Version': '1',
        'Device-Id': this.#options.deviceId,
        'Client-Id': this.#options.clientId,
        'User-Agent': 'veetee-device-simulator/0.1.0',
        'Accept-Language': 'vi-VN',
        'Content-Type': 'application/json',
      }
      : this.#createV2BootstrapHeaders(serialNumber);
    const request: BootstrapRequest = {
      headers,
      body: {
        version: 2,
        language: 'vi-VN',
        flash_size: 4194304,
        minimum_free_heap_size: '123456',
        mac_address: this.#options.deviceId,
        uuid: this.#options.clientId,
        chip_model_name: 'simulator-s3',
        chip_info: { model: 9, cores: 2, revision: 0, features: 0 },
        application: {
          name: 'veetee-device-simulator',
          version: '0.1.0',
          compile_time: '2026-08-13T00:00:00Z',
          idf_version: '5.5.4',
          elf_sha256: '0'.repeat(64),
        },
        partition_table: [],
        ota: { label: 'ota_0' },
        board: {
          type: 'veetee-simulator',
          name: 'Veetee Simulator',
          manufacturer: 'Veetee',
          mac: this.#options.deviceId,
        },
      },
    };
    return parseBootstrapRequest(request);
  }

  #createV2BootstrapHeaders(serialNumber: string | undefined): BootstrapRequest['headers'] {
    if (serialNumber === undefined) {
      throw new SimulatorStateError('activation version 2 is missing serialNumber');
    }
    return {
      'Activation-Version': '2',
      'Device-Id': this.#options.deviceId,
      'Client-Id': this.#options.clientId,
      'Serial-Number': serialNumber,
      'User-Agent': 'veetee-device-simulator/0.1.0',
      'Accept-Language': 'vi-VN',
      'Content-Type': 'application/json',
    };
  }

  acceptBootstrapResponse(value: unknown): SimulatorState {
    this.#requireState('new', 'pairing-pending', 'activated');
    const response = parseBootstrapResponse(value);
    if (response.activation !== undefined) {
      this.#activationCode = response.activation.code;
      this.#challenge = response.activation.challenge;
      this.#websocketConfig = undefined;
      return this.#setState('pairing-pending');
    }
    if (response.websocket !== undefined) {
      this.#activationCode = undefined;
      this.#challenge = undefined;
      this.#websocketConfig = response.websocket;
      return this.#setState('bootstrapped');
    }

    throw new SimulatorStateError('bootstrap response must contain activation or websocket configuration');
  }

  constructActivationPollRequest(hmac = ''): ActivationPollRequest {
    this.#requireState('pairing-pending');
    if (this.#challenge === undefined) {
      throw new SimulatorStateError('pairing state is missing activation challenge');
    }
    if (this.#options.activationVersion === '1') {
      return parseActivationPollRequest({
        headers: {
          'Activation-Version': '1',
          'Device-Id': this.#options.deviceId,
          'Client-Id': this.#options.clientId,
        },
        body: {},
      });
    }

    const serialNumber = this.#options.serialNumber;
    if (serialNumber === undefined) {
      throw new SimulatorStateError('activation version 2 is missing serialNumber');
    }
    return parseActivationPollRequest({
      headers: {
        'Activation-Version': '2',
        'Device-Id': this.#options.deviceId,
        'Client-Id': this.#options.clientId,
        'Serial-Number': serialNumber,
      },
      body: {
        algorithm: 'hmac-sha256',
        serial_number: serialNumber,
        challenge: this.#challenge,
        hmac,
      },
    });
  }

  pollActivation(value: unknown): SimulatorState {
    this.#requireState('pairing-pending');
    const response: ActivationPollResponse = parseActivationPollResponse(value);
    return response.status === 202 ? this.#setState('pairing-pending') : this.#setState('activated');
  }

  constructHello(): ClientHelloMessage {
    this.#requireState('bootstrapped');
    if (this.#websocketConfig === undefined) {
      throw new SimulatorStateError('websocket configuration is unavailable');
    }
    const hello = parseClientMessage({
      type: 'hello',
      version: this.#websocketConfig.version,
      transport: 'websocket',
      features: { mcp: true },
      audio_params: {
        format: 'opus',
        sample_rate: 16000,
        channels: 1,
        frame_duration: 60,
      },
    });
    if (hello.type !== 'hello') {
      throw new SimulatorStateError('client hello fixture did not parse as hello');
    }
    this.#setState('hello-sent');
    return hello;
  }

  constructHelloHeaders(): Record<string, string> {
    if (this.#websocketConfig === undefined) {
      throw new SimulatorStateError('websocket configuration is unavailable');
    }
    return {
      ...(this.#websocketConfig.token.length === 0
        ? {}
        : { Authorization: `Bearer ${this.#websocketConfig.token}` }),
      'Protocol-Version': String(this.#websocketConfig.version),
      'Device-Id': this.#options.deviceId,
      'Client-Id': this.#options.clientId,
    };
  }

  validateServerHello(value: unknown): ServerHelloMessage {
    this.#requireState('hello-sent');
    const hello = parseServerMessage(value);
    if (hello.type !== 'hello') {
      throw new SimulatorStateError('first server message must be hello');
    }
    this.#validateEchoedIdentity(value);
    this.#sessionId = hello.session_id;
    this.#setState('connected');
    return hello;
  }

  replayMessage(value: unknown, direction: 'client' | 'server'): KnownTransportMessage {
    this.#requireState('connected');
    const message = direction === 'client' ? parseClientMessage(value) : parseServerMessage(value);
    this.#validateSession(message);
    this.#assertMessageAllowedAfterTurnCancellation(message, direction);

    if (message.type === 'mcp') {
      this.#replayMcp(message, direction);
    }
    if (message.type === 'tts') {
      this.#replayTts(message, direction);
    }
    if (message.type === 'abort') {
      if (direction !== 'client') {
        throw new SimulatorStateError('abort messages must be device-to-server');
      }
      this.#turnCancelled = true;
      this.#sentenceActive = false;
    }
    if (message.type === 'listen' && direction === 'client' && message.state === 'start') {
      if (this.#ttsActive) {
        throw new SimulatorStateError('listen/start requires the cancelled turn to receive tts/stop first');
      }
      this.#turnCancelled = false;
    }
    return message;
  }

  replayBinaryOpus(value: Uint8Array): Uint8Array {
    this.#requireState('connected');
    if (this.#turnCancelled || !this.#ttsActive || !this.#sentenceActive) {
      throw new SimulatorStateError('binary Opus requires an active, non-cancelled TTS sentence');
    }
    return rawOpusV1FrameAdapter.decode(value);
  }

  approveUserToolCall(name: string): void {
    const tool = this.#discoveredTools.get(name);
    if (tool === undefined || !toolIsUserOnly(tool)) {
      throw new SimulatorStateError(`cannot approve unknown or non-user-only tool ${name}`);
    }
    this.#approvedUserTools.add(name);
  }

  snapshot(): SimulatorSnapshot {
    return {
      state: this.#state,
      activationCode: this.#activationCode,
      challenge: this.#challenge,
      websocketUrl: this.#websocketConfig?.url,
      sessionId: this.#sessionId,
    };
  }

  #replayTts(message: TtsMessage, direction: 'client' | 'server'): void {
    if (direction !== 'server') {
      throw new SimulatorStateError('TTS messages must be server-to-device');
    }
    switch (message.state) {
      case 'start':
        if (this.#ttsActive) {
          throw new SimulatorStateError('TTS start is invalid while TTS is already active');
        }
        if (this.#turnCancelled) {
          throw new SimulatorStateError('TTS start is invalid after a turn abort');
        }
        this.#ttsActive = true;
        this.#sentenceActive = false;
        return;
      case 'sentence_start':
        if (!this.#ttsActive || this.#turnCancelled) {
          throw new SimulatorStateError('TTS sentence_start requires an active, non-cancelled TTS turn');
        }
        this.#sentenceActive = true;
        return;
      case 'stop':
        if (!this.#ttsActive && !this.#turnCancelled) {
          throw new SimulatorStateError('TTS stop requires TTS start');
        }
        this.#ttsActive = false;
        this.#sentenceActive = false;
        return;
      default:
        throw new SimulatorStateError('unsupported TTS state');
    }
  }

  #replayMcp(message: McpEnvelope, direction: 'client' | 'server'): void {
    if (isMcpRequest(message.payload)) {
      if (direction !== 'server') {
        throw new SimulatorStateError('MCP requests must be server-to-device');
      }
      this.#registerMcpRequest(message.payload);
      return;
    }

    if (direction !== 'client') {
      throw new SimulatorStateError('MCP responses must be client-to-server');
    }
    this.#resolveMcpResponse(message.payload);
  }

  #registerMcpRequest(request: McpJsonRpcRequest): void {
    if (this.#pendingMcpRequests.has(request.id)) {
      throw new SimulatorStateError(`MCP request id ${request.id} is already pending`);
    }

    const pending: PendingMcpRequest = {
      method: request.method,
      expectedResultFamily: this.#expectedResultFamily(request.method),
      cursor: request.method === 'tools/list' ? request.params.cursor : undefined,
      withUserTools: request.method === 'tools/list' && request.params.withUserTools === true,
    };

    if (request.method === 'tools/list') {
      this.#validateToolsListRequest(pending);
    }
    if (request.method === 'tools/call') {
      this.#validateToolsCallRequest(request);
    }

    this.#pendingMcpRequests.set(request.id, pending);
  }

  #resolveMcpResponse(response: McpJsonRpcResponse): void {
    const pending = this.#pendingMcpRequests.get(response.id);
    if (pending === undefined) {
      if (isMcpResultResponse(response)) {
        const receivedFamily = resultFamily(response.result);
        const pendingFamilies = [...this.#pendingMcpRequests.values()]
          .map((request) => request.expectedResultFamily);
        if (pendingFamilies.length > 0 && !pendingFamilies.includes(receivedFamily)) {
          throw new SimulatorStateError(
            `MCP pending request requires ${pendingFamilies.join(' or ')} result, received ${receivedFamily}`,
          );
        }
      }
      throw new SimulatorStateError(`MCP response id ${response.id} has no pending request`);
    }
    if (!isMcpResultResponse(response)) {
      this.#pendingMcpRequests.delete(response.id);
      return;
    }

    const receivedFamily = resultFamily(response.result);
    if (receivedFamily !== pending.expectedResultFamily) {
      throw new SimulatorStateError(
        `MCP ${pending.method} request id ${response.id} requires ${pending.expectedResultFamily} result, received ${receivedFamily}`,
      );
    }
    if (isToolsListResult(response.result)) {
      this.#recordToolListResult(pending, response.result);
    }
    this.#pendingMcpRequests.delete(response.id);
  }

  #expectedResultFamily(method: McpRequestMethod): McpResultFamily {
    switch (method) {
      case 'initialize':
        return 'initialize';
      case 'tools/list':
        return 'tools/list';
      case 'tools/call':
        return 'tools/call';
      default:
        throw new SimulatorStateError(`unsupported MCP method ${method}`);
    }
  }

  #validateToolsListRequest(pending: PendingMcpRequest): void {
    if (pending.withUserTools) {
      if (this.#userNextCursor !== undefined && pending.cursor !== this.#userNextCursor) {
        throw new SimulatorStateError(`MCP user tools/list cursor must equal ${this.#userNextCursor}`);
      }
      if (this.#userNextCursor === undefined && pending.cursor !== undefined) {
        throw new SimulatorStateError('MCP user tools/list continuation requires a prior nextCursor');
      }
      return;
    }

    if (this.#standardNextCursor !== undefined && pending.cursor !== this.#standardNextCursor) {
      throw new SimulatorStateError(`MCP tools/list cursor must equal ${this.#standardNextCursor}`);
    }
    if (this.#standardNextCursor === undefined && pending.cursor !== undefined) {
      throw new SimulatorStateError('MCP tools/list continuation requires a prior nextCursor');
    }
    this.#standardToolPaginationComplete = false;
  }

  #validateToolsCallRequest(request: Extract<McpJsonRpcRequest, { method: 'tools/call' }>): void {
    if (!this.#standardToolPaginationComplete) {
      throw new SimulatorStateError('MCP tools/call is blocked until standard tools/list pagination completes');
    }
    const tool = this.#discoveredTools.get(request.params.name);
    if (tool === undefined) {
      throw new SimulatorStateError(
        `MCP tools/call name ${request.params.name} was not discovered from tools/list`,
      );
    }
    if (toolIsUserOnly(tool) && !this.#approvedUserTools.has(tool.name)) {
      throw new SimulatorStateError(`MCP user-only tool ${tool.name} requires explicit approval`);
    }
  }

  #recordToolListResult(pending: PendingMcpRequest, result: McpToolsListResult): void {
    for (const tool of result.tools) {
      if (toolIsUserOnly(tool) && !pending.withUserTools) {
        throw new SimulatorStateError(`user-only tool ${tool.name} requires withUserTools:true discovery`);
      }
      this.#discoveredTools.set(tool.name, tool);
    }

    if (pending.withUserTools) {
      this.#userNextCursor = result.nextCursor;
      return;
    }
    this.#standardNextCursor = result.nextCursor;
    this.#standardToolPaginationComplete = result.nextCursor === undefined;
  }

  #assertMessageAllowedAfterTurnCancellation(
    message: KnownTransportMessage,
    direction: 'client' | 'server',
  ): void {
    if (!this.#turnCancelled) {
      return;
    }
    if (message.type === 'mcp' && direction === 'client' && !isMcpRequest(message.payload)) {
      const pending = this.#pendingMcpRequests.get(message.payload.id);
      if (pending !== undefined) {
        return;
      }
      throw new SimulatorStateError(`MCP response id ${message.payload.id} has no pending request after abort`);
    }
    if (direction === 'server' && message.type === 'tts' && message.state === 'stop') {
      return;
    }
    if (direction === 'client' && message.type === 'listen' && message.state === 'start') {
      return;
    }
    throw new SimulatorStateError(
      'only correlated MCP responses, tts/stop acknowledgement, or a subsequent listen/start is valid after abort',
    );
  }

  #validateEchoedIdentity(value: unknown): void {
    if (!isRecord(value)) {
      return;
    }
    const deviceId = value.device_id;
    if (deviceId !== undefined && deviceId !== this.#options.deviceId) {
      throw new SimulatorStateError('server hello device_id does not match the bootstrap device identity');
    }
    const clientId = value.client_id;
    if (clientId !== undefined && clientId !== this.#options.clientId) {
      throw new SimulatorStateError('server hello client_id does not match the bootstrap client identity');
    }
  }

  #validateSession(message: KnownTransportMessage): void {
    const sessionId = sessionIdFor(message);
    if (sessionId !== undefined && sessionId !== this.#sessionId) {
      throw new SimulatorStateError('message session_id does not match the established server session');
    }
  }

  #setState(state: SimulatorState): SimulatorState {
    this.#state = state;
    return state;
  }

  #requireState(...allowedStates: SimulatorState[]): void {
    if (!allowedStates.includes(this.#state)) {
      throw new SimulatorStateError(
        `cannot perform this operation in ${this.#state}; expected ${allowedStates.join(' or ')}`,
      );
    }
  }
}

const fixtureDirectory = fileURLToPath(new URL('../../../packages/protocol-contracts/fixtures/', import.meta.url));

function readGoldenFixture(name: string): unknown {
  return JSON.parse(readFileSync(`${fixtureDirectory}${name}`, 'utf8')) as unknown;
}

function readGoldenBinaryFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(`${fixtureDirectory}${name}`));
}

/**
 * Exercise a deterministic fixture-only conversation without HTTP, WebSocket,
 * or audio-device I/O. It treats abort as a cancellable turn and explicitly
 * completes the scenario after the server acknowledgement and next listen turn.
 */
export function replayFixtureFlow(simulator: DeviceSimulator): FixtureReplayResult {
  const states: SimulatorState[] = [simulator.state];
  const bootstrapRequest = simulator.constructBootstrapRequest();

  states.push(simulator.acceptBootstrapResponse(readGoldenFixture('bootstrap-pairing-response.json')));
  const activationRequest = simulator.constructActivationPollRequest();
  states.push(simulator.pollActivation(readGoldenFixture('activation-pending-response.json')));
  states.push(simulator.pollActivation(readGoldenFixture('activation-claimed-response.json')));
  states.push(simulator.acceptBootstrapResponse(readGoldenFixture('bootstrap-websocket-response.json')));
  const helloHeaders = simulator.constructHelloHeaders();
  simulator.constructHello();
  states.push(simulator.state);
  simulator.validateServerHello(readGoldenFixture('server-hello.json'));
  states.push(simulator.state);

  const replayedTypes: string[] = [];
  const replay = (name: string, direction: 'client' | 'server'): void => {
    const parsed = simulator.replayMessage(readGoldenFixture(name), direction);
    replayedTypes.push(parsed.type);
    states.push(simulator.state);
  };
  for (const name of ['listen-start.json', 'listen-stop.json', 'listen-detect.json']) {
    replay(name, 'client');
  }
  for (const [request, response] of [
    ['mcp-initialize-request.json', 'mcp-initialize-result.json'],
    ['mcp-tools-list-initial-request.json', 'mcp-tools-list-initial-result.json'],
    ['mcp-tools-list-page-request.json', 'mcp-tools-list-page-result.json'],
    ['mcp-tools-call-request.json', 'mcp-tools-call-result.json'],
  ] as const) {
    replay(request, 'server');
    replay(response, 'client');
  }
  // Cached-wakeup audio can begin without preceding STT/LLM output.
  replay('tts-start.json', 'server');
  replay('tts-sentence-start.json', 'server');
  const opusPacket = simulator.replayBinaryOpus(readGoldenBinaryFixture('v1-opus-packet.bin'));
  replayedTypes.push('binary-opus');
  states.push(simulator.state);
  replay('tts-sentence-start.json', 'server');
  replay('abort.json', 'client');
  replay('tts-stop.json', 'server');
  replay('listen-start.json', 'client');

  return {
    states,
    bootstrapRequest,
    activationRequest,
    helloHeaders,
    replayedTypes,
    opusPacketBytes: opusPacket.byteLength,
    completed: simulator.state === 'connected',
  };
}

function isMainModule(): boolean {
  if (process.argv[1] === undefined) {
    return false;
  }
  return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isMainModule()) {
  const simulator = new DeviceSimulator({
    deviceId: '00:11:22:33:44:55',
    clientId: '00000000-0000-4000-8000-000000000001',
    activationVersion: '1',
  });
  const replay = replayFixtureFlow(simulator);
  console.log(JSON.stringify({ replay, snapshot: simulator.snapshot() }, null, 2));
}
