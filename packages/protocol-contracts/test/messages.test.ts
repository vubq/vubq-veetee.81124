import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ProtocolValidationError,
  isKnownTransportMessage,
  parseClientMessage,
  parseMcpEnvelope,
  parseServerMessage,
  parseWebSocketUpgradeHeaders,
  unknownTransportMessage,
} from '../src/index.js';

async function readFixture(name: string): Promise<unknown> {
  const path = fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

describe('WebSocket message contracts', () => {
  it('parses firmware-compatible hello fields including websocket transport and MCP support', async () => {
    const hello = parseClientMessage(await readFixture('client-hello.json'));

    expect(hello).toEqual(expect.objectContaining({
      type: 'hello',
      version: 1,
      transport: 'websocket',
      features: { mcp: true },
      audio_params: {
        format: 'opus',
        sample_rate: 16000,
        channels: 1,
        frame_duration: 60,
      },
    }));
  });

  it('normalizes lowercase Fastify upgrade headers', () => {
    expect(parseWebSocketUpgradeHeaders({
      authorization: 'Bearer fixture-device-token',
      'protocol-version': '1',
      'device-id': '00:11:22:33:44:55',
      'client-id': '00000000-0000-4000-8000-000000000001',
      ignored_later: 'accepted',
    })).toEqual({
      authorization: 'Bearer fixture-device-token',
      protocolVersion: 1,
      deviceId: '00:11:22:33:44:55',
      clientId: '00000000-0000-4000-8000-000000000001',
    });

    expect(() => parseWebSocketUpgradeHeaders({
      authorization: 'fixture-device-token',
      'protocol-version': '1',
      'device-id': '00:11:22:33:44:55',
      'client-id': '00000000-0000-4000-8000-000000000001',
    })).toThrow(ProtocolValidationError);
  });

  it('accepts a negotiated 16 kHz server hello while preserving the intended 24 kHz variant', async () => {
    const intendedHello = parseServerMessage(await readFixture('server-hello.json'));
    const negotiatedHello = parseServerMessage({
      type: 'hello',
      transport: 'websocket',
      session_id: 'session-fixture-001',
      audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 },
    });

    expect(intendedHello).toMatchObject({
      type: 'hello', transport: 'websocket', audio_params: { sample_rate: 24000 },
    });
    expect(negotiatedHello).toMatchObject({
      type: 'hello', transport: 'websocket', audio_params: { sample_rate: 16000 },
    });
    expect(() => parseServerMessage({
      type: 'hello',
      transport: 'mqtt',
      session_id: 'session-fixture-001',
      audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 },
    })).toThrow(ProtocolValidationError);
  });

  it('validates listen mode, detection text, and abort reason fields', async () => {
    const [start, detect, abort] = await Promise.all([
      readFixture('listen-start.json'),
      readFixture('listen-detect.json'),
      readFixture('abort.json'),
    ]);

    expect(parseClientMessage(start)).toMatchObject({ type: 'listen', state: 'start', mode: 'auto' });
    expect(parseClientMessage(detect)).toMatchObject({
      type: 'listen', state: 'detect',
      text: 'Veetee',
    });
    expect(parseClientMessage(abort)).toMatchObject({
      type: 'abort',
      reason: 'wake_word_detected',
    });
    expect(() => parseClientMessage({ type: 'listen', state: 'start' })).toThrow(ProtocolValidationError);
    expect(() => parseClientMessage({ type: 'listen', state: 'detect', text: '' })).toThrow(
      ProtocolValidationError,
    );
  });

  it('requires sentence text and models LLM emotion, system commands, and alerts', async () => {
    const [sentence, llm, system, alert] = await Promise.all([
      readFixture('tts-sentence-start.json'),
      readFixture('llm.json'),
      readFixture('system.json'),
      readFixture('alert.json'),
    ]);

    expect(parseServerMessage(sentence)).toMatchObject({
      type: 'tts', state: 'sentence_start', text: 'Chào bạn!',
    });
    expect(parseServerMessage(llm)).toMatchObject({ type: 'llm', emotion: 'happy' });
    expect(parseServerMessage(system)).toMatchObject({ type: 'system', command: 'reboot' });
    expect(parseServerMessage(alert)).toMatchObject({
      type: 'alert', status: 'warning', emotion: 'concerned', message: 'Pin yếu',
    });

    expect(() => parseServerMessage({ type: 'tts', state: 'sentence_start' })).toThrow(
      ProtocolValidationError,
    );
    expect(() => parseServerMessage({ type: 'system', message: 'not a command' })).toThrow(
      ProtocolValidationError,
    );
    expect(() => parseServerMessage({ type: 'alert', message: 'incomplete' })).toThrow(
      ProtocolValidationError,
    );
  });

  it('accepts server-to-device MCP requests without transport session IDs and normalizes omitted list params', async () => {
    const initialRequest = parseServerMessage(await readFixture('mcp-tools-list-initial-request.json'));
    const continuationRequest = parseServerMessage(await readFixture('mcp-tools-list-page-request.json'));
    const userToolRequest = parseServerMessage(await readFixture('mcp-tools-list-user-request.json'));

    expect(initialRequest).toEqual(expect.objectContaining({ type: 'mcp' }));
    if (initialRequest.type !== 'mcp' || !('method' in initialRequest.payload)) {
      throw new Error('fixture must be a server MCP request');
    }
    expect(initialRequest.session_id).toBeUndefined();
    expect(initialRequest.payload).toMatchObject({ id: 2, method: 'tools/list', params: {} });

    if (continuationRequest.type !== 'mcp' || !('method' in continuationRequest.payload)) {
      throw new Error('fixture must be a server MCP continuation request');
    }
    expect(continuationRequest.payload).toMatchObject({
      id: 2,
      method: 'tools/list',
      params: { cursor: 'self.audio_speaker.set_volume' },
    });

    if (userToolRequest.type !== 'mcp' || !('method' in userToolRequest.payload)) {
      throw new Error('fixture must be a server user-tool MCP request');
    }
    expect(userToolRequest.payload).toMatchObject({
      id: 2,
      method: 'tools/list',
      params: { withUserTools: true },
    });
  });

  it('requires client-to-server MCP envelopes to carry a session and validates request/result shapes', async () => {
    const fixtureNames = [
      'mcp-initialize-result.json',
      'mcp-tools-list-initial-result.json',
      'mcp-tools-list-page-result.json',
      'mcp-tools-list-user-result.json',
      'mcp-tools-call-result.json',
    ];
    const fixtures = await Promise.all(fixtureNames.map(readFixture));

    for (const fixture of fixtures) {
      expect(parseClientMessage(fixture)).toMatchObject({ type: 'mcp', session_id: 'session-fixture-001' });
    }

    const initialListResult = parseClientMessage(fixtures[1]);
    if (initialListResult.type !== 'mcp' || !('result' in initialListResult.payload)
      || !('tools' in initialListResult.payload.result)) {
      throw new Error('fixture must contain a tools/list result');
    }
    expect(initialListResult.payload.id).toBe(2);
    expect(initialListResult.payload.result.nextCursor).toBe('self.audio_speaker.set_volume');

    const userListResult = parseClientMessage(fixtures[3]);
    if (userListResult.type !== 'mcp' || !('result' in userListResult.payload)
      || !('tools' in userListResult.payload.result)
      || !Array.isArray(userListResult.payload.result.tools)) {
      throw new Error('fixture must contain a user tools/list result');
    }
    expect(userListResult.payload.result.tools[0]).toMatchObject({
      annotations: { audience: ['user'] },
    });

    expect(() => parseClientMessage({
      type: 'mcp',
      payload: { jsonrpc: '2.0', id: 2, result: { tools: [] } },
    })).toThrow(ProtocolValidationError);

    const invalidPayloads = [
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { arguments: {} } },
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tool' } },
      { jsonrpc: '2.0', id: 2 ** 31, result: {} },
      { jsonrpc: '2.0', id: 1, result: {}, error: { message: 'both' } },
      { jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'tool' }] } },
    ];
    for (const payload of invalidPayloads) {
      expect(() => parseMcpEnvelope({ type: 'mcp', session_id: 'session-fixture-001', payload })).toThrow(
        ProtocolValidationError,
      );
    }
  });

  it('is a structural known-message type guard rather than a type-name check', () => {
    const valid = {
      type: 'listen', state: 'start', mode: 'manual', session_id: 'session-fixture-001', extra: true,
    };
    expect(isKnownTransportMessage(valid)).toBe(true);
    expect(isKnownTransportMessage({ type: 'listen' })).toBe(false);
    expect(isKnownTransportMessage({ type: 'tts', state: 'sentence_start' })).toBe(false);
    expect(isKnownTransportMessage({ type: 'mcp', payload: { jsonrpc: '2.0', id: 1 } })).toBe(false);

    const unknown = unknownTransportMessage({ type: 'future-message', secret: 'not logged' });
    expect(unknown).toEqual({ type: 'future-message', known: false });
  });
});
