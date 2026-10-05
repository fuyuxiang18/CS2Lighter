import type { AiProviderConfiguration, PreparedVideoAiContext } from 'csdm/common/types/ai';
import { normalizeAiConfiguration } from './ai-configuration';
import { AiServiceError } from './ai-error';
import { VIDEO_AI_SYSTEM_PROMPT } from './video-ai-prompt';
import { validateVideoAiReport } from './validate-video-ai-report';
import { getAiRequestLimits } from './ai-request-limits';
import { createAiRequestDispatcher, fetchAiRequest } from './ai-request-dispatcher';
import { readAiProviderResponse, type AiResponseDiagnostics } from './ai-provider-response';

/** Exactly one multimodal generation request. Never retries or silently drops images. */
export async function requestVideoAiReport(
  context: PreparedVideoAiContext,
  configuration: AiProviderConfiguration,
  apiKey?: string,
) {
  const config = normalizeAiConfiguration(configuration);
  if (config.provider === 'openai-compatible' && !apiKey) throw new AiServiceError('key-unavailable');
  if (
    !context.frames.length ||
    context.frames.length > 12 ||
    context.frames.some(
      (frame) => !frame.dataUrl.startsWith('data:image/jpeg;base64,') || frame.dataUrl.length > 710_000,
    )
  )
    throw new AiServiceError('invalid-scope');
  const limits = getAiRequestLimits(config.maxOutputTokens);
  const network = createAiRequestDispatcher(limits.timeoutMs);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  const diagnostics: AiResponseDiagnostics = { stage: 'request', finishReason: 'missing' };
  try {
    const content: (
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string; detail: 'high' } }
    )[] = [{ type: 'text', text: JSON.stringify(context.payload) }];
    for (const frame of context.frames) {
      const { dataUrl, ...metadata } = frame;
      content.push(
        { type: 'text', text: JSON.stringify(metadata) },
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
      );
    }
    const options = {
      dispatcher: network.dispatcher,
      method: 'POST',
      redirect: 'error' as const,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        ...(new URL(config.baseUrl).hostname === 'api.openai.com'
          ? { max_completion_tokens: config.maxOutputTokens }
          : { max_tokens: config.maxOutputTokens }),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: VIDEO_AI_SYSTEM_PROMPT },
          { role: 'user', content },
        ],
      }),
    };
    const response = await fetchAiRequest(`${config.baseUrl}/chat/completions`, options);
    // 400/422 can also mean an unsupported token budget or context length, not missing image support.
    if (response.status === 415) throw new AiServiceError('vision-unsupported');
    if (!response.ok || !response.body) throw new AiServiceError('request-failed');
    return validateVideoAiReport(
      await readAiProviderResponse(response.body, controller.signal, limits.maximumResponseBytes, diagnostics),
      context,
    );
  } catch (error) {
    const failure = controller.signal.aborted
      ? new AiServiceError('request-timeout')
      : error instanceof AiServiceError
        ? error
        : new AiServiceError('request-failed');
    logger.warn('AI video request failed', { ...diagnostics, code: failure.code });
    throw failure;
  } finally {
    clearTimeout(timer);
    await network.dispose();
  }
}
