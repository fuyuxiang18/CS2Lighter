import type { AiReportScope, PreparedAiContext } from 'csdm/common/types/ai';
import type { PersonalMatchStats } from 'csdm/common/types/personal-stats';
import { Game } from 'csdm/common/types/counter-strike';
import { AI_MAX_MATCHES, buildAiContext, validateAiScope } from 'csdm/node/ai/build-ai-context';
import { loadDemoCaches } from 'csdm/node/demo-cache/demo-cache-service';
import { db } from 'csdm/node/database/database';

export async function prepareAiReport(scope: AiReportScope): Promise<PreparedAiContext> {
  validateAiScope(scope);
  let query = db
    .selectFrom('matches as m')
    .innerJoin('demos as d', 'd.checksum', 'm.checksum')
    .innerJoin('players as p', 'p.match_checksum', 'm.checksum')
    .select(['m.checksum', 'd.date'])
    .distinct()
    .where('d.game', '=', Game.CS2)
    .where('p.steam_id', '=', scope.steamId);
  if (scope.kind === 'match') query = query.where('m.checksum', '=', scope.checksum!);
  if (scope.mapName) query = query.where('d.map_name', '=', scope.mapName);
  if (scope.source) query = query.where('d.source', '=', scope.source);
  if (scope.side !== undefined) {
    query = query.where((eb) =>
      eb.exists(
        eb
          .selectFrom('player_economies as e')
          .select('e.id')
          .whereRef('e.match_checksum', '=', 'm.checksum')
          .where('e.player_steam_id', '=', scope.steamId)
          .where('e.player_side', '=', scope.side!),
      ),
    );
  }
  const matches = await query.orderBy('d.date', 'desc').orderBy('m.checksum').execute();
  const selected = matches.slice(0, scope.kind === 'match' ? 1 : AI_MAX_MATCHES);
  const facts: PersonalMatchStats[] = [];
  await loadDemoCaches(
    selected.map((match) => match.checksum),
    (cache) => {
      facts.push(...cache.metrics.filter((player) => player.steamId === scope.steamId));
    },
  );
  return buildAiContext(facts, scope, matches.length);
}
