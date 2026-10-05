import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { Agent, getGlobalDispatcher } from 'undici';
import { createServer } from 'node:http';
import { DEFAULT_AI_MAX_OUTPUT_TOKENS } from 'csdm/common/ai-token-limit';
import { getAiRequestLimits } from './ai-request-limits';
import { createAiRequestDispatcher, fetchAiRequest } from './ai-request-dispatcher';

afterEach(() => vi.restoreAllMocks());
describe('AI request transport limits', () => {
  it.each([
    [1, 2 * 1024 * 1024, 240000],
    [24000, 2 * 1024 * 1024, 240000],
    [24001, 2 * 1024 * 1024, 480000],
    [50000, 3200000, 720000],
    [DEFAULT_AI_MAX_OUTPUT_TOKENS, 15360000, 1800000],
    [1000000, 64000000, 1800000],
  ])('scales %i tokens within explicit wire and deadline bounds', (tokens, bytes, timeout) => {
    expect(getAiRequestLimits(tokens)).toEqual({ maximumResponseBytes: bytes, timeoutMs: timeout });
  });

  it.each([0, -1, 1.5, 1000001, NaN, Infinity])('rejects an invalid transport budget %s', (tokens) => {
    expect(() => getAiRequestLimits(tokens)).toThrow('invalid-configuration');
  });

  it('overrides fetch transport deadlines per request and leaves the global dispatcher untouched', async () => {
    const global = getGlobalDispatcher();
    const dispatch = vi.spyOn(Agent.prototype, 'dispatch').mockReturnValue(true);
    const destroy = vi.spyOn(Agent.prototype, 'destroy');
    const first = createAiRequestDispatcher(1800000);
    const second = createAiRequestDispatcher(240000);
    const options = {
      origin: 'https://synthetic.example',
      path: '/',
      method: 'POST' as const,
      headersTimeout: 300000,
      bodyTimeout: 300000,
    };
    first.dispatcher.dispatch(options, { onRequestStart: vi.fn(), onResponseError: vi.fn() });
    second.dispatcher.dispatch(options, { onRequestStart: vi.fn(), onResponseError: vi.fn() });
    expect(dispatch.mock.calls[0][0]).toMatchObject({ headersTimeout: 1800000, bodyTimeout: 1800000 });
    expect(dispatch.mock.calls[1][0]).toMatchObject({ headersTimeout: 240000, bodyTimeout: 240000 });
    expect(first.dispatcher).not.toBe(second.dispatcher);
    expect(getGlobalDispatcher()).toBe(global);
    await first.dispose();
    await second.dispose();
    expect(new Set(destroy.mock.contexts).size).toBe(2);
    expect(destroy.mock.contexts).not.toContain(global);
  });

  it('uses a compatible fetch and dispatcher for one real loopback POST without external networking', async () => {
    let posts = 0;
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        if (request.method === 'POST') posts++;
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ received: Buffer.concat(chunks).toString('utf8') }));
      });
    });
    const network = createAiRequestDispatcher(1800000);
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Missing loopback test address');
      const response = await fetchAiRequest(`http://127.0.0.1:${address.port}/synthetic`, {
        method: 'POST',
        body: 'synthetic',
        dispatcher: network.dispatcher,
        signal: AbortSignal.timeout(2000),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ received: 'synthetic' });
      expect(posts).toBe(1);
    } finally {
      await network.dispose();
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
