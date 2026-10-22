import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getVisibilityContentExpectation } from 'csdm/node/death-review/visibility-content-catalog';
import {
  readVisibilityResourceIndex,
  type VisibilityResourceEntry,
} from 'csdm/node/death-review/visibility-resource-audit';
import type { Source2ResourceEntry } from 'csdm/node/death-review/source2-model-resources';

export type VisibilityContentCertificate = {
  algorithm: 'sha1';
  depotId: 2347770;
  demoPatch: number;
  mapSha1: string;
  manifestIds: string[];
};
type Request = { csgoDirectory: string; mapName: string; demoPatch: number; signal: AbortSignal };
const hashes = new Map<string, { stamp: string; sha1: string; sha256: string }>();

async function fileStamp(file: string) {
  const stat = await fs.stat(file);
  if (!stat.isFile()) throw new Error('map-content-not-a-file');
  return { size: stat.size, stamp: `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}` };
}

/** Content equality is required even when installed and recorded patch numbers match. */
export async function resolveVisibilityContentProof(request: Request) {
  request.signal.throwIfAborted();
  if (!path.isAbsolute(request.csgoDirectory) || !/^[a-z0-9_]{1,64}$/.test(request.mapName))
    throw new Error('invalid-map-content-location');
  const expected = getVisibilityContentExpectation(request.demoPatch, request.mapName);
  if (!expected) throw new Error('map-content-reference-unavailable');
  const mapFile = path.resolve(request.csgoDirectory, 'maps', `${request.mapName}.vpk`);
  const initial = await fileStamp(mapFile);
  if (initial.size !== expected.size) throw new Error('map-content-size-mismatch');
  let verified = hashes.get(mapFile);
  if (verified?.stamp !== initial.stamp) {
    const sha1 = createHash('sha1'),
      sha256 = createHash('sha256');
    let bytes = 0;
    for await (const chunk of createReadStream(mapFile, { signal: request.signal })) {
      const data = chunk as Buffer;
      sha1.update(data);
      sha256.update(data);
      bytes += data.byteLength;
    }
    if (bytes !== initial.size || (await fileStamp(mapFile)).stamp !== initial.stamp)
      throw new Error('map-content-changed-during-verification');
    verified = { stamp: initial.stamp, sha1: sha1.digest('hex'), sha256: sha256.digest('hex') };
    // Only successful full-file hashes are reused; file changes invalidate the memory entry.
    if (verified.sha1 === expected.sha1) {
      hashes.set(mapFile, verified);
      if (hashes.size > 16) hashes.delete(hashes.keys().next().value!);
    }
  }
  if (verified.sha1 !== expected.sha1) throw new Error('map-content-hash-mismatch');
  const unchanged = async () => {
    request.signal.throwIfAborted();
    return (await fileStamp(mapFile)).stamp === initial.stamp;
  };
  const verifyResourceSource = async (entry: VisibilityResourceEntry) =>
    path.resolve(entry.packageFile) === mapFile && path.resolve(entry.file) === mapFile && (await unchanged());
  let index: Promise<Map<string, VisibilityResourceEntry>> | undefined;
  const verifyResource = async (entry: Source2ResourceEntry) => {
    if (path.resolve(entry.vpkPath) !== mapFile || !(await unchanged())) return false;
    index ??= readVisibilityResourceIndex(mapFile);
    const actual = (await index).get(entry.path);
    // CRC and size bind VRF's entry to the authenticated directory. CRC is not the content proof.
    return !!(
      actual &&
      actual.crc32 === entry.crc32 &&
      actual.length + actual.preload.length === entry.size &&
      (await verifyResourceSource(actual))
    );
  };
  const certificate: VisibilityContentCertificate = {
    algorithm: 'sha1',
    depotId: 2347770,
    demoPatch: request.demoPatch,
    mapSha1: verified.sha1,
    manifestIds: [...expected.manifestIds],
  };
  return { certificate, mapSha256: verified.sha256, verifyResourceSource, verifyResource, unchanged };
}
