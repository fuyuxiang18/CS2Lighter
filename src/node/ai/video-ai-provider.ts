import type { AiConfiguration, PreparedVideoAiContext } from 'csdm/common/types/ai';
import { normalizeAiConfiguration } from './ai-configuration';
import { AiServiceError } from './ai-error';
import { VIDEO_AI_SYSTEM_PROMPT } from './video-ai-prompt';
import { validateVideoAiReport } from './validate-video-ai-report';

/** Exactly one multimodal generation request. Never retries or silently drops images. */
export async function requestVideoAiReport(
  context: PreparedVideoAiContext,
  configuration: Pick<AiConfiguration, 'provider' | 'baseUrl' | 'model'>,
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180_000);
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
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        ...(new URL(config.baseUrl).hostname === 'api.openai.com'
          ? { max_completion_tokens: 6000 }
          : { max_tokens: 4000 }),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: VIDEO_AI_SYSTEM_PROMPT },
          { role: 'user', content },
        ],
      }),
    });
    if ([400, 415, 422].includes(response.status)) throw new AiServiceError('vision-unsupported');
    if (!response.ok || !response.body) throw new AiServiceError('request-failed');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 256 * 1024) {
        await reader.cancel();
        throw new AiServiceError('invalid-response');
      }
      chunks.push(value);
    }
    const wire = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const choice = wire?.choices?.[0];
    if (
      choice?.finish_reason !== 'stop' ||
      typeof choice.message?.content !== 'string' ||
      choice.message.content.length > 32000
    )
      throw new AiServiceError('invalid-response');
    return validateVideoAiReport(JSON.parse(choice.message.content), context);
  } catch (error) {
    if (error instanceof AiServiceError) throw error;
    if (controller.signal.aborted) throw new AiServiceError('request-timeout');
    if (error instanceof SyntaxError) throw new AiServiceError('invalid-response');
    throw new AiServiceError('request-failed');
  } finally {
    clearTimeout(timer);
  }
}
