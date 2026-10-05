import { AiServiceError } from './ai-error';

export type AiResponseDiagnostics = {
  stage: 'request' | 'wire' | 'completion' | 'report';
  finishReason: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

// Accept the common reader interface shared by Node/Undici and DOM streams, without relying on BYOB overloads.
type ResponseBody = {
  getReader(): {
    read(): Promise<{ done: boolean; value?: Uint8Array }>;
    cancel(): Promise<void>;
    releaseLock(): void;
  };
};

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
async function readResponseBody(body: ResponseBody, signal: AbortSignal, maximumBytes: number) {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) throw new AiServiceError('invalid-response');
      size += value.byteLength;
      if (size > maximumBytes) throw new AiServiceError('invalid-response');
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

/** Accept only a complete final response. Provider reasoning remains separate and never becomes report content. */
export async function readAiProviderResponse(
  body: ResponseBody,
  signal: AbortSignal,
  maximumBytes: number,
  diagnostics: AiResponseDiagnostics,
) {
  diagnostics.stage = 'wire';
  const wire = object(parseResponseJson(await readResponseBody(body, signal, maximumBytes)));
  const suppliedUsage = object(wire?.usage);
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens'] as const) {
    const value = suppliedUsage?.[key];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) diagnostics[key] = value;
  }
  diagnostics.stage = 'completion';
  const choice = object(Array.isArray(wire?.choices) ? wire.choices[0] : undefined);
  diagnostics.finishReason =
    typeof choice?.finish_reason === 'string' &&
    ['stop', 'length', 'content_filter', 'tool_calls', 'function_call'].includes(choice.finish_reason)
      ? choice.finish_reason
      : 'other';
  if (choice?.finish_reason === 'length') throw new AiServiceError('response-truncated');
  if (choice?.finish_reason !== 'stop') throw new AiServiceError('invalid-response');
  const content = object(choice.message)?.content;
  if (content === null || content === undefined) throw new AiServiceError('response-empty');
  if (typeof content !== 'string') throw new AiServiceError('invalid-response');
  diagnostics.stage = 'report';
  const trimmed = content.trim();
  if (!trimmed) throw new AiServiceError('response-empty');
  // Only one complete outer fence is tolerated; never extract or repair fragments of JSON.
  const fence = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/i.exec(trimmed);
  const json = fence ? fence[1].trim() : trimmed;
  if (!json) throw new AiServiceError('response-empty');
  if (json.length > 32_000) throw new AiServiceError('invalid-response');
  return parseResponseJson(json);
}
