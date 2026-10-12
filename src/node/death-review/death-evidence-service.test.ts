import { describe, expect, it, vi } from 'vite-plus/test';
import type { DeathEvidenceKey, DeathEvidenceReport, DeathEvidenceState } from 'csdm/common/types/death-evidence';
import { DeathEvidenceService } from './death-evidence-service';

const key: DeathEvidenceKey = { checksum: 'abc', steamId: '76561198000000001', deathId: 'first' };
function report(selected = key): DeathEvidenceReport {
  return {
    ...selected,
    version: 1,
    generatedAt: '',
    startTick: 1,
    endTick: 10,
    deathTick: 10,
    tickrate: 64,
    coverage: { requestedTicks: 10, decodedTicks: 9, missingTicks: 1, shots: 0 },
    geometry: { status: 'unavailable', mapName: 'de_nuke', match: 'unverified', reasons: [] },
    exposures: [],
    gunlines: [],
    spray: { status: 'blocked', reasons: [], points: [], findings: [] },
  };
}
function setup() {
  const states: DeathEvidenceState[] = [];
  const dependencies = {
    prepare: vi.fn(() => Promise.resolve({ revision: 'one' })),
    read: vi.fn((): Promise<DeathEvidenceReport | undefined> => Promise.resolve(undefined)),
    build: vi.fn<
      (selected: DeathEvidenceKey, context: { revision: string }, signal: AbortSignal) => Promise<DeathEvidenceReport>
    >((selected) => Promise.resolve(report(selected))),
    current: vi.fn(() => Promise.resolve(true)),
    write: vi
      .fn<(context: { revision: string }, report: DeathEvidenceReport, signal: AbortSignal) => Promise<void>>()
      .mockResolvedValue(undefined),
    canStart: vi.fn(() => true),
    changed: (state: DeathEvidenceState) => states.push(state),
  };
  return { service: new DeathEvidenceService(dependencies), dependencies, states };
}

