import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type {
  ReviewClip,
  ReviewClipInspection,
  ReviewClipIssue,
  ReviewClipRequest,
  ReviewClipRequirements,
  ReviewClipStatus,
} from 'csdm/common/types/review-clip';

const activeStatuses: ReviewClipStatus[] = ['queued', 'preparing', 'recording', 'encoding'];
const clipSchema = 1;

export class ReviewClipError extends Error {
  constructor(
    public readonly issue: ReviewClipIssue,
    detail?: string,
  ) {
    super(detail ?? issue);
  }
}

export type ResolvedReviewClip = {
  request: Required<ReviewClipRequest>;
  demoPath: string;
  mapName: string;
  playerName: string;
  tickrate: number;
  revision: string;
};

type Dependencies = {
  directory: () => string;
  resolve: (request: ReviewClipRequest) => Promise<ResolvedReviewClip>;
  requirements: () => Promise<ReviewClipRequirements>;
  record: (
    input: ResolvedReviewClip,
    id: string,
    directory: string,
    signal: AbortSignal,
    update: (status: ReviewClipStatus) => void,
  ) => Promise<string>;
  changed: (clip: ReviewClip) => void;
};

type Manifest = { version: number; clip: ReviewClip };

/** One explicitly requested game recording at a time. No startup auto-resume. */
export class ReviewClipService {
  private clips = new Map<string, ReviewClip>();
  private writes = new Map<string, Promise<void>>();
  private active?: { id: string; controller: AbortController };

  constructor(private readonly dependencies: Dependencies) {}

  isBusy() {
    return this.active !== undefined;
  }

