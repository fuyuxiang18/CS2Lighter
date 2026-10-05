import type { AiConfiguration, PreparedAiContext } from 'csdm/common/types/ai';
import { normalizeAiConfiguration } from './ai-configuration';
import { AiServiceError } from './ai-error';
import { AI_SYSTEM_PROMPT } from './ai-prompt';
import { validateAiReport } from './validate-ai-report';

const maximumResponseBytes = 2 * 1024 * 1024;
const maximumReportCharacters = 32_000;

function parseResponseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new AiServiceError('response-json-invalid');
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function readResponseBody(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    // Do not let a provider's slow cancellation delay an already classified failure.
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumResponseBytes) throw new AiServiceError('invalid-response');
      chunks.push(value);
    }
    signal.throwIfAborted();
    return Buffer.concat(chunks).toString('utf8');
  } catch (error) {
    cancel();
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

function reportJson(content: string) {
  const trimmed = content.trim();
  if (!trimmed) throw new AiServiceError('response-empty');
  // Only a complete, single outer fence is tolerated. Never extract or repair fragments of JSON.
  const fence = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  const json = fence ? fence[1].trim() : trimmed;
  if (!json) throw new AiServiceError('response-empty');
  if (json.length > maximumReportCharacters) throw new AiServiceError('invalid-response');
  return parseResponseJson(json);
}

/** No retries: each explicit generation is at most one billable request. Redirects are refused. */
export async function requestAiReport(
  context: PreparedAiContext,
  configuration: Pick<AiConfiguration, 'provider' | 'baseUrl' | 'model'>,
  apiKey?: string,
) {
  const config = normalizeAiConfiguration(configuration);
  if (config.provider === 'openai-compatible' && !apiKey) throw new AiServiceError('key-unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 240_000);
  let stage: 'request' | 'wire' | 'completion' | 'report' = 'request';
  let finishReason = 'missing';
  let usage: Record<string, number> = {};
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
          ? { max_completion_tokens: 24_000 }
          : { max_tokens: 24_000 }),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(context.payload) },
        ],
      }),
    });
    if (!response.ok || !response.body) throw new AiServiceError('request-failed');
    stage = 'wire';
    const wire = object(parseResponseJson(await readResponseBody(response.body, controller.signal)));
    const suppliedUsage = object(wire?.usage);
    usage = Object.fromEntries(
      ['prompt_tokens', 'completion_tokens', 'total_tokens'].flatMap((key) => {
        const value = suppliedUsage?.[key];
        return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? [[key, value]] : [];
      }),
    );
    stage = 'completion';
    const choice = object(Array.isArray(wire?.choices) ? wire.choices[0] : undefined);
    finishReason =
      typeof choice?.finish_reason === 'string' &&
      ['stop', 'length', 'content_filter', 'tool_calls', 'function_call'].includes(choice.finish_reason)
        ? choice.finish_reason
        : 'other';
    if (choice?.finish_reason === 'length') throw new AiServiceError('response-truncated');
    if (choice?.finish_reason !== 'stop') throw new AiServiceError('invalid-response');
    const content = object(choice.message)?.content;
    if (content === null || content === undefined) throw new AiServiceError('response-empty');
    if (typeof content !== 'string') throw new AiServiceError('invalid-response');
    // Reasoning fields remain provider-owned. Only the final content is a report candidate.
    stage = 'report';
    return validateAiReport(reportJson(content), context);
  } catch (error) {
    const failure = controller.signal.aborted
      ? new AiServiceError('request-timeout')
      : error instanceof AiServiceError
        ? error
        : new AiServiceError('request-failed');
    // These allowlisted codes and numeric counts are safe; provider text, URLs and reasoning never reach logs.
    logger.warn('AI statistics request failed', { stage, code: failure.code, finishReason, ...usage });
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}
