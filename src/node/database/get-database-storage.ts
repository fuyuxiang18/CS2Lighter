import { realpath } from 'node:fs/promises';
import { sql } from 'kysely';
import { DatabaseMode } from 'csdm/common/types/database-mode';
import type { DatabaseStorage } from 'csdm/common/types/database-storage';
import { getSettings } from 'csdm/node/settings/get-settings';
import { getEmbeddedDatabaseDataFolderPath } from './embedded/embedded-postgresql-paths';
import { db } from './database';

/** Catalog/filesystem metadata only: does not scan tick rows, vacuum, or change the database. */
export async function getDatabaseStorage(): Promise<DatabaseStorage> {
  const settings = await getSettings();
  const { rows } = await sql<{ total: number; players: number; utility: number; chickens: number }>`
    SELECT pg_database_size(current_database()) AS total,
      COALESCE(pg_total_relation_size(to_regclass('public.player_positions')), 0) AS players,
      COALESCE(pg_total_relation_size(to_regclass('public.grenade_positions')), 0)
        + COALESCE(pg_total_relation_size(to_regclass('public.inferno_positions')), 0)
        + COALESCE(pg_total_relation_size(to_regclass('public.hostage_positions')), 0) AS utility,
      COALESCE(pg_total_relation_size(to_regclass('public.chicken_positions')), 0) AS chickens
  `.execute(db);
  const row = rows[0];
  if (!row) throw new Error('Database storage metadata is unavailable');
  const embedded = settings.database.mode === DatabaseMode.Embedded;
  let logicalDataDirectory: string | null = null;
  let physicalDataDirectory: string | null = null;
  if (embedded) {
    // Ask the running server, so a junction or a custom PostgreSQL data_directory is represented correctly.
    const result = await sql<{ directory: string }>`SELECT current_setting('data_directory') AS directory`.execute(db);
    logicalDataDirectory = result.rows[0]?.directory ?? getEmbeddedDatabaseDataFolderPath();
    physicalDataDirectory = await realpath(logicalDataDirectory).catch(() => null);
  }
  const totalBytes = Number(row.total);
  const players = Number(row.players);
  const utility = Number(row.utility);
  const chickens = Number(row.chickens);
  return {
    measuredAt: new Date().toISOString(),
    totalBytes,
    logicalDataDirectory,
    physicalDataDirectory,
    location: !embedded ? 'external' : physicalDataDirectory ? 'embedded' : 'unavailable',
    parts: [
      { id: 'players', bytes: players },
      { id: 'utility', bytes: utility },
      { id: 'chickens', bytes: chickens },
      { id: 'other', bytes: Math.max(0, totalBytes - players - utility - chickens) },
    ],
  };
}
