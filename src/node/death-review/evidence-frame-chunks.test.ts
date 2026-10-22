import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vite-plus/test';
import type { EvidenceFrameChunk } from './evidence-protocol';
import { EvidenceFrameAssembler } from './evidence-frame-chunks';

const fixture = {
  type: 'frame',
  frame: 1,
  tick: 10,
  serverTick: 100,
  players: [],
  world: {
    complete: true,
    upserts: [
      {
        id: '2:1',
        fields: {
          text: { present: true, value: '测试'.repeat(360000), lastUpdate: null },
          missing: { present: false, value: null, lastUpdate: null },
        },
      },
    ],
    removed: [],
  },
  smokes: { complete: false, upserts: [], removed: ['7:3'] },
};
function chunks(value: unknown = fixture): EvidenceFrameChunk[] {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
  const result: EvidenceFrameChunk[] = [];
  for (let offset = 0; offset < bytes.length; offset += 256 * 1024)
    result.push({
      type: 'frame-chunk',
      id: '1:10',
      frame: 1,
      tick: 10,
      index: result.length,
      count: Math.ceil(bytes.length / (256 * 1024)),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      dataBase64: bytes.subarray(offset, offset + 256 * 1024).toString('base64'),
    });
  return result;
}
describe('atomic bounded frame reassembly', () => {
  it('preserves complete flags, missing values and UTF-8 across byte boundaries', () => {
    const assembler = new EvidenceFrameAssembler();
    const parts = chunks();
    for (const part of parts.slice(0, -1)) expect(assembler.accept(part)).toBeUndefined();
    expect(assembler.accept(parts.at(-1)!)).toEqual(fixture);
    expect(() => assembler.assertIdle()).not.toThrow();
  });
  it('rejects missing, reordered, duplicated and interleaved pieces', () => {
    const parts = chunks();
    expect(() => new EvidenceFrameAssembler().accept(parts[1])).toThrow('start at zero');
    for (const next of [
      parts[0],
      parts[2],
      { ...parts[1], tick: 11, id: '1:11' },
      { ...parts[1], sha256: 'a'.repeat(64) },
    ]) {
      const assembler = new EvidenceFrameAssembler();
      assembler.accept(parts[0]);
      expect(() => assembler.accept(next)).toThrow();
    }
    const incomplete = new EvidenceFrameAssembler();
    incomplete.accept(parts[0]);
    expect(() => incomplete.assertIdle()).toThrow('incomplete');
  });
  it('enforces declared size, canonical encoding and a 16 MiB memory ceiling', () => {
    const first = chunks()[0];
    for (const change of [
      { bytes: 16 * 1024 ** 2 + 1 },
      { count: first.count + 1 },
      { dataBase64: 'AAAA' },
      { dataBase64: '*'.repeat(first.dataBase64.length) },
      { dataBase64: 'A'.repeat(350000) },
    ])
      expect(() => new EvidenceFrameAssembler().accept({ ...first, ...change })).toThrow();
  });
  it('rejects checksum corruption, invalid UTF-8 and payload clock/type substitution', () => {
    const corrupted = chunks();
    corrupted[0] = { ...corrupted[0], dataBase64: Buffer.alloc(256 * 1024).toString('base64') };
    expect(() => {
      const assembler = new EvidenceFrameAssembler();
      corrupted.forEach((part) => assembler.accept(part));
    }).toThrow('checksum');
    for (const value of [{ ...fixture, tick: 11 }, { ...fixture, type: 'end' }, Buffer.from([0xff])]) {
      expect(() => {
        const assembler = new EvidenceFrameAssembler();
        chunks(value).forEach((part) => assembler.accept(part));
      }).toThrow();
    }
  });
});
