import { describe, expect, it } from 'vite-plus/test';
import { WeaponName, WeaponType } from 'csdm/common/types/counter-strike';
import type { DeathReviewRecord } from 'csdm/common/types/death-review';
import type { DamageRow } from 'csdm/node/database/damages/damage-table';
import type { ShotRow } from 'csdm/node/database/shots/shot-table';
import type { EvidenceFrame, EvidencePlayer } from './evidence-protocol';
import { buildRiskTacticalEvidence } from './risk-tactical-provider';
import { buildDeathRiskReport } from './death-risk-engine';

const ids = Array.from({ length: 10 }, (_, index) => String(76561198000000000n + BigInt(index)));
function field(value: unknown) {
  return { present: true, value, lastUpdate: null };
}
function player(index: number, tick: number): EvidencePlayer {
  return {
    id: `${index}:1`,
    steamId: ids[index],
    origin: [index ? 100 + index : tick, 0, 0],
    eyes: [index ? 100 + index : tick, 0, 64],
    yaw: 0,
    pitch: 0,
    velocity: [0, 0, 0],
    team: index < 5 ? 2 : 3,
    health: 100,
    lifeState: 0,
    hull: { mins: null, maxs: null },
    fieldsComplete: true,
    fields: { m_fFlags: field(1) },
    activeWeapon: {
      id: `weapon:${index}`,
      className: 'CKnife',
      fieldsComplete: true,
      fields: { 'm_AttributeManager.m_Item.m_iItemDefinitionIndex': field(42) },
    },
  };
}
function fixture() {
  const frames: EvidenceFrame[] = [1, 2, 3].map((tick) => ({
    type: 'frame',
    frame: tick,
    tick,
    serverTick: tick,
    players: ids.map((_, index) => player(index, tick)),
    world: { complete: true, upserts: [], removed: [] },
    smokes: { complete: true, upserts: [], removed: [] },
  }));
  const record = {
    steamId: ids[0],
    kind: 'enemy',
    evaluatedRules: ['first_death'],
    eventTick: 3,
    roundNumber: 1,
    tickrate: 64,
  } as DeathReviewRecord;
  const damage = {
    id: 1,
    round_number: 1,
    tick: 3,
    attacker_steam_id: ids[5],
    victim_steam_id: ids[0],
    health_damage: 30,
    victim_health: 100,
    weapon_type: WeaponType.Rifle,
    weapon_name: WeaponName.AK47,
    is_attacker_controlling_bot: false,
    is_victim_controlling_bot: false,
  } as DamageRow;
  const input: Parameters<typeof buildRiskTacticalEvidence>[0] = {
    record,
    startTick: 1,
    frames,
    contexts: new Map(),
    gunlines: frames.flatMap((frame) =>
      ids.slice(5).map((id) => ({
        tick: frame.tick,
        enemySteamId: id,
        distance: 100,
        facingOffset: 0,
        status: id === ids[5] && frame.tick > 1 ? ('clear' as const) : ('blocked' as const),
        reason: 'synthetic-map',
      })),
    ),
    damages: [damage],
    kills: [],
    shots: [],
    blinds: [],
    shotsComplete: true,
    signal: new AbortController().signal,
  };
  for (const frame of frames)
    input.contexts.set(frame.tick, {
      tick: frame.tick,
      source: `test-map:${frame.tick}`,
      reason: null,
      trace: () => Promise.resolve({ status: 'blocked', reason: 'occluded', rays: [] }),
    });
  return input;
}

describe('production tactical facts', () => {
  it('retains the subject own utility as an intervention using database weapon names', async () => {
    const input = fixture();
    input.shots.push({
      id: 8,
      round_number: 1,
      tick: 2,
      weapon_name: WeaponName.Flashbang,
      player_steam_id: ids[0],
      is_player_controlling_bot: false,
    } as ShotRow);
    const facts = await buildRiskTacticalEvidence(input);
    expect(facts.interventions).toContainEqual({ startTick: 2, endTick: 2, enemyId: ids[5], source: 'shot-event:8' });
  });
  it('links an actual incoming gun hit to a knife entry supported by a previous-position ray', async () => {
    const facts = await buildRiskTacticalEvidence(fixture());
    expect(facts.eligible).toBe(true);
    expect(facts.frames[1].lines[0].previousObserverPosition).toMatchObject({ tick: 1, status: 'blocked' });
    expect(buildDeathRiskReport(facts).findings.map((finding) => finding.ruleId)).toContain('r9');
  });
  it('does not blame movement when the enemy would also see the previous position', async () => {
    const input = fixture();
    input.contexts.get(2)!.trace = () => Promise.resolve({ status: 'clear', reason: 'clear', rays: [] });
    const report = buildDeathRiskReport(await buildRiskTacticalEvidence(input));
    expect(report.findings.map((finding) => finding.ruleId)).not.toContain('r9');
  });
  it('does not substitute explosive damage or missing geometry for a gun encounter', async () => {
    const input = fixture();
    input.damages[0].weapon_type = WeaponType.Grenade;
    expect(buildDeathRiskReport(await buildRiskTacticalEvidence(input)).findings).toEqual([]);
    input.damages[0].weapon_type = WeaponType.Rifle;
    input.contexts.clear();
    expect(buildDeathRiskReport(await buildRiskTacticalEvidence(input)).findings).toEqual([]);
  });
  it('keeps recorded shots when detailed accuracy reconstruction is unavailable', async () => {
    const input = fixture();
    input.shots.push({
      id: 9,
      round_number: 1,
      tick: 2,
      weapon_name: WeaponName.AK47,
      weapon_id: 'weapon:0',
      player_steam_id: ids[0],
      is_player_controlling_bot: false,
    } as ShotRow);
    const facts = await buildRiskTacticalEvidence(input);
    expect(facts.shots).toHaveLength(1);
    expect(buildDeathRiskReport(facts).findings.map((finding) => finding.ruleId)).not.toContain('r9');
  });
  it('keeps actual dead state and rejects unsupported roster identities', async () => {
    const input = fixture();
    input.frames[2].players[0].health = 0;
    input.frames[2].players[0].lifeState = 1;
    const facts = await buildRiskTacticalEvidence(input);
    expect(facts.frames[2].actors[0].alive).toBe(false);
    input.frames.forEach((frame) => frame.players.pop());
    expect((await buildRiskTacticalEvidence(input)).eligible).toBe(false);
  });
});
