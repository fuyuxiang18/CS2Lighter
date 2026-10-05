import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const mocks = vi.hoisted(() => ({
  copy: vi.fn(),
  remove: vi.fn(),
  cleanup: vi.fn(),
  begin: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('csdm/node/database/copy-csv-into-table', () => ({ copyCsvIntoTable: mocks.copy }));
vi.mock('./delete-matches-by-checksums', () => ({ deleteMatchesByChecksums: mocks.remove }));
vi.mock('./match-import-state', () => ({
  beginMatchImport: mocks.begin,
  completeMatchImport: mocks.complete,
  failMatchImport: mocks.fail,
}));
vi.mock('csdm/node/demo-cache/invalidate-demo-cache', () => ({ invalidateDemoCaches: mocks.invalidate }));
vi.mock('./match-insertion', () => ({
  deleteCsvFilesInOutputFolder: mocks.cleanup,
  getDemoNameFromPath: () => 'fixture',
  getCsvFilePath: () => '/qa/fixture.csv',
}));
vi.mock('../database', () => ({
  db: { insertInto: () => ({ values: () => ({ onConflict: () => ({ execute: () => Promise.resolve() }) }) }) },
}));
vi.mock('@fast-csv/parse', () => ({
  parseFile: () => {
    const parser = new EventEmitter();
    queueMicrotask(() => {
      parser.emit('data', [
        'aa',
        'cs2',
        'fixture',
        '2026-01-01',
        'unknown',
        'GOTV',
        '',
        'de_mirage',
        'server',
        'client',
        '1000',
        '64',
        '64',
        '16',
        '1',
        '1',
      ]);
      parser.emit('end');
    });
    return parser;
  },
}));
const { insertMatch } = await import('./insert-match');
beforeEach(() => {
  vi.resetAllMocks();
  mocks.copy.mockResolvedValue(undefined);
});

describe('complete match publication', () => {
  it('keeps a durable barrier until every COPY finishes, then invalidates early caches before releasing the match', async () => {
    let finish: () => void = () => {};
    mocks.copy.mockImplementation(({ tableName }: { tableName: string }) =>
      tableName === 'player_positions'
        ? new Promise<void>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(),
    );
    const run = insertMatch({ checksum: 'aa', demoPath: '/qa/fixture.dem', outputFolderPath: '/qa/export' });
    await vi.waitFor(() =>
      expect(mocks.copy).toHaveBeenCalledWith(expect.objectContaining({ tableName: 'player_positions' })),
    );
    expect(mocks.begin).toHaveBeenCalledBefore(mocks.remove);
    expect(mocks.complete).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
    finish();
    await run;
    expect(mocks.invalidate).toHaveBeenCalledWith(['aa']);
    expect(mocks.invalidate).toHaveBeenCalledBefore(mocks.complete);
    expect(mocks.complete).toHaveBeenCalledWith('aa');
    expect(mocks.fail).not.toHaveBeenCalled();
  });
  it('does not roll back or remove CSVs while another COPY is still writing after a sibling fails', async () => {
    let finish: () => void = () => {};
    mocks.copy.mockImplementation(({ tableName }: { tableName: string }) =>
      tableName === 'player_positions'
        ? new Promise<void>((resolve) => {
            finish = resolve;
          })
        : tableName === 'kills'
          ? Promise.reject(new Error('fixture failed COPY'))
          : Promise.resolve(),
    );
    const run = insertMatch({ checksum: 'aa', demoPath: '/qa/fixture.dem', outputFolderPath: '/qa/export' });
    const rejected = expect(run).rejects.toThrow('fixture failed COPY');
    await vi.waitFor(() =>
      expect(mocks.copy).toHaveBeenCalledWith(expect.objectContaining({ tableName: 'player_positions' })),
    );
    expect(mocks.remove).toHaveBeenCalledTimes(1);
    expect(mocks.cleanup).not.toHaveBeenCalled();
    expect(mocks.fail).not.toHaveBeenCalled();
    finish();
    await rejected;
    expect(mocks.remove).toHaveBeenCalledTimes(2);
    expect(mocks.fail).toHaveBeenCalledWith('aa');
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
