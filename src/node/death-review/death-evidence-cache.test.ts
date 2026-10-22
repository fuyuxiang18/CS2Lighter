import path from 'node:path';
import os from 'node:os';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import type { DeathEvidenceReport } from 'csdm/common/types/death-evidence';
import type { DeathAnimationEvidence } from 'csdm/common/types/death-animation';
import type { DeathRiskActorFrame, DeathRiskInput, DeathRiskReport } from 'csdm/common/types/death-risk';
import {
  DEATH_ENVIRONMENT_REVISION,
  DEATH_RISK_REVISION,
  DEATH_RISK_RULES,
} from 'csdm/common/death-review/death-risk-rules';
import { buildDeathRiskReport } from './death-risk-engine';
import { isDeathRiskInput, isDeathRiskReport } from './death-risk-cache-validation';
import { collectSupportTransitions } from './risk-spatial-provider';
import { readDeathEvidenceCache, readDeathRiskReports, writeDeathEvidenceCache } from './death-evidence-cache';
import { advanceDemoCacheGeneration, getDemoCacheGeneration } from 'csdm/node/demo-cache/cache-generation';

const directories: string[] = [];
const report: DeathEvidenceReport = {
  checksum: 'abc',
  steamId: '76561198000000001',
  deathId: 'first',
  version: 1,
  generatedAt: '2026-10-12T00:00:00Z',
  startTick: 1,
  endTick: 10,
  deathTick: 10,
  tickrate: 64,
  coverage: { requestedTicks: 10, decodedTicks: 9, missingTicks: 1, shots: 0 },
  geometry: { status: 'unavailable', mapName: 'de_nuke', match: 'unverified', reasons: ['map-version'] },
  exposures: [],
  gunlines: [],
  spray: { status: 'blocked', reasons: [], points: [], findings: [] },
};
const animation: DeathAnimationEvidence = {
  framesWithRecipe: 9,
  decodedTopologyFrames: 8,
  taskTypes: ['CNmSampleTask', 'CNmBlendTask'],
  graphResourceCount: 2,
  boneCount: 128,
  maskCount: 4,
  blockingTasks: ['CNmAimCSTask'],
  reasons: ['animation-world-pose-unverified'],
};
async function directory() {
  const value = await mkdtemp(path.join(os.tmpdir(), 'cs2lighter-evidence-cache-'));
  directories.push(value);
  return value;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((value) => rm(value, { recursive: true, force: true })));
});

