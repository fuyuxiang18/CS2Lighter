import { describe, expect, it } from 'vite-plus/test';
import { DEATH_RULES } from 'csdm/common/death-review/death-rules';
import { DemoSource, TeamNumber, WeaponName, WeaponType } from 'csdm/common/types/counter-strike';
import type { KillRow } from 'csdm/node/database/kills/kill-table';
import type { DamageRow } from 'csdm/node/database/damages/damage-table';
import type { ShotRow } from 'csdm/node/database/shots/shot-table';
import type { PlayerBlindRow } from 'csdm/node/database/player-blinds/player-blind-table';
import type { PlayerPositionRow } from 'csdm/node/database/player-position/player-position-table';
import type { RoundRow } from 'csdm/node/database/rounds/round-table';
import { buildDeathReviews, type DeathMatchInput } from './build-death-review';

const owner = '76561198000000001';
const opponent = '76561198000000011';
const mate = '76561198000000002';
const common = { match_checksum: 'demo', round_number: 1, tick: 1000, frame: 1000 };
function kill(overrides: Partial<KillRow> = {}): KillRow {
  return {
    ...common,
    id: '1',
    killer_steam_id: opponent,
    killer_name: 'Opponent',
    killer_side: TeamNumber.CT,
    victim_steam_id: owner,
    victim_name: 'Player',
    victim_side: TeamNumber.T,
    is_killer_controlling_bot: false,
    is_victim_controlling_bot: false,
    is_assister_controlling_bot: false,
    weapon_name: WeaponName.AK47,
    weapon_type: WeaponType.Rifle,
    is_headshot: false,
    is_victim_airborne: false,
    is_victim_blinded: false,
    is_victim_inspecting_weapon: false,
    is_through_smoke: false,
    penetrated_objects: 0,
    killer_x: 200,
    killer_y: 0,
    killer_z: 0,
    victim_x: 0,
    victim_y: 0,
    victim_z: 0,
    ...overrides,
  } as KillRow;
}
function damage(overrides: Partial<DamageRow> = {}): DamageRow {
  return {
    ...common,
    id: '1',
    attacker_steam_id: opponent,
    attacker_side: TeamNumber.CT,
    victim_steam_id: owner,
    victim_side: TeamNumber.T,
    is_attacker_controlling_bot: false,
    is_victim_controlling_bot: false,
    health_damage: 100,
    victim_health: 100,
    victim_new_health: 0,
    weapon_name: WeaponName.AK47,
    weapon_type: WeaponType.Rifle,
    ...overrides,
  } as DamageRow;
}
function shot(tick: number, overrides: Partial<ShotRow> = {}): ShotRow {
  return {
    ...common,
    id: String(tick),
    tick,
    frame: tick,
    player_steam_id: owner,
    player_side: TeamNumber.T,
    is_player_controlling_bot: false,
    weapon_name: WeaponName.AK47,
    weapon_id: 'weapon1',
    player_velocity_x: 0,
    player_velocity_y: 0,
    player_velocity_z: 0,
    player_yaw: 0,
    player_pitch: 0,
    recoil_index: 0,
    aim_punch_angle_x: 0,
    aim_punch_angle_y: 0,
    view_punch_angle_x: 0,
    view_punch_angle_y: 0,
    ...overrides,
  } as ShotRow;
}
function blind(overrides: Partial<PlayerBlindRow> = {}): PlayerBlindRow {
  return {
    ...common,
    id: '1',
    tick: 900,
    frame: 900,
    duration: 3,
    flasher_steam_id: opponent,
    flasher_side: TeamNumber.CT,
    flashed_steam_id: owner,
    flashed_side: TeamNumber.T,
    is_flasher_controlling_bot: false,
    is_flashed_controlling_bot: false,
    ...overrides,
  } as PlayerBlindRow;
}
function position(overrides: Partial<PlayerPositionRow> = {}): PlayerPositionRow {
  return {
    ...common,
    id: '1',
    tick: 995,
    frame: 995,
    player_steam_id: owner,
    side: TeamNumber.T,
    is_alive: true,
    health: 100,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    armor: 100,
    has_helmet: true,
    has_bomb: false,
    has_defuse_kit: false,
    is_ducking: false,
    is_airborne: false,
    is_scoping: false,
    is_defusing: false,
    is_planting: false,
    is_grabbing_hostage: false,
    active_weapon_name: WeaponName.AK47,
    grenades: '',
    ...overrides,
  } as PlayerPositionRow;
}
function input(overrides: Partial<DeathMatchInput> = {}): DeathMatchInput {
  return {
    checksum: 'demo',
    steamId: owner,
    mapName: 'de_mirage',
    date: '2026-01-01',
    source: DemoSource.PerfectWorld,
    tickrate: 64,
    tacticalEligible: true,
    shotsComplete: true,
    rounds: [
      {
        id: '1',
        match_checksum: 'demo',
        number: 1,
        start_tick: 0,
        freeze_time_end_tick: 100,
        end_tick: 2000,
        end_officially_tick: 2100,
        winner_side: TeamNumber.CT,
      } as RoundRow,
    ],
    roundPlayers: [0, 1, 2, 3, 4].flatMap((index) => [
      { round_number: 1, steam_id: `7656119800000000${index + 1}`, side: TeamNumber.T },
      { round_number: 1, steam_id: `7656119800000001${index + 1}`, side: TeamNumber.CT },
    ]),
    kills: [kill()],
    damages: [damage()],
    shots: [],
    blinds: [],
    positions: [],
    plants: [],
    defuses: [],
    ...overrides,
  };
}
function codes(data: DeathMatchInput): string[] {
  return buildDeathReviews(data)[0]?.findings.map((finding) => finding.code) ?? [];
}

