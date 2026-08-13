import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ActivationCodeError,
  ProtocolValidationError,
  parseActivationPollRequest,
  parseActivationPollResponse,
  parseBootstrapRequest,
  parseBootstrapResponse,
  validateActivationCode,
} from '../src/index.js';

const V1_DEVICE_ID = '00:11:22:33:44:55';
const V1_CLIENT_ID = '00000000-0000-4000-8000-000000000001';
const V2_DEVICE_ID = '66:77:88:99:aa:bb';
const V2_CLIENT_ID = '00000000-0000-4000-8000-000000000002';
const V2_SERIAL_NUMBER = 'SN-VEETEE-0002';
const V2_HMAC = '4d4d2f6eec66b9e06acaa3b49470a7713ac18fead421940b2d97bfe0ef6e0be5';

async function readFixture(name: string): Promise<unknown> {
  const path = fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

describe('OTA bootstrap contracts', () => {
  it('parses the literal firmware-shaped v1 bootstrap request and normalizes lowercase HTTP headers', async () => {
    const fixture = await readFixture('bootstrap-request.json') as {
      headers: Record<string, unknown>;
      body: Record<string, unknown>;
    };
    const lowerCaseHeaders = Object.fromEntries(
      Object.entries(fixture.headers).map(([key, value]) => [key.toLowerCase(), value]),
    );

    const request = parseBootstrapRequest({
      headers: lowerCaseHeaders,
      body: { ...fixture.body, future_capability: 'accepted' },
    });

    expect(request.headers).toEqual({
      'Activation-Version': '1',
      'Device-Id': V1_DEVICE_ID,
      'Client-Id': V1_CLIENT_ID,
      'User-Agent': 'veetee-device-simulator/0.1.0',
      'Accept-Language': 'vi-VN',
      'Content-Type': 'application/json',
    });
    expect(request.body).toMatchObject({
      version: 2,
      mac_address: V1_DEVICE_ID,
      uuid: V1_CLIENT_ID,
      application: { version: '0.1.0' },
      board: { type: 'veetee-simulator' },
      future_capability: 'accepted',
    });
  });

  it('requires firmware application and board metadata while preserving additive body fields', () => {
    const headers = {
      'Activation-Version': '1',
      'Device-Id': V1_DEVICE_ID,
      'Client-Id': V1_CLIENT_ID,
      'User-Agent': 'veetee-device-simulator/0.1.0',
      'Accept-Language': 'vi-VN',
      'Content-Type': 'application/json',
    };

    expect(parseBootstrapRequest({
      headers,
      body: {
        application: { version: '0.1.0', additive_application_field: true },
        board: { type: 'veetee-simulator', additive_board_field: 'accepted' },
        additive_body_field: { accepted: true },
      },
    }).body).toEqual({
      application: { version: '0.1.0', additive_application_field: true },
      board: { type: 'veetee-simulator', additive_board_field: 'accepted' },
      additive_body_field: { accepted: true },
    });

    const invalidBodies: Array<{ label: string; body: unknown }> = [
      { label: 'empty body', body: {} },
      { label: 'missing application object', body: { board: { type: 'veetee-simulator' } } },
      { label: 'malformed application object', body: { application: [], board: { type: 'veetee-simulator' } } },
      { label: 'missing board object', body: { application: { version: '0.1.0' } } },
      { label: 'malformed board object', body: { application: { version: '0.1.0' }, board: null } },
      { label: 'missing application version', body: { application: {}, board: { type: 'veetee-simulator' } } },
      { label: 'empty application version', body: { application: { version: '' }, board: { type: 'veetee-simulator' } } },
      { label: 'non-string application version', body: { application: { version: 1 }, board: { type: 'veetee-simulator' } } },
      { label: 'missing board type', body: { application: { version: '0.1.0' }, board: {} } },
      { label: 'empty board type', body: { application: { version: '0.1.0' }, board: { type: '' } } },
      { label: 'non-string board type', body: { application: { version: '0.1.0' }, board: { type: false } } },
    ];
    for (const { label, body } of invalidBodies) {
      expect(() => parseBootstrapRequest({ headers, body }), label).toThrow(ProtocolValidationError);
    }
  });

  it('enforces the firmware activation-version and serial-number relationship', () => {
    expect(() => parseBootstrapRequest({
      headers: {
        'Activation-Version': '1',
        'Device-Id': V1_DEVICE_ID,
        'Client-Id': V1_CLIENT_ID,
        'Serial-Number': V2_SERIAL_NUMBER,
        'User-Agent': 'veetee-device-simulator/0.1.0',
        'Accept-Language': 'vi-VN',
        'Content-Type': 'application/json',
      },
      body: {
        application: { version: '0.1.0' },
        board: { type: 'veetee-simulator' },
      },
    })).toThrow(ProtocolValidationError);

    expect(() => parseBootstrapRequest({
      headers: {
        'Activation-Version': '2',
        'Device-Id': V2_DEVICE_ID,
        'Client-Id': V2_CLIENT_ID,
        'User-Agent': 'veetee-device-simulator/0.1.0',
        'Accept-Language': 'vi-VN',
        'Content-Type': 'application/json',
      },
      body: {
        application: { version: '0.1.0' },
        board: { type: 'veetee-simulator' },
      },
    })).toThrow(ProtocolValidationError);

    expect(() => parseBootstrapRequest({
      headers: {
        'Activation-Version': '1',
        'Device-Id': 'not-a-mac-address',
        'Client-Id': V1_CLIENT_ID,
        'User-Agent': 'veetee-device-simulator/0.1.0',
        'Accept-Language': 'vi-VN',
        'Content-Type': 'application/json',
      },
      body: {
        application: { version: '0.1.0' },
        board: { type: 'veetee-simulator' },
      },
    })).toThrow(ProtocolValidationError);
  });

  it('models literal v1 and v2 activation wire bodies and constrains the optional HMAC', async () => {
    const [v1Fixture, v2Fixture] = await Promise.all([
      readFixture('activation-v1-request.json'),
      readFixture('activation-v2-request.json'),
    ]);

    expect(parseActivationPollRequest(v1Fixture)).toEqual({
      headers: {
        'Activation-Version': '1',
        'Device-Id': V1_DEVICE_ID,
        'Client-Id': V1_CLIENT_ID,
      },
      body: {},
    });
    expect(parseActivationPollRequest(v2Fixture)).toEqual({
      headers: {
        'Activation-Version': '2',
        'Device-Id': V2_DEVICE_ID,
        'Client-Id': V2_CLIENT_ID,
        'Serial-Number': V2_SERIAL_NUMBER,
      },
      body: {
        algorithm: 'hmac-sha256',
        serial_number: V2_SERIAL_NUMBER,
        challenge: 'opaque-challenge-fixture',
        hmac: V2_HMAC,
      },
    });

    expect(parseActivationPollRequest({
      headers: {
        'activation-version': '2',
        'device-id': V2_DEVICE_ID,
        'client-id': V2_CLIENT_ID,
        'serial-number': V2_SERIAL_NUMBER,
      },
      body: {
        algorithm: 'hmac-sha256',
        serial_number: V2_SERIAL_NUMBER,
        challenge: 'opaque-challenge-fixture',
        hmac: '',
      },
    }).body.hmac).toBe('');

    for (const hmac of ['not-a-digest', V2_HMAC.toUpperCase(), '0'.repeat(63)]) {
      expect(() => parseActivationPollRequest({
        headers: {
          'Activation-Version': '2',
          'Device-Id': V2_DEVICE_ID,
          'Client-Id': V2_CLIENT_ID,
          'Serial-Number': V2_SERIAL_NUMBER,
        },
        body: {
          algorithm: 'hmac-sha256',
          serial_number: V2_SERIAL_NUMBER,
          challenge: 'opaque-challenge-fixture',
          hmac,
        },
      })).toThrow(ProtocolValidationError);
    }

    expect(() => parseActivationPollRequest({
      headers: {
        'Activation-Version': '1',
        'Device-Id': V1_DEVICE_ID,
        'Client-Id': V1_CLIENT_ID,
      },
      body: { challenge: 'synthetic', code: '123456' },
    })).toThrow(ProtocolValidationError);
  });

  it('defaults omitted pairing timeout to the firmware default without mixing pairing code and activation body', async () => {
    const pairing = parseBootstrapResponse(await readFixture('bootstrap-pairing-response.json'));

    expect(pairing.activation).toEqual(expect.objectContaining({
      message: 'Mã ghép nối Veetee: 123456',
      code: '123456',
      challenge: 'opaque-challenge-fixture',
      timeout_ms: 30000,
    }));
    expect(() => validateActivationCode('１２３４５６')).toThrow(ActivationCodeError);
    expect(() => validateActivationCode('12345')).toThrow(ActivationCodeError);
  });

  it('parses literal activation success text and empty HTTP bodies', async () => {
    expect(parseActivationPollResponse(await readFixture('activation-pending-response.json'))).toEqual({
      status: 202,
      body: '',
    });
    expect(parseActivationPollResponse(await readFixture('activation-claimed-response.json'))).toEqual({
      status: 200,
      body: 'success',
    });
    expect(parseActivationPollResponse({ status: 200, body: {} })).toEqual({ status: 200, body: {} });
    expect(parseActivationPollResponse({ status: 200 })).toEqual({ status: 200, body: '' });
    expect(() => parseActivationPollResponse({ status: 201, body: {} })).toThrow(
      ProtocolValidationError,
    );
  });

  it('accepts object server time and defaults an omitted websocket version to v1', async () => {
    const fixture = await readFixture('bootstrap-websocket-response.json');
    const response = parseBootstrapResponse({
      ...fixture as Record<string, unknown>,
      additive_field: { supported: true },
    });

    expect(response.server_time).toEqual({ timestamp: 1735689600000, timezone_offset: 420 });
    expect(response.websocket).toEqual(expect.objectContaining({
      url: 'wss://simulator.invalid/ws/v1',
      token: 'fixture-device-token',
      version: 1,
    }));
    expect(response.additive_field).toEqual({ supported: true });

    expect(parseBootstrapResponse({
      websocket: { url: 'wss://simulator.invalid/ws/v2', token: 'fixture-token', version: 2 },
    }).websocket?.version).toBe(2);
    expect(() => parseBootstrapResponse({ server_time: 1735689600000 })).toThrow(
      ProtocolValidationError,
    );
  });

  it('rejects ambiguous MQTT and direct WebSocket selection', () => {
    expect(() => parseBootstrapResponse({
      websocket: { url: 'wss://simulator.invalid/ws/v1', token: 'fixture-token' },
      mqtt: { endpoint: 'mqtts://simulator.invalid' },
    })).toThrow(ProtocolValidationError);
  });
});
