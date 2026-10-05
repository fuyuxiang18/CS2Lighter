import type { AiConfiguration, PreparedAiContext } from 'csdm/common/types/ai';
import { normalizeAiConfiguration } from './ai-configuration';
import { AiServiceError } from './ai-error';
import { AI_SYSTEM_PROMPT } from './ai-prompt';
import { validateAiReport } from './validate-ai-report';

/** No retries: each explicit generation is at most one billable request. Redirects are refused. */
export async function requestAiReport(
  context: PreparedAiContext,
  configuration: Pick<AiConfiguration, 'provider' | 'baseUrl' | 'model'>,
  apiKey?: string,
) {
  const config = normalizeAiConfiguration(configuration);
  if (config.provider === 'openai-compatible' && !apiKey) throw new AiServiceError('key-unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        // Official OpenAI reasoning models reject legacy max_tokens; generic compatible servers and Ollama use it.
        ...(new URL(config.baseUrl).hostname === 'api.openai.com'
          ? { max_completion_tokens: 4096 }
          : { max_tokens: 2400 }),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(context.payload) },
        ],
      }),
    });
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
    return validateAiReport(JSON.parse(choice.message.content), context);
  } catch (error) {
    if (error instanceof AiServiceError) throw error;
    if (controller.signal.aborted) throw new AiServiceError('request-timeout');
    if (error instanceof SyntaxError) throw new AiServiceError('invalid-response');
    throw new AiServiceError('request-failed');
  } finally {
    clearTimeout(timer);
  }
}
