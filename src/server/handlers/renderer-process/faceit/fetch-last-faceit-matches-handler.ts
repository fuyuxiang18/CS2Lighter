import type { FaceitMatch } from 'csdm/common/types/faceit-match';
import { assertNetworkDemoDownloadsEnabled } from 'csdm/server/network-demo-downloads';
import { fetchLastFaceitMatches } from 'csdm/node/faceit/fetch-last-faceit-matches';
import { handleError } from '../../handle-error';

export async function fetchLastFaceitMatchesHandler(accountId: string) {
  assertNetworkDemoDownloadsEnabled();
  try {
    const matches: FaceitMatch[] = await fetchLastFaceitMatches(accountId);

    return matches;
  } catch (error) {
    handleError(error, 'Error while fetching last FACEIT matches');
  }
}
