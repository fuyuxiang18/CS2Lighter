import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { CorruptedDemoError } from './corrupted-demo-error';

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), mkdir: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }));
vi.mock('node:fs/promises', () => ({ default: { mkdir: mocks.mkdir } }));
vi.mock('csdm/node/filesystem/get-static-folder-path', () => ({ getStaticFolderPath: () => 'D:/qa/static' }));
vi.mock('csdm/node/os/is-windows', () => ({ isWindows: true }));
const { runDemoAnalyzer } = await import('./run-demo-analyzer');
let child: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
beforeEach(() => {
  vi.clearAllMocks();
  child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
  mocks.spawn.mockReturnValue(child);
});
const options = { demoPath: 'D:/qa/demo with spaces.dem', outputFolderPath: 'D:/qa/output', analyzePositions: true };

describe('owned analyzer process', () => {
  it('passes paths as arguments without a shell and keeps cancellation pending until the child pipes close', async () => {
    const controller = new AbortController();
    const onEnd = vi.fn();
    const run = runDemoAnalyzer({ ...options, signal: controller.signal, onEnd });
    const rejected = expect(run).rejects.toThrow('cancelled fixture');
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.stringMatching(/csda\.exe$/),
      expect.arrayContaining([
        `-demo-path=${options.demoPath}`,
        `-output=${options.outputFolderPath}`,
        '-positions=true',
      ]),
      { windowsHide: true, signal: controller.signal },
    );
    controller.abort(new Error('cancelled fixture'));
    child.emit('error', new Error('AbortError'));
    expect(onEnd).not.toHaveBeenCalled();
    child.emit('close', null);
    await rejected;
    expect(onEnd).toHaveBeenCalledWith(-1);
  });
  it('reports corrupted output only after exit so the recovery path cannot read incomplete writes', async () => {
    const run = runDemoAnalyzer(options);
    const rejected = expect(run).rejects.toBeInstanceOf(CorruptedDemoError);
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    expect(() => child.stderr.emit('data', Buffer.from('ErrUnexpectedEndOfDemo'))).not.toThrow();
    child.emit('close', 1);
    await rejected;
  });
  it('does not start a process when its request was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runDemoAnalyzer({ ...options, signal: controller.signal })).rejects.toThrow();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});
