import { describe, expect, it } from 'vite-plus/test';
import type { EvidenceShot } from './evidence-protocol';
import { resolveShotAccuracyComponents, type EvidenceBulletDamage } from './evidence-ballistics';

function fixture() {
  const shot: EvidenceShot = {
    type: 'shot',
    tick: 20,
    frame: 21,
    serverTick: 120,
    playerHandle: 16385,
    playerEntityId: '1:1',
    playerSlot: 0,
    steamId: 'subject',
    raw: { tick: 120, weapon_id: 16386, item_def_index: 7, inaccuracy: 0.12, recoil_index: 0 },
  };
  const event: EvidenceBulletDamage = {
    type: 'bullet-damage',
    tick: 20,
    frame: 21,
    serverTick: 120,
    attackerEntityId: '1:1',
    attackerSteamId: 'subject',
    victimEntityId: '3:1',
    victimSteamId: 'enemy',
    weaponEntityId: '2:1',
    itemDefinitionIndex: 7,
    raw: {
      distance: 1000,
      inaccuracy_total: 0.12,
      inaccuracy_move: 0.1,
      inaccuracy_air: 0,
      recoil_index: 0,
      attack_tick_count: 120,
      attack_tick_frac: 0.25,
      render_tick_count: 119,
      render_tick_frac: 0.5,
      in_air: false,
    },
  };
  return { shot, shots: [shot], targetIds: ['enemy'], bulletDamages: [event] };
}

describe('independent bullet-damage accuracy evidence', () => {
  it('joins the verified attacker, weapon, target and compatible shot clocks', () => {
    expect(resolveShotAccuracyComponents(fixture())).toEqual({
      source: 'bullet-damage',
      movement: 0.1,
      airborne: 0,
      inAir: false,
    });
  });

  it('does not fill absent event fields with protobuf zero defaults', () => {
    for (const key of [
      'inaccuracy_total',
      'inaccuracy_move',
      'inaccuracy_air',
      'in_air',
      'recoil_index',
      'attack_tick_count',
      'attack_tick_frac',
      'render_tick_count',
      'render_tick_frac',
    ]) {
      const input = fixture();
      delete input.bulletDamages[0].raw[key];
      expect(resolveShotAccuracyComponents(input), key).toBeNull();
    }
  });

  it('rejects swapped identity, lifecycle, victim, weapon or server clock', () => {
    for (const change of [
      { attackerEntityId: null },
      { attackerSteamId: null },
      { victimEntityId: null },
      { victimSteamId: 'other' },
      { weaponEntityId: '2:2' },
      { itemDefinitionIndex: 60 },
      { serverTick: 119 },
      { tick: 19 },
    ]) {
      const input = fixture();
      Object.assign(input.bulletDamages[0], change);
      expect(resolveShotAccuracyComponents(input)).toBeNull();
    }
  });

  it('rejects contradictory measured values and invalid subtick clocks', () => {
    for (const change of [
      { inaccuracy_total: 0.13 },
      { inaccuracy_move: -1 },
      { inaccuracy_move: 0.13 },
      { inaccuracy_air: 0.04 },
      { recoil_index: 1 },
      { attack_tick_count: 118 },
      { attack_tick_count: 121 },
      { attack_tick_frac: 1 },
      { render_tick_count: 121 },
      { render_tick_frac: -1 },
    ]) {
      const input = fixture();
      Object.assign(input.bulletDamages[0].raw, change);
      expect(resolveShotAccuracyComponents(input)).toBeNull();
    }
  });

  it('rejects duplicate shots, ambiguous damage and more than one damage target', () => {
    const shotDuplicate = fixture();
    shotDuplicate.shots.push({ ...shotDuplicate.shot });
    expect(resolveShotAccuracyComponents(shotDuplicate)).toBeNull();
    const damageDuplicate = fixture();
    damageDuplicate.bulletDamages.push({ ...damageDuplicate.bulletDamages[0] });
    expect(resolveShotAccuracyComponents(damageDuplicate)).toBeNull();
    const multipleTargets = fixture();
    multipleTargets.targetIds.push('other');
    expect(resolveShotAccuracyComponents(multipleTargets)).toBeNull();
  });

  it('rejects conflicts between independent bullet damage and FireBullets extra', () => {
    for (const change of [
      { attack_tick_count: 119 },
      { attack_tick_frac: 0.5 },
      { render_tick_count: 118 },
      { render_tick_frac: 0 },
      { inaccuracy_move: 0.09 },
      { inaccuracy_air: 0.01 },
    ]) {
      const input = fixture();
      input.shot.raw.extra = change;
      expect(resolveShotAccuracyComponents(input)).toBeNull();
    }
  });

  it('uses actual extra values without an independent event, never an omitted in-air flag', () => {
    const input = fixture();
    input.bulletDamages = [];
    input.shot.raw.extra = { inaccuracy_move: 0.1, inaccuracy_air: 0 };
    expect(resolveShotAccuracyComponents(input)).toBeNull();
    input.shot.raw.player_inair = false;
    expect(resolveShotAccuracyComponents(input)?.source).toBe('fire-bullets-extra');
  });
});
