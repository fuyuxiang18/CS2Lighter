import { useLingui } from '@lingui/react/macro';
import type { AiErrorCode } from 'csdm/common/types/ai';

export function useAiErrorMessage() {
  const { t } = useLingui();
  const messages: Record<AiErrorCode, string> = {
    'invalid-configuration': t`Check the AI provider, server address, model and output token limit in AI settings.`,
    'secure-storage-unavailable': t`Encrypted key storage is unavailable on this device. Check the AI settings.`,
    'key-unavailable': t`The API key is missing or could not be read. Save it in the AI settings.`,
    'invalid-scope': t`This player or match is not available for an AI review.`,
    'no-data': t`No usable rounds match this selection. Import demos or change the filters first.`,
    'request-failed': t`The AI request failed. Check the server address, model, credentials and whether the model supports your output token limit.`,
    'request-timeout': t`The model did not respond in time. Try again or choose a faster model.`,
    'invalid-response': t`The AI service returned an incomplete or unsupported response. No report was saved.`,
    'response-truncated': t`The model reached its output limit before completing the report. No report was saved. Adjust the output token limit in AI settings and check your model's supported limit.`,
    'response-empty': t`The model returned no final report. It may have returned only reasoning text. No report was saved.`,
    'response-json-invalid': t`The model's report could not be read as JSON. No report was saved.`,
    'response-schema-invalid': t`The report is missing required fields or has an invalid style label, length or structure. No report was saved.`,
    'response-evidence-invalid': t`The report cites unknown rounds or omits required supporting rounds. No report was saved.`,
    'response-score-invalid': t`The five scores do not match the required dimensions, available data or 0–100 integer range. No report was saved.`,
    'storage-failed': t`The report could not be saved locally. Check available disk space and try again.`,
    'video-not-ready': t`This recorded video is unavailable or incomplete. Generate the video before preparing an AI review.`,
    'frame-extraction-failed': t`The video frames could not be read. Check FFmpeg and the recorded video, then try again.`,
    'preview-expired': t`This preview has expired or the AI target changed. Preview the frames again before sending.`,
    'vision-unsupported': t`The server or model could not accept this visual request, or reported that it could not see the images. Choose a vision-capable model that supports image inputs and JSON responses. No text-only fallback was generated.`,
    busy: t`Another AI review is being generated. Wait for it to finish, then refresh this panel.`,
  };
  return (error: AiErrorCode) => messages[error];
}
