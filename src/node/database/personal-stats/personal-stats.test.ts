import { describe, expect, it } from 'vite-plus/test';
import {
  DemoSource,
  EconomyType,
  GameMode,
  RoundEndReason,
  TeamNumber,
  WeaponName,
} from 'csdm/common/types/counter-strike';
import { aggregatePersonalStats, calculateHltvRating1 } from './aggregate-personal-stats';
import { buildPersonalMatchStats, calculateRoundWinShare, type PersonalMatchInput } from './build-personal-match-stats';

const self = '76561198000000001';
const mate = '76561198000000002';
const enemy = '76561198000000003';
const enemy2 = '76561198000000004';

function fixture(): PersonalMatchInput {
  return {
    demo: {
      checksum: 'a',
      date: new Date('2026-01-01'),
      map_name: 'de_inferno',
      source: DemoSource.Unknown,
      build_number: 1,
      tickrate: 64,
    },
    match: { winner_name: 'A', game_mode_str: GameMode.Competitive, max_rounds: 24 },
    players: [
      { steam_id: self, name: 'Self', team_name: 'A' },
      { steam_id: mate, name: 'Mate', team_name: 'A' },
      { steam_id: enemy, name: 'Enemy', team_name: 'B' },
      { steam_id: enemy2, name: 'Enemy2', team_name: 'B' },
    ],
    rounds: [1, 2].map(
      (number) =>
        ({
          number,
          start_tick: number * 1000,
          freeze_time_end_tick: number * 1000 + 100,
          end_tick: number * 1000 + 700,
          end_officially_tick: number * 1000 + 800,
          winner_side: number === 1 ? TeamNumber.T : TeamNumber.CT,
          end_reason: RoundEndReason.TerroristWin,
          team_a_name: 'A',
          team_b_name: 'B',
          team_a_score: 13,
          team_b_score: 8,
        }) as PersonalMatchInput['rounds'][number],
    ),
    economies: [1, 2].flatMap((round_number) =>
      [self, mate, enemy, enemy2].map(
        (player_steam_id) =>
          ({
            round_number,
            player_steam_id,
            player_side: [self, mate].includes(player_steam_id) ? TeamNumber.T : TeamNumber.CT,
            type: EconomyType.Full,
            equipment_value: 4000,
            money_spent: 3000,
          }) as PersonalMatchInput['economies'][number],
      ),
    ),
    kills: [],
    damages: [],
    shots: [],
    clutches: [],
    blinds: [],
    plants: [],
    defuses: [],
  };
}

function kill(overrides: Partial<PersonalMatchInput['kills'][number]> = {}): PersonalMatchInput['kills'][number] {
  return {
    id: 1,
    round_number: 1,
    tick: 1200,
    frame: 1200,
    killer_steam_id: self,
    victim_steam_id: enemy,
    assister_steam_id: '',
    killer_side: TeamNumber.T,
    victim_side: TeamNumber.CT,
    assister_side: TeamNumber.UNASSIGNED,
    is_headshot: false,
    weapon_name: WeaponName.AK47,
    is_killer_controlling_bot: false,
    is_victim_controlling_bot: false,
    is_assister_controlling_bot: false,
    ...overrides,
  } as PersonalMatchInput['kills'][number];
}

function damage(overrides: Partial<PersonalMatchInput['damages'][number]> = {}): PersonalMatchInput['damages'][number] {
  return {
    round_number: 1,
    tick: 1200,
    attacker_steam_id: self,
    victim_steam_id: enemy,
    attacker_side: TeamNumber.T,
    victim_side: TeamNumber.CT,
    health_damage: 100,
    victim_health: 100,
    weapon_name: WeaponName.AK47,
    is_attacker_controlling_bot: false,
    ...overrides,
  } as PersonalMatchInput['damages'][number];
}

