import { useLingui } from '@lingui/react/macro';
import type { AiErrorCode } from 'csdm/common/types/ai';

export function useAiErrorMessage() {
  const { t } = useLingui();
  const messages: Record<AiErrorCode, string> = {
    'invalid-configuration': t`Set an AI provider, server address and model before generating a review.`,
    'secure-storage-unavailable': t`Encrypted key storage is unavailable on this device. Check the AI settings.`,
    'key-unavailable': t`The API key is missing or could not be read. Save it in the AI settings.`,
    'invalid-scope': t`This player or match is not available for an AI review.`,
    'no-data': t`No usable rounds match this selection. Import demos or change the filters first.`,
    'request-failed': t`The AI request failed. Check the server address, model and credentials, then try again.`,
    'request-timeout': t`The model did not respond in time. Try again or choose a faster model.`,
    'invalid-response': t`The model returned a report that could not be verified. It was not saved. Try another model or retry.`,
    'storage-failed': t`The report could not be saved locally. Check available disk space and try again.`,
    'video-not-ready': t`This recorded video is unavailable or incomplete. Generate the video before preparing an AI review.`,
    'frame-extraction-failed': t`The video frames could not be read. Check FFmpeg and the recorded video, then try again.`,
    'preview-expired': t`This preview has expired or the AI target changed. Preview the frames again before sending.`,
    'vision-unsupported': t`The server or model could not accept this visual request, or reported that it could not see the images. Choose a vision-capable model that supports image inputs and JSON responses. No text-only fallback was generated.`,
    busy: t`Another AI review is being generated. Wait for it to finish, then refresh this panel.`,
  };
  return (error: AiErrorCode) => messages[error];
}
