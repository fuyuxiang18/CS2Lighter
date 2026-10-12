import { describe, expect, it } from 'vite-plus/test';
import { WeaponName, WeaponType, TeamNumber } from 'csdm/common/types/counter-strike';
import type { EvidencePlayer } from './evidence-protocol';
import { buildSprayProviderEvidence, type SprayProviderInput, type SprayGeometryProvider } from './spray-provider';

const owner = '76561198000000001';
const enemy = '76561198000000002';
const another = '76561198000000003';

function fixture(): SprayProviderInput {
  const shots = [0, 0, -0.5, -1, -2, -3, -4, -5].map((pitch, i) => ({
    type: 'shot' as const,
    frame: 1028 + i * 6,
    tick: 1000 + i * 6,
    serverTick: 6400 + i * 6,
    playerHandle: 32769,
    playerEntityId: '1:1',
    playerSlot: 0,
    steamId: owner,
    raw: {
      origin: { x: 0, y: 0, z: 64 },
      angles: { x: pitch, y: 0, z: 0 },
      weapon_id: 65540,
      item_def_index: 7,
      recoil_index: i,
      seed: 500 + i,
      spread: 0.002,
      inaccuracy: 0.01,
    },
  }));
  return {
    header: {
      type: 'header',
      version: 1,
      parserVersion: 'test-fixture',
      playerFieldsMode: 'delta',
      mapName: 'de_test',
      tickRate: 64,
      windows: shots.map((s) => ({ startTick: s.tick, endTick: s.tick })),
      requestedTicks: 8,
      patch: 14190,
      buildNum: 1,
      sourceBytes: 100,
    },
    shots,
    frames: shots.map((s) => ({
      type: 'frame',
      frame: s.frame,
      tick: s.tick,
      serverTick: s.serverTick,
      players: [{ id: '1:1', steamId: owner } as EvidencePlayer],
      world: { complete: true, upserts: [], removed: [] },
      smokes: { complete: true, upserts: [], removed: [] },
    })),
    end: { type: 'end', status: 'ok', emittedTicks: 8, missingTicks: [], duplicateTicks: 0, frames: 8, shots: 8 },
    maximumUnlagSeconds: 1,
    match: {
      checksum: 'test',
      steamId: owner,
      tickrate: 64,
      shotsComplete: true,
      rounds: [
        {
          match_checksum: 'test',
          number: 1,
          start_tick: 900,
          freeze_time_end_tick: 950,
          end_tick: 1200,
        } as SprayProviderInput['match']['rounds'][number],
      ],
      shots: shots.map(
        (s) =>
          ({
            frame: s.frame,
            tick: s.tick,
            match_checksum: 'test',
            round_number: 1,
            player_steam_id: owner,
            weapon_name: WeaponName.AK47,
            weapon_id: 'csda-unique-ak',
            is_player_controlling_bot: false,
          }) as SprayProviderInput['match']['shots'][number],
      ),
      damages: [
        {
          frame: shots[0].frame,
          tick: shots[0].tick,
          match_checksum: 'test',
          round_number: 1,
          attacker_steam_id: owner,
          victim_steam_id: enemy,
          attacker_side: TeamNumber.T,
          victim_side: TeamNumber.CT,
          health_damage: 20,
          victim_health: 100,
          weapon_name: WeaponName.AK47,
          weapon_unique_id: 'csda-unique-ak',
          is_attacker_controlling_bot: false,
          is_victim_controlling_bot: false,
          weapon_type: WeaponType.Rifle,
        } as SprayProviderInput['match']['damages'][number],
      ],
      kills: [],
      blinds: [],
    },
  };
}

function verifiedGeometry({
  shot,
  targetSteamId,
}: Parameters<SprayGeometryProvider>[0]): ReturnType<SprayGeometryProvider> {
  const time = (shot.serverTick ?? 0) / 64;
  return {
    status: 'verified',
    provenance: {
      providerVersion: 'fixture-only',
      mapFingerprint: 'fixture-hash',
      geometry: 'verified-map-dynamic-and-smoke',
      bodyBounds: 'verified-full-body-conservative',
      clock: 'decoded-server-ticks',
    },
    frame: {
      shotId: shot.id,
      shotTick: shot.tick,
      targetSteamId,
      bodyBoxes: [{ min: { x: 984, y: -16, z: 48 }, max: { x: 1016, y: 16, z: 80 } }],
      timing: {
        kind: 'conservative-lag-envelope',
        earliestPossibleTargetTime: time - 1.1,
        latestPossibleTargetTime: time,
        coveredFrom: time - 1.1,
        coveredThrough: time,
      },
      frameCoverage: 'complete',
      poseAndMotionCoverage: 'complete',
      targetLife: 'alive',
      targetRelation: 'enemy',
      visibility: 'clear',
      shooterBlinded: false,
      throughSmoke: false,
    },
  };
}

