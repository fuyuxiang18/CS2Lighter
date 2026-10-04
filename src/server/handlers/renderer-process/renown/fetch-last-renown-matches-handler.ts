import { fetchLastRenownMatches } from 'csdm/node/renown/fetch-last-renown-matches';
import { assertNetworkDemoDownloadsEnabled } from 'csdm/server/network-demo-downloads';
import { handleError } from '../../handle-error';

export async function fetchLastRenownMatchesHandler(steamId: string) {
  assertNetworkDemoDownloadsEnabled();
  try {
    const matches = await fetchLastRenownMatches(steamId);

    return matches;
  } catch (error) {
    handleError(error, 'Error while fetching last Renown matches');
  }
}
