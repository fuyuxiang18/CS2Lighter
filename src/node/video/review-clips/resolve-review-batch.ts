import { createHash } from 'node:crypto';
import type {
  ReviewBatchItem,
  ReviewBatchRequest,
  ReviewBatchSegment,
  ReviewBattleRequest,
} from 'csdm/common/types/review-batch';
import { db } from 'csdm/node/database/database';
import { ReviewClipError, type ResolvedReviewClip } from './review-clip-service';
import { resolveReviewClip } from './resolve-review-clip';

export type BattleContact = {
  tick: number;
  attacker: string;
  victim: string;
  attackerSide: number;
  victimSide: number;
  damage: number;
  kill: boolean;
};
export function chooseBattleOpponent(request: ReviewBattleRequest, contacts: BattleContact[]): string | undefined {
  const relevant = contacts.filter(
    (contact) =>
      contact.tick >= request.startTick &&
      contact.tick <= (request.endTick ?? Infinity) &&
      [2, 3].includes(contact.attackerSide) &&
      [2, 3].includes(contact.victimSide) &&
      contact.attackerSide !== contact.victimSide &&
      contact.attacker !== contact.victim &&
      (contact.attacker === request.steamId || contact.victim === request.steamId),
  );
  const opponent = (contact: BattleContact) =>
    contact.attacker === request.steamId ? contact.victim : contact.attacker;
  if (request.eventTick !== undefined && !relevant.some((contact) => contact.tick === request.eventTick))
    throw new ReviewClipError('invalid-request', 'The event tick has no combat involving this player');
  if (request.opponentSteamId) {
    if (!relevant.some((contact) => opponent(contact) === request.opponentSteamId))
      throw new ReviewClipError('invalid-request', 'The requested opponent has no combat event in this range');
    return request.opponentSteamId;
  }
  relevant.sort((a, b) =>
    request.eventTick !== undefined
      ? Math.abs(a.tick - request.eventTick) - Math.abs(b.tick - request.eventTick) || Number(b.kill) - Number(a.kill)
      : Number(b.kill) - Number(a.kill) || b.damage - a.damage || a.tick - b.tick,
  );
  return relevant[0] ? opponent(relevant[0]) : undefined;
}

export function aliveEndTick(startTick: number, requestedEndTick: number, deathTick?: number): number | undefined {
  const end = deathTick === undefined ? requestedEndTick : Math.min(requestedEndTick, deathTick - 1);
  return end > startTick ? end : undefined;
}

export type ResolvedBatchItem = { item: ReviewBatchItem; input: ResolvedReviewClip; slots: Record<string, number> };
export type ResolvedReviewBatch = {
  id: string;
  request: ReviewBatchRequest;
  items: ResolvedBatchItem[];
  groups: ResolvedBatchItem[][];
};

export async function resolveReviewBatch(request: ReviewBatchRequest): Promise<ResolvedReviewBatch> {
  if (
    !request ||
    !Array.isArray(request.clips) ||
    request.clips.length < 1 ||
    request.clips.length > 20 ||
    typeof request.includeOpponent !== 'boolean'
  )
    throw new ReviewClipError('invalid-request', 'Select between one and twenty events');
  const items: ResolvedBatchItem[] = [];
  const seen = new Set<string>();
  let segmentIndex = 0;
  for (const candidate of request.clips) {
    const input = await resolveReviewClip(candidate);
    const clip = { ...input.request, eventTick: candidate.eventTick, opponentSteamId: candidate.opponentSteamId };
    if (
      candidate.eventTick !== undefined &&
      (!Number.isSafeInteger(candidate.eventTick) ||
        candidate.eventTick < clip.startTick ||
        candidate.eventTick > clip.endTick)
    )
      throw new ReviewClipError('invalid-request');
    if (candidate.opponentSteamId !== undefined && !/^\d{17}$/.test(candidate.opponentSteamId))
      throw new ReviewClipError('invalid-request');
    const duplicateKey = JSON.stringify(clip);
    if (seen.has(duplicateKey)) continue;
    seen.add(duplicateKey);
    const [kills, damages, players] = await Promise.all([
      db
        .selectFrom('kills')
        .select(['tick', 'killer_steam_id', 'victim_steam_id', 'killer_side', 'victim_side'])
        .where('match_checksum', '=', clip.checksum)
        .where('round_number', '=', clip.roundNumber)
        .execute(),
      db
        .selectFrom('damages')
        .select(['tick', 'attacker_steam_id', 'victim_steam_id', 'attacker_side', 'victim_side', 'health_damage'])
        .where('match_checksum', '=', clip.checksum)
        .where('round_number', '=', clip.roundNumber)
        .where('tick', '>=', clip.startTick)
        .where('tick', '<=', clip.endTick)
        .where((eb) => eb.or([eb('attacker_steam_id', '=', clip.steamId), eb('victim_steam_id', '=', clip.steamId)]))
        .execute(),
      db
        .selectFrom('players')
        .select(['steam_id', 'name', 'index'])
        .where('match_checksum', '=', clip.checksum)
        .execute(),
    ]);
    const opponentId = chooseBattleOpponent(clip, [
      ...kills.map((k) => ({
        tick: k.tick,
        attacker: k.killer_steam_id,
        victim: k.victim_steam_id,
        attackerSide: k.killer_side,
        victimSide: k.victim_side,
        damage: 0,
        kill: true,
      })),
      ...damages.map((d) => ({
        tick: d.tick,
        attacker: d.attacker_steam_id,
        victim: d.victim_steam_id,
        attackerSide: d.attacker_side,
        victimSide: d.victim_side,
        damage: d.health_damage,
        kill: false,
      })),
    ]);
    const segments: ReviewBatchSegment[] = [];
    for (const [perspective, steamId] of [
      ['player', clip.steamId],
      ...(request.includeOpponent && opponentId ? [['opponent', opponentId]] : []),
    ] as ['player' | 'opponent', string][]) {
      const player = players.find((row) => row.steam_id === steamId && row.index > 0);
      const deathTick = kills
        .filter((k) => k.victim_steam_id === steamId)
        .map((k) => k.tick)
        .sort((a, b) => a - b)[0];
      const endTick = aliveEndTick(clip.startTick, clip.endTick, deathTick);
      if (!player || endTick === undefined || endTick - clip.startTick < Math.ceil(input.tickrate / 15)) {
        if (perspective === 'player')
          throw new ReviewClipError('invalid-request', 'The player has no living POV in this range');
        continue;
      }
      segments.push({
        index: ++segmentIndex,
        perspective,
        steamId,
        playerName: player.name,
        startTick: clip.startTick,
        endTick,
        deathTick,
        truncatedAtDeath: endTick < clip.endTick,
        status: 'queued',
      });
    }
    items.push({
      input,
      slots: Object.fromEntries(players.map((p) => [p.steam_id, p.index])),
      item: {
        index: items.length + 1,
        request: clip,
        eventTick: clip.eventTick,
        mapName: input.mapName,
        tickrate: input.tickrate,
        opponentSteamId: opponentId,
        opponentName: players.find((p) => p.steam_id === opponentId)?.name,
        opponentUnavailable: request.includeOpponent && !segments.some((s) => s.perspective === 'opponent'),
        segments,
        status: 'queued',
      },
    });
  }
  const groups = Array.from(new Set(items.map(({ input }) => input.request.checksum)), (checksum) =>
    items.filter(({ input }) => input.request.checksum === checksum),
  );
  const id = createHash('sha256')
    .update(JSON.stringify([2, request.includeOpponent, items.map(({ input, item }) => [input.revision, item])]))
    .digest('hex');
  return { id, request, items, groups };
}
