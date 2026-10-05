import type { AiReportScope } from 'csdm/common/types/ai';
import { prepareAiReport } from 'csdm/node/database/review/prepare-ai-report';
import { getAiErrorCode } from 'csdm/node/ai/ai-error';

export async function prepareAiReportHandler(scope: AiReportScope) {
  try {
    return await prepareAiReport(scope);
  } catch (error) {
    // Never forward/log SQL parameters, names, paths or provider credentials.
    throw getAiErrorCode(error);
  }
}
