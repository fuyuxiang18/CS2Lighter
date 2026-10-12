import { spawn } from 'node:child_process';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { EvidenceEnd, EvidenceMessage, EvidenceRequest, WireField } from './evidence-protocol';

const MAX_LINE_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 128 * 1024 * 1024;

export function validateEvidenceRequest(request: EvidenceRequest) {
  if (
    request.version !== 1 ||
    typeof request.demoPath !== 'string' ||
    !path.isAbsolute(request.demoPath) ||
    path.extname(request.demoPath).toLowerCase() !== '.dem' ||
    !Array.isArray(request.windows) ||
    request.windows.length === 0 ||
    request.windows.length > 128 ||
    (request.players !== undefined &&
      (!Array.isArray(request.players) ||
        request.players.length > 64 ||
        request.players.some((id) => typeof id !== 'string' || !/^\d{17}$/.test(id))))
  )
    throw new Error('Invalid death evidence request');
  const ticks = new Set<number>();
  for (const window of request.windows) {
    if (
      !Number.isSafeInteger(window.startTick) ||
      !Number.isSafeInteger(window.endTick) ||
      window.startTick < 0 ||
      window.endTick < window.startTick ||
      window.endTick - window.startTick >= 4096
    )
      throw new Error('Invalid death evidence window');
    for (let tick = window.startTick; tick <= window.endTick; tick++) {
      ticks.add(tick);
      if (ticks.size > 4096) throw new Error('Death evidence request exceeds its tick budget');
    }
  }
  return ticks;
}

