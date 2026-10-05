import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import type {
  ResolvedVideoAiMedia,
  VideoAiFrame,
  VideoAiFacts,
  PreparedVideoAiContext,
  AiVideoSource,
} from 'csdm/common/types/ai';
import { AiServiceError } from './ai-error';

const execute = promisify(execFile);
const FRAMES_PER_VIEW = 6;
const MAX_JPEG_BYTES = 512 * 1024;

/** Samples inside the real chapter boundary; sparse frames are never continuous motion evidence. */
export function videoFrameTimes(duration: number, eventSeconds?: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0 || duration > 46) throw new AiServiceError('invalid-scope');
  const last = Math.max(0, duration - 0.15);
  const clamp = (seconds: number) => Number(Math.max(0, Math.min(last, seconds)).toFixed(3));
  const points = new Set<number>();
  if (
    eventSeconds !== undefined &&
    Number.isFinite(eventSeconds) &&
    eventSeconds >= 0 &&
    eventSeconds <= duration + 0.25
  ) {
    for (const seconds of [0, eventSeconds - 2, eventSeconds - 0.75, eventSeconds - 0.25, eventSeconds + 0.35, last])
      points.add(clamp(seconds));
  }
  for (let index = 0; index < FRAMES_PER_VIEW && points.size < FRAMES_PER_VIEW; index++)
    points.add(clamp((last * index) / (FRAMES_PER_VIEW - 1)));
  return [...points].sort((a, b) => a - b);
}

export async function extractVideoAiFrame(ffmpeg: string, file: string, seconds: number): Promise<Buffer> {
  try {
    const { stdout } = await execute(
      ffmpeg,
      [
        '-nostdin',
        '-v',
        'error',
        '-ss',
        String(seconds),
        '-i',
        file,
        '-frames:v',
        '1',
        '-an',
        '-vf',
        'scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2',
        '-q:v',
        '4',
        '-f',
        'image2pipe',
        '-c:v',
        'mjpeg',
        'pipe:1',
      ],
      { windowsHide: true, timeout: 10_000, maxBuffer: MAX_JPEG_BYTES, encoding: 'buffer' },
    );
    if (
      stdout.length < 4 ||
      stdout.length > MAX_JPEG_BYTES ||
      stdout[0] !== 0xff ||
      stdout[1] !== 0xd8 ||
      stdout.at(-2) !== 0xff ||
      stdout.at(-1) !== 0xd9
    ) {
      throw new Error('Invalid JPEG');
    }
    return stdout;
  } catch {
    throw new AiServiceError('frame-extraction-failed');
  }
}

export async function prepareVideoFrames(
  source: AiVideoSource,
  media: ResolvedVideoAiMedia,
  facts: VideoAiFacts,
  locale: 'zh-CN' | 'en',
  extract: (file: string, seconds: number) => Promise<Buffer>,
): Promise<PreparedVideoAiContext> {
  if (
    !['zh-CN', 'en'].includes(locale) ||
    !media.segments.length ||
    media.segments.length > 2 ||
    media.segments[0].perspective !== 'player' ||
    new Set(media.segments.map((segment) => segment.perspective)).size !== media.segments.length ||
    !Number.isFinite(media.tickrate) ||
    media.tickrate <= 0
  )
    throw new AiServiceError('invalid-scope');
  const frames: VideoAiFrame[] = [];
  const coverage: PreparedVideoAiContext['payload']['coverage'] = [];
  for (const segment of media.segments) {
    if (
      !Number.isFinite(segment.offsetSeconds) ||
      segment.offsetSeconds < 0 ||
      !Number.isSafeInteger(segment.startTick) ||
      !Number.isSafeInteger(segment.endTick) ||
      segment.endTick <= segment.startTick
    )
      throw new AiServiceError('invalid-scope');
    // Encoded footage can be a few frames longer than its demo range; never sample beyond either boundary.
    const duration = Math.min(segment.durationSeconds, (segment.endTick - segment.startTick) / media.tickrate);
    const eventSeconds =
      media.eventTick === undefined ? undefined : (media.eventTick - segment.startTick) / media.tickrate;
    const times = videoFrameTimes(duration, eventSeconds);
    coverage.push({
      perspective: segment.perspective,
      startTick: segment.startTick,
      endTick: segment.endTick,
      frameCount: times.length,
    });
    for (const [index, seconds] of times.entries()) {
      const videoSeconds = Number((segment.offsetSeconds + seconds).toFixed(3));
      const bytes = await extract(segment.filePath, videoSeconds);
      if (bytes.length > MAX_JPEG_BYTES) throw new AiServiceError('frame-extraction-failed');
      frames.push({
        id: `${segment.perspective === 'player' ? 'P' : 'O'}${index + 1}`,
        perspective: segment.perspective,
        videoSeconds,
        demoTick: Math.min(segment.endTick - 1, segment.startTick + Math.round(seconds * media.tickrate)),
        width: 960,
        height: 540,
        dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`,
      });
    }
  }
  const payload: PreparedVideoAiContext['payload'] = {
    locale,
    eventTick: media.eventTick ?? null,
    facts,
    frames: frames.map(({ dataUrl: _dataUrl, ...frame }) => frame),
    coverage,
    input: 'sampled-pov-frames-and-round-facts',
    audioIncluded: false,
  };
  return {
    source,
    frames,
    payload,
    contextHash: createHash('sha256')
      .update(JSON.stringify([media.revision, source, payload, frames]))
      .digest('hex'),
  };
}
