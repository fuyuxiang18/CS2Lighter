import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
const copy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('csdm/node/database/copy-csv-into-table', () => ({ copyCsvIntoTable: copy }));
import { insertMatchPositions } from './insert-match-positions';
beforeEach(() => {
  copy.mockReset();
  copy.mockResolvedValue(undefined);
});

describe('personal review position imports', () => {
  it('waits for other COPY streams to settle before reporting one failed stream', async () => {
    let release: () => void = () => {};
    copy.mockImplementation(({ tableName }: { tableName: string }) =>
      tableName === 'player_positions'
        ? new Promise<void>((resolve) => {
            release = resolve;
          })
        : tableName === 'grenade_positions'
          ? Promise.reject(new Error('fixture COPY failed'))
          : Promise.resolve(),
    );
    const run = insertMatchPositions({ demoName: 'fixture', outputFolderPath: '/qa/export' });
    const failed = vi.fn();
    void run.catch(failed);
    await Promise.resolve();
    await Promise.resolve();
    expect(failed).not.toHaveBeenCalled();
    release();
    await expect(run).rejects.toThrow('fixture COPY failed');
  });
  it('preserves player and utility tracks without inserting decorative chicken ticks', async () => {
    await insertMatchPositions({ demoName: 'fixture', outputFolderPath: '/qa/export' });
    expect(
      copy.mock.calls.map(([options]) => options.tableName).sort((a: string, b: string) => a.localeCompare(b)),
    ).toEqual(['grenade_positions', 'hostage_positions', 'inferno_positions', 'player_positions']);
  });
});
