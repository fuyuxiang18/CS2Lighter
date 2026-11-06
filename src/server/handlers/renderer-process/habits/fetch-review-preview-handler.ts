import type { ReviewPreview, ReviewPreviewRequest } from 'csdm/common/types/review-preview';
import { db } from 'csdm/node/database/database';
import { assertMatchImportComplete } from 'csdm/node/database/matches/match-import-state';
import { fetchPlayersPositions } from 'csdm/node/database/player-position/fetch-players-positions';
import { handleError } from '../../handle-error';
import { getDemoCacheGeneration } from 'csdm/node/demo-cache/invalidate-demo-cache';

export async function fetchReviewPreviewHandler(request: ReviewPreviewRequest): Promise<ReviewPreview> {
  try {
    if (
      !request ||
      !/^[a-f0-9]{1,64}$/.test(request.checksum) ||
      !Number.isSafeInteger(request.roundNumber) ||
      request.roundNumber < 1 ||
      !Number.isSafeInteger(request.startTick) ||
      !Number.isSafeInteger(request.endTick) ||
      request.startTick < 0 ||
      request.endTick <= request.startTick
    )
      throw new Error('Invalid review preview window');
    const { checksum, roundNumber } = request;
    const generation = getDemoCacheGeneration(checksum);
    await assertMatchImportComplete(checksum);
    const round = await db
      .selectFrom('rounds as r')
      .innerJoin('demos as d', 'd.checksum', 'r.match_checksum')
      .select(['r.start_tick', 'r.end_tick', 'r.end_officially_tick', 'd.tickrate'])
      .where('r.match_checksum', '=', checksum)
      .where('r.number', '=', roundNumber)
      .executeTakeFirst();
    if (!round || !Number.isFinite(round.tickrate) || round.tickrate <= 0 || round.tickrate > 256)
      throw new Error('Review timing is unavailable');
    const startTick = Math.max(round.start_tick, request.startTick);
    const endTick = Math.min(Math.max(round.end_tick, round.end_officially_tick), request.endTick);
    if (endTick <= startTick || endTick - startTick > 45 * round.tickrate)
      throw new Error('Review preview exceeds 45 seconds');
    const rows = await fetchPlayersPositions(checksum, roundNumber, { startTick, endTick });
    await assertMatchImportComplete(checksum);
    if (generation !== getDemoCacheGeneration(checksum)) throw new Error('Match data changed during preview');
    return {
      startTick,
      endTick,
      tickrate: round.tickrate,
      positions: rows.map(({ tick, x, y, z, yaw, health, isAlive, side, playerSteamId, playerName }) => ({
        tick,
        x,
        y,
        z,
        yaw,
        health,
        isAlive,
        side,
        playerSteamId,
        playerName,
      })),
    };
  } catch (error) {
    handleError(error, 'Could not load review preview');
  }
}
