import { describe, expect, it } from 'vite-plus/test';
import { buildRiskMechanicsEvidence } from './risk-mechanics-provider';
import type { EvidenceFrame, EvidencePlayer, EvidenceShot, WireField } from './evidence-protocol';
import type { EvidenceBulletDamage } from './evidence-ballistics';

function f(value: unknown): WireField {
  return { present: true, value, lastUpdate: null };
}
function player(speed = 0, penalty = 0.00641, ground = true): EvidencePlayer {
  return {
    id: '1:1',
    steamId: '76561190000000001',
    origin: [0, 0, 0],
    eyes: [0, 0, 64],
    yaw: 0,
    pitch: 0,
    velocity: [speed, 0, 0],
    team: 2,
    health: 100,
    lifeState: 0,
    hull: { mins: null, maxs: null },
    fieldsComplete: true,
    fields: {
      m_fFlags: f(ground ? 1 : 0),
      m_MoveType: f(2),
      m_bIsScoped: f(false),
      'm_pMovementServices.m_flDuckAmount': f(0),
    },
    activeWeapon: {
      id: '2:1',
      className: 'CAK47',
      fieldsComplete: true,
      fields: {
        m_fAccuracyPenalty: f(penalty),
        m_bInReload: f(false),
        m_flTurningInaccuracy: f(0),
        m_weaponMode: f(0),
      },
    },
  };
}
function fixture() {
  const frames: EvidenceFrame[] = Array.from({ length: 30 }, (_, i) => ({
    type: 'frame',
    tick: i,
    serverTick: 100 + i,
    frame: i,
    players: [player()],
    world: { complete: true, upserts: [], removed: [] },
    smokes: { complete: true, upserts: [], removed: [] },
  }));
  const shot: EvidenceShot = {
    type: 'shot',
    tick: 20,
    frame: 20,
    serverTick: 120,
    playerEntityId: '1:1',
    steamId: '76561190000000001',
    playerHandle: 16385,
    playerSlot: 0,
    raw: { tick: 120, item_def_index: 7, mode: 0, weapon_id: 16386, inaccuracy: 0.15, spread: 0.0006, recoil_index: 0 },
  };
  for (let i = 10; i <= 20; i++) frames[i].players = [player(200, i === 20 ? 0.01421 : 0.00641)];
  return {
    header: {
      type: 'header' as const,
      version: 1 as const,
      parserVersion: 'test',
      playerFieldsMode: 'delta' as const,
      mapName: 'de_test',
      tickRate: 64,
      windows: [{ startTick: 0, endTick: 29 }],
      requestedTicks: 30,
      patch: 14190,
      buildNum: 10924,
      sourceBytes: 1,
    },
    frames,
    shots: [shot],
    end: {
      type: 'end' as const,
      status: 'ok' as const,
      emittedTicks: 30,
      missingTicks: [],
      duplicateTicks: 0,
      frames: 30,
      shots: 1,
    },
    subjectId: shot.steamId!,
    contacts: [{ shotTick: 20, targetId: 'enemy', distance: 1200, source: 'unique-damage' }],
  };
}
describe('measured weapon accuracy attribution', () => {
  it('requires a fresh shot, measured clean baseline and conservative nonmovement envelope', () => {
    const input = fixture(),
      r = buildRiskMechanicsEvidence(input);
    expect(r.precision).toHaveLength(1);
    expect(r.precision[0]).toMatchObject({
      kind: 'movement',
      componentVerified: true,
      targetGeometryVerified: false,
      targetAssociationVerified: true,
      movementSpeed: 200,
    });
    expect(r.precision[0].baselineHalfAngleDegrees).toBeGreaterThan(0.36);
  });
  it('does not call ordinary weapon inaccuracy an unstopped first shot', () => {
    const input = fixture();
    input.shots[0].raw.inaccuracy = 0.00641;
    expect(buildRiskMechanicsEvidence(input).precision).toEqual([]);
  });
  it('rejects explicit shot-time state conflicting with the frame-end snapshot', () => {
    for (const change of [{ player_inair: true }, { player_scoped: true }]) {
      const input = fixture();
      Object.assign(input.shots[0].raw, change);
      expect(buildRiskMechanicsEvidence(input).precision).toEqual([]);
    }
  });
  it('does not turn an explicitly forced accuracy configuration into a player mistake', () => {
    const configurations: Record<string, string>[] = [
      { weapon_accuracy_nospread: 'true' },
      { weapon_debug_max_inaccuracy: '1' },
      { weapon_accuracy_forcespread: '0.15' },
    ];
    for (const conVars of configurations) {
      const input = fixture();
      input.shots[0].conVars = conVars;
      input.shots[0].raw.player_inair = false;
      input.shots[0].raw.extra = { inaccuracy_move: 0.12, inaccuracy_air: 0 };
      expect(buildRiskMechanicsEvidence(input).precision).toEqual([]);
    }
  });
  it('does not attribute missing or nonzero turning inaccuracy to movement', () => {
    for (const value of [undefined, 0.03]) {
      const input = fixture();
      for (const frame of input.frames) {
        if (value === undefined) delete frame.players[0].activeWeapon!.fields.m_flTurningInaccuracy;
        else frame.players[0].activeWeapon!.fields.m_flTurningInaccuracy = f(value);
      }
      expect(buildRiskMechanicsEvidence(input).precision).toEqual([]);
    }
  });
  it('uses a transmitted movement component without assuming untransmitted components are zero', () => {
    const input = fixture();
    for (const frame of input.frames) delete frame.players[0].activeWeapon!.fields.m_flTurningInaccuracy;
    input.shots[0].raw.player_inair = false;
    input.shots[0].raw.extra = { inaccuracy_move: 0.12, inaccuracy_air: 0 };
    expect(buildRiskMechanicsEvidence(input).precision[0]).toMatchObject({ kind: 'movement' });
    input.shots[0].raw.extra = { inaccuracy_move: 0.12 };
    expect(buildRiskMechanicsEvidence(input).precision).toEqual([]);
  });
  it('uses direct shot-time movement even when no clean snapshot anchor is recorded', () => {
    const input = fixture();
    for (const frame of input.frames) {
      delete frame.players[0].activeWeapon!.fields.m_flTurningInaccuracy;
      delete frame.players[0].activeWeapon!.fields.m_fAccuracyPenalty;
    }
    input.shots[0].raw.player_inair = false;
    input.shots[0].raw.extra = { inaccuracy_move: 0.12, inaccuracy_air: 0 };
    const result = buildRiskMechanicsEvidence(input);
    expect(result.precision[0]).toMatchObject({ kind: 'movement', componentVerified: true });
    expect(result.precision[0].profileSource).toContain('fire-bullets-extra');
    expect(result.precision[0].movementSpeed).toBeUndefined();
    input.shots[0].raw.player_inair = true;
    expect(buildRiskMechanicsEvidence(input).precision).toEqual([]);
  });
  it('accepts an explicitly disabled turning setting but never infers its default', () => {
    const input = fixture();
    for (const frame of input.frames) delete frame.players[0].activeWeapon!.fields.m_flTurningInaccuracy;
    input.shots[0].conVars = { sv_turning_inaccuracy_enabled: 'false' };
    expect(buildRiskMechanicsEvidence(input).precision[0]?.kind).toBe('movement');
    input.shots[0].conVars.sv_turning_inaccuracy_enabled = '1';
    expect(buildRiskMechanicsEvidence(input).precision).toEqual([]);
    input.shots[0].conVars = {};
    expect(buildRiskMechanicsEvidence(input).precision).toEqual([]);
  });
  it('uses separately transmitted damage components and checks their stream count', () => {
    const input = fixture();
    for (const frame of input.frames) delete frame.players[0].activeWeapon!.fields.m_flTurningInaccuracy;
    const damage: EvidenceBulletDamage = {
      type: 'bullet-damage',
      tick: 20,
      frame: 20,
      serverTick: 120,
      attackerEntityId: '1:1',
      attackerSteamId: input.subjectId,
      victimEntityId: '3:1',
      victimSteamId: 'enemy',
      weaponEntityId: '2:1',
      itemDefinitionIndex: 7,
      raw: {
        distance: 1200,
        inaccuracy_total: 0.15,
        inaccuracy_move: 0.12,
        inaccuracy_air: 0,
        recoil_index: 0,
        attack_tick_count: 120,
        attack_tick_frac: 0.25,
        render_tick_count: 119,
        render_tick_frac: 0.5,
        in_air: false,
      },
    };
    const joined = { ...input, bulletDamages: [damage], end: { ...input.end, bulletDamages: 1 } };
    const result = buildRiskMechanicsEvidence(joined);
    expect(result.precision[0].profileSource).toContain('bullet-damage');
    expect(result.measurements[0]).toMatchObject({
      component: 'movement',
      measurementSource: 'bullet-damage',
      movementInaccuracy: 0.12,
      airborneInaccuracy: 0,
    });
    expect(buildRiskMechanicsEvidence({ ...input, bulletDamages: [damage] }).precision).toEqual([]);
    joined.end.bulletDamages = 2;
    expect(buildRiskMechanicsEvidence(joined).precision).toEqual([]);
  });
  it('never falls back to a residual estimate after contradictory independent evidence', () => {
    const input = fixture();
    input.shots[0].raw.extra = { inaccuracy_move: 0.12, inaccuracy_air: 0 };
    input.shots[0].raw.player_inair = false;
    const damage = {
      type: 'bullet-damage' as const,
      tick: 20,
      frame: 20,
      serverTick: 120,
      attackerEntityId: '1:1',
      attackerSteamId: input.subjectId,
      victimEntityId: '3:1',
      victimSteamId: 'other',
      weaponEntityId: '2:1',
      itemDefinitionIndex: 7,
      raw: {},
    };
    expect(
      buildRiskMechanicsEvidence({ ...input, bulletDamages: [damage], end: { ...input.end, bulletDamages: 1 } })
        .precision,
    ).toEqual([]);
  });
  it('rejects missing states, wrong weapon lifecycle and crouch transitions', () => {
    for (const mutate of [
      (i: ReturnType<typeof fixture>) => {
        i.frames[19].players = [];
      },
      (i: ReturnType<typeof fixture>) => {
        i.frames[19].players[0].activeWeapon!.id = '2:2';
      },
      (i: ReturnType<typeof fixture>) => {
        i.frames[19].players[0].fields['m_pMovementServices.m_flDuckAmount'] = f(0.5);
      },
    ]) {
      const input = fixture();
      mutate(input);
      expect(buildRiskMechanicsEvidence(input).precision).toEqual([]);
    }
  });
  it('requires a confirmed opponent without using movement hulls as target hitboxes', () => {
    const input = fixture();
    input.contacts = [];
    const r = buildRiskMechanicsEvidence(input);
    expect(r.measurements[0].component).toBe('movement');
    expect(r.precision).toEqual([]);
    expect(r.aim).toEqual([]);
  });
  it('does not reuse an installed profile for older demo patches', () => {
    const input = fixture();
    input.header.patch = 14172;
    expect(buildRiskMechanicsEvidence(input).precision).toEqual([]);
  });
  it('identifies residual landing loss only across an entire isolated jump', () => {
    const input = fixture();
    for (let t = 0; t < 30; t++)
      input.frames[t].players = [player(0, t >= 14 && t <= 20 ? 0.05 : 0.00641, t < 10 || t >= 14)];
    input.shots[0].raw.inaccuracy = 0.05;
    expect(buildRiskMechanicsEvidence(input).precision[0]).toMatchObject({ kind: 'landing', landingTick: 14 });
    input.frames[12].players[0].velocity = [10, 0, 0];
    expect(buildRiskMechanicsEvidence(input).precision).toEqual([]);
  });
  it('distinguishes burst restart from normal weapon cadence using observed penalty decay', () => {
    const input = fixture();
    for (let t = 0; t < 30; t++)
      input.frames[t].players = [player(0, t >= 5 && t <= 20 ? 0.02 - (t - 5) * 0.0005 : 0.00641)];
    const first = {
      ...input.shots[0],
      tick: 5,
      frame: 5,
      serverTick: 105,
      raw: { ...input.shots[0].raw, tick: 105, inaccuracy: 0.00641 },
    };
    input.shots.unshift(first);
    input.end.shots = 2;
    input.shots[1].raw.inaccuracy = 0.0125;
    input.shots[1].raw.recoil_index = 0.5;
    expect(buildRiskMechanicsEvidence(input).precision[0]).toMatchObject({ kind: 'recovery', precedingShotTick: 5 });
    input.shots[0].tick = 14;
    input.shots[0].serverTick = 114;
    input.shots[0].raw.tick = 114;
    expect(buildRiskMechanicsEvidence(input).precision).toEqual([]);
  });
});
