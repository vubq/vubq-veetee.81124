import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DeviceSimulator,
  SimulatorStateError,
  replayFixtureFlow,
} from '../src/index.js';

const DEVICE_ID = '00:11:22:33:44:55';
const CLIENT_ID = '00000000-0000-4000-8000-000000000001';

async function readFixture(name: string): Promise<unknown> {
  const path = fileURLToPath(new URL(`../../../packages/protocol-contracts/fixtures/${name}`, import.meta.url));
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function connectedSimulator(): DeviceSimulator {
  const simulator = new DeviceSimulator({
    deviceId: DEVICE_ID,
    clientId: CLIENT_ID,
    activationVersion: '1',
  });
  simulator.acceptBootstrapResponse({
    websocket: { url: 'wss://simulator.invalid/ws/v1', token: 'fixture-device-token' },
  });
  simulator.constructHello();
  simulator.validateServerHello({
    type: 'hello',
    transport: 'websocket',
    session_id: 'session-fixture-001',
    audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 },
  });
  return simulator;
}

async function completeStandardToolDiscovery(simulator: DeviceSimulator): Promise<void> {
  for (const [request, result] of [
    ['mcp-initialize-request.json', 'mcp-initialize-result.json'],
    ['mcp-tools-list-initial-request.json', 'mcp-tools-list-initial-result.json'],
    ['mcp-tools-list-page-request.json', 'mcp-tools-list-page-result.json'],
  ] as const) {
    simulator.replayMessage(await readFixture(request), 'server');
    simulator.replayMessage(await readFixture(result), 'client');
  }
}

