import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  FrameCodecError,
  rawOpusV1FrameAdapter,
  reservedV2FrameAdapter,
  reservedV3FrameAdapter,
} from '../src/index.js';

async function readBinaryFixture(name: string): Promise<Uint8Array> {
  const path = fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
  return new Uint8Array(await readFile(path));
}

describe('binary frame adapters', () => {
  it('keeps v1 as a copied raw Opus packet without a transport header', async () => {
    const opusPacket = await readBinaryFixture('v1-opus-packet.bin');
    const encoded = rawOpusV1FrameAdapter.encode(opusPacket);
    const decoded = rawOpusV1FrameAdapter.decode(encoded);

    expect(opusPacket).not.toEqual(Uint8Array.from([0x4f, 0x70, 0x75, 0x73]));
    expect(encoded).toEqual(opusPacket);
    expect(decoded).toEqual(opusPacket);
    expect(encoded).not.toBe(opusPacket);
    expect(decoded).not.toBe(encoded);
  });

  it('does not alias Node Buffer backing storage on v1 encode or decode', () => {
    const source = Buffer.from([0x58, 0xe0, 0xb8, 0x80]);
    const encoded = rawOpusV1FrameAdapter.encode(source);
    source[0] = 0;
    expect(encoded[0]).toBe(0x58);

    const decoded = rawOpusV1FrameAdapter.decode(encoded);
    encoded[1] = 0;
    expect(decoded[1]).toBe(0xe0);
  });

  it('does not alias Uint8Array backing storage on v2 and v3 encode or decode', () => {
    const v2Payload = Uint8Array.from([1, 2, 3]);
    const v2Encoded = reservedV2FrameAdapter.encode(v2Payload, { type: 0, timestamp: 9 });
    v2Payload[0] = 99;
    expect(v2Encoded.slice(16)).toEqual(Uint8Array.from([1, 2, 3]));
    const v2Decoded = reservedV2FrameAdapter.decode(v2Encoded);
    v2Encoded[16] = 88;
    expect(v2Decoded.payload[0]).toBe(1);

    const v3Payload = Uint8Array.from([4, 5, 6]);
    const v3Encoded = reservedV3FrameAdapter.encode(v3Payload, { type: 0 });
    v3Payload[0] = 99;
    expect(v3Encoded.slice(4)).toEqual(Uint8Array.from([4, 5, 6]));
    const v3Decoded = reservedV3FrameAdapter.decode(v3Encoded);
    v3Encoded[4] = 88;
    expect(v3Decoded.payload[0]).toBe(4);
  });

  it('encodes the pinned v2 binary layout in network byte order', () => {
    const payload = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);

    const encoded = reservedV2FrameAdapter.encode(payload, { type: 0, timestamp: 0x01020304 });

    expect(encoded).toEqual(Uint8Array.from([
      0x00, 0x02, // uint16 version
      0x00, 0x00, // uint16 type (Opus)
      0x00, 0x00, 0x00, 0x00, // uint32 reserved
      0x01, 0x02, 0x03, 0x04, // uint32 timestamp
      0x00, 0x00, 0x00, 0x04, // uint32 payload size
      0xde, 0xad, 0xbe, 0xef,
    ]));
    expect(reservedV2FrameAdapter.decode(encoded)).toEqual({
      payload,
      metadata: { type: 0, timestamp: 0x01020304 },
    });
  });

  it('decodes an independently authored v2 wire fixture without magic or sequence fields', () => {
    const wireFixture = Uint8Array.from([
      0x00, 0x02, 0x00, 0x01,
      0x00, 0x00, 0x00, 0x00,
      0x11, 0x22, 0x33, 0x44,
      0x00, 0x00, 0x00, 0x03,
      0x7f, 0x45, 0x33,
    ]);

    expect(reservedV2FrameAdapter.decode(wireFixture)).toEqual({
      payload: Uint8Array.from([0x7f, 0x45, 0x33]),
      metadata: { type: 1, timestamp: 0x11223344 },
    });
  });

  it('encodes the pinned v3 binary layout in network byte order', () => {
    const payload = Uint8Array.from([5, 6, 7]);

    const encoded = reservedV3FrameAdapter.encode(payload, { type: 0 });

    expect(encoded).toEqual(Uint8Array.from([0x00, 0x00, 0x00, 0x03, 5, 6, 7]));
    expect(reservedV3FrameAdapter.decode(encoded)).toEqual({
      payload,
      metadata: { type: 0 },
    });
  });

  it('decodes an independently authored v3 JSON wire fixture', () => {
    const wireFixture = Uint8Array.from([0x01, 0x00, 0x00, 0x02, 0x7b, 0x7d]);

    expect(reservedV3FrameAdapter.decode(wireFixture)).toEqual({
      payload: Uint8Array.from([0x7b, 0x7d]),
      metadata: { type: 1 },
    });
  });

  it('rejects invalid version, reserved bytes, types, lengths, and configured bounds', () => {
    expect(() => reservedV2FrameAdapter.decode(Uint8Array.from([0x00]))).toThrow(FrameCodecError);
    expect(() => reservedV2FrameAdapter.decode(Uint8Array.from([
      0x00, 0x03, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]))).toThrow(FrameCodecError);
    expect(() => reservedV2FrameAdapter.decode(Uint8Array.from([
      0x00, 0x02, 0x00, 0x00, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0,
    ]))).toThrow(FrameCodecError);
    expect(() => reservedV2FrameAdapter.decode(Uint8Array.from([
      0x00, 0x02, 0x00, 0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]))).toThrow(FrameCodecError);
    expect(() => reservedV3FrameAdapter.decode(Uint8Array.from([0x00, 0x01, 0x00, 0x01, 0]))).toThrow(
      FrameCodecError,
    );
    expect(() => reservedV3FrameAdapter.encode(new Uint8Array(6), { type: 0 }, { maxPayloadBytes: 5 })).toThrow(
      FrameCodecError,
    );
    expect(() => reservedV3FrameAdapter.encode(new Uint8Array(65536), { type: 0 })).toThrow(
      FrameCodecError,
    );
  });
});
