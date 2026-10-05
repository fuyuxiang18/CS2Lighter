import type { ReviewClipRequest } from 'csdm/common/types/review-clip';
import { reviewClips } from 'csdm/node/video/review-clips/review-clips';
import { handleError } from '../../handle-error';
import { watchReviewPov } from 'csdm/node/video/review-clips/watch-review-pov';

export async function watchReviewPovHandler(request: ReviewClipRequest) {
  return await watchReviewPov(request);
}

export async function getReviewClipHandler(request: ReviewClipRequest) {
  try {
    return await reviewClips.inspect(request);
  } catch (error) {
    handleError(error, 'Error inspecting review clip');
  }
}

export async function generateReviewClipHandler(request: ReviewClipRequest) {
  try {
    return await reviewClips.generate(request);
  } catch (error) {
    handleError(error, 'Error generating review clip');
  }
}

export function cancelReviewClipHandler({ id }: { id: string }) {
  try {
    return Promise.resolve(reviewClips.cancel(id));
  } catch (error) {
    handleError(error, 'Error canceling review clip');
  }
}
