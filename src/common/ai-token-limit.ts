export const DEFAULT_AI_MAX_OUTPUT_TOKENS = 240_000;
export const MAX_AI_MAX_OUTPUT_TOKENS = 1_000_000;

export function isAiMaxOutputTokens(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_AI_MAX_OUTPUT_TOKENS;
}