describe('public rating and RWS definitions', () => {
  it('reproduces FACEIT public examples and includes lost rounds in the average', () => {
    expect(calculateRoundWinShare(true, 140, 500, false, false)).toBe(28);
    expect(calculateRoundWinShare(false, 100, 0, false, false)).toBe(0);
    expect(calculateRoundWinShare(true, 0, 200, true, true)).toBe(30);
    expect(calculateRoundWinShare(true, 100, 300, true, true)).toBeCloseTo(53.333333);
    expect(
      (calculateRoundWinShare(true, 140, 500, false, false)! + calculateRoundWinShare(false, 0, 0, false, false)!) / 2,
    ).toBe(14);
  });

  it('does not invent shares when zero damage or the objective actor is missing', () => {
    expect(calculateRoundWinShare(true, 0, 0, true, true)).toBeNull();
    expect(calculateRoundWinShare(true, 50, 100, false, true, false)).toBeNull();
  });

  it('uses the published Rating 1.0 constants and returns missing for no rounds', () => {
    expect(calculateHltvRating1(0.679, 0.317, 1.277, 1)).toBeCloseTo(1);
    // HLTV's original worked examples: 13/6 in 18 rounds with four doubles,
    // versus 37/17 in 30 with nine doubles, four triples and one quad.
    expect(calculateHltvRating1(13, 12, 21, 18)).toBeCloseTo(1.28, 2);
    expect(calculateHltvRating1(37, 13, 91, 30)).toBeCloseTo(1.91, 2);
    expect(calculateHltvRating1(0, 0, 0, 0)).toBeNull();
  });
});