  private folder(id: string) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new ReviewClipError('invalid-request');
    return path.join(this.dependencies.directory(), id);
  }

  private async read(input: ResolvedReviewClip): Promise<ReviewClip> {
    const id = createHash('sha256')
      .update(JSON.stringify([clipSchema, input.request, input.revision, '720p30-h264-aac-no-xray']))
      .digest('hex');
    let clip = this.clips.get(id);
    if (!clip) {
      try {
        const saved: Manifest = JSON.parse(await fs.readFile(path.join(this.folder(id), 'manifest.json'), 'utf8'));
        if (
          saved.version === clipSchema &&
          saved.clip.id === id &&
          JSON.stringify(saved.clip.request) === JSON.stringify(input.request)
        )
          clip = saved.clip;
      } catch {
        // A missing or incomplete manifest is a cache miss, never a successful recording.
      }
    }
    clip ??= {
      id,
      request: input.request,
      status: 'missing',
      source: 'cs2-demo-render',
      durationSeconds: (input.request.endTick - input.request.startTick) / input.tickrate,
      updatedAt: new Date().toISOString(),
    };
    if (clip.status === 'ready') {
      const file = path.join(this.folder(id), 'clip.mp4');
      const stats = await fs.stat(file).catch(() => undefined);
      clip =
        stats?.isFile() && stats.size > 0
          ? { ...clip, videoUrl: pathToFileURL(file).href }
          : { ...clip, status: 'failed', videoUrl: undefined, issue: 'output-missing' };
    } else {
      // Never trust a path persisted in a manifest or expose a partial output as a playable file.
      clip = { ...clip, videoUrl: undefined };
      if (activeStatuses.includes(clip.status) && this.active?.id !== id) {
        clip = { ...clip, status: 'failed', issue: 'interrupted' };
      }
    }
    this.clips.set(id, clip);
    return clip;
  }

  private save(clip: ReviewClip): Promise<void> {
    const snapshot = { version: clipSchema, clip: { ...clip, videoUrl: undefined } } satisfies Manifest;
    const directory = this.folder(clip.id);
    const previous = this.writes.get(clip.id) ?? Promise.resolve();
    const write = previous
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(directory, { recursive: true });
        const temporary = path.join(directory, `manifest-${randomUUID()}.tmp`);
        try {
          await fs.writeFile(temporary, JSON.stringify(snapshot));
          await fs.rename(temporary, path.join(directory, 'manifest.json'));
        } finally {
          await fs.unlink(temporary).catch(() => {});
        }
      });
    this.writes.set(clip.id, write);
    return write;
  }

  private update(clip: ReviewClip, patch: Partial<ReviewClip>): ReviewClip {
    const next = { ...clip, ...patch, updatedAt: new Date().toISOString() };
    this.clips.set(clip.id, next);
    this.dependencies.changed(next);
    return next;
  }

  async inspect(request: ReviewClipRequest): Promise<ReviewClipInspection> {
    const input = await this.dependencies.resolve(request);
    const [clip, requirements] = await Promise.all([this.read(input), this.dependencies.requirements()]);
    return { clip, requirements: this.withBusy(requirements) };
  }

  private withBusy(requirements: ReviewClipRequirements): ReviewClipRequirements {
    if (!this.isBusy() || requirements.queueBusy) return requirements;
    return { ...requirements, queueBusy: true, missingReasons: [...requirements.missingReasons, 'queue-busy'] };
  }

  async generate(request: ReviewClipRequest): Promise<ReviewClipInspection> {
    const input = await this.dependencies.resolve(request);
    let clip = await this.read(input);
    const requirements = this.withBusy(await this.dependencies.requirements());
    if (clip.status === 'ready' || this.active?.id === clip.id) return { clip, requirements };
    if (this.active || requirements.missingReasons.length) {
      clip = this.update(clip, {
        status: 'failed',
        issue: this.active ? 'queue-busy' : requirements.missingReasons[0],
        videoUrl: undefined,
      });
      return { clip, requirements };
    }
    const controller = new AbortController();
    this.active = { id: clip.id, controller };
    clip = this.update(clip, { status: 'queued', issue: undefined, errorDetail: undefined, videoUrl: undefined });
    try {
      await this.save(clip);
    } catch (error) {
      this.active = undefined;
      throw error;
    }
    void this.run(input, clip, controller);
    return { clip, requirements };
  }

  private async run(input: ResolvedReviewClip, initial: ReviewClip, controller: AbortController) {
    let clip = initial;
    try {
      const output = await this.dependencies.record(
        input,
        clip.id,
        this.folder(clip.id),
        controller.signal,
        (status) => {
          if (controller.signal.aborted) return;
          clip = this.update(clip, { status });
          void this.save(clip).catch((error) => logger.error(error));
        },
      );
      if (controller.signal.aborted) throw new ReviewClipError('interrupted');
      const stat = await fs.stat(output).catch(() => undefined);
      if (!stat?.isFile() || stat.size === 0) throw new ReviewClipError('output-missing');
      const destination = path.join(this.folder(clip.id), 'clip.mp4');
      if (path.resolve(output) !== path.resolve(destination)) await fs.rename(output, destination);
      // Persist completion before publishing it; a restart must see the same playable state.
      clip = {
        ...clip,
        status: 'ready',
        issue: undefined,
        errorDetail: undefined,
        updatedAt: new Date().toISOString(),
        videoUrl: pathToFileURL(destination).href,
      };
      await this.save(clip);
      this.update(clip, {});
    } catch (error) {
      clip = this.update(clip, {
        status: controller.signal.aborted ? 'canceled' : 'failed',
        videoUrl: undefined,
        issue: controller.signal.aborted
          ? undefined
          : error instanceof ReviewClipError
            ? error.issue
            : 'recording-failed',
        errorDetail: controller.signal.aborted ? undefined : error instanceof Error ? error.message : String(error),
      });
      await this.save(clip).catch((saveError) => logger.error(saveError));
    } finally {
      if (this.active?.id === clip.id) this.active = undefined;
    }
  }

  cancel(id: string): ReviewClip | undefined {
    this.folder(id);
    if (this.active?.id !== id) return this.clips.get(id);
    this.active.controller.abort();
    const clip = this.clips.get(id);
    if (!clip) return undefined;
    return this.update(clip, { status: 'canceled', videoUrl: undefined });
  }
}