describe('per-demo advanced death evidence cache', () => {
  it('retires cached R4 without re-extraction or dropping other decisions and shot traces', async () => {
    const folder = await directory();
    const risk: DeathRiskReport = {
      version: 1,
      ruleRevision: '2026-10-22.1',
      status: 'evaluated',
      selectedFindingIds: ['old-r4'],
      findings: ['r4', 'r10'].map((ruleId) => ({
        id: `old-${ruleId}`,
        ruleId: ruleId as 'r4' | 'r10',
        relatedRuleIds: [],
        startTick: 2,
        endTick: 4,
        priority: 80,
        targetIds: ['opponent'],
        evidence: [{ code: 'observation', tick: 2, values: {}, sources: ['saved-fact'] }],
        advice: { code: ruleId === 'r4' ? 'correct-target-relative-spray' : 'reload-behind-cover', values: {} },
      })),
      evaluations: [...DEATH_RISK_RULES.map(({ id }) => id), 'r4' as const].map((ruleId) => ({
        ruleId,
        status: ruleId === 'r4' || ruleId === 'r10' ? 'matched' : 'clear',
        reasons: [],
        findingIds: ruleId === 'r4' || ruleId === 'r10' ? [`old-${ruleId}`] : [],
      })),
    };
    const saved = { ...report, environmentRevision: DEATH_ENVIRONMENT_REVISION, matchRevision: 'a'.repeat(64), risk };
    await writeDeathEvidenceCache(folder, 'old', saved, new AbortController().signal);
    const loaded = await readDeathEvidenceCache(folder, report, 'new-map', saved.matchRevision);
    expect(loaded?.spray).toEqual(report.spray);
    expect(loaded?.risk?.evaluations).toHaveLength(13);
    expect(loaded?.risk?.findings.map(({ ruleId }) => ruleId)).toEqual(['r10']);
    expect(loaded?.risk?.selectedFindingIds).toEqual(['old-r10']);
    expect(loaded?.risk?.ruleRevision).toBe(DEATH_RISK_REVISION);
    expect(
      (await readDeathRiskReports(folder, 'abc', saved.matchRevision)).get(`${report.steamId}:${report.deathId}`),
    ).toEqual(loaded?.risk);
    expect(loaded?.loadedFromSavedEvidence).toBe(true);
    // The original file remains intact; the migration is a view over saved evidence.
    const disk = JSON.parse(gunzipSync(await readFile(path.join(folder, 'abc.json.gz'))).toString('utf8'));
    expect(disk.entries[0].report.risk.evaluations).toHaveLength(14);
    await writeDeathEvidenceCache(
      folder,
      'old-surfaces',
      {
        ...saved,
        environmentRevision: undefined,
        gunlines: [
          { tick: 2, enemySteamId: 'opponent', distance: 100, facingOffset: 0, status: 'blocked', reason: 'occluded' },
        ],
        gunlineAnalysis: { basis: 'environment-eye-reference', status: 'evaluated', reasons: [] },
      },
      new AbortController().signal,
    );
    const oldSurfaces = await readDeathEvidenceCache(folder, report, 'old-surfaces');
    expect(oldSurfaces?.gunlines[0]).toMatchObject({ status: 'unknown', reason: 'surface-unverified' });
    expect(oldSurfaces?.gunlineAnalysis?.status).toBe('unavailable');
    expect(oldSurfaces?.risk?.findings).toEqual([]);
    expect(oldSurfaces?.risk?.evaluations.find(({ ruleId }) => ruleId === 'r10')).toMatchObject({
      status: 'unavailable',
      reasons: ['surface-unverified'],
    });
    expect(oldSurfaces?.spray).toEqual(saved.spray);
    risk.findings = risk.findings.filter(({ ruleId }) => ruleId === 'r4');
    risk.status = 'partial';
    for (const evaluation of risk.evaluations) {
      if (evaluation.ruleId === 'r4') continue;
      evaluation.status = 'unavailable';
      evaluation.reasons = ['missing-evidence'];
      evaluation.findingIds = [];
    }
    await writeDeathEvidenceCache(folder, 'unknown', { ...saved, risk }, new AbortController().signal);
    const unavailable = await readDeathEvidenceCache(folder, report, 'unknown');
    expect(unavailable?.risk?.status).toBe('unavailable');
    expect(unavailable?.risk?.findings).toEqual([]);
    expect(unavailable?.risk?.selectedFindingIds).toEqual([]);
    expect(unavailable?.risk?.evaluations.every(({ status }) => status === 'unavailable')).toBe(true);
  });
  it('recomputes rule revisions from compressed facts and keeps internal frame data off the UI response', async () => {
    const folder = await directory();
    const facts: DeathRiskInput = {
      version: 1,
      eligible: false,
      subjectId: report.steamId,
      startTick: 1,
      deathTick: 10,
      tickrate: 64,
      enemyIds: [],
      teammateIds: [],
      frames: [],
      shots: [],
      events: [],
      precision: [],
      aim: [],
      cover: [],
      support: [],
      interventions: [],
      coverage: {
        events: true,
        shots: true,
        weaponState: false,
        flash: false,
        precision: false,
        aim: false,
        repeekInterventions: false,
      },
    };
    const saved = {
      ...report,
      matchRevision: 'a'.repeat(64),
      riskFacts: facts,
      risk: { ...buildDeathRiskReport(facts), ruleRevision: 'previous-rules' },
    };
    await writeDeathEvidenceCache(folder, 'one', saved, new AbortController().signal);
    const disk = JSON.parse(gunzipSync(await readFile(path.join(folder, 'abc.json.gz'))).toString('utf8'));
    expect(typeof disk.entries[0].report.riskFacts).toBe('string');
    const loaded = await readDeathEvidenceCache(folder, report, 'one');
    expect(loaded?.risk?.ruleRevision).toBe(DEATH_RISK_REVISION);
    expect(loaded?.riskFacts).toBeUndefined();
    expect(loaded?.spray).toEqual(report.spray);
    expect(
      (await readDeathRiskReports(folder, 'abc', saved.matchRevision)).get(`${report.steamId}:${report.deathId}`),
    ).toEqual(loaded?.risk);
    expect((await readDeathRiskReports(folder, 'abc', 'b'.repeat(64))).size).toBe(0);
  });
  it('does not restore old cover or unsupported-contact risks when recomputing eligible legacy facts', async () => {
    const folder = await directory();
    const self = report.steamId;
    const player = (id: string, x: number, y: number): DeathRiskActorFrame => ({
      id,
      alive: true,
      position: { x, y, z: 0 },
      eye: { x, y, z: 64 },
      yaw: 0,
      onGround: true,
      blind: null,
      weapon: {
        entityId: `${id}-gun`,
        name: 'ak47',
        kind: 'gun',
        magazine: 20,
        reloading: false,
        ready: true,
        deploying: false,
      },
    });
    const facts: DeathRiskInput = {
      version: 1,
      eligible: true,
      subjectId: self,
      startTick: 1,
      deathTick: 24,
      tickrate: 64,
      enemyIds: ['a', 'b', 'c'],
      teammateIds: ['mate'],
      frames: Array.from({ length: 24 }, (_, index) => {
        const tick = index + 1;
        return {
          tick,
          actors: [
            player(self, tick * 2, 0),
            player('a', 1000, 0),
            { ...player('b', -1000, 0), alive: tick < 3 },
            player('c', 0, 1000),
            player('mate', -100, 0),
          ],
          lines: [self, 'mate'].flatMap((observerId) =>
            ['a', 'b', 'c'].map((targetId) => ({
              observerId,
              targetId,
              status:
                (tick === 1 && targetId === 'b') || (observerId === self && tick >= 2 && targetId !== 'b')
                  ? ('clear' as const)
                  : ('blocked' as const),
              ...(observerId === self && tick === 2 && targetId !== 'b'
                ? {
                    previousObserverPosition: { tick: 1, status: 'blocked' as const, source: 'old-map:counterfactual' },
                  }
                : {}),
            })),
          ),
        };
      }),
      shots: [],
      events: [
        { id: 'kill-b', kind: 'kill', tick: 3, actorId: self, targetId: 'b', weaponKind: 'gun' },
        { id: 'hurt-a', kind: 'damage', tick: 8, actorId: 'a', targetId: self, amount: 30, weaponKind: 'gun' },
      ],
      precision: [],
      aim: [],
      cover: [
        {
          actorId: self,
          tick: 4,
          position: { x: 0, y: -20, z: 0 },
          verified: true,
          enemyIds: ['a', 'c'],
          travelTicks: 2,
          source: 'old-map:covered-route',
        },
      ],
      support: [],
      interventions: [],
      coverage: {
        events: true,
        shots: true,
        weaponState: true,
        flash: true,
        precision: false,
        aim: false,
        repeekInterventions: true,
      },
    };
    facts.supportTransitions = collectSupportTransitions({
      ...facts,
      contexts: new Map(facts.frames.map(({ tick }) => [tick, { tick, source: 'old-map:geometry', reason: null }])),
    });
    expect(isDeathRiskInput(facts)).toBe(true);
    expect(facts.supportTransitions.observations.length).toBeGreaterThan(0);
    const legacyRisk = buildDeathRiskReport(facts);
    expect(isDeathRiskReport(legacyRisk)).toBe(true);
    for (const id of ['r6', 'r8', 'r14'])
      expect(legacyRisk.evaluations.find(({ ruleId }) => ruleId === id)?.status).toBe('matched');
    const saved: DeathEvidenceReport = {
      ...report,
      deathTick: 24,
      endTick: 24,
      coverage: { requestedTicks: 24, decodedTicks: 24, missingTicks: 0, shots: 1 },
      matchRevision: 'a'.repeat(64),
      riskFacts: facts,
      risk: { ...legacyRisk, ruleRevision: 'before-material-migration' },
      spray: {
        status: 'evaluated',
        reasons: [],
        findings: [],
        points: [{ id: 'shot-8', tick: 8, pitch: 1, yaw: 2, recoilIndex: 3, itemDefinitionIndex: 7, target: null }],
      },
    };
    await writeDeathEvidenceCache(folder, 'old', saved, new AbortController().signal);
    const loaded = await readDeathEvidenceCache(folder, report, 'new-map', saved.matchRevision);
    expect(loaded?.risk?.ruleRevision).toBe(DEATH_RISK_REVISION);
    expect(isDeathRiskReport(loaded?.risk)).toBe(true);
    for (const id of ['r6', 'r8', 'r14'])
      expect(loaded?.risk?.evaluations.find(({ ruleId }) => ruleId === id)?.status).toBe('unavailable');
    expect(loaded?.risk?.findings.every(({ ruleId }) => ruleId === 'r5')).toBe(true);
    expect(loaded?.risk?.findings.some(({ ruleId }) => ruleId === 'r5')).toBe(true);
    expect(loaded?.risk?.selectedFindingIds.length).toBeGreaterThan(0);
    expect(loaded?.riskFacts).toBeUndefined();
    expect(loaded?.spray).toEqual(saved.spray);
    const disk = JSON.parse(gunzipSync(await readFile(path.join(folder, 'abc.json.gz'))).toString('utf8'));
    const retained = JSON.parse(gunzipSync(Buffer.from(disk.entries[0].report.riskFacts, 'base64')).toString('utf8'));
    expect(retained).toEqual(facts);
  });
  it('drops malformed optional risk without losing the original saved measurements', async () => {
    const folder = await directory();
    const saved = {
      ...report,
      risk: { version: 1, ruleRevision: DEATH_RISK_REVISION, findings: null },
      mechanics: { measurements: null, reasons: [] },
    } as unknown as DeathEvidenceReport;
    await writeDeathEvidenceCache(folder, 'one', saved, new AbortController().signal);
    expect(await readDeathEvidenceCache(folder, report, 'one')).toEqual(report);
  });
  it('roundtrips an animation summary and keeps legacy reports without one readable', async () => {
    const folder = await directory();
    const saved: DeathEvidenceReport = { ...report, animation };
    await writeDeathEvidenceCache(folder, 'one', saved, new AbortController().signal);
    expect(await readDeathEvidenceCache(folder, report, 'one')).toEqual(saved);
    await writeDeathEvidenceCache(folder, 'one', report, new AbortController().signal);
    const legacy = await readDeathEvidenceCache(folder, report, 'one');
    expect(legacy).toEqual(report);
    expect(legacy).not.toHaveProperty('animation');
  });
  it.each([
    { label: 'negative count', changes: { framesWithRecipe: -1 } },
    { label: 'fractional count', changes: { decodedTopologyFrames: 1.5 } },
    { label: 'nonfinite count', changes: { boneCount: Number.POSITIVE_INFINITY } },
    { label: 'decoded topology beyond recorded recipes', changes: { decodedTopologyFrames: 10 } },
    { label: 'recipe frames beyond decoded demo frames', changes: { framesWithRecipe: 10 } },
    { label: 'graph resource count beyond its bound', changes: { graphResourceCount: 16385 } },
    { label: 'bone count beyond its bound', changes: { boneCount: 16385 } },
    { label: 'mask count beyond its bound', changes: { maskCount: 16385 } },
    { label: 'nonstring task name', changes: { taskTypes: [null] } },
    { label: 'overlong task name', changes: { taskTypes: ['x'.repeat(257)] } },
    { label: 'too many task names', changes: { taskTypes: Array(256).fill('CNmSampleTask') } },
    { label: 'malformed blocking task name', changes: { blockingTasks: [{}] } },
    { label: 'too many diagnostic reasons', changes: { reasons: Array(33).fill('unverified') } },
  ])('drops only the optional animation summary with $label', async ({ changes }) => {
    const folder = await directory();
    const saved = { ...report, animation: { ...animation, ...changes } } as unknown as DeathEvidenceReport;
    await writeDeathEvidenceCache(folder, 'one', saved, new AbortController().signal);
    expect(await readDeathEvidenceCache(folder, report, 'one')).toEqual(report);
  });
  it('reuses saved evidence for the same match revision when the source or installed map changes', async () => {
    const folder = await directory();
    const saved = { ...report, matchRevision: 'a'.repeat(64) };
    await writeDeathEvidenceCache(folder, 'old-source-and-map', saved, new AbortController().signal);
    expect(await readDeathEvidenceCache(folder, report, 'missing-source-new-map', saved.matchRevision)).toEqual({
      ...saved,
      loadedFromSavedEvidence: true,
    });
    expect(await readDeathEvidenceCache(folder, report, 'missing-source-new-map', 'b'.repeat(64))).toBeUndefined();
    expect(await readDeathEvidenceCache(folder, report, 'missing-source-new-map')).toBeUndefined();
    expect(
      await readDeathEvidenceCache(
        folder,
        { ...report, steamId: '76561198000000002' },
        'missing-source-new-map',
        saved.matchRevision,
      ),
    ).toBeUndefined();
    await writeDeathEvidenceCache(folder, 'old-source-and-map', report, new AbortController().signal);
    expect(await readDeathEvidenceCache(folder, report, 'missing-source-new-map', saved.matchRevision)).toBeUndefined();
  });
  it('retains old resource evidence after a map update without mutating the cached report', async () => {
    const folder = await directory();
    const saved: DeathEvidenceReport = {
      ...report,
      environmentRevision: DEATH_ENVIRONMENT_REVISION,
      matchRevision: 'a'.repeat(64),
      geometry: { status: 'available', mapName: 'de_nuke', match: 'installed-build-matched', reasons: [] },
      gunlines: [
        {
          tick: 8,
          enemySteamId: '76561198000000002',
          distance: 100,
          facingOffset: 0,
          status: 'blocked',
          reason: 'occluded',
        },
      ],
    };
    await writeDeathEvidenceCache(folder, 'same-source-original-map', saved, new AbortController().signal);
    const file = path.join(folder, 'abc.json.gz');
    const storedBeforeRead = await readFile(file);
    const original = await readDeathEvidenceCache(folder, report, 'same-source-original-map', saved.matchRevision);
    const historical = await readDeathEvidenceCache(folder, report, 'same-source-updated-map', saved.matchRevision);
    expect(historical).toEqual({ ...saved, loadedFromSavedEvidence: true });
    expect(historical).not.toBe(original);
    expect(original).toEqual(saved);
    expect(original).not.toHaveProperty('loadedFromSavedEvidence');
    expect(await readDeathEvidenceCache(folder, report, 'same-source-original-map', saved.matchRevision)).toEqual(
      saved,
    );
    expect(await readFile(file)).toEqual(storedBeforeRead);
  });
  it('never crosses match revisions, players, deaths or demo checksums in the historical fallback', async () => {
    const folder = await directory();
    const saved = { ...report, matchRevision: 'a'.repeat(64) };
    await writeDeathEvidenceCache(folder, 'original-map', saved, new AbortController().signal);
    expect(await readDeathEvidenceCache(folder, report, 'original-map', 'b'.repeat(64))).toBeUndefined();
    expect(await readDeathEvidenceCache(folder, report, 'new-map', 'b'.repeat(64))).toBeUndefined();
    for (const other of [
      { ...report, steamId: '76561198000000002' },
      { ...report, deathId: 'another-death' },
      { ...report, checksum: 'def' },
    ]) {
      expect(await readDeathEvidenceCache(folder, other, 'new-map', saved.matchRevision)).toBeUndefined();
    }
  });
  it('keeps legacy reports without a match revision readable only under their exact source/map revision', async () => {
    const folder = await directory();
    await writeDeathEvidenceCache(folder, 'original-map', report, new AbortController().signal);
    expect(await readDeathEvidenceCache(folder, report, 'original-map', 'a'.repeat(64))).toEqual(report);
    expect(await readDeathEvidenceCache(folder, report, 'new-map', 'a'.repeat(64))).toBeUndefined();
    expect(await readDeathEvidenceCache(folder, report, 'original-map', '')).toBeUndefined();
  });
  it('rejects a save from the generation before match deletion', async () => {
    const folder = await directory();
    const generation = getDemoCacheGeneration(report.checksum);
    advanceDemoCacheGeneration(report.checksum);
    await expect(
      writeDeathEvidenceCache(folder, 'old', report, new AbortController().signal, generation),
    ).rejects.toThrow('invalidated');
    expect(await readDeathEvidenceCache(folder, report, 'old')).toBeUndefined();
  });
  it('retains another death and ignores a stale source/map revision', async () => {
    const folder = await directory();
    await writeDeathEvidenceCache(folder, 'one', report, new AbortController().signal);
    const second = { ...report, deathId: 'second' };
    await writeDeathEvidenceCache(folder, 'one', second, new AbortController().signal);
    expect(await readDeathEvidenceCache(folder, report, 'one')).toEqual(report);
    expect(await readDeathEvidenceCache(folder, second, 'one')).toEqual(second);
    expect(await readDeathEvidenceCache(folder, report, 'two')).toBeUndefined();
    expect(await readDeathEvidenceCache(folder, { ...report, steamId: '76561198000000002' }, 'one')).toBeUndefined();
  });
  it('does not treat corrupted or edited measurements as valid cached analysis', async () => {
    const folder = await directory();
    await writeDeathEvidenceCache(folder, 'one', report, new AbortController().signal);
    const file = path.join(folder, 'abc.json.gz');
    const value = JSON.parse(gunzipSync(await readFile(file)).toString('utf8'));
    value.entries[0].report.coverage.decodedTicks = 10;
    await writeFile(file, gzipSync(JSON.stringify(value)));
    expect(await readDeathEvidenceCache(folder, report, 'one')).toBeUndefined();
    await writeFile(file, '{truncated');
    expect(await readDeathEvidenceCache(folder, report, 'one')).toBeUndefined();
  });
  it('preserves previous results when canceled and rejects path traversal', async () => {
    const folder = await directory();
    await writeDeathEvidenceCache(folder, 'one', report, new AbortController().signal);
    const controller = new AbortController();
    controller.abort();
    await expect(writeDeathEvidenceCache(folder, 'two', report, controller.signal)).rejects.toThrow();
    expect(await readDeathEvidenceCache(folder, report, 'one')).toEqual(report);
    await expect(readDeathEvidenceCache(folder, { ...report, checksum: '../abc' }, 'one')).rejects.toThrow();
  });
  it('stores repeated per-tick evidence compactly and bounds decompression', async () => {
    const folder = await directory();
    const dense = {
      ...report,
      environmentRevision: DEATH_ENVIRONMENT_REVISION,
      gunlines: Array.from({ length: 2400 }, (_, tick) => ({
        tick,
        enemySteamId: '76561198000000002',
        distance: 1234.567,
        facingOffset: 14.5,
        status: 'blocked' as const,
        reason: 'occluded',
      })),
    };
    await writeDeathEvidenceCache(folder, 'one', dense, new AbortController().signal);
    expect(await readDeathEvidenceCache(folder, dense, 'one')).toEqual(dense);
    const file = path.join(folder, 'abc.json.gz');
    expect((await stat(file)).size).toBeLessThan(24_000);
    await writeFile(file, gzipSync(Buffer.alloc(65 * 1024 ** 2, 32)));
    expect(await readDeathEvidenceCache(folder, dense, 'one')).toBeUndefined();
  });
});