describe('death review event boundaries and evidence', () => {
  it('keeps an ordinary death with a deterministic id and a measured source-unit distance', () => {
    const result = buildDeathReviews(input({ kills: [kill({ distance: 9999 })] }))[0];
    expect(result.kind).toBe('enemy');
    expect(result.distance).toBe(200);
    expect(result.healthBeforeHit).toBe(100);
    expect(result.teammatesAlive).toBe(4);
    expect(result.enemiesAlive).toBe(5);
    expect(result.findings.map((finding) => finding.code)).toContain('opening_death');
    expect(result.id).toBe(buildDeathReviews(input())[0].id);
    expect(result.recordingRequest?.opponentSteamId).toBe(opponent);
  });
  it.each([
    { killer_steam_id: owner, expected: 'self' },
    { killer_steam_id: mate, killer_side: TeamNumber.T, expected: 'team' },
    { killer_steam_id: '0', weapon_name: WeaponName.World, weapon_type: WeaponType.World, expected: 'world' },
    { killer_steam_id: '', expected: 'unknown' },
  ])('keeps non-opponent deaths without tactical blame ($expected)', ({ expected, ...changes }) => {
    const result = buildDeathReviews(input({ kills: [kill(changes)] }))[0];
    expect(result.kind).toBe(expected);
    expect(result.findings).toEqual([]);
    expect(result.recordingRequest?.includeOpponent).toBe(false);
  });
  it.each([50, 2050])('does not diagnose freeze-time or post-round deaths (%s)', (tick) => {
    expect(codes(input({ kills: [kill({ tick, frame: tick })] }))).toEqual([]);
  });
  it('disables elimination reasoning for respawns and incomplete rosters', () => {
    expect(codes(input({ kills: [kill({ id: 'earlier', tick: 300, frame: 300 }), kill()] }))).toEqual([]);
    expect(codes(input({ roundPlayers: [] }))).toEqual([]);
    expect(codes(input({ tacticalEligible: false }))).toEqual([]);
  });
  it('ignores foreign matches, rounds, after-death hits, and overkill damage', () => {
    const data = input({
      damages: [
        damage(),
        damage({
          tick: 950,
          frame: 950,
          attacker_steam_id: owner,
          attacker_side: TeamNumber.T,
          victim_steam_id: opponent,
          victim_side: TeamNumber.CT,
          health_damage: 500,
          victim_health: 20,
        }),
        damage({ tick: 900, frame: 900, round_number: 2 }),
        damage({ tick: 900, frame: 900, match_checksum: 'foreign' }),
        damage({ tick: 1001, frame: 1001 }),
      ],
    });
    expect(codes(data)).not.toContain('high_damage_to_killer');
    expect(codes(data)).not.toContain('damage_before_death');
    expect(buildDeathReviews(data)[0].timeline.filter((event) => event.kind === 'damage-dealt')[0].value).toBe(20);
  });
  it('does not emit nonfinite measurements or use a missing rate', () => {
    const data = input({
      kills: [kill({ killer_x: NaN })],
      positions: [position({ yaw: NaN, armor: NaN })],
      shots: [shot(990, { player_velocity_x: NaN })],
    });
    const result = buildDeathReviews(data)[0];
    expect(result.distance).toBeNull();
    expect(result.findings.flatMap((finding) => finding.measures).every((entry) => Number.isFinite(entry.value))).toBe(
      true,
    );
    expect(codes(data)).not.toContain('high_speed_final_shot');
    const unknownTiming = buildDeathReviews(input({ tickrate: 0 }));
    expect(unknownTiming).toHaveLength(1);
    expect(unknownTiming[0].recordingRequest).toBeNull();
    expect(unknownTiming[0].findings).toEqual([]);
  });
  it('preserves deaths with missing round metadata or bot control and keeps ids stable on reimport', () => {
    const missingRound = buildDeathReviews(input({ rounds: [] }));
    expect(missingRound).toHaveLength(1);
    expect(missingRound[0].recordingRequest).toBeNull();
    const controlled = buildDeathReviews(input({ kills: [kill({ is_victim_controlling_bot: true })] }));
    expect(controlled).toHaveLength(1);
    expect(controlled[0].findings).toEqual([]);
    expect(buildDeathReviews(input({ kills: [kill({ id: '9999' })] }))[0].id).toBe(buildDeathReviews(input())[0].id);
    expect(buildDeathReviews(input({ positions: [position()] }))[0].missingSignals).toEqual([]);
  });
  it('sorts same-tick timeline events by recorded frame instead of event type', () => {
    const result = buildDeathReviews(
      input({ shots: [shot(1000, { frame: 998 })], damages: [damage({ frame: 999 })] }),
    )[0];
    expect(result.timeline.map((event) => event.kind)).toEqual(['shot', 'damage-taken', 'death']);
  });
  it('rounds fractional-rate clip ranges outward without crossing the round boundary', () => {
    const result = buildDeathReviews(input({ tickrate: 63.999 }))[0];
    expect(result.startTick).toBe(488);
    expect(result.endTick).toBe(1320);
    expect(result.recordingRequest?.startTick).toBe(488);
    expect(result.recordingRequest?.endTick).toBe(1320);
    const bounded = input({ tickrate: 63.999 });
    bounded.rounds[0].start_tick = 600;
    bounded.rounds[0].end_tick = 1100;
    bounded.rounds[0].end_officially_tick = 1150;
    const boundedResult = buildDeathReviews(bounded)[0];
    expect(boundedResult.startTick).toBe(600);
    expect(boundedResult.endTick).toBe(1150);
  });
  it('keeps a malformed fractional death tick without offering a recording', () => {
    const result = buildDeathReviews(input({ kills: [kill({ tick: 1000.5 })] }))[0];
    expect(result.eventTick).toBe(1000.5);
    expect(result.recordingRequest).toBeNull();
    expect(result.findings).toEqual([]);
  });
});

