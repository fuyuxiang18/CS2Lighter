import { createHash } from 'node:crypto';
import type { EvidenceFrameChunk } from './evidence-protocol';

const chunkBytes = 256 * 1024;
const maximumFrameBytes = 16 * 1024 * 1024;
type PendingFrame = { first: EvidenceFrameChunk; nextIndex: number; buffers: Buffer[] };

/** Chunks never become partial entity snapshots or alter complete/delta semantics. */
export class EvidenceFrameAssembler {
  private pending: PendingFrame | undefined;

  assertIdle() {
    if (this.pending) throw new Error('Death evidence frame chunks are incomplete or interrupted');
  }

  accept(message: EvidenceFrameChunk): unknown {
    const integer = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    if (
      !integer(message.frame) ||
      !integer(message.tick) ||
      message.id !== `${message.frame}:${message.tick}` ||
      !integer(message.bytes) ||
      message.bytes === 0 ||
      message.bytes > maximumFrameBytes ||
      !integer(message.index) ||
      !integer(message.count) ||
      message.count !== Math.ceil(message.bytes / chunkBytes) ||
      message.index >= message.count ||
      typeof message.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(message.sha256) ||
      typeof message.dataBase64 !== 'string' ||
      message.dataBase64.length === 0 ||
      message.dataBase64.length > Math.ceil(chunkBytes / 3) * 4 ||
      message.dataBase64.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(message.dataBase64)
    )
      throw new Error('Invalid death evidence frame chunk');
    if (!this.pending) {
      if (message.index !== 0) throw new Error('Death evidence frame chunks must start at zero');
      this.pending = { first: message, nextIndex: 0, buffers: [] };
    }
    const pending = this.pending;
    if (
      message.index !== pending.nextIndex ||
      message.id !== pending.first.id ||
      message.frame !== pending.first.frame ||
      message.tick !== pending.first.tick ||
      message.bytes !== pending.first.bytes ||
      message.count !== pending.first.count ||
      message.sha256 !== pending.first.sha256
    )
      throw new Error('Death evidence frame chunks are reordered or inconsistent');
    const decoded = Buffer.from(message.dataBase64, 'base64');
    const expectedBytes = Math.min(chunkBytes, message.bytes - message.index * chunkBytes);
    if (decoded.length !== expectedBytes || decoded.toString('base64') !== message.dataBase64)
      throw new Error('Death evidence frame chunk length or encoding is invalid');
    pending.buffers.push(decoded);
    pending.nextIndex++;
    if (pending.nextIndex !== message.count) return undefined;
    this.pending = undefined;
    const bytes = Buffer.concat(pending.buffers, message.bytes);
    if (createHash('sha256').update(bytes).digest('hex') !== message.sha256)
      throw new Error('Death evidence frame checksum mismatch');
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error('Invalid death evidence frame UTF-8');
    const frame: unknown = JSON.parse(text);
    if (
      !frame ||
      typeof frame !== 'object' ||
      !('type' in frame) ||
      frame.type !== 'frame' ||
      !('tick' in frame) ||
      frame.tick !== message.tick ||
      !('frame' in frame) ||
      frame.frame !== message.frame
    )
      throw new Error('Death evidence chunk metadata does not match its frame');
    return frame;
  }
}
