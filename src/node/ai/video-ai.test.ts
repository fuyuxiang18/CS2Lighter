import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { AiVideoSource, ResolvedVideoAiMedia, VideoAiContent, VideoAiFacts } from 'csdm/common/types/ai';
import { videoFrameTimes, prepareVideoFrames } from './video-ai-frames';
import { validateVideoAiReport } from './validate-video-ai-report';
import { requestVideoAiReport } from './video-ai-provider';
import { VideoAiReviews } from './video-ai-report-service';
import { VIDEO_AI_SYSTEM_PROMPT } from './video-ai-prompt';

// Synthetic bytes/responses test the contract; they are not actual model visual judgments.
const bytes = Buffer.from([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
const source: AiVideoSource = { kind: 'batch', id: 'a'.repeat(64), itemIndex: 1 };
const media: ResolvedVideoAiMedia = {
  checksum: 'cafe',
  steamId: '76561198000000001',
  revision: 'private-revision',
  mapName: 'de_inferno',
  roundNumber: 5,
  tickrate: 64,
  segments: [
    {
      perspective: 'player',
      filePath: 'C:\\private\\player.mp4',
      startTick: 1000,
      endTick: 1640,
      offsetSeconds: 0,
      durationSeconds: 10.1,
    },
    {
      perspective: 'opponent',
      filePath: 'C:\\private\\player.mp4',
      startTick: 1000,
      endTick: 1512,
      offsetSeconds: 10.1,
      durationSeconds: 8.1,
    },
  ],
};
const facts: VideoAiFacts = {
  map: 'de_inferno',
  round: 5,
  tickrate: 64,
  side: 2,
  won: true,
  kills: 1,
  deaths: 0,
  damage: 100,
  openingKill: true,
  openingDeath: false,
  tradeKills: 0,
  tradedDeaths: 0,
  utilityThrown: 1,
  utilityDamage: 0,
};
const config = {
  provider: 'openai-compatible' as const,
  baseUrl: 'https://example.com/v1',
  model: 'synthetic-vision-fixture',
};
const local = { provider: 'ollama' as const, baseUrl: 'http://127.0.0.1:11434/v1', model: 'synthetic-local-vision' };
const directories: string[] = [];
async function context() {
  return prepareVideoFrames(source, media, facts, 'en', () => Promise.resolve(bytes));
}
function response(): VideoAiContent {
  return {
    visualInput: 'visible',
    summary: { text: 'Synthetic test summary.', frameIds: ['P1'] },
    style: { text: 'Synthetic clip choice.', frameIds: ['P2'] },
    timeline: [
      {
        frameIds: ['P1'],
        observation: 'Synthetic visible corner.',
        inference: 'A possible exposure.',
        information: 'player-visible',
        alternative: 'Check this corner from cover.',
        uncertainty: 'Communication is unknown.',
      },
      {
        frameIds: ['O2'],
        observation: 'Synthetic opponent cover.',
        inference: 'Hindsight only.',
        information: 'opponent-hindsight',
        alternative: 'Manually compare player visibility.',
        uncertainty: 'Player did not necessarily know this.',
      },
    ],
    practice: [{ action: 'Synthetic practice drill.', check: 'Review comparable cover choices.', frameIds: ['P1'] }],
    limitations: ['Sparse sampling and unknown communications.'],
  };
}
function wire(value: unknown = response()) {
  return new Response(
    JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }),
    { status: 200 },
  );
}
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('video AI frame preparation', () => {
  it('targets pre-duel choices and the event, clamping and deduplicating near death', () => {
    expect(videoFrameTimes(12, 8)).toEqual([0, 6, 7.25, 7.75, 8.35, 11.85]);
    const death = videoFrameTimes(8, 8);
    expect(death).toContain(7.75);
    expect(death).toContain(7.85);
    expect(death).toHaveLength(6);
    expect(death.every((time) => time < 8)).toBe(true);
    expect(videoFrameTimes(8 - 1 / 64, 8)).toContain(7.75);
    expect(new Set(videoFrameTimes(0.1, 0.05)).size).toBe(1);
  });
  it('samples actual segment offsets and stays strictly before death/end boundaries', async () => {
    const calls: number[] = [];
    const prepared = await prepareVideoFrames(source, media, facts, 'en', (_file, seconds) => {
      calls.push(seconds);
      return Promise.resolve(bytes);
    });
    expect(prepared.frames).toHaveLength(12);
    expect(calls[0]).toBe(0);
    expect(calls[6]).toBe(10.1);
    expect(
      prepared.frames.filter((f) => f.perspective === 'player').every((f) => f.demoTick < 1640 && f.videoSeconds < 10),
    ).toBe(true);
    expect(
      prepared.frames
        .filter((f) => f.perspective === 'opponent')
        .every((f) => f.demoTick < 1512 && f.videoSeconds < 18.1),
    ).toBe(true);
    expect(prepared.frames.map((frame) => frame.id)).toEqual([
      'P1',
      'P2',
      'P3',
      'P4',
      'P5',
      'P6',
      'O1',
      'O2',
      'O3',
      'O4',
      'O5',
      'O6',
    ]);
    expect(JSON.stringify(prepared.payload)).not.toContain(media.steamId);
    expect(JSON.stringify(prepared.payload)).not.toContain('private');
  });
  it('rejects empty/oversized/duplicate perspectives and does not invent opponent frames', async () => {
    expect(() => videoFrameTimes(0)).toThrow('invalid-scope');
    expect(() => videoFrameTimes(200)).toThrow('invalid-scope');
    await expect(
      prepareVideoFrames(source, { ...media, segments: [media.segments[0], media.segments[0]] }, facts, 'en', () =>
        Promise.resolve(bytes),
      ),
    ).rejects.toThrow('invalid-scope');
    const single = await prepareVideoFrames(source, { ...media, segments: [media.segments[0]] }, facts, 'en', () =>
      Promise.resolve(bytes),
    );
    expect(single.frames).toHaveLength(6);
    expect(single.frames.every((f) => f.perspective === 'player')).toBe(true);
  });
  it('changes context identity when images change, even with unchanged facts', async () => {
    const first = await context();
    const changed = await prepareVideoFrames(source, media, facts, 'en', () =>
      Promise.resolve(Buffer.from('different synthetic image')),
    );
    expect(changed.contextHash).not.toBe(first.contextHash);
  });
});

