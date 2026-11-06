import type { Migration } from './migration';

const v16: Migration = {
  schemaVersion: 16,
  run: async (transaction) => {
    // Additive: old positions remain readable without an expensive migration or demo reparse.
    await transaction.schema
      .createTable('player_position_blocks')
      .ifNotExists()
      .addColumn('id', 'bigserial', (column) => column.primaryKey().notNull())
      .addColumn('match_checksum', 'varchar', (column) => column.notNull())
      .addColumn('round_number', 'integer', (column) => column.notNull())
      .addColumn('player_steam_id', 'varchar', (column) => column.notNull())
      .addColumn('first_tick', 'integer', (column) => column.notNull())
      .addColumn('last_tick', 'integer', (column) => column.notNull())
      .addColumn('row_count', 'integer', (column) => column.notNull())
      .addColumn('payload', 'bytea', (column) => column.notNull())
      .addColumn('payload_sha256', 'varchar', (column) => column.notNull())
      .addForeignKeyConstraint(
        'player_position_blocks_match_fk',
        ['match_checksum'],
        'matches',
        ['checksum'],
        (column) => column.onDelete('cascade'),
      )
      .execute();
    await transaction.schema
      .createIndex('player_position_blocks_round_idx')
      .ifNotExists()
      .on('player_position_blocks')
      .columns(['match_checksum', 'round_number', 'first_tick'])
      .execute();
    await transaction.schema
      .createIndex('player_position_blocks_player_idx')
      .ifNotExists()
      .on('player_position_blocks')
      .columns(['match_checksum', 'player_steam_id', 'round_number'])
      .execute();
  },
};

export default v16;
