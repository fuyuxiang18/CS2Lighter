import type { AiErrorCode } from 'csdm/common/types/ai';

export class AiServiceError extends Error {
  constructor(readonly code: AiErrorCode) {
    super(code);
  }
}

/** Do not forward provider response bodies, fetch errors or filesystem paths to the renderer/log. */
export function getAiErrorCode(error: unknown): AiErrorCode {
  if (error instanceof AiServiceError) return error.code;
  const codes: AiErrorCode[] = [
    'invalid-configuration',
    'secure-storage-unavailable',
    'key-unavailable',
    'invalid-scope',
    'no-data',
    'request-failed',
    'request-timeout',
    'invalid-response',
    'response-truncated',
    'response-empty',
    'response-json-invalid',
    'response-schema-invalid',
    'response-evidence-invalid',
    'response-score-invalid',
    'storage-failed',
    'video-not-ready',
    'frame-extraction-failed',
    'preview-expired',
    'vision-unsupported',
    'busy',
  ];
  // The server transports known failures as strings, not Error instances.
  return typeof error === 'string' && codes.includes(error as AiErrorCode) ? (error as AiErrorCode) : 'request-failed';
}