describe('shot observations do not invent mechanics', () => {
  it('requires complete shot coverage before stating there was no return fire', () => {
    const damages = [damage({ tick: 900, frame: 900, health_damage: 10, victim_new_health: 90 }), damage()];
    expect(codes(input({ damages, shotsComplete: false }))).not.toContain('no_return_fire');
    expect(codes(input({ damages }))).toContain('no_return_fire');
    expect(codes(input({ damages, shots: [shot(950)] }))).not.toContain('no_return_fire');
    expect(codes(input({ damages, shots: [shot(1001)] }))).toContain('no_return_fire');
  });
  it('does not call an instant one-tap a missed response opportunity', () => {
    expect(codes(input())).not.toContain('no_return_fire');
    expect(codes(input())).not.toContain('very_fast_damage_sequence');
  });
  it('distinguishes a high-speed opening shot from the final shot', () => {
    const data = input({ shots: [shot(900, { player_velocity_x: 100 }), shot(950), shot(995)] });
    expect(codes(data)).toContain('first_shot_high_speed');
    expect(codes(data)).not.toContain('high_speed_final_shot');
    expect(
      codes(
        input({ shots: [shot(900), shot(980, { player_velocity_x: 100 }), shot(995, { player_velocity_y: 100 })] }),
      ),
    ).toContain('high_speed_final_shot');
  });
  it('does not call a grenade or knife a high-speed gunshot', () => {
    for (const weapon_name of [
      WeaponName.Flashbang,
      WeaponName.Knife,
      WeaponName.Bomb,
      'Future weapon' as WeaponName,
    ]) {
      expect(codes(input({ shots: [shot(995, { weapon_name, player_velocity_x: 250 })] }))).not.toContain(
        'high_speed_final_shot',
      );
    }
  });
  it('requires a continuous same-weapon burst and keeps burst and spray mutually exclusive', () => {
    const short = [shot(970), shot(980), shot(990)];
    expect(codes(input({ shots: short }))).toContain('burst_without_damage');
    expect(codes(input({ shots: short }))).not.toContain('spray_without_damage');
    const long = Array.from({ length: 8 }, (_, index) => shot(920 + index * 10));
    expect(codes(input({ shots: long }))).toContain('spray_without_damage');
    expect(codes(input({ shots: long }))).not.toContain('burst_without_damage');
    expect(codes(input({ shots: [shot(900), shot(950), shot(990)] }))).not.toContain('burst_without_damage');
    expect(codes(input({ shots: [shot(970), shot(980, { weapon_id: 'other' }), shot(990)] }))).not.toContain(
      'burst_without_damage',
    );
  });
  it('does not assign another target or count utility damage as a landed bullet', () => {
    const shots = [shot(970), shot(980), shot(990)];
    const hit = damage({
      tick: 980,
      frame: 980,
      attacker_steam_id: owner,
      attacker_side: TeamNumber.T,
      victim_steam_id: '76561198000000012',
      victim_side: TeamNumber.CT,
      health_damage: 20,
      victim_new_health: 80,
    });
    expect(codes(input({ shots, damages: [hit, damage()] }))).not.toContain('burst_without_damage');
    expect(
      codes(input({ shots, damages: [damage({ ...hit, weapon_name: WeaponName.HEGrenade }), damage()] })),
    ).toContain('burst_without_damage');
  });
  it('uses shortest yaw arc and never turns zero aim-punch into recoil precision', () => {
    expect(codes(input({ shots: [shot(980, { player_yaw: 179 }), shot(990, { player_yaw: -179 })] }))).not.toContain(
      'shooting_direction_change',
    );
    const result = buildDeathReviews(input({ shots: [shot(980), shot(990, { player_yaw: 90 })] }))[0];
    expect(result.findings.map((finding) => finding.code)).toContain('shooting_direction_change');
    expect(result.findings.map((finding) => finding.code)).not.toContain('recoil_compensation');
    expect(result.evaluatedRules).not.toContain('mouse_oscillation');
    expect(codes(input({ shots: [shot(900), shot(990, { player_yaw: 90 })] }))).not.toContain(
      'shooting_direction_change',
    );
    expect(codes(input({ shots: [shot(980), shot(990, { player_yaw: 90, weapon_id: 'other' })] }))).not.toContain(
      'shooting_direction_change',
    );
  });
});

