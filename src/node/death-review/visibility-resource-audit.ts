import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';

type Entry = { name: string; file: string; offset: number; length: number; preload: Buffer };
type Package = { entries: Map<string, Entry> };
type Request = { csgoDirectory: string; mapName: string; signal: AbortSignal };

function requireValue(condition: unknown): asserts condition {
  if (!condition) throw new Error('Invalid Source 2 visibility resource index');
}
async function read(file: FileHandle, position: number, length: number) {
  requireValue(
    Number.isSafeInteger(position) &&
      position >= 0 &&
      Number.isSafeInteger(length) &&
      length >= 0 &&
      length <= 16 * 1024 * 1024,
  );
  const bytes = Buffer.alloc(length);
  const result = await file.read(bytes, 0, length, position);
  requireValue(result.bytesRead === length);
  return bytes;
}

async function indexPackage(file: string, handles: Map<string, FileHandle>): Promise<Package> {
  const handle = await fs.open(file, 'r');
  handles.set(file, handle);
  const header = await read(handle, 0, 12);
  requireValue(header.readUInt32LE(0) === 0x55aa1234);
  const version = header.readUInt32LE(4),
    treeLength = header.readUInt32LE(8);
  requireValue((version === 1 || version === 2) && treeLength > 0);
  const headerLength = version === 2 ? 28 : 12;
  const tree = await read(handle, headerLength, treeLength);
  let cursor = 0;
  const string = () => {
    const end = tree.indexOf(0, cursor);
    requireValue(end >= cursor && end - cursor <= 4096);
    const value = tree.toString('utf8', cursor, end);
    cursor = end + 1;
    return value;
  };
  const entries = new Map<string, Entry>();
  for (let ext; (ext = string());) {
    for (let directory; (directory = string());) {
      for (let name; (name = string());) {
        requireValue(cursor + 18 <= tree.length);
        const preloadLength = tree.readUInt16LE(cursor + 4),
          archive = tree.readUInt16LE(cursor + 6),
          offset = tree.readUInt32LE(cursor + 8),
          length = tree.readUInt32LE(cursor + 12);
        requireValue(tree.readUInt16LE(cursor + 16) === 0xffff && cursor + 18 + preloadLength <= tree.length);
        cursor += 18;
        const preload = tree.subarray(cursor, cursor + preloadLength);
        cursor += preloadLength;
        const resource = `${directory === ' ' ? '' : `${directory}/`}${name}.${ext}`.toLowerCase();
        const archiveFile =
          archive === 0x7fff ? file : file.replace(/(?:_dir)?\.vpk$/i, `_${String(archive).padStart(3, '0')}.vpk`);
        requireValue(!entries.has(resource));
        entries.set(resource, {
          name: resource,
          file: archiveFile,
          offset: offset + (archive === 0x7fff ? headerLength + treeLength : 0),
          length,
          preload,
        });
      }
    }
  }
  return { entries };
}

async function entrySlice(entry: Entry, offset: number, length: number, handles: Map<string, FileHandle>) {
  requireValue(offset >= 0 && length >= 0 && offset + length <= entry.length + entry.preload.length);
  const output = Buffer.alloc(length);
  const preloaded = Math.max(0, Math.min(length, entry.preload.length - offset));
  if (preloaded) entry.preload.copy(output, 0, offset, offset + preloaded);
  if (preloaded < length) {
    let handle = handles.get(entry.file);
    if (!handle) {
      handle = await fs.open(entry.file, 'r');
      handles.set(entry.file, handle);
    }
    const bytes = await read(handle, entry.offset + offset + preloaded - entry.preload.length, length - preloaded);
    bytes.copy(output, preloaded);
  }
  return output;
}

async function references(entry: Entry, handles: Map<string, FileHandle>) {
  const header = await entrySlice(entry, 0, 16, handles);
  requireValue(header.readUInt16LE(4) === 12);
  const tableOffset = 8 + header.readUInt32LE(8),
    count = header.readUInt32LE(12);
  requireValue(count <= 64);
  const table = await entrySlice(entry, tableOffset, count * 12, handles);
  const names: string[] = [];
  for (let index = 0; index < count; index++) {
    const start = index * 12;
    if (table.toString('ascii', start, start + 4) !== 'RERL') continue;
    const offset = tableOffset + start + 4 + table.readUInt32LE(start + 4),
      size = table.readUInt32LE(start + 8);
    requireValue(size >= 8 && size <= 1024 * 1024);
    const block = await entrySlice(entry, offset, size, handles);
    const arrayStart = block.readUInt32LE(0),
      arrayCount = block.readUInt32LE(4);
    requireValue(arrayCount <= 20_000 && arrayStart + arrayCount * 16 <= block.length);
    for (let ref = 0; ref < arrayCount; ref++) {
      const address = arrayStart + ref * 16 + 8;
      const relative = block.readBigInt64LE(address);
      requireValue(relative >= 0n && relative <= BigInt(block.length));
      const stringStart = address + Number(relative),
        end = block.indexOf(0, stringStart);
      requireValue(stringStart < block.length && end >= stringStart && end - stringStart <= 4096);
      names.push(block.toString('utf8', stringStart, end).toLowerCase());
    }
  }
  return names;
}

/** Validate render dependencies because VRF skips absent models without failing the entire world export. */
export async function auditVisibilityResources(
  request: Request,
): Promise<{ complete: boolean; checked: number; missing: string[] }> {
  request.signal.throwIfAborted();
  const handles = new Map<string, FileHandle>();
  const missing = new Set<string>();
  let checked = 0;
  try {
    if (!path.isAbsolute(request.csgoDirectory) || !/^[a-z0-9_]{1,64}$/.test(request.mapName))
      return { complete: false, checked, missing: ['invalid-map-location'] };
    const base = await indexPackage(path.join(request.csgoDirectory, 'pak01_dir.vpk'), handles);
    const map = await indexPackage(path.join(request.csgoDirectory, 'maps', `${request.mapName}.vpk`), handles);
    // World-node names are authored in DATA, not always listed in world RERL.
    // Auditing every map-local world node/entity lump is conservative coverage.
    const queue = [...map.entries.keys()].filter((name) => /\.(?:vwrld|vwnod|vents)_c$/.test(name));
    if (!queue.includes(`maps/${request.mapName}/world.vwrld_c`)) missing.add('world-resource-missing');
    const seen = new Set<string>();
    for (let i = 0; i < queue.length; i++) {
      requireValue(queue.length <= 100_000);
      request.signal.throwIfAborted();
      const name = queue[i];
      if (seen.has(name)) continue;
      requireValue(seen.size < 20_000);
      seen.add(name);
      const entry = map.entries.get(name) ?? base.entries.get(name);
      if (!entry) {
        if (missing.size < 100) missing.add(name);
        continue;
      }
      const refs = await references(entry, handles);
      checked++;
      for (const reference of refs) {
        if (/\.(?:vmdl|vmesh|vwnod|vents|vwrld)$/.test(reference)) queue.push(`${reference}_c`);
      }
    }
    return { complete: missing.size === 0 && checked > 0, checked, missing: [...missing].sort() };
  } catch (error) {
    request.signal.throwIfAborted();
    return { complete: false, checked, missing: [error instanceof Error ? error.message : 'resource-audit-failed'] };
  } finally {
    await Promise.all(Array.from(handles.values(), (handle) => handle.close()));
  }
}
