import { unixTimestampToDate } from 'csdm/common/date/unix-timestamp-to-date';
import { getUsersSummary } from 'csdm/node/steam-web-api/get-users-summary';
import { EconomyBan } from 'csdm/node/steam-web-api/steam-constants';
import type { InsertableSteamAccount } from './steam-account-table';

export async function buildSteamAccountsFromSteamIds(steamIds: string[]): Promise<InsertableSteamAccount[]> {
  const users = await getUsersSummary(steamIds);

  const rows: InsertableSteamAccount[] = [];
  for (const steamId of steamIds) {
    const user = users.find((user) => user.steamid === steamId);
    if (user === undefined) {
      continue;
    }

    const row: InsertableSteamAccount = {
      steam_id: steamId,
      name: user.personaname,
      avatar: user.avatarfull,
      has_private_profile: user.communityvisibilitystate !== 3,
      is_community_banned: false,
      economy_ban: EconomyBan.None,
      last_ban_date: null,
      game_ban_count: 0,
      vac_ban_count: 0,
      creation_date: user.timecreated ? unixTimestampToDate(user.timecreated) : null,
    };

    rows.push(row);
  }

  return rows;
}
