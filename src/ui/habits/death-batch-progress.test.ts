import { describe, expect, it } from 'vite-plus/test';
import { deathBatchKey, deathBatchProgress, type DeathBatchItem } from './death-batch-progress';

function item(status: DeathBatchItem['status'], completedTicks = 0, totalTicks = 0): DeathBatchItem {
  return { checksum: 'aa', steamId: '1', deathId: '1', status, completedTicks, totalTicks };
}

describe('batch evidence progress', () => {
  it('counts cached successes, failed and canceled jobs separately and waits for persistence', () => {
    expect(
      deathBatchProgress([item('completed'), item('error'), item('canceled'), item('running', 20, 20), item('queued')]),
    ).toEqual({ completed: 1, failed: 1, canceled: 1, settled: 3, total: 5, active: true, fraction: 3.99 });
    expect(deathBatchProgress([item('completed'), item('error')]).active).toBe(false);
  });
  it('keeps different matches and players separate even with the same local death id', () => {
    expect(deathBatchKey(item('queued'))).not.toBe(deathBatchKey({ ...item('queued'), checksum: 'bb' }));
    expect(deathBatchKey(item('queued'))).not.toBe(deathBatchKey({ ...item('queued'), steamId: '2' }));
  });
});
