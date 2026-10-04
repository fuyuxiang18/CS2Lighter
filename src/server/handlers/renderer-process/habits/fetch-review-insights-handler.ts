import type { FetchReviewInsightsPayload } from 'csdm/common/types/review-insights';
import { fetchReviewInsights } from 'csdm/node/database/review/fetch-review-insights';
import { handleError } from '../../handle-error';

export async function fetchReviewInsightsHandler(payload: FetchReviewInsightsPayload) {
  try {
    return await fetchReviewInsights(payload);
  } catch (error) {
    handleError(error, 'Error while fetching review insights');
  }
}
