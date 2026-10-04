import { describe, expect, it, vi } from 'vite-plus/test';
import type { Download } from 'csdm/common/download/download-types';

const mocks = vi.hoisted(() => ({ validateFolder: vi.fn(), checkLink: vi.fn() }));
vi.mock('csdm/server/server', () => ({ server: { sendPushMessage: vi.fn() } }));
vi.mock('csdm/node/download/assert-download-folder-is-valid', () => ({
  assertDownloadFolderIsValid: mocks.validateFolder,
}));
vi.mock('csdm/node/download/is-download-link-expired', () => ({ isDownloadLinkExpired: mocks.checkLink }));
vi.mock('csdm/node/demo/load-demo-by-path', () => ({ loadDemoByPath: vi.fn() }));
vi.mock('csdm/node/demo/get-demo-from-file-path', () => ({ getDemoFromFilePath: vi.fn() }));
vi.mock('csdm/node/database/download-history/insert-download-history', () => ({ insertDownloadHistory: vi.fn() }));
vi.mock('csdm/node/database/demos/insert-demos', () => ({ insertDemos: vi.fn() }));

describe('disabled demo download queue', () => {
  it('rejects single and batch downloads before touching destinations or checking network links', async () => {
    const { downloadDemoQueue } = await import('./download-queue');
    const download = { matchId: 'test', demoUrl: 'https://example.invalid/demo.dem' } as Download;
    await expect(downloadDemoQueue.addDownload(download)).rejects.toThrow('disabled');
    await expect(downloadDemoQueue.addDownloads([download])).rejects.toThrow('disabled');
    expect(mocks.validateFolder).not.toHaveBeenCalled();
    expect(mocks.checkLink).not.toHaveBeenCalled();
    expect(downloadDemoQueue.getDownloads()).toEqual([]);
    expect(downloadDemoQueue.hasDownloads()).toBe(false);
  });
});
