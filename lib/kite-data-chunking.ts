export type KiteLoadIntervalFormat = "f32-interleaved";

export type KiteLoadIntervalChunkHeader = {
  type: "LOAD_INTERVAL";
  sessionId: string;
  intervalId: string;
  origin: string;
  format: KiteLoadIntervalFormat;
  channelCount: number;
  sampleRate: number;
  intervalFrames: number;
  chunkIndex: number;
  totalChunks: number;
  byteOffset: number;
  totalBytes: number;
};

export type KiteLoadIntervalChunk = KiteLoadIntervalChunkHeader & {
  payload: ArrayBuffer;
};

export type CreateLoadIntervalChunksOptions = {
  sessionId: string;
  intervalId: string;
  origin: string;
  channelCount: number;
  sampleRate: number;
  intervalFrames: number;
  buffer: Float32Array | ArrayBuffer;
  chunkSizeBytes?: number;
};

export type ReassembledLoadInterval = Omit<
  KiteLoadIntervalChunkHeader,
  "chunkIndex" | "totalChunks" | "byteOffset"
> & {
  totalChunks: number;
  payload: ArrayBuffer;
};

export type ReassemblyResult =
  | { status: "pending"; key: string; receivedChunks: number; totalChunks: number }
  | { status: "complete"; key: string; interval: ReassembledLoadInterval }
  | { status: "discarded"; key: string; reason: string };

export type ExpiredReassembly = {
  key: string;
  reason: "expired";
  missingChunkIndexes: number[];
};

export type ReassemblerOptions = {
  ttlMs?: number;
  maxTotalBytes?: number;
};

export type DataChannelSendOptions = {
  lowWatermarkBytes?: number;
  highWatermarkBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

const DEFAULT_CHUNK_SIZE_BYTES = 16 * 1024;
const HEADER_RESERVE_BYTES = 1024;
const DEFAULT_REASSEMBLY_TTL_MS = 30000;
const DEFAULT_MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const DEFAULT_LOW_WATERMARK_BYTES = 64 * 1024;
const DEFAULT_HIGH_WATERMARK_BYTES = 256 * 1024;
const DEFAULT_BACKPRESSURE_TIMEOUT_MS = 45000;
const BACKPRESSURE_POLL_INTERVAL_MS = 150;
const KITE_CHUNK_MAGIC = [75, 73, 84, 69] as const; // "KITE"
const KITE_CHUNK_HEADER_BYTES = 6;

type PendingInterval = {
  header: Omit<KiteLoadIntervalChunkHeader, "chunkIndex" | "byteOffset">;
  chunks: Map<number, KiteLoadIntervalChunk>;
  expiresAt: number;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function assertPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function assertNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return value;
}

function assertNonEmptyString(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function toArrayBuffer(buffer: Float32Array | ArrayBuffer): ArrayBuffer {
  if (buffer instanceof ArrayBuffer) return buffer;
  const copy = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(copy).set(new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength));
  return copy;
}

function toReadableArrayBuffer(data: unknown): ArrayBuffer | null {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    const copy = new ArrayBuffer(view.byteLength);
    new Uint8Array(copy).set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    return copy;
  }
  return null;
}

function reassemblyKey(chunk: Pick<KiteLoadIntervalChunkHeader, "sessionId" | "origin" | "intervalId">): string {
  return `${chunk.sessionId}:${chunk.origin}:${chunk.intervalId}`;
}

function validateChunkHeader(chunk: KiteLoadIntervalChunkHeader): void {
  if (chunk.type !== "LOAD_INTERVAL") {
    throw new Error("Kite interval chunk type must be LOAD_INTERVAL.");
  }
  assertNonEmptyString(chunk.sessionId, "sessionId");
  assertNonEmptyString(chunk.intervalId, "intervalId");
  assertNonEmptyString(chunk.origin, "origin");
  if (chunk.format !== "f32-interleaved") {
    throw new Error("Kite interval chunk format must be f32-interleaved.");
  }
  assertPositiveInteger(chunk.channelCount, "channelCount");
  assertPositiveInteger(chunk.sampleRate, "sampleRate");
  assertPositiveInteger(chunk.intervalFrames, "intervalFrames");
  assertNonNegativeInteger(chunk.chunkIndex, "chunkIndex");
  assertPositiveInteger(chunk.totalChunks, "totalChunks");
  assertNonNegativeInteger(chunk.byteOffset, "byteOffset");
  assertPositiveInteger(chunk.totalBytes, "totalBytes");
  if (chunk.chunkIndex >= chunk.totalChunks) {
    throw new Error("chunkIndex must be less than totalChunks.");
  }
}

