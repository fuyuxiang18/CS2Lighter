import type { FetchPersonalStatsPayload } from 'csdm/common/types/personal-stats';
import { fetchPersonalStats } from 'csdm/node/database/personal-stats/fetch-personal-stats';
import { handleError } from '../../handle-error';

export async function fetchPersonalStatsHandler(payload: FetchPersonalStatsPayload) {
  try {
    return await fetchPersonalStats(payload);
  } catch (error) {
    handleError(error, 'Error while fetching personal statistics');
  }
}