describe('trade, blindness, snapshots, and objective scope', () => {
  it('reports a later trade as an outcome, not as evidence for a prior action', () => {
    const trade = kill({
      id: 'trade',
      tick: 1100,
      frame: 1100,
      killer_steam_id: mate,
      killer_side: TeamNumber.T,
      victim_steam_id: opponent,
      victim_side: TeamNumber.CT,
    });
    const result = buildDeathReviews(input({ kills: [kill(), trade] }))[0];
    expect(result.findings.map((finding) => finding.code)).toContain('traded_death');
    expect(result.findings.map((finding) => finding.code)).not.toContain('untraded_death');
    expect(result.findings.map((finding) => finding.code)).not.toContain('death_after_kill');
    expect(codes(input())).toContain('untraded_death');
    const data = input();
    data.rounds[0].end_tick = 1100;
    expect(codes(data)).not.toContain('untraded_death');
  });
  it('does not invent an opening order among deaths in the same recorded frame', () => {
    const simultaneous = kill({ id: 'simultaneous', victim_steam_id: mate });
    const result = buildDeathReviews(input({ kills: [kill(), simultaneous] }))[0];
    expect(result.findings.map((finding) => finding.code)).not.toContain('opening_death');
    expect(result.evaluatedRules).not.toContain('opening_death');
  });
  it('does not request a trade against a killer already dead before delayed damage', () => {
    const earlier = kill({
      id: 'earlier',
      tick: 950,
      frame: 950,
      killer_steam_id: owner,
      killer_side: TeamNumber.T,
      victim_steam_id: opponent,
      victim_side: TeamNumber.CT,
    });
    const data = input({
      kills: [earlier, kill({ weapon_name: WeaponName.Molotov, weapon_type: WeaponType.Grenade })],
    });
    const result = buildDeathReviews(data)[0];
    expect(result.findings.map((finding) => finding.code)).toContain('death_after_kill');
    expect(result.evaluatedRules).not.toContain('untraded_death');
  });
  it('keeps multiple damage sources separate from simultaneous visible enemies', () => {
    const data = input({
      damages: [
        damage({
          tick: 990,
          frame: 990,
          attacker_steam_id: '76561198000000012',
          health_damage: 10,
          victim_new_health: 90,
        }),
        damage(),
      ],
    });
    expect(codes(data)).toContain('multi_attacker_damage');
    expect(codes(data)).not.toContain('simultaneous_visible_enemies');
    expect(codes(data)).not.toContain('multiple_visible_angles');
  });
  it('checks blindness at each shot rather than borrowing the death flag', () => {
    expect(
      codes(
        input({
          kills: [kill({ is_victim_blinded: false })],
          blinds: [blind({ tick: 900, frame: 900, duration: 1 })],
          shots: [shot(920)],
        }),
      ),
    ).toContain('firing_while_blind');
    expect(
      codes(
        input({
          kills: [kill({ is_victim_blinded: true })],
          blinds: [blind({ tick: 980, frame: 980 })],
          shots: [shot(950)],
        }),
      ),
    ).not.toContain('firing_while_blind');
    expect(codes(input({ blinds: [blind()], kills: [kill({ is_victim_blinded: true })] }))).toContain('enemy_flash');
    expect(
      codes(input({ blinds: [blind({ duration: 0.2 })], kills: [kill({ is_victim_blinded: true })] })),
    ).not.toContain('enemy_flash');
  });
  it.each([
    ['knife_in_hand', { active_weapon_name: WeaponName.Knife }],
    ['grenade_in_hand', { active_weapon_name: WeaponName.Flashbang }],
    ['bomb_in_hand', { active_weapon_name: WeaponName.Bomb }],
    ['planting_death', { is_planting: true }],
    ['defusing_death', { is_defusing: true }],
    ['bomb_carrier_death', { has_bomb: true }],
    ['kit_carrier_death', { has_defuse_kit: true }],
    ['crouched_death', { is_ducking: true }],
    ['scoped_death', { is_scoping: true }],
    ['no_armor', { armor: 0 }],
    ['retained_utility', { grenades: `${WeaponName.Flashbang},${WeaponName.Smoke}` }],
  ] as const)('requires a fresh, alive snapshot for %s', (code, state) => {
    expect(codes(input({ positions: [position(state)] }))).toContain(code);
    expect(codes(input({ positions: [position({ ...state, tick: 980, frame: 980 })] }))).not.toContain(code);
    expect(codes(input({ positions: [position({ ...state, tick: 1000, frame: 1001 })] }))).not.toContain(code);
    expect(codes(input({ positions: [position({ ...state, is_alive: false })] }))).not.toContain(code);
  });
  it('requires all living teammate snapshots before asserting nearest teammate distance', () => {
    const teammates = [2, 3, 4, 5].map((index) =>
      position({ player_steam_id: `7656119800000000${index}`, x: 1500 + index * 10 }),
    );
    expect(codes(input({ positions: [position(), ...teammates] }))).toContain('distant_nearest_teammate');
    expect(codes(input({ positions: [position(), ...teammates.slice(1)] }))).not.toContain('distant_nearest_teammate');
  });
  it('requires a prior plant in this same round', () => {
    const data = input();
    data.plants = [
      {
        ...common,
        id: 'plant',
        tick: 900,
        frame: 900,
        planter_steam_id: mate,
        is_planter_controlling_bot: false,
      } as DeathMatchInput['plants'][number],
    ];
    expect(codes(data)).toContain('postplant_t_death');
    data.plants[0].tick = 1001;
    expect(codes(data)).not.toContain('postplant_t_death');
    data.plants[0].tick = 900;
    data.plants[0].round_number = 2;
    expect(codes(data)).not.toContain('postplant_t_death');
  });
  it('has unique rule ids and never evaluates unsupported signals', () => {
    expect(DEATH_RULES.length).toBeGreaterThanOrEqual(66);
    expect(new Set(DEATH_RULES.map((rule) => rule.code)).size).toBe(DEATH_RULES.length);
    const unsupported = new Set(DEATH_RULES.filter((rule) => rule.support === 'unavailable').map((rule) => rule.code));
    expect(buildDeathReviews(input())[0].evaluatedRules.some((code) => unsupported.has(code))).toBe(false);
  });
});
