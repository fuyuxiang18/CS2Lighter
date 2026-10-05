import type { ReviewBatchRequest } from 'csdm/common/types/review-batch';
import { reviewBatches } from 'csdm/node/video/review-clips/review-batches';

export const generateReviewBatchHandler = (request: ReviewBatchRequest) => reviewBatches.generate(request);
export const getReviewBatchHandler = ({ id }: { id: string }) => reviewBatches.inspect(id);
export const listReviewBatchesHandler = () => reviewBatches.list();
export const cancelReviewBatchHandler = ({ id }: { id: string }) => Promise.resolve(reviewBatches.cancel(id));
