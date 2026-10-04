import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { hasCompleteSource2Demo } from './has-complete-source2-demo';

let folderPath: string;

beforeEach(async () => {
  folderPath = await mkdtemp(path.join(os.tmpdir(), 'cs2-demo-completeness-'));
});

afterEach(async () => {
  await rm(folderPath, { recursive: true, force: true });
});

function varInt(value: number): Buffer {
  const bytes: number[] = [];
  do {
    const byte = value & 127;
    value = Math.floor(value / 128);
    bytes.push(byte | (value > 0 ? 128 : 0));
  } while (value > 0);
  return Buffer.from(bytes);
}

function frame(command: number, payload: Buffer, tick = 1): Buffer {
  return Buffer.concat([varInt(command), varInt(tick), varInt(payload.length), payload]);
}

const header = Buffer.concat([Buffer.from('PBDEMS2\0'), Buffer.alloc(8)]);
const firstFrame = frame(1, Buffer.from([1, 2, 3]), 0xffffffff);
const stop = Buffer.from([0, 1]);

async function check(...parts: Buffer[]) {
  const filePath = path.join(folderPath, '完美录像 with spaces.dem');
  await writeFile(filePath, Buffer.concat(parts));
  return hasCompleteSource2Demo(filePath);
}

describe('hasCompleteSource2Demo', () => {
  it('requires a stop command even if all received packets are complete', async () => {
    expect(await check(header, firstFrame)).toBe(false);
    expect(await check(header, firstFrame, stop)).toBe(true);
  });

  it('rejects a partial header, wrong file signature and missing first header command', async () => {
    expect(await check(header.subarray(0, 12))).toBe(false);
    expect(await check(Buffer.alloc(16), firstFrame, stop)).toBe(false);
    expect(await check(header, stop)).toBe(false);
  });

  it('rejects truncated payloads rather than treating zero bytes inside them as a stop marker', async () => {
    const packet = frame(7, Buffer.alloc(100));
    expect(await check(header, firstFrame, packet.subarray(0, 50))).toBe(false);
    expect(await check(header, firstFrame, packet)).toBe(false);
  });

  it('handles compressed frames and payloads larger than its bounded read buffer', async () => {
    const packet = frame(7 | 64, Buffer.alloc(100000));
    expect(await check(header, firstFrame, packet, stop)).toBe(true);
  });

  it('rejects truncated and overflowing varints and an incomplete stop tick', async () => {
    expect(await check(header, firstFrame, Buffer.from([128]))).toBe(false);
    expect(await check(header, firstFrame, Buffer.from([128, 128, 128, 128, 255]))).toBe(false);
    expect(await check(header, firstFrame, Buffer.from([0]))).toBe(false);
  });
});
