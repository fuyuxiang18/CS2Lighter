import { sql } from 'kysely';
import type { MatchTable } from 'csdm/common/types/match-table';
import { TeamLetter } from 'csdm/common/types/counter-strike';
import { db } from 'csdm/node/database/database';
import { fetchChecksumTagIds } from '../tags/fetch-checksum-tag-ids';
import { MatchNotFound } from './errors/match-not-found';
import { fetchCollateralKillCountPerMatch } from './fetch-collateral-kill-count-per-match';
import { matchTableRowToMatchTable } from './match-table-row-to-match-table';
import { fetchPlayersPerMatch } from './fetch-players-per-match';

export async function fetchMatchTable(checksum: string): Promise<MatchTable> {
  const { sum } = db.fn;
  const row = await db
    .selectFrom('matches')
    .innerJoin('demos', 'demos.checksum', 'matches.checksum')
    .innerJoin('teams as teamA', function (qb) {
      return qb.on('teamA.letter', '=', TeamLetter.A).onRef('teamA.match_checksum', '=', 'matches.checksum');
    })
    .innerJoin('teams as teamB', function (qb) {
      return qb.on('teamB.letter', '=', TeamLetter.B).onRef('teamB.match_checksum', '=', 'matches.checksum');
    })
    .leftJoin('players', 'players.match_checksum', 'matches.checksum')
    .leftJoin('comments', 'comments.checksum', 'matches.checksum')
    .where('matches.checksum', '=', checksum)
    .select([
      'matches.checksum',
      'matches.demo_path',
      'matches.game_type',
      'matches.game_mode',
      'matches.game_mode_str',
      'matches.is_ranked',
      'matches.kill_count',
      'matches.death_count',
      'matches.assist_count',
      'matches.shot_count',
      'matches.winner_name',
      'matches.winner_side',
      'matches.analyze_date',
      'matches.overtime_count',
      'matches.max_rounds',
    ])
    .select([
      'demos.name',
      'demos.game',
      'demos.source',
      'demos.type',
      'demos.date',
      'demos.map_name',
      'demos.tick_count',
      'demos.tickrate',
      'demos.framerate',
      'demos.duration',
      'demos.server_name',
      'demos.client_name',
      'demos.network_protocol',
      'demos.build_number',
      'demos.share_code',
      'teamA.name as teamAName',
      'teamA.score as teamAScore',
      'teamB.name as teamBName',
      'teamB.score as teamBScore',
      sum<number>('players.five_kill_count').as('fiveKillCount'),
      sum<number>('players.four_kill_count').as('fourKillCount'),
      sum<number>('players.three_kill_count').as('threeKillCount'),
      sql<number>`ROUND(AVG(players.hltv_rating_2)::numeric, 2)`.as('hltvRating2'),
      'comments.comment',
    ])
    .groupBy([
      'matches.checksum',
      'demos.name',
      'demos.game',
      'demos.source',
      'demos.type',
      'demos.date',
      'demos.map_name',
      'demos.tick_count',
      'demos.tickrate',
      'demos.framerate',
      'demos.duration',
      'demos.server_name',
      'demos.client_name',
      'demos.network_protocol',
      'demos.build_number',
      'demos.share_code',
      'comment',
      'teamA.name',
      'teamB.name',
      'teamA.score',
      'teamB.score',
    ])
    .executeTakeFirst();

  if (row === undefined) {
    throw new MatchNotFound();
  }

  const tagIds = await fetchChecksumTagIds(row.checksum);
  const playersPerMatch = await fetchPlayersPerMatch([row.checksum]);
  const collateralKillCountPerMatch = await fetchCollateralKillCountPerMatch([row.checksum]);
  const match: MatchTable = matchTableRowToMatchTable(row, tagIds, collateralKillCountPerMatch, playersPerMatch);

  return match;
}
