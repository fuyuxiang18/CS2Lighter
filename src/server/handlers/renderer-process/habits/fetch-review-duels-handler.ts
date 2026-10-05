import type { ReviewDuelsPayload } from 'csdm/common/types/review-duels';
import { fetchReviewDuels } from 'csdm/node/database/review/fetch-review-duels';
import { handleError } from '../../handle-error';

export async function fetchReviewDuelsHandler(payload: ReviewDuelsPayload) {
  try {
    return await fetchReviewDuels(payload);
  } catch (error) {
    handleError(error, 'Error while fetching combat events');
  }
}