describe('per-demo round facts', () => {
  it('persists exact eligible event ticks, keeping the earliest event despite unsorted rows', () => {
    const data = fixture();
    data.kills = [
      kill({
        id: 2,
        tick: 1500,
        killer_steam_id: enemy,
        victim_steam_id: self,
        killer_side: TeamNumber.CT,
        victim_side: TeamNumber.T,
      }),
      kill({ id: 1, tick: 1200 }),
    ];
    data.blinds = [
      { tick: 1450, duration: 2 },
      { tick: 1300, duration: 3 },
      { tick: 1250, duration: 1 },
      { tick: 1200, duration: 3, is_flasher_controlling_bot: true },
    ].map(
      (event) =>
        ({
          round_number: 1,
          flasher_steam_id: self,
          flashed_steam_id: mate,
          flasher_side: TeamNumber.T,
          flashed_side: TeamNumber.T,
          is_flasher_controlling_bot: false,
          ...event,
        }) as PersonalMatchInput['blinds'][number],
    );
    data.clutches = [
      {
        round_number: 1,
        tick: 1400,
        clutcher_steam_id: self,
        opponent_count: 1,
        won: false,
      } as PersonalMatchInput['clutches'][number],
    ];
    const players = buildPersonalMatchStats(data);
    const stats = players.find((player) => player.steamId === self)!;
    expect(stats.tickrate).toBe(64);
    expect(stats.rounds[0]).toMatchObject({
      openingKillTick: 1200,
      openingDeathTick: null,
      deathTick: 1500,
      teamFlashTick: 1300,
      clutchTick: 1400,
      teammatesFlashed: 2,
    });
    expect(players.find((player) => player.steamId === enemy)?.rounds[0].openingDeathTick).toBe(1200);
    expect(stats.rounds[1]).toMatchObject({
      openingKillTick: null,
      openingDeathTick: null,
      deathTick: null,
      teamFlashTick: null,
      clutchTick: null,
    });
  });

  it('separates enemy kills, all deaths, overkill damage, utility and objective RWS', () => {
    const data = fixture();
    data.rounds[0].end_reason = RoundEndReason.TargetBombed;
    data.kills = [
      kill({ is_headshot: true }),
      kill({ id: 2, tick: 1250, victim_steam_id: mate, victim_side: TeamNumber.T }),
      kill({
        id: 3,
        tick: 2300,
        round_number: 2,
        killer_steam_id: self,
        victim_steam_id: self,
        victim_side: TeamNumber.T,
      }),
    ];
    data.damages = [
      damage({ health_damage: 140, victim_health: 30, weapon_name: WeaponName.HEGrenade }),
      damage({ attacker_steam_id: mate, health_damage: 70 }),
      damage({ tick: 1750, health_damage: 100 }),
      damage({ victim_steam_id: mate, victim_side: TeamNumber.T, health_damage: 12 }),
    ];
    data.plants = [
      {
        round_number: 1,
        tick: 1300,
        planter_steam_id: self,
        is_planter_controlling_bot: false,
      } as PersonalMatchInput['plants'][number],
    ];
    const stats = buildPersonalMatchStats(data).find((player) => player.steamId === self)!;
    expect(stats.rounds[0]).toMatchObject({
      kills: 1,
      headshotKills: 1,
      damage: 130,
      utilityDamage: 30,
      friendlyDamage: 12,
      bombPlants: 1,
      rws: 51,
    });
    expect(stats.rounds[1]).toMatchObject({ kills: 0, deaths: 1, survived: false, kast: false, rws: 0 });
    expect(aggregatePersonalStats([stats], { steamId: self }).metrics).toMatchObject({
      kills: 1,
      deaths: 1,
      headshotPercentage: 100,
      adr: 65,
      rws: 25.5,
      kastPercentage: 50,
    });
  });

  it('counts a trade once, allows one killer to trade several teammates, and excludes later trades', () => {
    const data = fixture();
    data.kills = [
      kill({ killer_steam_id: enemy, victim_steam_id: self, killer_side: TeamNumber.CT, victim_side: TeamNumber.T }),
      kill({
        id: 2,
        tick: 1220,
        killer_steam_id: enemy,
        victim_steam_id: mate,
        killer_side: TeamNumber.CT,
        victim_side: TeamNumber.T,
      }),
      kill({ id: 3, tick: 1300, killer_steam_id: '76561198000000005', victim_steam_id: enemy }),
      kill({
        id: 4,
        tick: 1600,
        killer_steam_id: enemy2,
        victim_steam_id: '76561198000000005',
        killer_side: TeamNumber.CT,
        victim_side: TeamNumber.T,
      }),
    ];
    data.players.push({ steam_id: '76561198000000005', name: 'Trader', team_name: 'A' });
    data.economies.push({ ...data.economies[0], player_steam_id: '76561198000000005' });
    const facts = buildPersonalMatchStats(data);
    expect(facts.find((player) => player.steamId === self)!.rounds[0]).toMatchObject({
      openingDeath: true,
      tradedDeaths: 1,
      kast: true,
    });
    expect(facts.find((player) => player.steamId === mate)!.rounds[0].tradedDeaths).toBe(1);
    expect(facts.find((player) => player.steamId === '76561198000000005')!.rounds[0].tradeKills).toBe(1);
    data.kills[2].tick = 1600;
    expect(buildPersonalMatchStats(data).find((player) => player.steamId === self)!.rounds[0].tradedDeaths).toBe(0);
  });

  it('does not fabricate participation, opening duels from teamkills, or unfinished rounds', () => {
    const data = fixture();
    data.economies = data.economies.filter((entry) => !(entry.player_steam_id === self && entry.round_number === 2));
    data.rounds.push({ ...data.rounds[1], number: 3, winner_side: TeamNumber.UNASSIGNED });
    data.kills = [
      kill({ id: 1, tick: 1100, victim_steam_id: mate, victim_side: TeamNumber.T }),
      kill({ id: 2, tick: 1200, killer_steam_id: mate }),
      kill({ id: 3, tick: 1900, is_headshot: true }),
    ];
    const facts = buildPersonalMatchStats(data);
    expect(facts.find((player) => player.steamId === self)!.rounds).toHaveLength(1);
    expect(facts.find((player) => player.steamId === self)!.rounds[0].openingKill).toBe(false);
    expect(facts.find((player) => player.steamId === mate)!.rounds[0].openingKill).toBe(true);
    expect(facts.find((player) => player.steamId === self)!.demoRoundCount).toBe(2);
  });

  it('does not count an assist or invent a denominator round without a participation snapshot', () => {
    const data = fixture();
    data.economies = data.economies.filter((entry) => !(entry.player_steam_id === self && entry.round_number === 2));
    data.kills = [
      kill({
        round_number: 2,
        tick: 2200,
        killer_steam_id: mate,
        assister_steam_id: self,
        assister_side: TeamNumber.T,
      }),
    ];
    const summary = aggregatePersonalStats(buildPersonalMatchStats(data), { steamId: self });
    expect(summary.metrics).toMatchObject({ roundCount: 1, kills: 0, assists: 0, deaths: 0, kda: null });
    expect(summary.analysis.output.killOrAssistRounds).toEqual({ count: 0, total: 1, percentage: 0 });
  });

  it('keeps firearm shots distinct from damage events, grenade throws and controlled-bot fire', () => {
    const data = fixture();
    data.shots = [
      { weapon_name: WeaponName.AK47, is_player_controlling_bot: false },
      { weapon_name: WeaponName.AK47, is_player_controlling_bot: true },
      { weapon_name: WeaponName.HEGrenade, is_player_controlling_bot: false },
    ].map(
      (entry) =>
        ({ ...entry, tick: 1200, round_number: 1, player_steam_id: self }) as PersonalMatchInput['shots'][number],
    );
    data.damages = [
      damage({ health_damage: 100 }),
      damage({ victim_steam_id: enemy2, health_damage: 10 }),
      damage({ weapon_name: WeaponName.HEGrenade, health_damage: 20 }),
    ];
    const summary = aggregatePersonalStats(buildPersonalMatchStats(data), { steamId: self });
    expect(summary.weapons.find((weapon) => weapon.weapon === WeaponName.AK47)).toMatchObject({
      shots: 1,
      damage: 110,
    });
    expect(summary.weapons.find((weapon) => weapon.weapon === WeaponName.HEGrenade)).toMatchObject({
      shots: 0,
      damage: 20,
    });
    expect(summary.metrics.heThrown).toBe(1);
  });

  it('keeps controlled-bot damage in team RWS but does not credit it to the controller', () => {
    const data = fixture();
    data.damages = [
      damage({ health_damage: 40 }),
      damage({ attacker_steam_id: mate, health_damage: 60, is_attacker_controlling_bot: true }),
    ];
    const facts = buildPersonalMatchStats(data);
    expect(facts.find((player) => player.steamId === self)!.rounds[0].rws).toBe(40);
    expect(facts.find((player) => player.steamId === mate)!.rounds[0].rws).toBe(0);
  });

  it('does not give the bot controller an objective bonus or bomb count', () => {
    const data = fixture();
    data.rounds[0].end_reason = RoundEndReason.TargetBombed;
    data.damages = [damage()];
    data.plants = [
      {
        round_number: 1,
        tick: 1400,
        planter_steam_id: self,
        is_planter_controlling_bot: true,
      } as PersonalMatchInput['plants'][number],
    ];
    expect(buildPersonalMatchStats(data).find((player) => player.steamId === self)!.rounds[0]).toMatchObject({
      rws: 70,
      bombPlants: 0,
    });
    data.rounds[0].end_reason = RoundEndReason.BombDefused;
    data.defuses = [
      {
        round_number: 1,
        tick: 1400,
        defuser_steam_id: self,
        is_defuser_controlling_bot: true,
      } as PersonalMatchInput['defuses'][number],
    ];
    expect(buildPersonalMatchStats(data).find((player) => player.steamId === self)!.rounds[0]).toMatchObject({
      rws: 70,
      bombDefuses: 0,
    });
  });

  it('does not calibrate historical Rating 1.0 for Wingman or respawn/custom games', () => {
    for (const mode of [GameMode.Scrimmage2V2, GameMode.Deathmatch, GameMode.Custom]) {
      const data = fixture();
      data.match.game_mode_str = mode;
      const summary = aggregatePersonalStats(buildPersonalMatchStats(data), { steamId: self });
      expect(summary.metrics.hltvRating1).toBeNull();
      expect(summary.metrics.ratingRoundCount).toBe(0);
    }
    const data = fixture();
    data.kills = [
      kill({ victim_steam_id: self, killer_steam_id: enemy }),
      kill({ id: 2, tick: 1400, victim_steam_id: self, killer_steam_id: enemy }),
    ];
    expect(buildPersonalMatchStats(data).find((player) => player.steamId === self)!.ratingEligible).toBe(false);
  });

  it('recognizes third-party 5v5 despite a Casual header, but rejects short casual, 10v10 and respawn evidence', () => {
    const data = fixture();
    data.match.game_mode_str = GameMode.Casual;
    data.players = Array.from({ length: 10 }, (_, index) => ({
      steam_id: String(BigInt(self) + BigInt(index)),
      name: `Fixture ${index}`,
      team_name: index < 5 ? 'A' : 'B',
    }));
    data.rounds = Array.from({ length: 5 }, (_, index) => ({ ...data.rounds[0], number: index + 1 }));
    data.economies = data.rounds.flatMap((round) =>
      data.players.map((player, index) => ({
        ...data.economies[0],
        round_number: round.number,
        player_steam_id: player.steam_id,
        player_side: index < 5 ? TeamNumber.T : TeamNumber.CT,
      })),
    );
    expect(buildPersonalMatchStats(data)[0]).toMatchObject({
      ratingEligible: true,
      ratingEligibilityBasis: 'observed-5v5',
      gameMode: GameMode.Casual,
    });
    const standard = aggregatePersonalStats(buildPersonalMatchStats(data), { steamId: self });
    expect(standard.metrics.ratingRoundCount).toBe(5);
    data.match.max_rounds = 15;
    data.rounds.forEach((round) => {
      round.team_a_score = 8;
      round.team_b_score = 2;
    });
    expect(buildPersonalMatchStats(data)[0].ratingEligible).toBe(false);
    data.match.max_rounds = 24;
    data.players.push({ steam_id: '76561198000000099', name: 'Extra', team_name: 'A' });
    data.economies.push({ ...data.economies[0], player_steam_id: '76561198000000099' });
    expect(buildPersonalMatchStats(data)[0].ratingEligible).toBe(false);
    data.economies.pop();
    data.kills = [
      kill({ killer_steam_id: enemy, victim_steam_id: self }),
      kill({ id: 2, tick: 1400, killer_steam_id: enemy, victim_steam_id: self }),
    ];
    expect(buildPersonalMatchStats(data)[0].ratingEligible).toBe(false);
  });

  it('records utility throws, hostile flash exposure, flash assists and the first clutch only', () => {
    const data = fixture();
    data.shots = [
      WeaponName.Flashbang,
      WeaponName.Smoke,
      WeaponName.HEGrenade,
      WeaponName.Molotov,
      WeaponName.AK47,
    ].map(
      (weapon_name) =>
        ({ tick: 1300, round_number: 1, player_steam_id: self, weapon_name }) as PersonalMatchInput['shots'][number],
    );
    data.blinds = [
      { duration: 2, flashed_steam_id: enemy, flashed_side: TeamNumber.CT },
      { duration: 0.5, flashed_steam_id: enemy2, flashed_side: TeamNumber.CT },
      { duration: 3, flashed_steam_id: mate, flashed_side: TeamNumber.T },
    ].map(
      (value) =>
        ({
          ...value,
          tick: 1400,
          round_number: 1,
          flasher_steam_id: self,
          flasher_side: TeamNumber.T,
        }) as PersonalMatchInput['blinds'][number],
    );
    data.kills = [
      kill({ killer_steam_id: mate, assister_steam_id: self, assister_side: TeamNumber.T, is_assisted_flash: true }),
    ];
    data.clutches = [3, 1].map(
      (opponent_count, index) =>
        ({
          round_number: 1,
          tick: 1400 + index,
          clutcher_steam_id: self,
          opponent_count,
          won: true,
        }) as PersonalMatchInput['clutches'][number],
    );
    const stats = buildPersonalMatchStats(data).find((player) => player.steamId === self)!;
    expect(stats.rounds[0]).toMatchObject({
      flashesThrown: 1,
      smokesThrown: 1,
      heThrown: 1,
      fireThrown: 1,
      enemiesFlashed: 1,
      enemyBlindSeconds: 2.5,
      teammatesFlashed: 1,
      assists: 1,
      flashAssists: 1,
      clutchOpponents: 3,
      clutchWon: true,
    });
    expect(aggregatePersonalStats([stats], { steamId: self }).byClutchSize).toEqual([
      { opponents: 3, attempts: 1, wins: 1, winPercentage: 100 },
    ]);
  });
});

