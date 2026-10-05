import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { AiConfiguration, AiReportContent, PreparedAiContext } from 'csdm/common/types/ai';
import { TeamNumber } from 'csdm/common/types/counter-strike';
import { requestAiReport } from './ai-provider';

const configuration = {
  provider: 'openai-compatible' as const,
  baseUrl: 'https://provider.example/v1',
  model: 'synthetic-test-model',
};
const preview: PreparedAiContext['preview'] = {
  kind: 'personal',
  matchCount: 1,
  roundCount: 1,
  availableMatchCount: 1,
  evidenceCount: 1,
  maxMatches: 10,
  supportedInput: 'facts',
};
const context: PreparedAiContext = {
  identityHash: 'synthetic-identity',
  contextHash: 'synthetic-context',
  preview,
  evidence: [
    {
      id: 'r001',
      checksum: 'a11ce',
      steamId: '76561198000000001',
      mapName: 'de_inferno',
      roundNumber: 1,
      side: TeamNumber.T,
      tick: 1000,
      eventTick: 1512,
      precision: 'event-context',
    },
  ],
  payload: {
    kind: 'personal',
    locale: 'zh-CN',
    sample: preview,
    metrics: { roundCount: 1 },
    methodology: { rating: 'hltv-1.0-public', rws: 'faceit-2025-public-local-v1', tradeWindowSeconds: 5 },
    allowedScoreDimensions: [],
    bySide: [],
    weapons: [],
    byClutchSize: [],
    cohorts: [],
    rounds: [],
  },
};
function report(): AiReportContent {
  return {
    summary: { text: 'Synthetic protocol fixture, not a player assessment.', evidenceIds: ['r001'] },
    style: { label: '火力输出', text: 'Synthetic style fixture.', evidenceIds: ['r001'] },
    observations: [{ text: 'Review the cited event.', evidenceIds: ['r001'] }],
    recommendations: [
      {
        title: 'Review context',
        action: 'Replay the event.',
        uncertainty: 'Small sample.',
        evidenceIds: ['r001'],
      },
    ],
    scores: (['aim', 'opening', 'trading', 'utility', 'clutch'] as const).map((dimension) => ({
      dimension,
      score: null,
      rationale: 'Insufficient synthetic sample.',
      evidenceIds: [],
    })),
    limitations: ['Synthetic fixture only.'],
  };
}
function wire(content: unknown = JSON.stringify(report()), finishReason = 'stop', reasoning = '') {
  return JSON.stringify({
    choices: [{ finish_reason: finishReason, message: { content, reasoning_content: reasoning } }],
    usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
  });
}
function mockResponse(body = wire()) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(body));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}
const warning = vi.fn();
beforeEach(() => {
  warning.mockClear();
  vi.stubGlobal('logger', { warn: warning });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('statistics AI provider budget and response boundaries', () => {
  it.each([
    ['https://api.openai.com/v1', 'openai-compatible', 'max_completion_tokens'],
    ['https://api.deepseek.com/v1', 'openai-compatible', 'max_tokens'],
    ['https://provider.example/v1', 'openai-compatible', 'max_tokens'],
    ['http://127.0.0.1:11434/v1', 'ollama', 'max_tokens'],
  ] as const)(
    'sets 24000 tokens for %s without changing the provider thinking default',
    async (baseUrl, provider, key) => {
      const fetchMock = mockResponse();
      const config: Pick<AiConfiguration, 'baseUrl' | 'provider' | 'model'> = { ...configuration, baseUrl, provider };
      expect(await requestAiReport(context, config, provider === 'ollama' ? undefined : 'test-secret')).toEqual(
        report(),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, options] = fetchMock.mock.calls[0];
      expect(typeof options?.body).toBe('string');
      const body = JSON.parse(options?.body as string);
      expect(body[key]).toBe(24000);
      expect(body[key === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens']).toBeUndefined();
      expect(Object.keys(body).sort()).toEqual(['messages', key, 'model', 'response_format', 'stream'].sort());
      expect(body.messages[1].content).toBe(JSON.stringify(context.payload));
      expect(options?.redirect).toBe('error');
    },
  );

  it('accepts a final report with separate DeepSeek reasoning and ignores that private reasoning', async () => {
    const fetchMock = mockResponse(wire(JSON.stringify(report()), 'stop', 'private-thinking '.repeat(20000)));
    expect(
      await requestAiReport(context, { ...configuration, baseUrl: 'https://api.deepseek.com/v1' }, 'test-secret'),
    ).toEqual(report());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
  });

  it.each(['```json\n', '```JSON\r\n', '```\n'])('accepts one complete outer JSON code fence (%s)', async (opening) => {
    mockResponse(wire(`${opening}${JSON.stringify(report())}\n\x60\x60\x60`));
    expect(await requestAiReport(context, configuration, 'test-secret')).toEqual(report());
  });

  it.each([
    ['length', '', 'response-truncated'],
    ['length', '{"summary":', 'response-truncated'],
    ['stop', '', 'response-empty'],
    ['stop', ' \n\t ', 'response-empty'],
    ['stop', null, 'response-empty'],
    ['stop', '{"summary":', 'response-json-invalid'],
    ['stop', '```json\n{"summary":', 'response-json-invalid'],
    ['stop', `prefix ${JSON.stringify(report())}`, 'response-json-invalid'],
    ['stop', `\x60\x60\x60json\n${JSON.stringify(report())}\n\x60\x60\x60\nextra`, 'response-json-invalid'],
    ['content_filter', '', 'invalid-response'],
    ['tool_calls', '', 'invalid-response'],
  ])('classifies %s / %j without recovery or an automatic retry', async (finish, content, code) => {
    const fetchMock = mockResponse(wire(content, finish as string));
    await expect(requestAiReport(context, configuration, 'test-secret')).rejects.toThrow(code as string);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('distinguishes invalid wire JSON from a missing completion envelope', async () => {
    mockResponse('{"private-provider-data":');
    await expect(requestAiReport(context, configuration, 'test-secret')).rejects.toThrow('response-json-invalid');
    mockResponse(JSON.stringify({ choices: [] }));
    await expect(requestAiReport(context, configuration, 'test-secret')).rejects.toThrow('invalid-response');
  });

  it('keeps the final report bounded even when a large reasoning envelope is permitted', async () => {
    mockResponse(wire(JSON.stringify({ oversized: 'x'.repeat(32000) })));
    await expect(requestAiReport(context, configuration, 'test-secret')).rejects.toThrow('invalid-response');
  });

  it('accepts exactly 2 MiB of wire data but cancels a stream that exceeds the byte bound', async () => {
    const base = wire();
    const permitted = wire(JSON.stringify(report()), 'stop', 'x'.repeat(2 * 1024 * 1024 - Buffer.byteLength(base)));
    expect(Buffer.byteLength(permitted)).toBe(2 * 1024 * 1024);
    mockResponse(permitted);
    expect(await requestAiReport(context, configuration, 'test-secret')).toEqual(report());

    const cancel = vi.fn();
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from(`${permitted} `));
        },
        cancel,
      }),
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestAiReport(context, configuration, 'test-secret')).rejects.toThrow('invalid-response');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves precise schema, evidence and score validation failures', async () => {
    mockResponse(wire(JSON.stringify({ ...report(), summary: null })));
    await expect(requestAiReport(context, configuration, 'test-secret')).rejects.toThrow('response-schema-invalid');
    const badEvidence = report();
    badEvidence.summary.evidenceIds = ['r999'];
    mockResponse(wire(JSON.stringify(badEvidence)));
    await expect(requestAiReport(context, configuration, 'test-secret')).rejects.toThrow('response-evidence-invalid');
    const badScore = report();
    badScore.scores[0].score = 50;
    mockResponse(wire(JSON.stringify(badScore)));
    await expect(requestAiReport(context, configuration, 'test-secret')).rejects.toThrow('response-score-invalid');
  });

  it('logs only allowlisted error metadata, never secrets, provider text, URLs or reasoning', async () => {
    const privateText = 'test-secret https://private.example/details private-thinking';
    const fetchMock = mockResponse(wire(privateText, privateText, privateText));
    await expect(requestAiReport(context, configuration, 'test-secret')).rejects.toThrow('invalid-response');
    expect(warning).toHaveBeenLastCalledWith('AI statistics request failed', {
      stage: 'completion',
      code: 'invalid-response',
      finishReason: 'other',
      prompt_tokens: 100,
      completion_tokens: 200,
      total_tokens: 300,
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain('test-secret');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('https:');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('private-thinking');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects reasoning-only output and drops nonnumeric or invalid usage metadata', async () => {
    mockResponse(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { reasoning_content: 'private-thinking' } }],
        usage: { prompt_tokens: 'private-token-text', completion_tokens: -1, total_tokens: 3.5 },
      }),
    );
    await expect(requestAiReport(context, configuration, 'test-secret')).rejects.toThrow('response-empty');
    expect(warning).toHaveBeenLastCalledWith('AI statistics request failed', {
      stage: 'completion',
      code: 'response-empty',
      finishReason: 'stop',
    });
  });

  it('rejects HTTP and fetch failures without exposing their body or cause and without retrying', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('private-server-response test-secret', { status: 401 }))
      .mockRejectedValueOnce(new Error('https://private.example test-secret'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestAiReport(context, configuration, 'test-secret')).rejects.toThrow('request-failed');
    await expect(requestAiReport(context, configuration, 'test-secret')).rejects.toThrow('request-failed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(warning.mock.calls)).not.toContain('test-secret');
  });

  it('allows up to 240 seconds for a request and then aborts it once with a safe code', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          signal = options?.signal ?? undefined;
          signal?.addEventListener('abort', () => reject(new Error('private-network-error')));
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const assertion = expect(requestAiReport(context, configuration, 'test-secret')).rejects.toThrow('request-timeout');
    await vi.advanceTimersByTimeAsync(239999);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await assertion;
    expect(signal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('also times out a stalled response body and cancels its reader without returning an empty-report error', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel }))));
    const assertion = expect(requestAiReport(context, configuration, 'test-secret')).rejects.toThrow('request-timeout');
    await vi.advanceTimersByTimeAsync(240000);
    await assertion;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