describe('bounded visual review request and evidence', () => {
  it('sends the exact preview images and metadata in one request, without identity or paths', async () => {
    const prepared = await context();
    const fetch = vi.fn((_url: unknown, options: RequestInit) => {
      const body = JSON.parse(options.body as string);
      const images = body.messages[1].content.filter((item: { type: string }) => item.type === 'image_url');
      expect(images.map((item: { image_url: { url: string } }) => item.image_url.url)).toEqual(
        prepared.frames.map((frame) => frame.dataUrl),
      );
      expect(JSON.parse(body.messages[1].content[0].text)).toEqual(prepared.payload);
      expect(options.body as string).not.toContain(media.steamId);
      expect(options.body as string).not.toContain(media.segments[0].filePath);
      expect(options.redirect).toBe('error');
      return Promise.resolve(wire());
    });
    vi.stubGlobal('fetch', fetch);
    await requestVideoAiReport(prepared, config, 'synthetic-key');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('uses image inputs with Ollama and does not require or send a cloud key', async () => {
    const fetch = vi.fn((_url: unknown, options: RequestInit) => {
      expect(options.headers).not.toHaveProperty('Authorization');
      expect(
        JSON.parse(options.body as string).messages[1].content.some(
          (item: { type: string }) => item.type === 'image_url',
        ),
      ).toBe(true);
      return Promise.resolve(wire());
    });
    vi.stubGlobal('fetch', fetch);
    await requestVideoAiReport(await context(), local);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rejects unsupported vision without a text retry or pretend report', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('private provider detail', { status: 400 })));
    vi.stubGlobal('fetch', fetch);
    await expect(requestVideoAiReport(await context(), config, 'synthetic-key')).rejects.toThrow('vision-unsupported');
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockImplementation(() => Promise.resolve(wire({ visualInput: 'unavailable' })));
    await expect(requestVideoAiReport(await context(), config, 'synthetic-key')).rejects.toThrow('vision-unsupported');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('rejects made-up frame IDs and opponent hindsight mislabeled as player knowledge', async () => {
    const prepared = await context();
    const fabricated = response();
    fabricated.summary.frameIds = ['P999'];
    expect(() => validateVideoAiReport(fabricated, prepared)).toThrow('invalid-response');
    const hindsight = response();
    hindsight.timeline[1].information = 'player-visible';
    expect(() => validateVideoAiReport(hindsight, prepared)).toThrow('invalid-response');
    expect(() => validateVideoAiReport({ ...response(), score: 99 }, prepared)).toThrow('invalid-response');
    expect(VIDEO_AI_SYSTEM_PROMPT).toContain('millisecond');
    expect(VIDEO_AI_SYSTEM_PROMPT).toContain('untrusted evidence');
  });
  it('rejects truncated/oversized model output and sanitizes request failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] })),
        ),
      ),
    );
    await expect(requestVideoAiReport(await context(), local)).rejects.toThrow('invalid-response');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('x'.repeat(300 * 1024)))),
    );
    await expect(requestVideoAiReport(await context(), local)).rejects.toThrow('invalid-response');
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('secret api key and host'))),
    );
    await expect(requestVideoAiReport(await context(), local)).rejects.toThrow('request-failed');
  });
});