function metadataMatches(
  existing: PendingInterval["header"],
  next: KiteLoadIntervalChunkHeader
): boolean {
  return (
    existing.type === next.type &&
    existing.sessionId === next.sessionId &&
    existing.intervalId === next.intervalId &&
    existing.origin === next.origin &&
    existing.format === next.format &&
    existing.channelCount === next.channelCount &&
    existing.sampleRate === next.sampleRate &&
    existing.intervalFrames === next.intervalFrames &&
    existing.totalChunks === next.totalChunks &&
    existing.totalBytes === next.totalBytes
  );
}

function payloadsMatch(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const av = new Uint8Array(a);
  const bv = new Uint8Array(b);
  for (let i = 0; i < av.length; i += 1) {
    if (av[i] !== bv[i]) return false;
  }
  return true;
}

function missingChunkIndexes(pending: PendingInterval): number[] {
  const missing: number[] = [];
  for (let index = 0; index < pending.header.totalChunks; index += 1) {
    if (!pending.chunks.has(index)) missing.push(index);
  }
  return missing;
}

export function createLoadIntervalChunks(
  options: CreateLoadIntervalChunksOptions
): KiteLoadIntervalChunk[] {
  const source = toArrayBuffer(options.buffer);
  const totalBytes = source.byteLength;
  if (totalBytes <= 0) {
    throw new Error("Kite interval payload must not be empty.");
  }

  const chunkSizeBytes = options.chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
  const payloadSizeBytes = chunkSizeBytes - KITE_CHUNK_HEADER_BYTES - HEADER_RESERVE_BYTES;
  if (payloadSizeBytes <= 0) {
    throw new Error("chunkSizeBytes is too small for Kite interval chunk headers.");
  }

  const totalChunks = Math.ceil(totalBytes / payloadSizeBytes);
  const baseHeader = {
    type: "LOAD_INTERVAL" as const,
    sessionId: assertNonEmptyString(options.sessionId, "sessionId"),
    intervalId: assertNonEmptyString(options.intervalId, "intervalId"),
    origin: assertNonEmptyString(options.origin, "origin"),
    format: "f32-interleaved" as const,
    channelCount: assertPositiveInteger(options.channelCount, "channelCount"),
    sampleRate: assertPositiveInteger(options.sampleRate, "sampleRate"),
    intervalFrames: assertPositiveInteger(options.intervalFrames, "intervalFrames"),
    totalChunks,
    totalBytes,
  };

  const chunks: KiteLoadIntervalChunk[] = [];
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const byteOffset = chunkIndex * payloadSizeBytes;
    const byteEnd = Math.min(totalBytes, byteOffset + payloadSizeBytes);
    const chunk = {
      ...baseHeader,
      chunkIndex,
      byteOffset,
      payload: source.slice(byteOffset, byteEnd),
    };
    validateChunkHeader(chunk);
    chunks.push(chunk);
  }

  return chunks;
}

export function encodeLoadIntervalChunk(chunk: KiteLoadIntervalChunk): ArrayBuffer {
  validateChunkHeader(chunk);
  const { payload, ...header } = chunk;
  const headerBytes = textEncoder.encode(JSON.stringify(header));
  if (headerBytes.byteLength > 0xffff) {
    throw new Error("Kite interval chunk header is too large.");
  }

  const frame = new ArrayBuffer(KITE_CHUNK_HEADER_BYTES + headerBytes.byteLength + payload.byteLength);
  const frameBytes = new Uint8Array(frame);
  frameBytes.set(KITE_CHUNK_MAGIC, 0);
  new DataView(frame).setUint16(4, headerBytes.byteLength, false);
  frameBytes.set(headerBytes, KITE_CHUNK_HEADER_BYTES);
  frameBytes.set(new Uint8Array(payload), KITE_CHUNK_HEADER_BYTES + headerBytes.byteLength);
  return frame;
}

export function decodeLoadIntervalChunk(data: unknown): KiteLoadIntervalChunk | null {
  const frame = toReadableArrayBuffer(data);
  if (!frame || frame.byteLength < KITE_CHUNK_HEADER_BYTES) return null;

  const frameBytes = new Uint8Array(frame);
  for (let i = 0; i < KITE_CHUNK_MAGIC.length; i += 1) {
    if (frameBytes[i] !== KITE_CHUNK_MAGIC[i]) return null;
  }

  const headerBytesLength = new DataView(frame).getUint16(4, false);
  const payloadOffset = KITE_CHUNK_HEADER_BYTES + headerBytesLength;
  if (payloadOffset > frame.byteLength) return null;

  const headerText = textDecoder.decode(frame.slice(KITE_CHUNK_HEADER_BYTES, payloadOffset));
  const header = JSON.parse(headerText) as KiteLoadIntervalChunkHeader;
  validateChunkHeader(header);

  return {
    ...header,
    payload: frame.slice(payloadOffset),
  };
}

