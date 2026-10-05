import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import type { AiConfiguration, AiReport, AiReportState, PreparedAiContext } from 'csdm/common/types/ai';
import { getAppFolderPath } from 'csdm/node/filesystem/get-app-folder-path';
import { AI_PROMPT_VERSION } from './ai-prompt';
import { normalizeAiConfiguration } from './ai-configuration';
import { AiServiceError } from './ai-error';
import { requestAiReport } from './ai-provider';
import { validateAiReport } from './validate-ai-report';

type Configuration = Pick<AiConfiguration, 'provider' | 'baseUrl' | 'model'>;
const inFlight = new Map<string, Promise<AiReportState>>();

function reportKey(context: PreparedAiContext, config: Configuration) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        identity: context.identityHash,
        context: context.contextHash,
        provider: config.provider,
        baseUrl: config.baseUrl,
        model: config.model,
        prompt: AI_PROMPT_VERSION,
      }),
    )
    .digest('hex');
}

function reportDirectory() {
  return path.join(getAppFolderPath(), 'ai-reports');
}

/** Disk-only lookup; never calls the provider. A changed model/context/prompt gets a new cache key. */
export async function getAiReportState(
  context: PreparedAiContext,
  configuration: Configuration,
  directory = reportDirectory(),
): Promise<AiReportState> {
  const config = normalizeAiConfiguration(configuration);
  const id = reportKey(context, config);
  try {
    const raw = await readFile(path.join(directory, `${id}.json`), 'utf8');
    if (raw.length > 256 * 1024) return { preview: context.preview, report: null };
    const saved = JSON.parse(raw) as AiReport;
    if (
      !saved ||
      typeof saved !== 'object' ||
      saved.id !== id ||
      saved.contextHash !== context.contextHash ||
      saved.promptVersion !== AI_PROMPT_VERSION ||
      saved.provider !== config.provider ||
      saved.model !== config.model ||
      !Number.isFinite(Date.parse(saved.generatedAt))
    )
      return { preview: context.preview, report: null };
    const content = validateAiReport(saved.content, context);
    return {
      preview: context.preview,
      report: {
        id,
        generatedAt: saved.generatedAt,
        provider: config.provider,
        model: config.model,
        promptVersion: AI_PROMPT_VERSION,
        contextHash: context.contextHash,
        content,
        preview: context.preview,
        evidence: context.evidence,
        input: 'facts',
        assessment: 'model-subjective',
      },
    };
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === 'ENOENT' ||
      error instanceof SyntaxError ||
      error instanceof AiServiceError
    )
      return { preview: context.preview, report: null };
    throw new AiServiceError('storage-failed');
  }
}

export async function generateAiReport(
  context: PreparedAiContext,
  configuration: Configuration,
  apiKey?: string,
  regenerate = false,
  directory = reportDirectory(),
): Promise<AiReportState> {
  const config = normalizeAiConfiguration(configuration);
  const id = reportKey(context, config);
  const key = `${directory}:${id}`;
  if (!regenerate) {
    const saved = await getAiReportState(context, config, directory);
    if (saved.report) return saved;
  }
  const current = inFlight.get(key);
  if (current) return current;
  const operation = (async (): Promise<AiReportState> => {
    const content = await requestAiReport(context, config, apiKey);
    const report: AiReport = {
      id,
      generatedAt: new Date().toISOString(),
      provider: config.provider,
      model: config.model,
      promptVersion: AI_PROMPT_VERSION,
      contextHash: context.contextHash,
      preview: context.preview,
      content,
      evidence: context.evidence,
      assessment: 'model-subjective',
      input: 'facts',
    };
    const temporary = path.join(directory, `${id}.${randomUUID()}.tmp`);
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(temporary, JSON.stringify(report), { flag: 'wx', mode: 0o600 });
      await rename(temporary, path.join(directory, `${id}.json`));
    } catch {
      throw new AiServiceError('storage-failed');
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
    return { preview: context.preview, report };
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, operation);
  return operation;
}
