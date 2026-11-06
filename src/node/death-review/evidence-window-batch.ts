import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createGzip, createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { once } from 'node:events';
import type {
  EvidenceEnd,
  EvidenceEntity,
  EvidenceFrame,
  EvidenceHeader,
  EvidenceMessage,
  EvidenceShot,
  EvidenceSmoke,
  EvidenceWindow,
  WireField,
} from './evidence-protocol';
import type { EvidenceBulletDamage } from './evidence-ballistics';
import { runDeathEvidenceProcess } from './death-evidence-process';

export type ExtractedEvidenceWindow = {
  window: EvidenceWindow;
  header: EvidenceHeader;
  frames: EvidenceFrame[];
  rawShots: EvidenceShot[];
  bulletDamages: EvidenceBulletDamage[];
  end: EvidenceEnd;
};
type WindowData = Pick<ExtractedEvidenceWindow, 'window' | 'frames' | 'rawShots' | 'bulletDamages'>;
const MAX_SPOOL_BYTES = 512 * 1024 * 1024;

async function* readLines(input: AsyncIterable<Buffer>) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  for await (const chunk of input) {
    pending += decoder.write(chunk);
    let separator: number;
    while ((separator = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, separator);
      pending = pending.slice(separator + 1);
      yield line;
    }
    if (Buffer.byteLength(pending) > 32 * 1024 * 1024)
      throw new Error('Death evidence expanded frame exceeds its size limit');
  }
  pending += decoder.end();
  if (pending.length) throw new Error('Death evidence temporary data is incomplete');
}

type RecordedMessage = Extract<EvidenceMessage, { type: 'frame' | 'shot' | 'bullet-damage' }>;
async function* readMessages(input: AsyncIterable<Buffer>) {
  for await (const line of readLines(input)) yield JSON.parse(line) as RecordedMessage;
}

/** Keep the native 4096-tick limit, including overlapping windows only once. */
export function groupEvidenceWindows(windows: EvidenceWindow[]): EvidenceWindow[][] {
  const groups: EvidenceWindow[][] = [];
  let group: EvidenceWindow[] = [];
  let ticks = new Set<number>();
  for (const window of windows.toSorted((a, b) => a.startTick - b.startTick || a.endTick - b.endTick)) {
    if (
      !Number.isSafeInteger(window.startTick) ||
      !Number.isSafeInteger(window.endTick) ||
      window.startTick < 0 ||
      window.endTick < window.startTick ||
      window.endTick - window.startTick >= 4096
    )
      throw new Error('Invalid death evidence window');
    const additional: number[] = [];
    for (let tick = window.startTick; tick <= window.endTick; tick++) if (!ticks.has(tick)) additional.push(tick);
    if (ticks.size + additional.length > 4096 || group.length >= 128) {
      groups.push(group);
      group = [];
      ticks = new Set();
    }
    group.push(window);
    for (let tick = window.startTick; tick <= window.endTick; tick++) ticks.add(tick);
  }
  if (group.length) groups.push(group);
  return groups;
}

/** Short prefixes cost less than preparing a shared batch; keep their direct path. */
export function planEvidenceScans(windows: EvidenceWindow[]): EvidenceWindow[][] {
  return groupEvidenceWindows(windows).flatMap((group) => {
    if (group.length === 1) return [group];
    const ticks = new Set<number>();
    for (const window of group) for (let tick = window.startTick; tick <= window.endTick; tick++) ticks.add(tick);
    const skippedPrefixTicks =
      group.reduce((total, window) => total + window.endTick + 1, 0) -
      Math.max(...group.map((window) => window.endTick + 1));
    // Conservative crossover from real early/late-demo measurements. This changes
    // scheduling only: the same frames, events and coverage checks are required.
    return skippedPrefixTicks < ticks.size * 24 ? group.map((window) => [window]) : [group];
  });
}

function updateEntities<T extends EvidenceEntity>(
  state: Map<string, T>,
  delta: { complete: boolean; upserts: T[]; removed: string[] },
) {
  if (delta.complete) state.clear();
  for (const id of delta.removed) state.delete(id);
  for (const entity of delta.upserts) state.set(entity.id, entity);
}

/** Rehydrate the already-validated private spool; shared unchanged fields stay shared in memory. */
class SpoolPlayerFields {
  private players = new Map<string, Record<string, WireField>>();
  private weapons = new Map<string, { id: string; fields: Record<string, WireField> }>();
  private tick = -1;

