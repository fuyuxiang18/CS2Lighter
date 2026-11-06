import type { DeathEvidenceState } from 'csdm/common/types/death-evidence';
import { deathBatchKey, type DeathBatchItem } from './death-batch-progress';

const storageKey = 'cs2lighter.death-evidence-batch.v1';
const statuses = new Set(['idle', 'queued', 'running', 'completed', 'canceled', 'error']);

function compact(item: DeathBatchItem): DeathBatchItem {
  const { checksum, steamId, deathId, status, completedTicks, totalTicks } = item;
  return { checksum, steamId, deathId, status, completedTicks, totalTicks };
}

export function parseDeathBatch(value: string | null): DeathBatchItem[] {
  if (!value || value.length > 65536) return [];
  try {
    const data: unknown = JSON.parse(value);
    if (!data || typeof data !== 'object' || !('version' in data) || data.version !== 1 || !('items' in data))
      return [];
    if (!Array.isArray(data.items)) return [];
    const result = new Map<string, DeathBatchItem>();
    for (const item of data.items.slice(0, 32)) {
      if (
        !item ||
        typeof item !== 'object' ||
        typeof item.checksum !== 'string' ||
        !/^[a-f0-9]{1,64}$/.test(item.checksum) ||
        typeof item.steamId !== 'string' ||
        !/^\d{17}$/.test(item.steamId) ||
        typeof item.deathId !== 'string' ||
        item.deathId.length < 1 ||
        item.deathId.length > 256 ||
        !statuses.has(item.status) ||
        !Number.isSafeInteger(item.completedTicks) ||
        item.completedTicks < 0 ||
        !Number.isSafeInteger(item.totalTicks) ||
        item.totalTicks < 0 ||
        item.completedTicks > item.totalTicks
      )
        continue;
      result.set(deathBatchKey(item), compact(item));
    }
    return [...result.values()];
  } catch {
    return [];
  }
}

export function loadDeathBatch(): DeathBatchItem[] {
  try {
    return parseDeathBatch(localStorage.getItem(storageKey));
  } catch {
    return [];
  }
}

export function saveDeathBatch(items: DeathBatchItem[]) {
  try {
    localStorage.setItem(storageKey, JSON.stringify({ version: 1, items: items.slice(0, 32).map(compact) }));
  } catch {
    // A storage quota or disabled storage must not interrupt a running analysis.
  }
}

type ReplyToken = { generation: number; sequence: number };

/** Request replies cannot overwrite newer pushes, a resumed batch, or a new user selection. */
export class DeathBatchTracker {
  private items = new Map<string, DeathBatchItem>();
  private sequences = new Map<string, number>();
  private generation = 0;

  constructor(items: DeathBatchItem[]) {
    this.replace(items);
  }

  snapshot() {
    return [...this.items.values()];
  }

  replace(items: DeathBatchItem[]) {
    this.generation++;
    this.sequences.clear();
    this.items = new Map(items.slice(0, 32).map((item) => [deathBatchKey(item), compact(item)]));
  }

  token(key: string): ReplyToken {
    return { generation: this.generation, sequence: this.sequences.get(key) ?? 0 };
  }

  push(state: DeathEvidenceState): boolean {
    const key = deathBatchKey(state);
    if (!this.items.has(key)) return false;
    this.sequences.set(key, (this.sequences.get(key) ?? 0) + 1);
    this.items.set(key, compact(state));
    return true;
  }

  reply(state: DeathBatchItem, token: ReplyToken, hydration = false): boolean {
    const key = deathBatchKey(state);
    if (
      !this.items.has(key) ||
      token.generation !== this.generation ||
      token.sequence !== (this.sequences.get(key) ?? 0)
    )
      return false;
    // A restarted server has no running job. Restoring the UI must never restart parsing itself.
    this.items.set(key, {
      ...compact(state),
      status: hydration && state.status === 'idle' ? 'canceled' : state.status,
    });
    return true;
  }
}
