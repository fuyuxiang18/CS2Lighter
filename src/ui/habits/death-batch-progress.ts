import type { DeathEvidenceKey, DeathEvidenceState } from 'csdm/common/types/death-evidence';

export type DeathBatchItem = DeathEvidenceKey & Pick<DeathEvidenceState, 'status' | 'completedTicks' | 'totalTicks'>;

export function deathBatchKey(key: DeathEvidenceKey) {
  return JSON.stringify([key.checksum, key.steamId, key.deathId]);
}

export function deathBatchProgress(items: DeathBatchItem[]) {
  let completed = 0;
  let failed = 0;
  let canceled = 0;
  let fraction = 0;
  for (const item of items) {
    if (item.status === 'completed') completed++;
    else if (item.status === 'error') failed++;
    else if (item.status === 'canceled') canceled++;
    else if (item.status === 'running' && item.totalTicks > 0)
      fraction += Math.min(0.99, Math.max(0, item.completedTicks / item.totalTicks));
  }
  const settled = completed + failed + canceled;
  return {
    completed,
    failed,
    canceled,
    settled,
    total: items.length,
    active: settled < items.length,
    fraction: settled + fraction,
  };
}
