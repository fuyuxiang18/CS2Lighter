import { describe, expect, it } from 'vite-plus/test';
import { aliveEndTick, battleEventKind, chooseBattleOpponent, type BattleContact } from './resolve-review-batch';

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
  it.each([
    { attacker: request.steamId, attackerSide: 2 },
    { attacker: '76561198000000003', attackerSide: 2 },
    { attacker: '0', attackerSide: 0 },
  ])(
    'allows a verified own-only death without choosing an unrelated enemy ($attacker)',
    ({ attacker, attackerSide }) => {
      const death = { ...contact, attacker, attackerSide, victim: request.steamId, victimSide: 2 };
      const previousEnemy = { ...contact, tick: 1300 };
      expect(chooseBattleOpponent({ ...request, includeOpponent: false }, [previousEnemy, death])).toBeUndefined();
      expect(
        chooseBattleOpponent({ ...request, includeOpponent: false }, [
          { ...previousEnemy, tick: request.eventTick, kill: false },
          death,
        ]),
      ).toBeUndefined();
      expect(battleEventKind(request, [previousEnemy, death])).toBe('death');
      expect(() => chooseBattleOpponent({ ...request, includeOpponent: true }, [previousEnemy, death])).toThrow(
        'event tick has no combat',
      );
      expect(() =>
        chooseBattleOpponent({ ...request, includeOpponent: false, opponentSteamId: previousEnemy.victim }, [
          previousEnemy,
          death,
        ]),
      ).toThrow('no requested opponent');
    },
  );
  it('does not accept a forged own-only death tick, nonfatal team damage, or another victim', () => {
    const self = { ...contact, attacker: request.steamId, victim: request.steamId, victimSide: 2 };
    for (const invalid of [
      { ...self, tick: 1401 },
      { ...self, kill: false },
      { ...self, attacker: '0', victim: '76561198000000003' },
    ]) {
      expect(() => chooseBattleOpponent({ ...request, includeOpponent: false }, [invalid])).toThrow(
        'event tick has no combat',
      );
    }
  });
  it('labels suicide as death before considering the matching killer id', () => {
    const self = { ...contact, attacker: request.steamId, victim: request.steamId, victimSide: 2 };
    expect(battleEventKind(request, [self])).toBe('death');
    expect(battleEventKind(request, [contact])).toBe('kill');
    expect(battleEventKind(request, [{ ...contact, kill: false }])).toBe('damage');
  });
});
