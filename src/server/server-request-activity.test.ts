import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

const mocks = vi.hoisted(() => ({ maintenance: vi.fn(() => false) }));
vi.mock('csdm/server/update-maintenance', () => ({ isUpdateMaintenance: mocks.maintenance }));
vi.mock('csdm/server/handlers/renderer-handlers-mapping', () => ({ rendererHandlers: {} }));
vi.mock('csdm/server/handlers/main-handlers-mapping', () => ({ mainHandlers: {} }));
vi.mock('csdm/server/handlers/cli-handlers-mapping', () => ({ cliHandlers: {}, probeHandlers: {} }));
vi.mock('csdm/server/video-queue', () => ({ videoQueue: {} }));
vi.mock('csdm/server/analyses-listener', () => ({ analysesListener: {} }));
vi.mock('csdm/node/daemon/probe-daemon', () => ({ probeDaemon: vi.fn() }));
vi.mock('csdm/node/daemon/daemon-info-file', () => ({ readDaemonInfoFile: vi.fn() }));
vi.mock('csdm/node/os/is-process-alive', () => ({ isProcessAlive: vi.fn() }));
vi.stubGlobal('logger', { warn: vi.fn(), error: vi.fn() });

const { server, getActiveRequestCount } = await import('./server');
type Dispatch = (
  socket: { send: (data: string) => void },
  handlers: Record<string, () => Promise<unknown>>,
  message: { name: string; uuid: string },
) => Promise<void>;
// Exercise the dispatcher without binding a port or importing real application handlers.
const dispatch = Reflect.get(server, 'dispatchMessageToHandlers') as Dispatch;

beforeEach(() => mocks.maintenance.mockReturnValue(false));

describe('server request activity', () => {
  it('tracks overlapping awaited work and releases each request after success or failure', async () => {
    let resolveExport: (value: unknown) => void = () => {};
    let rejectVoice: (reason: unknown) => void = () => {};
    const socket = { send: vi.fn() };
    const handlers = {
      export: () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        }),
      voice: () =>
        new Promise((_resolve, reject) => {
          rejectVoice = reject;
        }),
    };
    const first = dispatch(socket, handlers, { name: 'export', uuid: 'one' });
    const second = dispatch(socket, handlers, { name: 'voice', uuid: 'two' });
    expect(getActiveRequestCount()).toBe(2);
    resolveExport(undefined);
    await first;
    expect(getActiveRequestCount()).toBe(1);
    rejectVoice(new Error('export failed'));
    await second;
    expect(getActiveRequestCount()).toBe(0);
    expect(socket.send.mock.calls.map(([data]) => JSON.parse(data).name)).toEqual(['reply', 'reply-error']);
  });

  it('does not count the update preparation request itself', async () => {
    const prepare = vi.fn(() => {
      expect(getActiveRequestCount()).toBe(0);
      return Promise.resolve(true);
    });
    await dispatch({ send: vi.fn() }, { 'prepare-for-update': prepare }, { name: 'prepare-for-update', uuid: 'one' });
    expect(prepare).toHaveBeenCalledOnce();
    expect(getActiveRequestCount()).toBe(0);
  });

  it('rejects requests during maintenance without invoking a handler or leaking the count', async () => {
    mocks.maintenance.mockReturnValue(true);
    const handler = vi.fn(() => Promise.resolve());
    await dispatch({ send: vi.fn() }, { export: handler }, { name: 'export', uuid: 'one' });
    expect(handler).not.toHaveBeenCalled();
    expect(getActiveRequestCount()).toBe(0);
  });
});
