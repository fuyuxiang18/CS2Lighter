import { describe, expect, it, vi } from 'vite-plus/test';

const mocks = vi.hoisted(() => ({
  buildShareCode: vi.fn(),
  faceit: vi.fn(),
  valve: vi.fn(),
  fiveEPlay: vi.fn(),
  renown: vi.fn(),
  add: vi.fn(),
}));
vi.mock('csdm/node/download/build-download-from-share-code', () => ({
  buildDownloadFromShareCode: mocks.buildShareCode,
}));
vi.mock('csdm/node/faceit/fetch-last-faceit-matches', () => ({ fetchLastFaceitMatches: mocks.faceit }));
vi.mock('csdm/node/valve-match/fetch-last-valve-matches', () => ({ fetchLastValveMatches: mocks.valve }));
vi.mock('csdm/node/5eplay/fetch-last-5eplay-matches', () => ({ fetchLast5EPlayMatches: mocks.fiveEPlay }));
vi.mock('csdm/node/renown/fetch-last-renown-matches', () => ({ fetchLastRenownMatches: mocks.renown }));
vi.mock('csdm/server/server', () => ({ server: { sendPushMessage: vi.fn() } }));
vi.mock('csdm/server/download-queue', () => ({ downloadDemoQueue: { addDownload: mocks.add } }));

describe('disabled network demo entry points', () => {
  it('rejects share codes before looking them up or enqueueing a download', async () => {
    const { addDownloadFromShareCodeHandler } =
      await import('./handlers/renderer-process/download/add-download-from-share-code-handler');
    await expect(addDownloadFromShareCodeHandler('CSGO-ignored')).rejects.toThrow('disabled');
    expect(mocks.buildShareCode).not.toHaveBeenCalled();
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('rejects all remote match lists without calling a network provider', async () => {
    const { fetchLastValveMatchesHandler } =
      await import('./handlers/renderer-process/download/fetch-last-valve-matches-handler');
    const { fetchLastFaceitMatchesHandler } =
      await import('./handlers/renderer-process/faceit/fetch-last-faceit-matches-handler');
    const { fetchLast5EPlayMatchesHandler } =
      await import('./handlers/renderer-process/5eplay/fetch-last-5eplay-matches-handler');
    const { fetchLastRenownMatchesHandler } =
      await import('./handlers/renderer-process/renown/fetch-last-renown-matches-handler');
    await expect(fetchLastValveMatchesHandler()).rejects.toThrow('disabled');
    await expect(fetchLastFaceitMatchesHandler('id')).rejects.toThrow('disabled');
    await expect(fetchLast5EPlayMatchesHandler('id')).rejects.toThrow('disabled');
    await expect(fetchLastRenownMatchesHandler('id')).rejects.toThrow('disabled');
    for (const provider of [mocks.valve, mocks.faceit, mocks.fiveEPlay, mocks.renown]) {
      expect(provider).not.toHaveBeenCalled();
    }
  });
});
