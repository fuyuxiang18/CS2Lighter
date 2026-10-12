import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { auditVisibilityResources } from 'csdm/node/death-review/visibility-resource-audit';

let temporary: string;
function resource(reference?: string) {
  if (!reference) {
    const raw = Buffer.alloc(16);
    raw.writeUInt16LE(12, 4);
    raw.writeUInt32LE(8, 8);
    return raw;
  }
  const name = Buffer.from(`${reference}\0`),
    raw = Buffer.alloc(52 + name.length);
  raw.writeUInt32LE(raw.length);
  raw.writeUInt16LE(12, 4);
  raw.writeUInt32LE(8, 8);
  raw.writeUInt32LE(1, 12);
  raw.write('RERL', 16);
  raw.writeUInt32LE(8, 20);
  raw.writeUInt32LE(24 + name.length, 24);
  raw.writeUInt32LE(8, 28);
  raw.writeUInt32LE(1, 32);
  raw.writeBigUInt64LE(1n, 36);
  raw.writeBigInt64LE(8n, 44);
  name.copy(raw, 52);
  return raw;
}
function vpk(files: { name: string; bytes: Buffer }[]) {
  const tree: Buffer[] = [],
    data: Buffer[] = [];
  let offset = 0;
  // Every fixture uses a distinct extension, retaining literal VPK tree nesting.
  for (const file of files) {
    const at = file.name.lastIndexOf('.'),
      slash = file.name.lastIndexOf('/');
    tree.push(
      Buffer.from(`${file.name.slice(at + 1)}\0${file.name.slice(0, slash)}\0${file.name.slice(slash + 1, at)}\0`),
    );
    const entry = Buffer.alloc(18);
    entry.writeUInt16LE(0x7fff, 6);
    entry.writeUInt32LE(offset, 8);
    entry.writeUInt32LE(file.bytes.length, 12);
    entry.writeUInt16LE(0xffff, 16);
    tree.push(entry, Buffer.from([0, 0]));
    data.push(file.bytes);
    offset += file.bytes.length;
  }
  tree.push(Buffer.from([0]));
  const directory = Buffer.concat(tree),
    header = Buffer.alloc(12);
  header.writeUInt32LE(0x55aa1234);
  header.writeUInt32LE(1, 4);
  header.writeUInt32LE(directory.length, 8);
  return Buffer.concat([header, directory, ...data]);
}
beforeEach(async () => {
  temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'cs2-resource-test-'));
  await fs.mkdir(path.join(temporary, 'maps'));
  await fs.writeFile(
    path.join(temporary, 'pak01_dir.vpk'),
    vpk([{ name: 'models/fixture.vmdl_c', bytes: resource() }]),
  );
});
afterEach(async () => {
  const resolved = path.resolve(temporary);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('cs2-resource-test-'))
    throw new Error('Unexpected test directory');
  await fs.rm(resolved, { recursive: true, force: true });
});
describe('world render dependency audit', () => {
  it('follows map-world references into the base package without reading full assets', async () => {
    await fs.writeFile(
      path.join(temporary, 'maps', 'de_fixture.vpk'),
      vpk([{ name: 'maps/de_fixture/world.vwrld_c', bytes: resource('models/fixture.vmdl') }]),
    );
    expect(
      await auditVisibilityResources({
        csgoDirectory: temporary,
        mapName: 'de_fixture',
        signal: new AbortController().signal,
      }),
    ).toEqual({ complete: true, checked: 2, missing: [] });
  });
  it('surfaces an absent referenced model and rejects truncated VPK indexes', async () => {
    await fs.writeFile(
      path.join(temporary, 'maps', 'de_fixture.vpk'),
      vpk([{ name: 'maps/de_fixture/world.vwrld_c', bytes: resource('models/missing.vmdl') }]),
    );
    expect(
      await auditVisibilityResources({
        csgoDirectory: temporary,
        mapName: 'de_fixture',
        signal: new AbortController().signal,
      }),
    ).toEqual({ complete: false, checked: 1, missing: ['models/missing.vmdl_c'] });
    await fs.writeFile(path.join(temporary, 'maps', 'de_fixture.vpk'), Buffer.from([1, 2, 3]));
    expect(
      (
        await auditVisibilityResources({
          csgoDirectory: temporary,
          mapName: 'de_fixture',
          signal: new AbortController().signal,
        })
      ).complete,
    ).toBe(false);
  });
  it('honors cancellation and rejects traversal names', async () => {
    expect(
      (
        await auditVisibilityResources({
          csgoDirectory: temporary,
          mapName: '../other',
          signal: new AbortController().signal,
        })
      ).complete,
    ).toBe(false);
    await fs.writeFile(
      path.join(temporary, 'maps', 'de_fixture.vpk'),
      vpk([{ name: 'maps/de_fixture/world.vwrld_c', bytes: resource() }]),
    );
    const control = new AbortController();
    control.abort();
    await expect(
      auditVisibilityResources({ csgoDirectory: temporary, mapName: 'de_fixture', signal: control.signal }),
    ).rejects.toThrow();
  });
});