describe('cross-match personal summary', () => {
  it('pools denominators, deduplicates checksum, and excludes other accounts', () => {
    const data = fixture();
    data.kills = [kill({ is_headshot: true })];
    const a = buildPersonalMatchStats(data).find((player) => player.steamId === self)!;
    const b = {
      ...a,
      checksum: 'b',
      result: 'loss' as const,
      source: DemoSource.PerfectWorld,
      buildNumber: 2,
      rounds: [{ ...a.rounds[0], kills: 9, headshotKills: 0, damage: 900, rws: 90 }],
    };
    const summary = aggregatePersonalStats([a, b, a, { ...a, steamId: enemy }], { steamId: self });
    expect(summary).toMatchObject({ matchCount: 2, matchWins: 1, matchLosses: 1, matchWinPercentage: 50 });
    expect(summary.metrics).toMatchObject({
      roundCount: 3,
      kills: 10,
      headshotPercentage: 10,
      adr: 300,
      rwsMissingRoundCount: 1,
      rws: 45,
    });
    expect(summary.cohorts).toHaveLength(2);
    expect(summary.bySide[0].matchCount).toBe(2);
  });

  it('applies source/map/side filters and returns null, not NaN or infinity, for undefined ratios', () => {
    const stats = buildPersonalMatchStats(fixture());
    const summary = aggregatePersonalStats(stats, { steamId: self });
    expect(summary.metrics.headshotPercentage).toBeNull();
    expect(summary.metrics.kd).toBeNull();
    expect(summary.metrics.openingSuccessPercentage).toBeNull();
    const absentSide = aggregatePersonalStats(stats, { steamId: self, side: TeamNumber.CT });
    expect(absentSide.matchCount).toBe(0);
    expect(absentSide.coverage.skippedMatches).toBe(0);
    expect(aggregatePersonalStats(stats, { steamId: self, source: DemoSource.PerfectWorld }).matchCount).toBe(0);
    expect(aggregatePersonalStats(stats, { steamId: self, mapName: 'de_nuke' }).metrics.hltvRating1).toBeNull();
    expect(JSON.stringify(summary)).not.toContain('NaN');
  });
});