describe('video AI consent preparation and separate report cache', () => {
  async function service() {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'cs2lighter-video-ai-'));
    directories.push(dir);
    return { dir, reviews: new VideoAiReviews(dir) };
  }
  it('prepares locally, caches one explicit call and requires explicit regeneration', async () => {
    const { dir, reviews } = await service();
    const fetch = vi.fn(() => Promise.resolve(wire()));
    vi.stubGlobal('fetch', fetch);
    const preview = await reviews.prepare(await context(), config);
    expect(fetch).not.toHaveBeenCalled();
    expect(preview.report).toBeNull();
    await reviews.generate(preview.preparationId, config, 'synthetic-key');
    const cached = await reviews.prepare(await context(), config);
    expect(cached.report?.input).toBe('sampled-pov-frames-and-round-facts');
    await reviews.generate(cached.preparationId, config, 'synthetic-key');
    expect(fetch).toHaveBeenCalledTimes(1);
    await reviews.generate(cached.preparationId, config, 'synthetic-key', true);
    expect(fetch).toHaveBeenCalledTimes(2);
    const saved = await readFile(path.join(dir, (await readdir(dir))[0]), 'utf8');
    expect(saved).not.toContain('synthetic-key');
    expect(saved).not.toContain('data:image');
    expect(saved).not.toContain('private');
  });
  it('rejects stale previews and changed targets before any provider request', async () => {
    const { reviews } = await service();
    const fetch = vi.fn(() => Promise.resolve(wire()));
    vi.stubGlobal('fetch', fetch);
    const preview = await reviews.prepare(await context(), config);
    await expect(
      reviews.generate(preview.preparationId, { ...config, baseUrl: 'https://other.example/v1' }, 'synthetic-key'),
    ).rejects.toThrow('preview-expired');
    await expect(
      reviews.generate(preview.preparationId, { ...config, model: 'changed' }, 'synthetic-key'),
    ).rejects.toThrow('preview-expired');
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 16 * 60_000);
    await expect(reviews.generate(preview.preparationId, config, 'synthetic-key')).rejects.toThrow('preview-expired');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not cache invalid model evidence and deduplicates simultaneous generation', async () => {
    const { dir, reviews } = await service();
    const preview = await reviews.prepare(await context(), config);
    const invalid = response();
    invalid.practice[0].frameIds = ['invented'];
    const fetch = vi.fn(() => Promise.resolve(wire(invalid)));
    vi.stubGlobal('fetch', fetch);
    await expect(reviews.generate(preview.preparationId, config, 'synthetic-key')).rejects.toThrow('invalid-response');
    expect(await readdir(dir)).toEqual([]);
    fetch.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return Promise.resolve(wire());
    });
    const results = await Promise.all([
      reviews.generate(preview.preparationId, config, 'synthetic-key'),
      reviews.generate(preview.preparationId, config, 'synthetic-key'),
    ]);
    expect(results[0].report?.id).toBe(results[1].report?.id);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
