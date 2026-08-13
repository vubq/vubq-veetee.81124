import { FrameCodecError } from './errors.js';
import type {
  DecodedFrame,
  FrameLimits,
  FrameType,
  V2FrameMetadata,
  V3FrameMetadata,
} from './types.js';

export const MAX_FRAME_PAYLOAD_BYTES = 1024 * 1024;
export const V2_HEADER_BYTES = 16;
export const V3_HEADER_BYTES = 4;
const V3_WIRE_MAX_PAYLOAD_BYTES = 0xffff;

export interface RawOpusV1FrameAdapter {
  readonly version: 1;
  encode(payload: Uint8Array, limits?: FrameLimits): Uint8Array;
  decode(frame: Uint8Array, limits?: FrameLimits): Uint8Array;
}

export interface ReservedV2FrameAdapter {
  readonly version: 2;
  encode(payload: Uint8Array, metadata: V2FrameMetadata, limits?: FrameLimits): Uint8Array;
  decode(frame: Uint8Array, limits?: FrameLimits): DecodedFrame<V2FrameMetadata>;
}

export interface ReservedV3FrameAdapter {
  readonly version: 3;
  encode(payload: Uint8Array, metadata: V3FrameMetadata, limits?: FrameLimits): Uint8Array;
  decode(frame: Uint8Array, limits?: FrameLimits): DecodedFrame<V3FrameMetadata>;
}

export type FrameVersion = 1 | 2 | 3;
export type FrameAdapter = RawOpusV1FrameAdapter | ReservedV2FrameAdapter | ReservedV3FrameAdapter;

function maximumPayloadBytes(limits: FrameLimits | undefined, wireMaximum: number): number {
  const configuredMaximum = limits?.maxPayloadBytes ?? MAX_FRAME_PAYLOAD_BYTES;
  if (!Number.isSafeInteger(configuredMaximum) || configuredMaximum < 1) {
    throw new FrameCodecError('maxPayloadBytes must be a positive safe integer');
  }
  return Math.min(configuredMaximum, wireMaximum);
}

function requireBytes(value: Uint8Array, path: string, limits: FrameLimits | undefined, wireMaximum: number): void {
  if (!(value instanceof Uint8Array)) {
    throw new FrameCodecError(`${path} must be a Uint8Array`);
  }
  if (value.byteLength === 0) {
    throw new FrameCodecError(`${path} must not be empty`);
  }
  if (value.byteLength > maximumPayloadBytes(limits, wireMaximum)) {
    throw new FrameCodecError(`${path} exceeds the maximum payload length`);
  }
}

/** Copies exactly the visible bytes, including for Buffer views with a larger backing ArrayBuffer. */
function copyBytes(value: Uint8Array): Uint8Array {
  return Uint8Array.from(value);
}

function requireUint32(value: number, path: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new FrameCodecError(`${path} must be an unsigned 32-bit integer`);
  }
}

function requireFrameType(value: unknown, path: string): asserts value is FrameType {
  if (value !== 0 && value !== 1) {
    throw new FrameCodecError(`${path} must be 0 (Opus) or 1 (JSON)`);
  }
}