export class KiteIntervalReassembler {
  private readonly ttlMs: number;
  private readonly maxTotalBytes: number;
  private readonly pending = new Map<string, PendingInterval>();

  constructor(options?: ReassemblerOptions) {
    this.ttlMs = options?.ttlMs ?? DEFAULT_REASSEMBLY_TTL_MS;
    this.maxTotalBytes = options?.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  }

  acceptChunk(chunk: KiteLoadIntervalChunk, nowMs = Date.now()): ReassemblyResult {
    this.cleanupExpired(nowMs);

    try {
      validateChunkHeader(chunk);
    } catch (error) {
      return {
        status: "discarded",
        key: reassemblyKey(chunk),
        reason: error instanceof Error ? error.message : "invalid chunk",
      };
    }

    const key = reassemblyKey(chunk);
    if (chunk.totalBytes > this.maxTotalBytes) {
      return { status: "discarded", key, reason: "payload exceeds maximum allowed size" };
    }
    if (chunk.payload.byteLength <= 0) {
      return { status: "discarded", key, reason: "chunk payload is empty" };
    }

    const existing = this.pending.get(key);
    if (existing && !metadataMatches(existing.header, chunk)) {
      this.pending.delete(key);
      return { status: "discarded", key, reason: "chunk metadata conflict" };
    }

    const pending =
      existing ??
      ({
        header: {
          type: chunk.type,
          sessionId: chunk.sessionId,
          intervalId: chunk.intervalId,
          origin: chunk.origin,
          format: chunk.format,
          channelCount: chunk.channelCount,
          sampleRate: chunk.sampleRate,
          intervalFrames: chunk.intervalFrames,
          totalChunks: chunk.totalChunks,
          totalBytes: chunk.totalBytes,
        },
        chunks: new Map<number, KiteLoadIntervalChunk>(),
        expiresAt: nowMs + Math.max(this.ttlMs, chunk.totalBytes / 100),
      } satisfies PendingInterval);

    const duplicate = pending.chunks.get(chunk.chunkIndex);
    if (duplicate) {
      if (!payloadsMatch(duplicate.payload, chunk.payload) || duplicate.byteOffset !== chunk.byteOffset) {
        this.pending.delete(key);
        return { status: "discarded", key, reason: "duplicate chunk conflict" };
      }
      return {
        status: "pending",
        key,
        receivedChunks: pending.chunks.size,
        totalChunks: pending.header.totalChunks,
      };
    }

    pending.chunks.set(chunk.chunkIndex, chunk);
    pending.expiresAt = nowMs + Math.max(this.ttlMs, pending.header.totalBytes / 100);
    this.pending.set(key, pending);

    if (pending.chunks.size !== pending.header.totalChunks) {
      return {
        status: "pending",
        key,
        receivedChunks: pending.chunks.size,
        totalChunks: pending.header.totalChunks,
      };
    }

    const assembled = this.assemblePendingInterval(key, pending);
    if (!assembled) {
      this.pending.delete(key);
      return { status: "discarded", key, reason: "chunk sequence is incomplete or non-contiguous" };
    }

    this.pending.delete(key);
    return { status: "complete", key, interval: assembled };
  }

  cleanupExpired(nowMs = Date.now()): ExpiredReassembly[] {
    const expired: ExpiredReassembly[] = [];
    for (const [key, pending] of Array.from(this.pending.entries())) {
      const dynamicTtlMs = Math.max(this.ttlMs, pending.header.totalBytes / 100);
      const newestChunkAtMs = pending.expiresAt - dynamicTtlMs;
      if (newestChunkAtMs + dynamicTtlMs > nowMs) continue;
      expired.push({
        key,
        reason: "expired",
        missingChunkIndexes: missingChunkIndexes(pending),
      });
      this.pending.delete(key);
    }
    return expired;
  }

  clearReassemblyState(): void {
    this.pending.clear();
  }