describe('deterministic device simulator', () => {
  it('replays firmware-shaped bootstrap, activation, MCP, cached-wakeup TTS, binary Opus, and turn abort', () => {
    const simulator = new DeviceSimulator({
      deviceId: DEVICE_ID,
      clientId: CLIENT_ID,
      activationVersion: '1',
    });

    const replay = replayFixtureFlow(simulator);

    expect(replay.bootstrapRequest.headers).toMatchObject({
      'Device-Id': DEVICE_ID,
      'Client-Id': CLIENT_ID,
      'Activation-Version': '1',
    });
    expect(replay.bootstrapRequest.headers).not.toHaveProperty('Serial-Number');
    expect(replay.bootstrapRequest.body).toMatchObject({
      application: { version: '0.1.0' },
      board: { type: 'veetee-simulator' },
    });
    expect(replay.activationRequest).toEqual({
      headers: {
        'Activation-Version': '1',
        'Device-Id': DEVICE_ID,
        'Client-Id': CLIENT_ID,
      },
      body: {},
    });
    expect(replay.helloHeaders).toEqual({
      Authorization: 'Bearer fixture-device-token',
      'Protocol-Version': '1',
      'Device-Id': DEVICE_ID,
      'Client-Id': CLIENT_ID,
    });
    expect(replay.replayedTypes).toEqual([
      'listen', 'listen', 'listen',
      'mcp', 'mcp', 'mcp', 'mcp', 'mcp', 'mcp', 'mcp', 'mcp',
      'tts', 'tts', 'binary-opus', 'tts', 'abort', 'tts', 'listen',
    ]);
    expect(replay.opusPacketBytes).toBeGreaterThan(0);
    expect(simulator.snapshot()).toEqual({
      state: 'connected',
      activationCode: undefined,
      challenge: undefined,
      websocketUrl: 'wss://simulator.invalid/ws/v1',
      sessionId: 'session-fixture-001',
    });
  });

  it('constructs the v2 HMAC activation request with serial identity', () => {
    const simulator = new DeviceSimulator({
      deviceId: '66:77:88:99:aa:bb',
      clientId: '00000000-0000-4000-8000-000000000002',
      activationVersion: '2',
      serialNumber: 'SN-VEETEE-0002',
    });
    simulator.acceptBootstrapResponse({
      activation: {
        message: 'Mã ghép nối Veetee: 123456',
        code: '123456',
        challenge: 'opaque-challenge-fixture',
      },
    });

    expect(simulator.constructActivationPollRequest('4d4d2f6eec66b9e06acaa3b49470a7713ac18fead421940b2d97bfe0ef6e0be5')).toEqual({
      headers: {
        'Activation-Version': '2',
        'Device-Id': '66:77:88:99:aa:bb',
        'Client-Id': '00000000-0000-4000-8000-000000000002',
        'Serial-Number': 'SN-VEETEE-0002',
      },
      body: {
        algorithm: 'hmac-sha256',
        serial_number: 'SN-VEETEE-0002',
        challenge: 'opaque-challenge-fixture',
        hmac: '4d4d2f6eec66b9e06acaa3b49470a7713ac18fead421940b2d97bfe0ef6e0be5',
      },
    });
  });

  it('requires MCP response result families to match requests and finishes pagination before calls', async () => {
    const simulator = connectedSimulator();
    const initializeRequest = await readFixture('mcp-initialize-request.json');
    const initializeResult = await readFixture('mcp-initialize-result.json');
    const initialListRequest = await readFixture('mcp-tools-list-initial-request.json');
    const initialListResult = await readFixture('mcp-tools-list-initial-result.json');
    const pageRequest = await readFixture('mcp-tools-list-page-request.json');
    const pageResult = await readFixture('mcp-tools-list-page-result.json');
    const callRequest = await readFixture('mcp-tools-call-request.json');
    const callResult = await readFixture('mcp-tools-call-result.json');

    simulator.replayMessage(initializeRequest, 'server');
    expect(() => simulator.replayMessage(initialListResult, 'client')).toThrow(/initialize/);
    simulator.replayMessage(initializeResult, 'client');

    simulator.replayMessage(initialListRequest, 'server');
    simulator.replayMessage(initialListResult, 'client');
    expect(() => simulator.replayMessage(callRequest, 'server')).toThrow(/pagination/);

    simulator.replayMessage(pageRequest, 'server');
    simulator.replayMessage(pageResult, 'client');
    simulator.replayMessage(callRequest, 'server');
    simulator.replayMessage(callResult, 'client');
  });

  it('preserves user-only audience metadata and requires explicit approval before calls', async () => {
    const simulator = connectedSimulator();
    await completeStandardToolDiscovery(simulator);
    const userListRequest = await readFixture('mcp-tools-list-user-request.json');
    const userListResult = await readFixture('mcp-tools-list-user-result.json');
    const userCallRequest = await readFixture('mcp-tools-call-user-request.json');
    const userCallResult = await readFixture('mcp-tools-call-user-result.json');

    simulator.replayMessage(userListRequest, 'server');
    simulator.replayMessage(userListResult, 'client');
    expect(() => simulator.replayMessage(userCallRequest, 'server')).toThrow(/approval/);

    simulator.approveUserToolCall('self.user.settings');
    simulator.replayMessage(userCallRequest, 'server');
    simulator.replayMessage(userCallResult, 'client');
  });

  it('preserves independent pending MCP calls across speech abort and validates late results', async () => {
    const simulator = connectedSimulator();
    await completeStandardToolDiscovery(simulator);
    const callRequest = await readFixture('mcp-tools-call-request.json');
    const callResult = await readFixture('mcp-tools-call-result.json');
    const abort = await readFixture('abort.json');

    simulator.replayMessage(callRequest, 'server');
    simulator.replayMessage(abort, 'client');
    expect(() => simulator.replayMessage({
      type: 'mcp',
      session_id: 'session-fixture-001',
      payload: {
        jsonrpc: '2.0',
        id: 3,
        result: { tools: [] },
      },
    }, 'client')).toThrow(/tools\/call.*tools\/list/i);
    expect(() => simulator.replayMessage(callResult, 'client')).not.toThrow();
    expect(() => simulator.replayMessage({
      type: 'mcp',
      session_id: 'session-fixture-001',
      payload: {
        jsonrpc: '2.0',
        id: 999,
        result: {
          content: [{ type: 'text', text: 'late' }],
          isError: false,
        },
      },
    }, 'client')).toThrow(/no pending request/);
    expect(simulator.state).toBe('connected');

    simulator.replayMessage({
      type: 'tts',
      state: 'stop',
      session_id: 'session-fixture-001',
    }, 'server');
    simulator.replayMessage({
      type: 'listen',
      state: 'start',
      mode: 'auto',
      session_id: 'session-fixture-001',
    }, 'client');
    simulator.replayMessage(callRequest, 'server');
    simulator.replayMessage(abort, 'client');
    expect(() => simulator.replayMessage({
      type: 'mcp',
      session_id: 'session-fixture-001',
      payload: {
        jsonrpc: '2.0',
        id: 3,
        error: { code: -32000, message: 'tool call cancelled remotely' },
      },
    }, 'client')).not.toThrow();
  });

  it('accepts cached-wakeup TTS without LLM and keeps a connected session through abort acknowledgement and a new listen turn', async () => {
    const simulator = connectedSimulator();
    const ttsStart = await readFixture('tts-start.json');
    const sentenceStart = await readFixture('tts-sentence-start.json');
    const ttsStop = await readFixture('tts-stop.json');
    const abort = await readFixture('abort.json');
    const listenStart = await readFixture('listen-start.json');

    simulator.replayMessage(ttsStart, 'server');
    simulator.replayMessage(sentenceStart, 'server');
    expect(() => simulator.replayBinaryOpus(new Uint8Array([1, 2, 3]))).not.toThrow();
    simulator.replayMessage(abort, 'client');
    simulator.replayMessage(ttsStop, 'server');
    expect(simulator.state).toBe('connected');
    expect(() => simulator.replayMessage(listenStart, 'client')).not.toThrow();
  });

  it('enforces session identity and invalid connection state transitions', () => {
    const simulator = connectedSimulator();

    expect(() => simulator.replayMessage({
      type: 'stt', session_id: 'other-session', text: 'mismatch', is_final: true,
    }, 'server')).toThrow(/session_id/);

    const unconnected = new DeviceSimulator({
      deviceId: DEVICE_ID,
      clientId: CLIENT_ID,
      activationVersion: '1',
    });
    expect(() => unconnected.pollActivation({ status: 202, body: '' })).toThrow(SimulatorStateError);
    expect(() => unconnected.validateServerHello({
      type: 'hello',
      transport: 'websocket',
      session_id: 'session-fixture-001',
      audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 },
    })).toThrow(SimulatorStateError);
  });
});