function integer(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseMessage(line: string): EvidenceMessage {
  const value: unknown = JSON.parse(line);
  if (!value || typeof value !== 'object') throw new Error('Invalid death evidence response');
  const message = value as Partial<EvidenceMessage>;
  if (message.type === 'header') {
    if (
      message.version !== 1 ||
      message.playerFieldsMode !== 'delta' ||
      typeof message.mapName !== 'string' ||
      typeof message.parserVersion !== 'string' ||
      !integer(message.requestedTicks) ||
      !Array.isArray(message.windows) ||
      !Number.isFinite(message.tickRate) ||
      message.tickRate! <= 0
    )
      throw new Error('Invalid death evidence header');
  } else if (message.type === 'frame') {
    if (
      !integer(message.frame) ||
      !integer(message.tick) ||
      !Array.isArray(message.players) ||
      message.players.length > 64 ||
      !Array.isArray(message.world?.upserts) ||
      !Array.isArray(message.world?.removed) ||
      typeof message.world?.complete !== 'boolean' ||
      !Array.isArray(message.smokes?.upserts) ||
      !Array.isArray(message.smokes?.removed) ||
      typeof message.smokes?.complete !== 'boolean'
    )
      throw new Error('Invalid death evidence frame');
  } else if (message.type === 'shot') {
    if (!integer(message.frame) || !integer(message.tick) || !message.raw || typeof message.raw !== 'object')
      throw new Error('Invalid death evidence shot');
  } else if (message.type === 'progress') {
    if (!integer(message.requestedTicks) || !integer(message.emittedTicks))
      throw new Error('Invalid death evidence progress');
  } else if (message.type === 'end') {
    if (
      !['ok', 'error'].includes(message.status ?? '') ||
      !integer(message.emittedTicks) ||
      !Array.isArray(message.missingTicks) ||
      !message.missingTicks.every(integer)
    )
      throw new Error('Invalid death evidence result');
  } else throw new Error('Unknown death evidence message');
  return message as EvidenceMessage;
}

/** The native parser runs outside the daemon so cancellation also interrupts synchronous decoding. */
export async function runDeathEvidenceProcess({
  executable,
  args = [],
  request,
  signal,
  onMessage,
  timeoutMs = 180_000,
}: {
  executable: string;
  args?: string[];
  request: EvidenceRequest;
  signal: AbortSignal;
  onMessage: (message: EvidenceMessage) => void | Promise<void>;
  timeoutMs?: number;
}): Promise<EvidenceEnd> {
  const wanted = validateEvidenceRequest(request);
  signal.throwIfAborted();
  const child = spawn(executable, args, {
    windowsHide: true,
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let failure: Error | undefined;
  let stderr = '';
  const stop = (error: Error) => {
    failure ??= error;
    child.kill();
  };
  const abort = () => stop(new Error('Death evidence extraction canceled'));
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(() => stop(new Error('Death evidence extraction timed out')), timeoutMs);
  const closed = new Promise<number | null>((resolve) => {
    child.once('error', (error) => stop(error));
    child.once('close', (code) => resolve(code));
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-4096);
  });
  child.stdin.on('error', (error) => stop(error));
  child.stdin.end(JSON.stringify(request));
  let headerSeen = false;
  let end: EvidenceEnd | undefined;
  const frames = new Set<number>();
  const playerFields = new Map<string, Record<string, WireField>>();
  const weaponFields = new Map<string, { id: string; fields: Record<string, WireField> }>();
  let previousTick: number | undefined;
  let totalBytes = 0;
  let pending = '';
  const decoder = new StringDecoder('utf8');
  const accept = async (line: string) => {
    if (line.length === 0) return;
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) throw new Error('Death evidence line exceeds its size limit');
    if (end) throw new Error('Death evidence continued after its final result');
    const message = parseMessage(line);
    if (message.type === 'header') {
      if (headerSeen || message.requestedTicks !== wanted.size) throw new Error('Mismatched death evidence header');
      headerSeen = true;
    } else if (!headerSeen && !(message.type === 'end' && message.status === 'error'))
      throw new Error('Death evidence header is missing');
    if (message.type === 'frame' || message.type === 'shot') {
      if (!wanted.has(message.tick)) throw new Error('Death evidence escaped its requested windows');
      if (message.type === 'frame') {
        if (previousTick !== undefined && message.tick <= previousTick)
          throw new Error('Death evidence frames are not in increasing tick order');
        if (previousTick !== undefined && message.tick !== previousTick + 1) {
          playerFields.clear();
          weaponFields.clear();
        }
        previousTick = message.tick;
        const seenIds = new Set<string>();
        for (const player of message.players) {
          if (
            typeof player.id !== 'string' ||
            !/^\d+:\d+$/.test(player.id) ||
            seenIds.has(player.id) ||
            typeof player.fieldsComplete !== 'boolean' ||
            !player.fields ||
            typeof player.fields !== 'object' ||
            Array.isArray(player.fields)
          )
            throw new Error('Invalid death evidence player fields');
          seenIds.add(player.id);
          if (!player.fieldsComplete && !playerFields.has(player.id))
            throw new Error('Death evidence player delta has no baseline');
          const expanded = {
            ...(player.fieldsComplete ? {} : playerFields.get(player.id)),
            ...player.fields,
          };
          playerFields.set(player.id, expanded);
          player.fields = expanded;
          player.fieldsComplete = true;
          const weapon = player.activeWeapon;
          if (weapon === null || weapon === undefined) {
            weaponFields.delete(player.id);
          } else {
            if (
              typeof weapon.id !== 'string' ||
              !/^\d+:\d+$/.test(weapon.id) ||
              typeof weapon.className !== 'string' ||
              typeof weapon.fieldsComplete !== 'boolean' ||
              !weapon.fields ||
              typeof weapon.fields !== 'object' ||
              Array.isArray(weapon.fields)
            )
              throw new Error('Invalid death evidence weapon fields');
            const previousWeapon = weaponFields.get(player.id);
            if (!weapon.fieldsComplete && previousWeapon?.id !== weapon.id)
              throw new Error('Death evidence weapon delta has no baseline');
            const expandedWeapon = {
              ...(weapon.fieldsComplete ? {} : previousWeapon?.fields),
              ...weapon.fields,
            };
            weaponFields.set(player.id, { id: weapon.id, fields: expandedWeapon });
            weapon.fields = expandedWeapon;
            weapon.fieldsComplete = true;
          }
        }
        for (const id of playerFields.keys()) {
          if (!seenIds.has(id)) {
            playerFields.delete(id);
            weaponFields.delete(id);
          }
        }
        frames.add(message.tick);
      }
    }
    if (message.type === 'end') end = message;
    await onMessage(message);
    signal.throwIfAborted();
    if (failure) throw failure;
  };
  try {
    for await (const chunk of child.stdout) {
      totalBytes += (chunk as Buffer).length;
      if (totalBytes > MAX_OUTPUT_BYTES) throw new Error('Death evidence output exceeds its size limit');
      pending += decoder.write(chunk as Buffer);
      let separator: number;
      while ((separator = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, separator).replace(/\r$/, '');
        pending = pending.slice(separator + 1);
        await accept(line);
      }
      if (Buffer.byteLength(pending) > MAX_LINE_BYTES) throw new Error('Death evidence line exceeds its size limit');
    }
    pending += decoder.end();
    if (pending.trim()) await accept(pending);
    const code = await closed;
    signal.throwIfAborted();
    if (failure) throw failure;
    if (code !== 0 || end?.status !== 'ok')
      throw new Error(end?.error || stderr.trim() || 'Death evidence extraction did not finish');
    const missing = new Set(end.missingTicks);
    if (
      end.emittedTicks !== frames.size ||
      missing.size !== end.missingTicks.length ||
      frames.size + missing.size !== wanted.size ||
      [...missing].some((tick) => !wanted.has(tick) || frames.has(tick))
    )
      throw new Error('Death evidence coverage does not match its requested windows');
    return end;
  } catch (error) {
    child.kill();
    await closed;
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}