describe('spray provider with exact event joins', () => {
  it('accepts source duplicate ticks after the extractor has emitted unique complete snapshots', async () => {
    const input = fixture();
    input.end.duplicateTicks = 4;
    const result = await buildSprayProviderEvidence({ ...input, geometryProvider: verifiedGeometry });
    expect(result.status).toBe('evaluated');
    expect(result.coverage.evaluatedShots).toBe(8);
    expect(result.reasons).not.toContain('extraction-incomplete');
  });

  it('still blocks actual duplicated output ticks even when end counts match', async () => {
    const input = fixture();
    input.frames.push({ ...input.frames[0] });
    input.end.frames++;
    const result = await buildSprayProviderEvidence({ ...input, geometryProvider: verifiedGeometry });
    expect(result.reasons).toContain('extraction-incomplete');
    expect(result.coverage.evaluatedShots).toBe(0);
  });

  it('retains real firing centres but explicitly blocks diagnosis without geometry', async () => {
    const result = await buildSprayProviderEvidence(fixture());
    expect(result.status).toBe('blocked');
    expect(result.reasons).toContain('geometry-provider-unavailable');
    expect(result.rawTrajectory).toHaveLength(8);
    expect(result.rawTrajectory[7].direction?.pitch).toBe(-5);
    expect(result.coverage).toEqual({
      rawShots: 8,
      identityVerified: 8,
      databaseMatched: 8,
      confirmedDamage: 1,
      evaluatedShots: 0,
    });
    expect(result.evidence.segments[0].diagnoses).toEqual([]);
  });

  it('evaluates only when a separately verified geometry provider supplies all evidence', async () => {
    const result = await buildSprayProviderEvidence({ ...fixture(), geometryProvider: verifiedGeometry });
    expect(result.status).toBe('evaluated');
    expect(result.coverage.evaluatedShots).toBe(8);
    expect(result.evidence.segments[0].diagnoses[0].code).toBe('spray_center_rising');
    expect(result.evidence.segments[0].weaponEntityId).toBe('65540');
    expect(result.evidence.segments[0].itemDefinitionIndex).toBe(7);
  });

  it.each(['serial', 'steam-id', 'missing-frame'] as const)(
    'does not attach raw fire to the wrong lifecycle: %s',
    async (scenario) => {
      const input = fixture();
      if (scenario === 'serial') input.frames[0].players[0].id = '1:2';
      if (scenario === 'steam-id') input.frames[0].players[0].steamId = another;
      if (scenario === 'missing-frame') input.frames = input.frames.slice(1);
      const result = await buildSprayProviderEvidence(input);
      expect(result.rawTrajectory).toHaveLength(8);
      expect(result.rawTrajectory[0].identityVerified).toBe(false);
      expect(result.coverage.confirmedDamage).toBe(0);
    },
  );

  it.each(['two-raw', 'two-db', 'two-damage', 'other-frame', 'other-weapon'] as const)(
    'does not greedily join ambiguous evidence: %s',
    async (scenario) => {
      const input = fixture();
      if (scenario === 'two-raw') input.shots.push(structuredClone(input.shots[0]));
      if (scenario === 'two-db') input.match.shots.push(structuredClone(input.match.shots[0]));
      if (scenario === 'two-damage') input.match.damages.push(structuredClone(input.match.damages[0]));
      if (scenario === 'other-frame') input.match.damages[0].frame++;
      if (scenario === 'other-weapon') input.match.damages[0].weapon_unique_id = 'a-different-ak';
      const result = await buildSprayProviderEvidence({ ...input, geometryProvider: verifiedGeometry });
      expect(result.coverage.confirmedDamage).toBe(0);
      expect(result.status).toBe('blocked');
    },
  );

  it('does not confuse weapon item definition with its entity handle', async () => {
    const input = fixture();
    input.shots.slice(4).forEach((s) => {
      s.raw.weapon_id = 98308;
    });
    const result = await buildSprayProviderEvidence({ ...input, geometryProvider: verifiedGeometry });
    expect(result.evidence.segments).toHaveLength(2);
    expect(result.evidence.segments.flatMap((s) => s.diagnoses)).toEqual([]);
  });

  it('accepts the observed FrameDone increment but not a later frame or another tick', async () => {
    const input = fixture();
    input.frames.forEach((f) => {
      f.frame++;
    });
    expect((await buildSprayProviderEvidence(input)).coverage.identityVerified).toBe(8);
    input.frames[0].frame++;
    expect((await buildSprayProviderEvidence(input)).rawTrajectory[0].identityVerified).toBe(false);
    input.frames[0].frame--;
    input.frames[0].tick++;
    expect((await buildSprayProviderEvidence(input)).rawTrajectory[0].identityVerified).toBe(false);
  });

  it('rejects a second damaged target even if that hurt event cannot be joined to one shot', async () => {
    const input = fixture();
    input.match.damages.push({ ...input.match.damages[0], tick: 1013, frame: 1041, victim_steam_id: another });
    const result = await buildSprayProviderEvidence({ ...input, geometryProvider: verifiedGeometry });
    expect(result.status).toBe('blocked');
    expect(result.reasons).toContain('target-switch');
  });

  it('marks partial geometry coverage separately from a clean result', async () => {
    const input = fixture();
    input.geometryProvider = async (request) =>
      request.shot.tick === 1018
        ? { status: 'unavailable', reasons: ['dynamic-object-not-resolved'] }
        : verifiedGeometry(request);
    const result = await buildSprayProviderEvidence(input);
    expect(result.status).toBe('partial');
    expect(result.coverage.evaluatedShots).toBe(7);
    expect(result.reasons).toContain('dynamic-object-not-resolved');
    expect(result.evidence.segments[0].diagnoses).toEqual([]);
  });

  it.each(['missing-ticks', 'failed-extraction', 'db-incomplete', 'clock-mismatch', 'missing-server-clock'] as const)(
    'cannot diagnose with incomplete inputs: %s',
    async (scenario) => {
      const input = fixture();
      if (scenario === 'missing-ticks') input.end.missingTicks = [1001];
      if (scenario === 'failed-extraction') input.end.status = 'error';
      if (scenario === 'db-incomplete') input.match.shotsComplete = false;
      if (scenario === 'clock-mismatch') input.header.tickRate = 128;
      if (scenario === 'missing-server-clock')
        input.shots.forEach((s) => {
          s.serverTick = null;
        });
      const result = await buildSprayProviderEvidence({ ...input, geometryProvider: verifiedGeometry });
      expect(result.status).toBe('blocked');
      expect(result.rawTrajectory).toHaveLength(8);
    },
  );

  it('uses known flash events to veto a provider even if it labels the shooter clear', async () => {
    const input = fixture();
    input.match.blinds.push({
      match_checksum: 'test',
      round_number: 1,
      tick: 1010,
      frame: 1038,
      duration: 5,
      flashed_steam_id: owner,
    } as SprayProviderInput['match']['blinds'][number]);
    const result = await buildSprayProviderEvidence({ ...input, geometryProvider: verifiedGeometry });
    expect(result.status).toBe('partial');
    expect(result.reasons).toContain('blinded-or-unknown');
    expect(result.evidence.segments[0].diagnoses).toEqual([]);
  });

  it('never treats a target already killed in this round as alive', async () => {
    const input = fixture();
    input.match.kills.push({
      match_checksum: 'test',
      round_number: 1,
      tick: 1017,
      frame: 1045,
      victim_steam_id: enemy,
    } as SprayProviderInput['match']['kills'][number]);
    const result = await buildSprayProviderEvidence({ ...input, geometryProvider: verifiedGeometry });
    expect(result.evidence.segments[0].diagnoses).toEqual([]);
    expect(result.reasons).toContain('unconfirmed-target');
  });

  it('does not label null raw fields as a genuine zero', async () => {
    const input = fixture();
    input.shots[0].raw.angles = { x: null, y: 0, z: 0 };
    input.shots[1].raw.recoil_index = null;
    const result = await buildSprayProviderEvidence(input);
    expect(result.rawTrajectory[0].direction).toBeNull();
    expect(result.rawTrajectory[1].recoilIndex).toBeNull();
    expect(result.status).toBe('blocked');
  });

  it('rejects wrong geometry provenance and preserves its raw trajectory', async () => {
    const input = fixture();
    input.geometryProvider = async (request) => {
      const result = await verifiedGeometry(request);
      if (result.status === 'verified') result.provenance.mapFingerprint = '';
      return result;
    };
    const result = await buildSprayProviderEvidence(input);
    expect(result.status).toBe('blocked');
    expect(result.reasons).toContain('geometry-provenance-unverified');
    expect(result.rawTrajectory).toHaveLength(8);
  });

  it('preserves the trajectory if geometry resource loading throws', async () => {
    const input = fixture();
    input.geometryProvider = () => {
      throw new Error('Resource not available');
    };
    const result = await buildSprayProviderEvidence(input);
    expect(result.status).toBe('blocked');
    expect(result.reasons).toContain('geometry-provider-error');
    expect(result.rawTrajectory).toHaveLength(8);
  });
});
