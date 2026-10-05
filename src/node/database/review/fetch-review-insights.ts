import { Game, TeamNumber } from 'csdm/common/types/counter-strike';
import type { PersonalMatchStats } from 'csdm/common/types/personal-stats';
import type { FetchReviewInsightsPayload, ReviewInsightsSummary } from 'csdm/common/types/review-insights';
import { loadDemoCaches } from 'csdm/node/demo-cache/demo-cache-service';
import { db } from 'csdm/node/database/database';
import { buildReviewInsights } from './build-review-insights';

export async function fetchReviewInsights(payload: FetchReviewInsightsPayload): Promise<ReviewInsightsSummary> {
  if (typeof payload.steamId !== 'string' || !/^\d{17}$/.test(payload.steamId))
    throw new Error('A valid SteamID is required');
  if (payload.side !== undefined && payload.side !== TeamNumber.T && payload.side !== TeamNumber.CT)
    throw new Error('Invalid review insights side filter');
  let query = db
    .selectFrom('matches as m')
    .innerJoin('demos as d', 'd.checksum', 'm.checksum')
    .innerJoin('players as p', 'p.match_checksum', 'm.checksum')
    .select(['m.checksum', 'd.map_name', 'd.source'])
    .distinct()
    .where('d.game', '=', Game.CS2)
    .where('p.steam_id', '=', payload.steamId);
  // A saved training cohort remains independent of the page's current filters.
  if (!payload.training) {
    if (payload.mapName) query = query.where('d.map_name', '=', payload.mapName);
    if (payload.source) query = query.where('d.source', '=', payload.source);
  }
  const matches = await query.execute();
  const availableMatches = matches.filter(
    (match) =>
      (!payload.mapName || match.map_name === payload.mapName) && (!payload.source || match.source === payload.source),
  ).length;
  const facts: PersonalMatchStats[] = [];
  let result: ReviewInsightsSummary | undefined;
  await loadDemoCaches(
    matches.map((match) => match.checksum),
    (cache, index, total) => {
      facts.push(...cache.metrics.filter((player) => player.steamId === payload.steamId));
      if (index === total) result = buildReviewInsights(facts, payload, availableMatches);
    },
    { allowPartial: true },
  );
  return result ?? buildReviewInsights(facts, payload, availableMatches);
}
