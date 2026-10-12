import { expect, it, vi } from 'vite-plus/test';
import { DemoSource, GameMode, TeamNumber } from 'csdm/common/types/counter-strike';
import type { DeathReviewRecord } from 'csdm/common/types/death-review';
import type { DeathRiskReport } from 'csdm/common/types/death-risk';
import { DEATH_RISK_REVISION, DEATH_RISK_RULES } from 'csdm/common/death-review/death-risk-rules';
import type { DeathMatchDescriptor } from './death-review-cache';
import { DeathReviewService } from './death-review-service';

const steamId = '76561198000000001';
const otherId = '76561198000000002';
function match(checksum = 'a'): DeathMatchDescriptor {
  return {
    checksum,
    name: `${checksum}.dem`,
    analyzeDate: '2026-10-12T01:00:00.000Z',
    mapName: 'de_dust2',
    date: '2026-10-11T01:00:00.000Z',
    source: DemoSource.Valve,
    tickrate: 64,
    networkProtocol: 14089,
    gameMode: GameMode.Competitive,
    shotCount: 4,
  };
}
function record(index = 0, overrides: Partial<DeathReviewRecord> = {}): DeathReviewRecord {
  return {
    id: `a:${index}`,
    checksum: 'a',
    steamId,
    mapName: 'de_dust2',
    date: '2026-10-11T01:00:00.000Z',
    source: DemoSource.Valve,
    roundNumber: index + 1,
    side: TeamNumber.T,
    eventTick: 1000 + index,
    startTick: 900,
    endTick: 1100 + index,
    tickrate: 64,
    kind: 'enemy',
    killerSteamId: otherId,
    killerName: 'Synthetic opponent',
    weapon: 'AK-47',
    roundWon: false,
    distance: 500,
    range: 'medium',
    healthBeforeHit: 100,
    teammatesAlive: null,
    enemiesAlive: null,
    findings: [],
    evaluatedRules: [],
    missingSignals: [],
    timeline: [],
    recordingRequest: null,
    ...overrides,
  };
}
function fixture(matches = [match()]) {
  const caches = new Map<string, DeathReviewRecord[]>();
  const dependencies = {
    listMatches: vi.fn(() => Promise.resolve(matches)),
    read: vi.fn((demo: DeathMatchDescriptor) => Promise.resolve(caches.get(demo.checksum))),
    build: vi.fn((demo: DeathMatchDescriptor) => Promise.resolve([record(0, { checksum: demo.checksum })])),
    isCurrent: vi.fn(() => Promise.resolve(true)),
    write: vi.fn((demo: DeathMatchDescriptor, records: DeathReviewRecord[]) => {
      caches.set(demo.checksum, records);
      return Promise.resolve();
    }),
    canStart: vi.fn(() => true),
    changed: vi.fn(),
  };
  const service = new DeathReviewService(dependencies);
  return { service, dependencies, caches };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function riskReport(matched = false): DeathRiskReport {
  return {
    version: 1,
    ruleRevision: DEATH_RISK_REVISION,
    status: 'evaluated',
    findings: matched
      ? [
          {
            id: 'risk-13',
            ruleId: 'r13',
            relatedRuleIds: [],
            startTick: 990,
            endTick: 1000,
            priority: 95,
            targetIds: [otherId],
            evidence: [{ code: 'incoming-hit', tick: 1000, values: { damage: 40 }, sources: ['event:damage'] }],
            advice: { code: 'wait-out-blindness-in-cover', values: {} },
          },
        ]
      : [],
    selectedFindingIds: matched ? ['risk-13'] : [],
    evaluations: DEATH_RISK_RULES.map((rule) => ({
      ruleId: rule.id,
      status: matched && rule.id === 'r13' ? 'matched' : 'clear',
      reasons: [],
      findingIds: matched && rule.id === 'r13' ? ['risk-13'] : [],
    })),
  };
}

it('returns a progress snapshot before generation and then reuses each all-player cache', async () => {
  const { service, dependencies } = fixture([match('a'), match('b')]);
  const pending = deferred<DeathReviewRecord[]>();
  dependencies.build.mockImplementationOnce(() => pending.promise);
  const first = await service.fetch({ steamId });
  expect(first.progress.status).toBe('running');
  expect(first.coverage).toEqual({
    availableMatches: 2,
    readyMatches: 0,
    missingMatches: 2,
    failedMatches: 0,
  });
  expect(service.isBusy()).toBe(true);
  pending.resolve([record()]);
  await vi.waitFor(() => expect(service.isBusy()).toBe(false));
  const ready = await service.fetch({ steamId });
  expect(ready.progress.completed).toBe(2);
  expect(ready.progress.failed).toBe(0);
  expect(ready.total).toBe(2);
  expect(dependencies.build).toHaveBeenCalledTimes(2);
  await service.fetch({ steamId, page: 2 });
  expect(dependencies.build).toHaveBeenCalledTimes(2);
});

it('filters the full death collection before paging and keeps scope IDs independent of page and finding', async () => {
  const { service, caches, dependencies } = fixture();
  const records = Array.from({ length: 55 }, (_, index) =>
    record(index, {
      evaluatedRules: ['opening_death'],
      risk: riskReport(index >= 22),
      findings:
        index >= 22
          ? [
              {
                code: 'died_flashed',
                category: 'utility',
                kind: 'review',
                evidenceTicks: [1000],
                measures: [],
              },
            ]
          : [],
    }),
  );
  records.push(
    record(60, { steamId: otherId }),
    record(61, { side: TeamNumber.CT, evaluatedRules: ['opening_death'], missingSignals: ['positions'] }),
  );
  caches.set('a', records);
  const filtered = await service.fetch({
    steamId,
    side: TeamNumber.T,
    findingCode: 'r13',
    page: 1,
  });
  expect(filtered.total).toBe(33);
  expect(filtered.items).toHaveLength(13);
  expect(filtered.items[0].roundNumber).toBe(43);
  expect(filtered.totals).toEqual({ deaths: 55, flagged: 33, needsData: 0, analyzed: 55 });
  const all = await service.fetch({ steamId, side: TeamNumber.T });
  expect(all.progress.id).toBe(filtered.progress.id);
  const otherSide = await service.fetch({ steamId, side: TeamNumber.CT, filter: 'needs-data' });
  expect(otherSide.progress.id).not.toBe(filtered.progress.id);
  expect(otherSide.total).toBe(1);
  expect(dependencies.build).not.toHaveBeenCalled();
});

it('does not count legacy state tags as action risks or silently treat missing evidence as analyzed', async () => {
  const { service, caches } = fixture();
  caches.set('a', [
    record(0, {
      evaluatedRules: ['opening_death'],
      findings: [
        { code: 'first_shot_high_speed', category: 'mechanics', kind: 'review', evidenceTicks: [1000], measures: [] },
      ],
    }),
    record(1, { evaluatedRules: ['opening_death'], risk: riskReport() }),
    record(2, { evaluatedRules: ['opening_death'], risk: riskReport(true) }),
  ]);
  const all = await service.fetch({ steamId });
  expect(all.totals).toEqual({ deaths: 3, flagged: 1, needsData: 1, analyzed: 2 });
  const flagged = await service.fetch({ steamId, filter: 'flagged' });
  expect(flagged.items.map((item) => item.id)).toEqual(['a:2']);
  const missing = await service.fetch({ steamId, filter: 'needs-data' });
  expect(missing.items.map((item) => item.id)).toEqual(['a:0']);
});

it('cancels without saving late results, does not restart on fetch, and resumes only on explicit retry', async () => {
  const { service, dependencies, caches } = fixture([match('a'), match('b')]);
  caches.set('a', [record()]);
  const pending = deferred<DeathReviewRecord[]>();
  dependencies.build.mockImplementationOnce(() => pending.promise);
  await service.fetch({ steamId });
  await vi.waitFor(() => expect(dependencies.build).toHaveBeenCalledTimes(1));
  const canceled = await service.control({ steamId, action: 'cancel' });
  expect(canceled.status).toBe('canceled');
  expect(canceled.completed).toBe(1);
  pending.resolve([record(1, { checksum: 'b' })]);
  await vi.waitFor(() => expect(service.isBusy()).toBe(false));
  expect(dependencies.write).not.toHaveBeenCalled();
  expect((await service.fetch({ steamId })).progress.status).toBe('canceled');
  expect(dependencies.build).toHaveBeenCalledTimes(1);
  await service.control({ steamId, action: 'retry' });
  await vi.waitFor(() => expect(service.isBusy()).toBe(false));
  expect((await service.fetch({ steamId })).progress.completed).toBe(2);
  expect(dependencies.build).toHaveBeenCalledTimes(2);
});

it('exposes a failed match instead of an empty successful result and retries missing data only', async () => {
  const { service, dependencies, caches } = fixture([match('a'), match('b')]);
  caches.set('a', [record()]);
  dependencies.build.mockRejectedValueOnce(new Error('Synthetic database read failure'));
  await service.fetch({ steamId });
  await vi.waitFor(() => expect(service.isBusy()).toBe(false));
  const page = await service.fetch({ steamId });
  expect(page.coverage).toEqual({
    availableMatches: 2,
    readyMatches: 1,
    missingMatches: 0,
    failedMatches: 1,
  });
  expect(page.progress.errors).toEqual([{ checksum: 'b', reason: 'Synthetic database read failure' }]);
  expect(page.progress.completed).toBe(1);
  expect(dependencies.build).toHaveBeenCalledTimes(1);
  await service.control({ steamId, action: 'retry' });
  await vi.waitFor(() => expect(service.isBusy()).toBe(false));
  expect((await service.fetch({ steamId })).progress.failed).toBe(0);
});

it('rejects results when the match revision changes during the build', async () => {
  const { service, dependencies } = fixture();
  dependencies.isCurrent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  await service.fetch({ steamId });
  await vi.waitFor(() => expect(service.isBusy()).toBe(false));
  expect(dependencies.write).not.toHaveBeenCalled();
  const page = await service.fetch({ steamId });
  expect(page.progress.failed).toBe(1);
  expect(page.progress.errors[0].reason).toContain('Match changed');
});

it('serializes scopes and shares all-player files across identities', async () => {
  const { service, dependencies } = fixture();
  const pending = deferred<DeathReviewRecord[]>();
  dependencies.build.mockImplementationOnce(() => pending.promise);
  await service.fetch({ steamId });
  await service.fetch({ steamId: otherId });
  await vi.waitFor(() => expect(dependencies.build).toHaveBeenCalledTimes(1));
  pending.resolve([record(), record(1, { steamId: otherId })]);
  await vi.waitFor(() => expect(service.isBusy()).toBe(false));
  expect(dependencies.build).toHaveBeenCalledTimes(1);
  expect((await service.fetch({ steamId: otherId })).items.map((item) => item.steamId)).toEqual([otherId]);
});

it('does not start work during updates and handles an empty scope without a fake missing match', async () => {
  const { service, dependencies } = fixture();
  dependencies.canStart.mockReturnValue(false);
  expect((await service.fetch({ steamId })).progress.status).toBe('idle');
  expect(dependencies.build).not.toHaveBeenCalled();
  await expect(service.control({ steamId, action: 'retry' })).rejects.toThrow('update');
  dependencies.listMatches.mockResolvedValue([]);
  const empty = await service.fetch({ steamId, mapName: 'de_nuke' });
  expect(empty.progress.status).toBe('completed');
  expect(empty.coverage.availableMatches).toBe(0);
  expect(empty.items).toEqual([]);
});

it('validates identifiers and exposes cache read failures rather than silently treating them as zero deaths', async () => {
  const { service, dependencies } = fixture();
  await expect(service.fetch({ steamId: '../invalid' })).rejects.toThrow('Invalid');
  await expect(service.fetch({ steamId, checksum: '../file' })).rejects.toThrow('Invalid');
  await expect(service.fetch({ steamId, page: -1 })).rejects.toThrow('Invalid');
  dependencies.read.mockRejectedValue(new Error('Synthetic denied file access'));
  const page = await service.fetch({ steamId });
  expect(page.coverage.failedMatches).toBe(1);
  expect(page.progress.errors[0].reason).toBe('Synthetic denied file access');
  expect(dependencies.build).not.toHaveBeenCalled();
});

it('does not push an old canceled state after retry and refreshes a canceled scope count without resuming it', async () => {
  const { service, dependencies } = fixture();
  const pending = deferred<DeathReviewRecord[]>();
  dependencies.build.mockImplementationOnce(() => pending.promise);
  await service.fetch({ steamId });
  await vi.waitFor(() => expect(dependencies.build).toHaveBeenCalledTimes(1));
  await service.control({ steamId, action: 'cancel' });
  dependencies.listMatches.mockResolvedValue([match(), match('b')]);
  const canceled = await service.fetch({ steamId });
  expect(canceled.progress.status).toBe('canceled');
  expect(canceled.progress.total).toBe(2);
  expect(dependencies.build).toHaveBeenCalledTimes(1);
  dependencies.listMatches.mockResolvedValue([]);
  const empty = await service.fetch({ steamId });
  expect(empty.progress.status).toBe('canceled');
  expect(empty.progress.total).toBe(0);
  expect(empty.progress.completed).toBe(0);
  expect(empty.coverage.availableMatches).toBe(0);
  expect(dependencies.build).toHaveBeenCalledTimes(1);
  dependencies.listMatches.mockResolvedValue([match(), match('b')]);
  await service.control({ steamId, action: 'retry' });
  dependencies.changed.mockClear();
  pending.resolve([record()]);
  await vi.waitFor(() => expect(service.isBusy()).toBe(false));
  expect(dependencies.changed.mock.calls.some(([progress]) => progress.status === 'canceled')).toBe(false);
  expect((await service.fetch({ steamId })).progress.completed).toBe(2);
});
