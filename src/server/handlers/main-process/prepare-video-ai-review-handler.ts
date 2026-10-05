import type { AiVideoSource } from 'csdm/common/types/ai';
import { prepareVideoAiReview } from 'csdm/node/ai/prepare-video-ai-review';
import { getAiErrorCode } from 'csdm/node/ai/ai-error';

export async function prepareVideoAiReviewHandler(payload: { source: AiVideoSource; locale: 'zh-CN' | 'en' }) {
  try {
    return await prepareVideoAiReview(payload?.source, payload?.locale);
  } catch (error) {
    throw getAiErrorCode(error);
  }
}