  private assemblePendingInterval(
    key: string,
    pending: PendingInterval
  ): ReassembledLoadInterval | null {
    let byteOffset = 0;
    const assembled = new Uint8Array(pending.header.totalBytes);

    for (let index = 0; index < pending.header.totalChunks; index += 1) {
      const chunk = pending.chunks.get(index);
      if (!chunk || chunk.byteOffset !== byteOffset) return null;

      const payload = new Uint8Array(chunk.payload);
      if (byteOffset + payload.byteLength > assembled.byteLength) return null;
      assembled.set(payload, byteOffset);
      byteOffset += payload.byteLength;
    }

    if (byteOffset !== pending.header.totalBytes) {
      return null;
    }

    return {
      type: pending.header.type,
      sessionId: pending.header.sessionId,
      intervalId: pending.header.intervalId,
      origin: pending.header.origin,
      format: pending.header.format,
      channelCount: pending.header.channelCount,
      sampleRate: pending.header.sampleRate,
      intervalFrames: pending.header.intervalFrames,
      totalBytes: pending.header.totalBytes,
      totalChunks: pending.header.totalChunks,
      payload: assembled.buffer,
    };
  }
}

function waitForBufferedAmountLow(
  channel: RTCDataChannel,
  options: Required<DataChannelSendOptions>
): Promise<void> {
  if (channel.readyState !== "open") {
    return Promise.reject(new Error("RTCDataChannel is not open."));
  }
  if (channel.bufferedAmount <= options.lowWatermarkBytes) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let pollIntervalId: ReturnType<typeof setInterval> | null = null;

    const cleanup = (): void => {
      channel.removeEventListener("bufferedamountlow", handleLow);
      channel.removeEventListener("close", handleClose);
      options.signal.removeEventListener("abort", handleAbort);
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (pollIntervalId !== null) clearInterval(pollIntervalId);
    };
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const handleLow = (): void => settle(resolve);
    const handleClose = (): void =>
      settle(() => reject(new Error("RTCDataChannel closed during backpressure wait.")));
    const handleAbort = (): void =>
      settle(() => reject(options.signal.reason ?? new Error("Kite chunk send aborted.")));
    const checkBufferedAmount = (): void => {
      if (channel.readyState !== "open") {
        handleClose();
        return;
      }
      if (channel.bufferedAmount <= options.lowWatermarkBytes) {
        settle(resolve);
      }
    };

    channel.addEventListener("bufferedamountlow", handleLow);
    channel.addEventListener("close", handleClose);
    options.signal.addEventListener("abort", handleAbort);
    pollIntervalId = setInterval(checkBufferedAmount, BACKPRESSURE_POLL_INTERVAL_MS);
    timeoutId = setTimeout(() => {
      settle(() => reject(new Error("Timed out waiting for RTCDataChannel backpressure.")));
    }, options.timeoutMs);
  });
}

export class KiteDataChannelChunkSender {
  private readonly channel: RTCDataChannel;
  private activeAbortController: AbortController | null = null;

  constructor(channel: RTCDataChannel) {
    this.channel = channel;
  }

  async sendChunks(
    chunks: KiteLoadIntervalChunk[],
    options?: DataChannelSendOptions
  ): Promise<void> {
    this.abortPendingSends();
    const abortController = new AbortController();
    this.activeAbortController = abortController;

    const sendOptions: Required<DataChannelSendOptions> = {
      lowWatermarkBytes: options?.lowWatermarkBytes ?? DEFAULT_LOW_WATERMARK_BYTES,
      highWatermarkBytes: options?.highWatermarkBytes ?? DEFAULT_HIGH_WATERMARK_BYTES,
      timeoutMs: options?.timeoutMs ?? DEFAULT_BACKPRESSURE_TIMEOUT_MS,
      signal: abortController.signal,
    };

    if (options?.signal) {
      if (options.signal.aborted) {
        abortController.abort(options.signal.reason);
      } else {
        options.signal.addEventListener(
          "abort",
          () => abortController.abort(options.signal?.reason),
          { once: true }
        );
      }
    }

    try {
      this.channel.bufferedAmountLowThreshold = sendOptions.lowWatermarkBytes;
      for (const chunk of chunks) {
        if (abortController.signal.aborted) {
          throw abortController.signal.reason ?? new Error("Kite chunk send aborted.");
        }
        if (this.channel.readyState !== "open") {
          throw new Error("RTCDataChannel is not open.");
        }
        if (this.channel.bufferedAmount > sendOptions.highWatermarkBytes) {
          await waitForBufferedAmountLow(this.channel, sendOptions);
        }
        this.channel.send(encodeLoadIntervalChunk(chunk));
      }
      if (this.channel.bufferedAmount > sendOptions.highWatermarkBytes) {
        await waitForBufferedAmountLow(this.channel, sendOptions);
      }
    } finally {
      if (this.activeAbortController === abortController) {
        this.activeAbortController = null;
      }
    }
  }

  abortPendingSends(reason = "Kite chunk send aborted."): void {
    if (!this.activeAbortController) return;
    this.activeAbortController.abort(new Error(reason));
    this.activeAbortController = null;
  }
}
