import { describe, expect, it } from 'vite-plus/test';
import { decodeRiskWeaponState, getWeaponAccuracyProfile, shotServerInterval } from './weapon-accuracy';
import type { EvidencePlayer, EvidenceFrame, WireField } from './evidence-protocol';

function field(value: unknown): WireField {
  return { present: true, value, lastUpdate: null };
}
function context() {
  const player = {
    id: '1:1',
    steamId: '76561190000000001',
    health: 100,
    lifeState: 0,
    fields: { 'controller.m_nTickBase': field(5000), 'm_pWeaponServices.m_flNextAttack': field(70) },
    activeWeapon: {
      id: '2:1',
      className: 'CAK47',
      fieldsComplete: true,
      fields: {
        'm_AttributeManager.m_Item.m_iItemDefinitionIndex': field(7),
        m_iClip1: field(30),
        m_bInReload: field(false),
        'decoded.m_nNextPrimaryAttackTick': field(4999),
        m_flNextPrimaryAttackTickRatio: field(0),
      },
    },
  } as unknown as EvidencePlayer;
  const frame = { tick: 1000, serverTick: 5000 } as EvidenceFrame;
  return { player, frame };
}

describe('versioned weapon mechanics', () => {
  it('uses different weapon and mode facts and rejects unmatched versions', () => {
    expect(getWeaponAccuracyProfile(14190, 7, 0)?.cycle).toBe(0.1);
    expect(getWeaponAccuracyProfile(14190, 34, 0)?.cycle).toBe(0.07);
    expect(getWeaponAccuracyProfile(14190, 60, 0)?.fire).not.toBe(getWeaponAccuracyProfile(14190, 60, 1)?.fire);
    expect(getWeaponAccuracyProfile(14172, 7, 0)).toBeNull();
    expect(getWeaponAccuracyProfile(14190, 7, 2)).toBeNull();
  });
  it('maps a decoded attack timer from server clock to demo clock', () => {
    const { player, frame } = context();
    player.activeWeapon!.fields['decoded.m_nNextPrimaryAttackTick'] = field(5004);
    expect(decodeRiskWeaponState(player, frame, 64)).toMatchObject({ ready: false, nextReadyTick: 1004 });
  });
  it('does not interpret the parser raw doubled GameTick as a timestamp', () => {
    const { player, frame } = context();
    delete player.activeWeapon!.fields['decoded.m_nNextPrimaryAttackTick'];
    player.activeWeapon!.fields['m_nNextPrimaryAttackTick'] = field(9998);
    expect(decodeRiskWeaponState(player, frame, 64)?.ready).toBeNull();
  });
  it('requires both weapon and owner locks to finish', () => {
    const { player, frame } = context();
    expect(decodeRiskWeaponState(player, frame, 64)?.ready).toBe(true);
    player.fields['m_pWeaponServices.m_flNextAttack'] = field(5008 / 64);
    expect(decodeRiskWeaponState(player, frame, 64)).toMatchObject({ ready: false, nextReadyTick: 1008 });
    player.fields['controller.m_nTickBase'] = field(5001);
    expect(decodeRiskWeaponState(player, frame, 64)?.ready).toBeNull();
  });
  it('keeps missing magazines unknown and respects empty/reload facts', () => {
    const { player, frame } = context();
    delete player.activeWeapon!.fields['m_iClip1'];
    expect(decodeRiskWeaponState(player, frame, 64)).toMatchObject({ magazine: null, ready: null });
    player.activeWeapon!.fields['m_iClip1'] = field(0);
    expect(decodeRiskWeaponState(player, frame, 64)?.ready).toBe(false);
    player.activeWeapon!.fields['m_iClip1'] = field(20);
    player.activeWeapon!.fields['m_bInReload'] = field(true);
    expect(decodeRiskWeaponState(player, frame, 64)?.ready).toBe(false);
  });
  it('requires explicit bounded shot clock fields', () => {
    expect(shotServerInterval({ raw: { tick: 100 }, serverTick: 101 } as never)).toEqual({ first: 99, last: 101 });
    expect(shotServerInterval({ raw: { tick: 100 }, serverTick: 103 } as never)).toBeNull();
    expect(shotServerInterval({ raw: {}, serverTick: 101 } as never)).toBeNull();
  });
});
