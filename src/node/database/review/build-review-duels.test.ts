import { describe, expect, it } from 'vite-plus/test';
import { TeamNumber, WeaponName } from 'csdm/common/types/counter-strike';
import type { KillRow } from '../kills/kill-table';
import type { DamageRow } from '../damages/damage-table';
import type { RoundRow } from '../rounds/round-table';
import { buildReviewDuels } from './build-review-duels';

const steamId = '76561198000000001';
const enemy = '76561198000000002';
const teammate = '76561198000000003';
function fixture(rate = 128): Parameters<typeof buildReviewDuels>[0] {
  return {
    matches: [{ checksum: 'a', map_name: 'de_inferno', date: '2026-01-01', tickrate: rate }],
    rounds: [
      {
        match_checksum: 'a',
        number: 1,
        start_tick: 1000,
        end_tick: 20000,
        end_officially_tick: 20500,
        winner_side: TeamNumber.T,
      } as RoundRow,
    ],
    kills: [],
    damages: [],
    players: [{ match_checksum: 'a', steam_id: enemy, name: 'Enemy' }],
    participation: [{ match_checksum: 'a', round_number: 1, player_side: TeamNumber.T }],
  };
}
function kill(change: Partial<KillRow> = {}): KillRow {
  return {
    id: 1,
    match_checksum: 'a',
    round_number: 1,
    tick: 4000,
    frame: 100,
    killer_steam_id: steamId,
    victim_steam_id: enemy,
    killer_side: TeamNumber.T,
    victim_side: TeamNumber.CT,
    killer_name: 'Self',
    victim_name: 'Enemy',
    weapon_name: WeaponName.AK47,
    is_headshot: false,
    is_killer_controlling_bot: false,
    is_victim_controlling_bot: false,
    ...change,
  } as KillRow;
}
function damage(change: Partial<DamageRow> = {}): DamageRow {
  return {
    id: 1,
    match_checksum: 'a',
    round_number: 1,
    tick: 3800,
    frame: 90,
    attacker_steam_id: steamId,
    victim_steam_id: enemy,
    attacker_side: TeamNumber.T,
    victim_side: TeamNumber.CT,
    health_damage: 30,
    victim_health: 100,
    weapon_name: WeaponName.AK47,
    is_attacker_controlling_bot: false,
    is_victim_controlling_bot: false,
    ...change,
  } as DamageRow;
}

