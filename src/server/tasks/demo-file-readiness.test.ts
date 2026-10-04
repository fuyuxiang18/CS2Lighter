import { describe, expect, it } from 'vite-plus/test';
import { DemoFileReadiness, getDemoFileFingerprint, shouldSkipDemoImport } from './demo-file-readiness';

describe('automatic demo import readiness', () => {
  it('waits for stability even for a file present at startup', () => {
    const readiness = new DemoFileReadiness();
    expect(readiness.isReady('a.dem', '100:1', 0, 10000)).toBe(false);
    expect(readiness.isReady('a.dem', '100:1', 9999, 10000)).toBe(false);
    expect(readiness.isReady('a.dem', '100:1', 10000, 10000)).toBe(true);
  });

  it('starts a new stability window when a download grows or overwrites the same number of bytes', () => {
    const readiness = new DemoFileReadiness();
    readiness.isReady('a.dem', '100:1', 0, 10000);
    expect(readiness.isReady('a.dem', '200:2', 10000, 10000)).toBe(false);
    expect(readiness.isReady('a.dem', '200:3', 20000, 10000)).toBe(false);
    expect(readiness.isReady('a.dem', '200:3', 30000, 10000)).toBe(true);
    expect(getDemoFileFingerprint({ size: 200, mtimeMs: 3 })).toBe('200:3');
  });

  it('tracks several folders independently and waits again after a file disappears', () => {
    const readiness = new DemoFileReadiness();
    readiness.isReady('/one/a.dem', '100:1', 0, 10000);
    readiness.isReady('/two/a.dem', '200:2', 5000, 10000);
    expect(readiness.isReady('/one/a.dem', '100:1', 10000, 10000)).toBe(true);
    expect(readiness.isReady('/two/a.dem', '200:2', 10000, 10000)).toBe(false);
    readiness.removeMissingFiles(new Set(['/two/a.dem']));
    expect(readiness.isReady('/one/a.dem', '100:1', 20000, 10000)).toBe(false);
    readiness.clear();
    expect(readiness.isReady('/two/a.dem', '200:2', 30000, 10000)).toBe(false);
  });

  it('does not repeatedly analyze an unchanged corrupt file, but retries a changed download', () => {
    const failed = { fingerprint: '100:1', failed: true };
    expect(shouldSkipDemoImport(failed, '100:1', new Set())).toBe(true);
    expect(shouldSkipDemoImport(failed, '101:2', new Set())).toBe(false);
    expect(shouldSkipDemoImport(failed, '100:2', new Set())).toBe(false);
  });

  it('skips imported duplicates only while their checksum is present in the current database', () => {
    const imported = { fingerprint: '100:1', failed: false, checksum: 'match-one' };
    expect(shouldSkipDemoImport(imported, '100:1', new Set(['match-one']))).toBe(true);
    expect(shouldSkipDemoImport(imported, '100:1', new Set())).toBe(false);
    expect(shouldSkipDemoImport(undefined, '100:1', new Set(['match-one']))).toBe(false);
  });
});
