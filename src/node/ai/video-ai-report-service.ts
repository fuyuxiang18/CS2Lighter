import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import type {
  AiProviderConfiguration,
  PreparedVideoAiContext,
  VideoAiReport,
  VideoAiReviewState,
} from 'csdm/common/types/ai';
import { getAppFolderPath } from 'csdm/node/filesystem/get-app-folder-path';
import { VIDEO_AI_PROMPT_VERSION } from './video-ai-prompt';
import { validateVideoAiReport } from './validate-video-ai-report';
import { requestVideoAiReport } from './video-ai-provider';
import { AiServiceError } from './ai-error';

type Configuration = AiProviderConfiguration;
function configurationKey(config: Configuration) {
  return JSON.stringify([config.provider, config.baseUrl, config.model]);
}
function reportKey(context: PreparedVideoAiContext, config: Configuration) {
  return createHash('sha256')
    .update(JSON.stringify([context.contextHash, configurationKey(config), VIDEO_AI_PROMPT_VERSION]))
    .digest('hex');
}

/** Prepared images stay in main-process memory, never accepted back from a renderer. */
export class VideoAiReviews {
  private preparations = new Map<string, { context: PreparedVideoAiContext; target: string; expires: number }>();
  private inFlight = new Map<string, Promise<VideoAiReport>>();

  constructor(private readonly directory = path.join(getAppFolderPath(), 'video-ai-reports')) {}

  private async cached(context: PreparedVideoAiContext, config: Configuration): Promise<VideoAiReport | null> {
    const id = reportKey(context, config);
    try {
      const text = await readFile(path.join(this.directory, `${id}.json`), 'utf8');
      if (text.length > 256 * 1024) return null;
      const report = JSON.parse(text) as VideoAiReport;
      if (
        !report ||
        typeof report !== 'object' ||
        report.id !== id ||
        report.contextHash !== context.contextHash ||
        report.promptVersion !== VIDEO_AI_PROMPT_VERSION ||
        report.provider !== config.provider ||
        report.model !== config.model ||
        !Number.isFinite(Date.parse(report.generatedAt))
      )
        return null;
      return {
        id,
        contextHash: context.contextHash,
        generatedAt: report.generatedAt,
        provider: config.provider,
        model: config.model,
        promptVersion: VIDEO_AI_PROMPT_VERSION,
        input: 'sampled-pov-frames-and-round-facts',
        content: validateVideoAiReport(report.content, context),
      };
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === 'ENOENT' ||
        error instanceof SyntaxError ||
        error instanceof AiServiceError
      )
        return null;
      throw new AiServiceError('storage-failed');
    }
  }

  async prepare(context: PreparedVideoAiContext, config: Configuration): Promise<VideoAiReviewState> {
    for (const [key, entry] of this.preparations) if (entry.expires < Date.now()) this.preparations.delete(key);
    while (this.preparations.size >= 4) this.preparations.delete(this.preparations.keys().next().value!);
    const preparationId = randomUUID();
    const expires = Date.now() + 15 * 60_000;
    this.preparations.set(preparationId, { context, target: configurationKey(config), expires });
    return {
      preparationId,
      expiresAt: new Date(expires).toISOString(),
      frames: context.frames,
      payload: context.payload,
      report: config.model.trim() ? await this.cached(context, config) : null,
    };
  }

  async generate(
    preparationId: string,
    config: Configuration,
    apiKey?: string,
    regenerate = false,
  ): Promise<VideoAiReviewState> {
    const entry = this.preparations.get(preparationId);
    if (!entry || entry.expires < Date.now() || entry.target !== configurationKey(config))
      throw new AiServiceError('preview-expired');
    const { context } = entry;
    const id = reportKey(context, config);
    let report = regenerate ? null : await this.cached(context, config);
    if (!report) {
      let operation = this.inFlight.get(id);
      if (!operation) {
        operation = this.generateAndSave(context, config, apiKey).finally(() => this.inFlight.delete(id));
        this.inFlight.set(id, operation);
      }
      report = await operation;
    }
    return {
      preparationId,
      expiresAt: new Date(entry.expires).toISOString(),
      frames: context.frames,
      payload: context.payload,
      report,
    };
  }

  private async generateAndSave(
    context: PreparedVideoAiContext,
    config: Configuration,
    apiKey?: string,
  ): Promise<VideoAiReport> {
    const content = await requestVideoAiReport(context, config, apiKey);
    const id = reportKey(context, config);
    const report: VideoAiReport = {
      id,
      contextHash: context.contextHash,
      generatedAt: new Date().toISOString(),
      provider: config.provider,
      model: config.model,
      promptVersion: VIDEO_AI_PROMPT_VERSION,
      content,
      input: 'sampled-pov-frames-and-round-facts',
    };
    const temporary = path.join(this.directory, `${id}.${randomUUID()}.tmp`);
    try {
      await mkdir(this.directory, { recursive: true });
      await writeFile(temporary, JSON.stringify(report), { flag: 'wx', mode: 0o600 });
      await rename(temporary, path.join(this.directory, `${id}.json`));
    } catch {
      throw new AiServiceError('storage-failed');
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
    return report;
  }
}