describe('complete review encounters', () => {
  it('respects real tickrate and extends a killing encounter to include its earlier damage without duplication', () => {
    const input = fixture(128);
    input.kills = [kill()];
    input.damages = [
      damage({ tick: 3400, health_damage: 70, victim_health: 30 }),
      damage({ id: 2, tick: 3900, health_damage: 20 }),
    ];
    const page = buildReviewDuels(input, { steamId });
    expect(page.total).toBe(1);
    expect(page.events[0]).toMatchObject({
      kind: 'kill',
      eventTick: 4000,
      startTick: 2376,
      endTick: 4512,
      damageGiven: 50,
      opening: true,
    });
    expect(page.coverage).toBe('kills-deaths-damage');
  });

  it('splits damage after five seconds of silence and at a kill, but merges the exact five-second boundary', () => {
    const input = fixture(64);
    input.damages = [damage({ tick: 2000 }), damage({ id: 2, tick: 2320 }), damage({ id: 3, tick: 2641 })];
    let page = buildReviewDuels(input, { steamId });
    expect(page.events.map((event) => event.damageGiven)).toEqual([60, 30]);
    expect(page.events.every((event) => event.opponent === 'Enemy')).toBe(true);
    input.kills = [kill({ tick: 2320 })];
    input.damages[2].tick = 2330;
    page = buildReviewDuels(input, { steamId });
    expect(page.events.map((event) => event.kind)).toEqual(['kill', 'damage']);
    expect(page.events.map((event) => event.damageGiven)).toEqual([60, 30]);
  });

  it('keeps both damage directions and independent opponents without double-counting the killing shot', () => {
    const input = fixture();
    input.kills = [kill()];
    input.damages = [
      damage(),
      damage({
        id: 2,
        tick: 3900,
        attacker_steam_id: enemy,
        victim_steam_id: steamId,
        attacker_side: TeamNumber.CT,
        victim_side: TeamNumber.T,
        health_damage: 20,
      }),
      damage({ id: 3, tick: 4000, health_damage: 120, victim_health: 70 }),
      damage({ id: 4, victim_steam_id: '76561198000000004', health_damage: 15 }),
    ];
    const page = buildReviewDuels(input, { steamId });
    expect(page.events.find((event) => event.kind === 'kill')).toMatchObject({ damageGiven: 100, damageTaken: 20 });
    expect(page.events.find((event) => event.kind === 'damage')?.damageGiven).toBe(15);
    expect(page.total).toBe(2);
  });

  it('uses the first enemy elimination globally with frame and numeric-id ties, without crediting controlled bots', () => {
    const input = fixture();
    input.kills = [kill({ id: 10 }), kill({ id: 2, killer_steam_id: teammate })];
    expect(buildReviewDuels(input, { steamId }).openingKills).toBe(0);
    input.kills[0].frame = 99;
    expect(buildReviewDuels(input, { steamId }).openingKills).toBe(1);
    input.kills = [kill({ is_killer_controlling_bot: true }), kill({ id: 2, tick: 4200 })];
    expect(buildReviewDuels(input, { steamId })).toMatchObject({ total: 1, openingKills: 0 });
    input.kills = [
      kill({ killer_steam_id: enemy, victim_steam_id: steamId, killer_side: TeamNumber.CT, victim_side: TeamNumber.T }),
    ];
    expect(buildReviewDuels(input, { steamId })).toMatchObject({ total: 1, openingDeaths: 1 });
  });

  it('excludes invalid rounds, friendly/self events, controlled bot damage and absent participation', () => {
    const input = fixture();
    input.kills = [
      kill({ victim_steam_id: steamId }),
      kill({ id: 2, victim_side: TeamNumber.T }),
      kill({ id: 3, round_number: 0 }),
    ];
    input.damages = [damage({ is_attacker_controlling_bot: true }), damage({ id: 2, victim_side: TeamNumber.T })];
    expect(buildReviewDuels(input, { steamId }).total).toBe(0);
    input.kills = [kill()];
    input.participation = [];
    expect(buildReviewDuels(input, { steamId }).total).toBe(0);
    input.participation = undefined;
    input.rounds[0].winner_side = TeamNumber.UNASSIGNED;
    expect(buildReviewDuels(input, { steamId }).total).toBe(0);
  });

  it('includes post-win events through official end but never promotes them to opening and omits unknown tickrate', () => {
    const input = fixture();
    input.kills = [kill({ tick: 20200 }), kill({ id: 2, tick: 20501 })];
    const page = buildReviewDuels(input, { steamId });
    expect(page).toMatchObject({ total: 1, openingKills: 0 });
    expect(page.events[0].endTick).toBe(20500);
    input.matches[0].tickrate = 0;
    expect(buildReviewDuels(input, { steamId }).total).toBe(0);
  });

  it('caps the union of a long damage encounter and its terminal kill at 45 seconds while retaining actual damage', () => {
    const input = fixture(64);
    input.damages = Array.from({ length: 7 }, (_, index) =>
      damage({ id: index + 1, tick: 4000 + index * 320, health_damage: 1 }),
    );
    input.kills = [kill({ tick: 6240 })];
    const page = buildReviewDuels(input, { steamId });
    expect(page.total).toBe(1);
    const event = page.events[0];
    expect(event.damageGiven).toBe(7);
    expect(event.endTick - event.startTick).toBe(45 * 64);
    expect(event.startTick).toBeLessThan(input.damages[0].tick);
  });

  it('paginates deterministic event order and keeps opening totals independent of page/type filter', () => {
    const input = fixture();
    input.kills = Array.from({ length: 25 }, (_, index) => kill({ id: index + 1, tick: 2000 + index * 100 }));
    const first = buildReviewDuels(input, { steamId, page: 0 });
    const second = buildReviewDuels(input, { steamId, page: 1 });
    expect(first).toMatchObject({ total: 25, openingKills: 1 });
    expect(first.events).toHaveLength(20);
    expect(second.events).toHaveLength(5);
    expect(new Set([...first.events, ...second.events].map((event) => event.id)).size).toBe(25);
    expect(buildReviewDuels(input, { steamId, filter: 'opening' }).total).toBe(1);
    expect(buildReviewDuels(input, { steamId, filter: 'deaths' })).toMatchObject({ total: 0, openingKills: 1 });
    expect(buildReviewDuels(input, { steamId, side: TeamNumber.CT }).total).toBe(0);
  });
});
