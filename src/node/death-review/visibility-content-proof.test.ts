import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { resolveVisibilityContentProof } from './visibility-content-proof';
import { readVisibilityResourceIndex } from './visibility-resource-audit';

const { expectation } = vi.hoisted(() => ({ expectation: vi.fn() }));
vi.mock('csdm/node/death-review/visibility-content-catalog', () => ({ getVisibilityContentExpectation: expectation }));
let directory: string;
let mapFile: string;
let bytes: Buffer;
function fixture() {
  const entry = Buffer.alloc(18);
  entry.writeUInt32LE(0x1234, 0);
  entry.writeUInt16LE(0x7fff, 6);
  entry.writeUInt32LE(5, 12);
  entry.writeUInt16LE(0xffff, 16);
  const tree = Buffer.concat([Buffer.from('vmdl_c\0models\0test\0'), entry, Buffer.from([0, 0, 0])]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x55aa1234);
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(tree.length, 8);
  return Buffer.concat([header, tree, Buffer.from('model')]);
}
function request() {
  return { csgoDirectory: directory, mapName: 'de_fixture', demoPatch: 14190, signal: new AbortController().signal };
}
function modelEntry() {
  return { vpkPath: mapFile, path: 'models/test.vmdl_c', crc32: '00001234', size: 5 };
}
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cs2-content-proof-'));
  await fs.mkdir(path.join(directory, 'maps'));
  mapFile = path.join(directory, 'maps', 'de_fixture.vpk');
  bytes = fixture();
  await fs.writeFile(mapFile, bytes);
  expectation.mockReset();
  expectation.mockReturnValue({
    size: bytes.length,
    sha1: createHash('sha1').update(bytes).digest('hex'),
    manifestIds: ['123', '456'],
  });
});
afterEach(async () => {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('cs2-content-proof-'))
    throw new Error('Unexpected test directory');
  await fs.rm(resolved, { recursive: true, force: true });
});
describe('whole-map content proof', () => {
  it('checks actual bytes and binds a model to the authenticated map directory', async () => {
    const proof = await resolveVisibilityContentProof(request());
    expect(proof.certificate).toEqual({
      algorithm: 'sha1',
      depotId: 2347770,
      demoPatch: 14190,
      mapSha1: createHash('sha1').update(bytes).digest('hex'),
      manifestIds: ['123', '456'],
    });
    expect(proof.mapSha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(await proof.verifyResource(modelEntry())).toBe(true);
    expect(await proof.verifyResource({ ...modelEntry(), crc32: '00005678' })).toBe(false);
    expect(await proof.verifyResource({ ...modelEntry(), size: 4 })).toBe(false);
    expect(await proof.verifyResource({ ...modelEntry(), path: 'models/missing.vmdl_c' })).toBe(false);
  });
  it('rejects shared packages and split archive payloads even when their names and CRC agree', async () => {
    const proof = await resolveVisibilityContentProof(request());
    expect(await proof.verifyResource({ ...modelEntry(), vpkPath: path.join(directory, 'pak01_dir.vpk') })).toBe(false);
    const entry = (await readVisibilityResourceIndex(mapFile)).get(modelEntry().path)!;
    expect(await proof.verifyResourceSource(entry)).toBe(true);
    expect(await proof.verifyResourceSource({ ...entry, file: path.join(directory, 'pak01_000.vpk') })).toBe(false);
    expect(await proof.verifyResourceSource({ ...entry, packageFile: path.join(directory, 'pak01_dir.vpk') })).toBe(
      false,
    );
  });
  it('rejects different contents of the same size and unknown release cohorts', async () => {
    const changed = Buffer.from(bytes);
    changed[changed.length - 1] ^= 1;
    await fs.writeFile(mapFile, changed);
    await expect(resolveVisibilityContentProof(request())).rejects.toThrow('map-content-hash-mismatch');
    expectation.mockReturnValue(null);
    await expect(resolveVisibilityContentProof(request())).rejects.toThrow('map-content-reference-unavailable');
  });
  it('invalidates the memory hash and already-issued resource proof after a source change', async () => {
    const proof = await resolveVisibilityContentProof(request());
    const changed = Buffer.from(bytes);
    changed[changed.length - 1] ^= 1;
    await fs.writeFile(mapFile, changed);
    expect(await proof.unchanged()).toBe(false);
    expect(await proof.verifyResource(modelEntry())).toBe(false);
    await expect(resolveVisibilityContentProof(request())).rejects.toThrow('map-content-hash-mismatch');
  });
  it('rejects invalid location, changed size and cancellation before reading resources', async () => {
    await expect(resolveVisibilityContentProof({ ...request(), mapName: '../other' })).rejects.toThrow(
      'invalid-map-content-location',
    );
    await fs.appendFile(mapFile, 'x');
    await expect(resolveVisibilityContentProof(request())).rejects.toThrow('map-content-size-mismatch');
    const control = new AbortController();
    control.abort();
    await expect(resolveVisibilityContentProof({ ...request(), signal: control.signal })).rejects.toThrow();
  });
});