describe('death evidence queue', () => {
  it('reads cached evidence without decoding or replacing missing ticks with completion', async () => {
    const { service, dependencies } = setup();
    dependencies.read.mockResolvedValue(report());
    const state = await service.inspect({ ...key, action: 'analyze' });
    expect(state.status).toBe('completed');
    expect([state.completedTicks, state.totalTicks]).toEqual([9, 10]);
    expect(dependencies.build).not.toHaveBeenCalled();
  });
  it('deduplicates overlapping requests and saves only the completed report', async () => {
    const { service, dependencies } = setup();
    await Promise.all([service.inspect({ ...key, action: 'analyze' }), service.inspect({ ...key, action: 'analyze' })]);
    await vi.waitFor(() => expect(service.isBusy()).toBe(false));
    expect(dependencies.build).toHaveBeenCalledTimes(1);
    expect(dependencies.write).toHaveBeenCalledTimes(1);
  });
  it('only refresh rebuilds a cached unavailable result and preserves it until the replacement is ready', async () => {
    const { service, dependencies } = setup();
    let stored: DeathEvidenceReport | undefined;
    dependencies.read.mockImplementation(() => Promise.resolve(stored));
    dependencies.write.mockImplementation((_, value) => {
      stored = value;
      return Promise.resolve();
    });
    await service.inspect({ ...key, action: 'analyze' });
    await vi.waitFor(() => expect(service.isBusy()).toBe(false));
    const first = (await service.inspect({ ...key, action: 'read' })).report;
    expect(first?.geometry.status).toBe('unavailable');
    expect((await service.inspect({ ...key, action: 'analyze' })).report).toEqual(first);
    expect(dependencies.build).toHaveBeenCalledTimes(1);
    let finish: ((value: DeathEvidenceReport) => void) | undefined;
    dependencies.build.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    expect((await service.inspect({ ...key, action: 'refresh' })).report).toEqual(first);
    const during = await service.inspect({ ...key, action: 'read' });
    expect(during.status).toBe('running');
    expect(during.report).toEqual(first);
    await service.inspect({ ...key, action: 'refresh' });
    expect(dependencies.build).toHaveBeenCalledTimes(2);
    const replacement = {
      ...report(),
      generatedAt: 'refreshed',
      geometry: {
        status: 'available' as const,
        mapName: 'de_nuke',
        match: 'installed-build-matched' as const,
        reasons: [],
      },
    };
    finish!(replacement);
    await vi.waitFor(() => expect(service.isBusy()).toBe(false));
    expect((await service.inspect({ ...key, action: 'read' })).report).toEqual(replacement);
    expect(dependencies.write).toHaveBeenCalledTimes(2);
  });
  it('keeps the saved result when a manual refresh fails or is canceled', async () => {
    const { service, dependencies, states } = setup();
    const previous = report();
    dependencies.read.mockResolvedValue(previous);
    dependencies.build.mockRejectedValueOnce(new Error('temporary failure'));
    await service.inspect({ ...key, action: 'refresh' });
    await vi.waitFor(() => expect(service.isBusy()).toBe(false));
    expect(states.at(-1)).toMatchObject({ status: 'error', report: previous });
    expect(dependencies.write).not.toHaveBeenCalled();
    dependencies.build.mockImplementationOnce(
      (_, __, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('canceled')), { once: true });
        }),
    );
    await service.inspect({ ...key, action: 'refresh' });
    expect((await service.inspect({ ...key, action: 'cancel' })).report).toEqual(previous);
    await vi.waitFor(() => expect(service.isBusy()).toBe(false));
    expect(states.at(-1)).toMatchObject({ status: 'canceled', report: previous });
    expect(dependencies.write).not.toHaveBeenCalled();
    expect((await service.inspect({ ...key, action: 'read' })).report).toEqual(previous);
  });
  it('does not requeue when an overlapping cache miss returns after the worker completed', async () => {
    const { service, dependencies } = setup();
    let finishRead: (() => void) | undefined;
    dependencies.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = () => resolve(undefined);
        }),
    );
    const delayed = service.inspect({ ...key, action: 'analyze' });
    await vi.waitFor(() => expect(finishRead).toBeDefined());
    await service.inspect({ ...key, action: 'analyze' });
    await vi.waitFor(() => expect(service.isBusy()).toBe(false));
    finishRead!();
    expect((await delayed).status).toBe('completed');
    expect(dependencies.build).toHaveBeenCalledTimes(1);
  });
  it('kills a canceled running job and lets the next queued death run', async () => {
    const { service, dependencies, states } = setup();
    dependencies.build.mockImplementationOnce(
      (...[, , signal]) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('canceled')), { once: true });
        }),
    );
    await service.inspect({ ...key, action: 'analyze' });
    await service.inspect({ ...key, deathId: 'second', action: 'analyze' });
    expect((await service.inspect({ ...key, action: 'cancel' })).status).toBe('canceled');
    await vi.waitFor(() => expect(service.isBusy()).toBe(false));
    expect(dependencies.write).toHaveBeenCalledTimes(1);
    expect(dependencies.write.mock.calls[0]?.[1]).toMatchObject({ deathId: 'second' });
    expect(states.some((state) => state.deathId === 'second' && state.status === 'completed')).toBe(true);
    expect((await service.inspect({ ...key, action: 'read' })).status).toBe('canceled');
  });
  it('removes queued work on cancel, and rejects a report after its demo changed', async () => {
    const { service, dependencies } = setup();
    let finish: (() => void) | undefined;
    dependencies.build.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return report();
    });
    dependencies.current.mockResolvedValue(false);
    await service.inspect({ ...key, action: 'analyze' });
    await service.inspect({ ...key, deathId: 'second', action: 'analyze' });
    await service.inspect({ ...key, deathId: 'second', action: 'cancel' });
    finish!();
    await vi.waitFor(() => expect(service.isBusy()).toBe(false));
    expect(dependencies.build).toHaveBeenCalledTimes(1);
    expect(dependencies.write).not.toHaveBeenCalled();
    expect((await service.inspect({ ...key, action: 'read' })).status).toBe('error');
  });
  it('a read does not start a task and update maintenance blocks new work', async () => {
    const { service, dependencies } = setup();
    expect((await service.inspect({ ...key, action: 'read' })).status).toBe('idle');
    dependencies.canStart.mockReturnValue(false);
    await expect(service.inspect({ ...key, action: 'analyze' })).rejects.toThrow('update');
    expect(dependencies.build).not.toHaveBeenCalled();
  });
});