  expand(frame: EvidenceFrame) {
    if (frame.tick !== this.tick + 1) {
      this.players.clear();
      this.weapons.clear();
    }
    this.tick = frame.tick;
    const seen = new Set<string>();
    for (const player of frame.players) {
      seen.add(player.id);
      if (!player.fieldsComplete && !this.players.has(player.id))
        throw new Error('Death evidence spool lost a player baseline');
      player.fields = { ...(player.fieldsComplete ? {} : this.players.get(player.id)), ...player.fields };
      player.fieldsComplete = true;
      this.players.set(player.id, player.fields);
      const weapon = player.activeWeapon;
      if (!weapon) this.weapons.delete(player.id);
      else {
        const previous = this.weapons.get(player.id);
        if (!weapon.fieldsComplete && previous?.id !== weapon.id)
          throw new Error('Death evidence spool lost a weapon baseline');
        weapon.fields = { ...(weapon.fieldsComplete ? {} : previous?.fields), ...weapon.fields };
        weapon.fieldsComplete = true;
        this.weapons.set(player.id, { id: weapon.id, fields: weapon.fields });
      }
    }
    for (const id of this.players.keys())
      if (!seen.has(id)) {
        this.players.delete(id);
        this.weapons.delete(id);
      }
  }
}

/**
 * Decode once, verify the entire subprocess result, then evaluate one time window at a time.
 * A temporary gzip spool keeps expanded player fields out of a multi-window memory buffer.
 * It is removed on success, cancellation and error; durable output remains the existing per-death cache.
 */
export async function extractEvidenceWindows(options: Parameters<typeof extractWindowGroup>[0]): Promise<void> {
  try {
    await extractWindowGroup(options);
  } catch (error) {
    options.signal.throwIfAborted();
    const message = error instanceof Error ? error.message : String(error);
    // A dense smoke/prop state can exceed the shared wire budget even though each
    // death fits alone. Retry smaller groups, retaining every safety limit.
    if (
      options.windows.length <= 1 ||
      !/evidence output exceeds|evidence batch exceeds its temporary data budget/i.test(message)
    )
      throw error;
    const middle = Math.ceil(options.windows.length / 2);
    await extractEvidenceWindows({ ...options, windows: options.windows.slice(0, middle) });
    await extractEvidenceWindows({ ...options, windows: options.windows.slice(middle) });
  }
}

