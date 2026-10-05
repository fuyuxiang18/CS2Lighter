import { describe, expect, it } from 'vite-plus/test';
import { aliveEndTick, chooseBattleOpponent, type BattleContact } from './resolve-review-batch';

const request = {
  checksum: 'abc',
  steamId: '76561198000000001',
  roundNumber: 1,
  startTick: 1000,
  endTick: 1800,
  eventTick: 1400,
};
const contact: BattleContact = {
  tick: 1400,
  attacker: request.steamId,
  victim: '76561198000000002',
  attackerSide: 2,
  victimSide: 3,
  damage: 100,
  kill: true,
};

describe('battle viewpoints', () => {
  it('only resolves an enemy involved in this player’s selected combat interval', () => {
    const unrelated = { ...contact, attacker: '76561198000000003', victim: '76561198000000004' };
    const teammate = { ...contact, victimSide: 2 };
    const outside = { ...contact, tick: 900 };
    expect(chooseBattleOpponent({ ...request, eventTick: undefined }, [unrelated, teammate, outside])).toBeUndefined();
    expect(() => chooseBattleOpponent({ ...request, eventTick: 1401 }, [contact])).toThrow('event tick has no combat');
    expect(chooseBattleOpponent(request, [unrelated, contact])).toBe(contact.victim);
    expect(() => chooseBattleOpponent({ ...request, opponentSteamId: unrelated.victim }, [contact])).toThrow(
      'no combat event',
    );
  });
  it('uses the closest contact to the event, and supports the victim viewpoint', () => {
    const early = { ...contact, tick: 1100, victim: '76561198000000003' };
    expect(chooseBattleOpponent(request, [early, contact])).toBe(contact.victim);
    expect(chooseBattleOpponent({ ...request, steamId: contact.victim }, [contact])).toBe(contact.attacker);
  });
  it('ends strictly before death and refuses a player already dead when capture begins', () => {
    expect(aliveEndTick(1000, 1800, 1400)).toBe(1399);
    expect(aliveEndTick(1000, 1800, 2000)).toBe(1800);
    expect(aliveEndTick(1000, 1800)).toBe(1800);
    expect(aliveEndTick(1000, 1800, 1000)).toBeUndefined();
    expect(aliveEndTick(1000, 1800, 900)).toBeUndefined();
  });
});