function requireFrame(value: Uint8Array): void {
  if (!(value instanceof Uint8Array)) {
    throw new FrameCodecError('frame must be a Uint8Array');
  }
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

export const rawOpusV1FrameAdapter: RawOpusV1FrameAdapter = Object.freeze({
  version: 1 as const,
  encode(payload: Uint8Array, limits?: FrameLimits): Uint8Array {
    requireBytes(payload, 'v1 payload', limits, MAX_FRAME_PAYLOAD_BYTES);
    return copyBytes(payload);
  },
  decode(frame: Uint8Array, limits?: FrameLimits): Uint8Array {
    requireBytes(frame, 'v1 frame', limits, MAX_FRAME_PAYLOAD_BYTES);
    return copyBytes(frame);
  },
});

/** Firmware BinaryProtocol2: uint16 version/type, uint32 reserved/timestamp/payload_size. */
export const reservedV2FrameAdapter: ReservedV2FrameAdapter = Object.freeze({
  version: 2 as const,
  encode(payload: Uint8Array, metadata: V2FrameMetadata, limits?: FrameLimits): Uint8Array {
    requireBytes(payload, 'v2 payload', limits, MAX_FRAME_PAYLOAD_BYTES);
    if (metadata === undefined || metadata === null || typeof metadata !== 'object') {
      throw new FrameCodecError('v2 metadata must be an object');
    }
    requireFrameType(metadata.type, 'v2 metadata.type');
    requireUint32(metadata.timestamp, 'v2 metadata.timestamp');

    const frame = new Uint8Array(V2_HEADER_BYTES + payload.byteLength);
    const view = new DataView(frame.buffer);
    view.setUint16(0, 2, false);
    view.setUint16(2, metadata.type, false);
    view.setUint32(4, 0, false);
    view.setUint32(8, metadata.timestamp, false);
    view.setUint32(12, payload.byteLength, false);
    frame.set(payload, V2_HEADER_BYTES);
    return frame;
  },
  decode(frame: Uint8Array, limits?: FrameLimits): DecodedFrame<V2FrameMetadata> {
    requireFrame(frame);
    if (frame.byteLength < V2_HEADER_BYTES) {
      throw new FrameCodecError('v2 frame is shorter than its header');
    }

    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    if (view.getUint16(0, false) !== 2) {
      throw new FrameCodecError('v2 frame has an invalid version');
    }
    const type = view.getUint16(2, false);
    requireFrameType(type, 'v2 frame type');
    if (readUint32(view, 4) !== 0) {
      throw new FrameCodecError('v2 frame has non-zero reserved bytes');
    }

    const payloadLength = readUint32(view, 12);
    if (payloadLength === 0 || payloadLength > maximumPayloadBytes(limits, MAX_FRAME_PAYLOAD_BYTES)) {
      throw new FrameCodecError('v2 frame declares an invalid payload length');
    }
    if (frame.byteLength !== V2_HEADER_BYTES + payloadLength) {
      throw new FrameCodecError('v2 frame length does not match its header');
    }

    return {
      payload: copyBytes(frame.subarray(V2_HEADER_BYTES)),
      metadata: {
        type,
        timestamp: readUint32(view, 8),
      },
    };
  },
});

/** Firmware BinaryProtocol3: uint8 type/reserved, uint16 payload_size. */
export const reservedV3FrameAdapter: ReservedV3FrameAdapter = Object.freeze({
  version: 3 as const,
  encode(payload: Uint8Array, metadata: V3FrameMetadata, limits?: FrameLimits): Uint8Array {
    requireBytes(payload, 'v3 payload', limits, V3_WIRE_MAX_PAYLOAD_BYTES);
    if (metadata === undefined || metadata === null || typeof metadata !== 'object') {
      throw new FrameCodecError('v3 metadata must be an object');
    }
    requireFrameType(metadata.type, 'v3 metadata.type');

    const frame = new Uint8Array(V3_HEADER_BYTES + payload.byteLength);
    const view = new DataView(frame.buffer);
    view.setUint8(0, metadata.type);
    view.setUint8(1, 0);
    view.setUint16(2, payload.byteLength, false);
    frame.set(payload, V3_HEADER_BYTES);
    return frame;
  },
  decode(frame: Uint8Array, limits?: FrameLimits): DecodedFrame<V3FrameMetadata> {
    requireFrame(frame);
    if (frame.byteLength < V3_HEADER_BYTES) {
      throw new FrameCodecError('v3 frame is shorter than its header');
    }

    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    const type = view.getUint8(0);
    requireFrameType(type, 'v3 frame type');
    if (view.getUint8(1) !== 0) {
      throw new FrameCodecError('v3 frame has non-zero reserved bytes');
    }
    const payloadLength = view.getUint16(2, false);
    if (payloadLength === 0 || payloadLength > maximumPayloadBytes(limits, V3_WIRE_MAX_PAYLOAD_BYTES)) {
      throw new FrameCodecError('v3 frame declares an invalid payload length');
    }
    if (frame.byteLength !== V3_HEADER_BYTES + payloadLength) {
      throw new FrameCodecError('v3 frame length does not match its header');
    }

    return {
      payload: copyBytes(frame.subarray(V3_HEADER_BYTES)),
      metadata: { type },
    };
  },
});

export function frameAdapterForVersion(version: FrameVersion): FrameAdapter {
  switch (version) {
    case 1:
      return rawOpusV1FrameAdapter;
    case 2:
      return reservedV2FrameAdapter;
    case 3:
      return reservedV3FrameAdapter;
    default:
      throw new FrameCodecError(`unsupported frame version: ${String(version)}`);
  }
}