async function extractWindowGroup(options: {
  executable: string;
  demoPath: string;
  windows: EvidenceWindow[];
  directory: string;
  signal: AbortSignal;
  onProgress: (window: EvidenceWindow, completedTicks: number) => void;
  onScanCompleted?: (milliseconds: number) => void;
  consume: (window: ExtractedEvidenceWindow) => Promise<void>;
}) {
  const { signal } = options;
  signal.throwIfAborted();
  if (options.windows.length > 128 || groupEvidenceWindows(options.windows).length !== 1)
    throw new Error('Death evidence batch exceeds its window budget');
  if (options.windows.length === 1) {
    // Preserve the direct single-death path: batching must not add disk I/O to an ordinary click.
    const window = options.windows[0];
    const frames: EvidenceFrame[] = [],
      rawShots: EvidenceShot[] = [],
      bulletDamages: EvidenceBulletDamage[] = [];
    let header: EvidenceHeader | undefined;
    const scanStarted = performance.now();
    const end = await runDeathEvidenceProcess({
      executable: options.executable,
      request: { version: 1, demoPath: options.demoPath, windows: [window] },
      signal,
      onMessage: (message) => {
        if (message.type === 'header') header = message;
        else if (message.type === 'frame') frames.push(message);
        else if (message.type === 'shot') rawShots.push(message);
        else if (message.type === 'bullet-damage') bulletDamages.push(message);
        else if (message.type === 'progress') options.onProgress(window, frames.length);
      },
    });
    options.onScanCompleted?.(performance.now() - scanStarted);
    signal.throwIfAborted();
    if (!header) throw new Error('Death evidence header is missing');
    options.onProgress(window, frames.length);
    await options.consume({ window, header, frames, rawShots, bulletDamages, end });
    return;
  }
  // Two normal seven-second windows fit in a bounded direct buffer. Larger batches
  // spool deltas; their memory footprint does not grow with every selected death.
  const uniqueTicks = new Set<number>();
  for (const window of options.windows)
    for (let tick = window.startTick; tick <= window.endTick; tick++) uniqueTicks.add(tick);
  const buffered: RecordedMessage[] | null = uniqueTicks.size <= 1024 ? [] : null;
  if (!buffered) await mkdir(options.directory, { recursive: true });
  const temporary = buffered ? null : await mkdtemp(path.join(options.directory, '.batch-'));
  const file = temporary ? path.join(temporary, 'frames.jsonl.gz') : null;
  const gzip = file ? createGzip({ level: 1 }) : null;
  const output = file ? createWriteStream(file, { flags: 'wx' }) : null;
  const writing = gzip && output ? pipeline(gzip, output, { signal }) : Promise.resolve();
  // Attach immediately: a disk failure must not become an unhandled rejection while decoding.
  void writing.catch(() => undefined);
  let bytes = 0;
  let header: EvidenceHeader | undefined;
  let end: EvidenceEnd;
  const decoded = new Map(options.windows.map((window) => [window, 0]));
  try {
    const scanStarted = performance.now();
    end = await runDeathEvidenceProcess({
      executable: options.executable,
      request: { version: 1, demoPath: options.demoPath, windows: options.windows },
      frameFields: 'delta',
      signal,
      onMessage: async (message) => {
        if (message.type === 'header') header = message;
        if (message.type === 'frame')
          for (const window of options.windows)
            if (message.tick >= window.startTick && message.tick <= window.endTick)
              decoded.set(window, decoded.get(window)! + 1);
        if (message.type === 'progress') for (const [window, count] of decoded) options.onProgress(window, count);
        if (!['frame', 'shot', 'bullet-damage'].includes(message.type)) return;
        if (buffered) {
          buffered.push(message as RecordedMessage);
          return;
        }
        const line = `${JSON.stringify(message)}\n`;
        bytes += Buffer.byteLength(line);
        if (bytes > MAX_SPOOL_BYTES) throw new Error('Death evidence batch exceeds its temporary data budget');
        if (!gzip!.write(line)) await once(gzip!, 'drain', { signal });
      },
    });
    options.onScanCompleted?.(performance.now() - scanStarted);
    gzip?.end();
    await writing;
    signal.throwIfAborted();
    for (const [window, count] of decoded) options.onProgress(window, count);
    if (!header) throw new Error('Death evidence header is missing');
    const pending: WindowData[] = options.windows.map((window) => ({
      window,
      frames: [],
      rawShots: [],
      bulletDamages: [],
    }));
    const world = new Map<string, EvidenceEntity>();
    const smokes = new Map<string, EvidenceSmoke>();
    const playerFields = new SpoolPlayerFields();
    let worldReady = false;
    let smokeReady = false;
    const finish = async (item: WindowData) => {
      signal.throwIfAborted();
      const coverage = end.windowClasses?.find(
        (entry) => entry.startTick === item.window.startTick && entry.endTick === item.window.endTick,
      );
      if (!coverage && options.windows.length > 1)
        throw new Error('Native parser does not provide per-window class coverage');
      const inWindow = (tick: number) => tick >= item.window.startTick && tick <= item.window.endTick;
      await options.consume({
        ...item,
        header: { ...header!, windows: [item.window], requestedTicks: item.window.endTick - item.window.startTick + 1 },
        end: {
          ...end,
          emittedTicks: item.frames.length,
          frames: item.frames.length,
          shots: item.rawShots.length,
          bulletDamages: item.bulletDamages.length,
          missingTicks: end.missingTicks.filter(inWindow),
          ...(coverage
            ? {
                supportedClasses: coverage.supportedClasses,
                unsupportedClasses: coverage.unsupportedClasses,
                duplicateTicks: coverage.duplicateTicks,
              }
            : {}),
        },
      });
    };
    const input = file ? createReadStream(file) : null;
    const gunzip = buffered ? null : createGunzip();
    const reading = input && gunzip ? pipeline(input, gunzip, { signal }) : Promise.resolve();
    void reading.catch(() => undefined);
    const messages = buffered ?? readMessages(gunzip!);
    try {
      for await (const message of messages) {
        signal.throwIfAborted();
        if (message.type === 'frame') {
          playerFields.expand(message);
          // Fire events can precede the previous tick's delayed frame flush.
          // Only frame boundaries prove that every event for an earlier window has arrived.
          for (let index = 0; index < pending.length;) {
            if (pending[index].window.endTick < message.tick) {
              await finish(pending[index]);
              pending.splice(index, 1);
            } else index++;
          }
          updateEntities(world, message.world);
          updateEntities(smokes, message.smokes);
          worldReady ||= message.world.complete;
          smokeReady ||= message.smokes.complete;
        }
        for (const item of pending) {
          if (message.tick < item.window.startTick || message.tick > item.window.endTick) continue;
          if (message.type === 'frame') {
            item.frames.push(
              item.frames.length === 0
                ? {
                    ...message,
                    world: { complete: worldReady, upserts: [...world.values()], removed: [] },
                    smokes: { complete: smokeReady, upserts: [...smokes.values()], removed: [] },
                  }
                : message,
            );
          } else if (message.type === 'shot') item.rawShots.push(message);
          else item.bulletDamages.push(message);
        }
      }
      await reading;
      for (const item of pending) await finish(item);
    } finally {
      input?.destroy();
      gunzip?.destroy();
      await reading.catch(() => undefined);
    }
  } finally {
    gzip?.destroy();
    output?.destroy();
    await writing.catch(() => undefined);
    if (temporary) await rm(temporary, { recursive: true, force: true });
  }
}
