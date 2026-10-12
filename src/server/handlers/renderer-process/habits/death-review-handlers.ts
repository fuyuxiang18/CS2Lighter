import type { ControlDeathReview, FetchDeathReviewPage } from 'csdm/common/types/death-review';
import { deathReview } from 'csdm/node/death-review/death-review';
import { handleError } from '../../handle-error';

export async function fetchDeathReviewPageHandler(payload: FetchDeathReviewPage) {
  try {
    return await deathReview.fetch(payload);
  } catch (error) {
    handleError(error, 'Error while fetching death review');
  }
}

export async function controlDeathReviewHandler(payload: ControlDeathReview) {
  try {
    return await deathReview.control(payload);
  } catch (error) {
    handleError(error, 'Error while controlling death review');
  }
}
