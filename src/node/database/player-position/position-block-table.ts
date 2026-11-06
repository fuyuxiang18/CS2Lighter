import type { Generated } from 'kysely';
import type { ColumnID } from 'csdm/common/types/column-id';

export type PositionBlockTable = {
  id: Generated<ColumnID>;
  match_checksum: string;
  round_number: number;
  player_steam_id: string;
  first_tick: number;
  last_tick: number;
  row_count: number;
  payload: Buffer;
  payload_sha256: string;
};
