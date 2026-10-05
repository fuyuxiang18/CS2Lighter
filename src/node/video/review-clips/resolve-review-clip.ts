import type { ReviewClipRequest } from 'csdm/common/types/review-clip';
import { Game } from 'csdm/common/types/counter-strike';
import { db } from 'csdm/node/database/database';
import { ReviewClipError, type ResolvedReviewClip } from './review-clip-service';

export function normalizeReviewClipRange(
  request: ReviewClipRequest,
  tickrate: number,
  start: number,
  end: number,
): Required<ReviewClipRequest> {
  if (
    !Number.isFinite(tickrate) ||
    tickrate <= 0 ||
    !Number.isSafeInteger(request.startTick) ||
    request.startTick < start ||
    request.startTick >= end
  )
    throw new ReviewClipError('invalid-request');
  const requestedEnd = request.endTick ?? Math.round(request.startTick + 20 * tickrate);
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd <= request.startTick)
    throw new ReviewClipError('invalid-request');
  const endTick = Math.min(requestedEnd, end);
  if ((endTick - request.startTick) / tickrate > 45)
    throw new ReviewClipError('invalid-request', 'A review clip can contain at most 45 seconds');
  return {
    checksum: request.checksum,
    steamId: request.steamId,
    roundNumber: request.roundNumber,
    startTick: request.startTick,
    endTick,
  };
}

export async function resolveReviewClip(request: ReviewClipRequest): Promise<ResolvedReviewClip> {
  if (
    !request ||
    !/^[a-f0-9]{1,16}$/.test(request.checksum) ||
    !/^\d{17}$/.test(request.steamId) ||
    !Number.isSafeInteger(request.roundNumber) ||
    request.roundNumber < 1
  )
    throw new ReviewClipError('invalid-request');
  const [match, round, player] = await Promise.all([
    db
      .selectFrom('matches')
      .innerJoin('demos', 'matches.checksum', 'demos.checksum')
      .select([
        'matches.demo_path',
        'matches.analyze_date',
        'demos.game',
        'demos.tickrate',
        'demos.map_name',
        'demos.build_number',
      ])
      .where('matches.checksum', '=', request.checksum)
      .executeTakeFirst(),
    db
      .selectFrom('rounds')
      .select(['start_tick', 'end_tick', 'end_officially_tick'])
      .where('match_checksum', '=', request.checksum)
      .where('number', '=', request.roundNumber)
      .executeTakeFirst(),
    db
      .selectFrom('players')
      .select('name')
      .where('match_checksum', '=', request.checksum)
      .where('steam_id', '=', request.steamId)
      .executeTakeFirst(),
  ]);
  if (!match || match.game !== Game.CS2 || !round || !player) throw new ReviewClipError('invalid-request');
  return {
    request: normalizeReviewClipRange(
      request,
      match.tickrate,
      round.start_tick,
      Math.max(round.end_tick, round.end_officially_tick),
    ),
    demoPath: match.demo_path,
    playerName: player.name,
    mapName: match.map_name,
    tickrate: match.tickrate,
    revision: `${match.build_number}:${new Date(match.analyze_date).toISOString()}`,
  };
}
