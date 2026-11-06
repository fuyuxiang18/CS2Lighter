import fs from 'node:fs/promises';
import path from 'node:path';
import type { Sequence } from 'csdm/common/types/sequence';
import { Game } from 'csdm/common/types/counter-strike';
import { DisplayMode } from 'csdm/common/types/display-mode';
import { getDemoChecksumFromDemoPath } from 'csdm/node/demo/get-demo-checksum-from-demo-path';
import { getCsgoFolderPathOrThrow } from 'csdm/node/counter-strike/get-csgo-folder-path';
import { isCounterStrikeRunning } from 'csdm/node/counter-strike/is-counter-strike-running';
import { watchDemoWithHlae } from 'csdm/node/counter-strike/launcher/watch-demo-with-hlae';
import { createCs2VideoJsonFile } from 'csdm/node/video/generation/create-cs2-video-json-file';
import { generateVideoWithFFmpeg } from 'csdm/node/video/generation/generate-video-with-ffmpeg';
import { getFfmpegExecutablePath } from 'csdm/node/video/ffmpeg/ffmpeg-location';
import { getSequenceOutputFilePath } from 'csdm/node/video/generation/get-sequence-output-file-path';
import { getSequenceName } from 'csdm/node/video/generation/get-sequence-name';
import { isUpdateMaintenance } from 'csdm/server/update-maintenance';
import { buildReviewClipVideo } from './build-review-clip-video';
import { buildReviewHlaeCommands } from './create-review-hlae-commands';
import { buildReviewBoundaryScript, createReviewSessionBridge } from './review-session-bridge';
import { assertReviewGameFiles } from './assert-review-game-files';
import { ReviewClipError } from './review-clip-service';
import type { ResolvedBatchItem } from './resolve-review-batch';
import { planReviewCapturePasses, reviewBoundaryTick, reviewWarmupTick } from './review-capture-plan';

type SessionStep = {
  item: ResolvedBatchItem;
  sequence: Sequence;
  folder: string;
  demoPath: string;
  xmlPath: string;
  tickrate: number;
  actions: { tick: number; cmd: string }[];
  video: ReturnType<typeof buildReviewClipVideo>;
};

/** A new scheduler is installed before a seek; forward seeks initialize at their warm-up tick. */
export function nextReviewSessionCommand(
  currentDemo: string,
  next: { demoPath: string; xmlPath: string; entryTick?: number } | undefined,
): string {
  if (!next) return 'quit';
  const quote = (value: string) => {
    if (/["\r\n;]/.test(value)) throw new ReviewClipError('invalid-request');
    return `"${value.replaceAll('\\', '/')}"`;
  };
  const entryTick = next.entryTick ?? 0;
  if (!Number.isSafeInteger(entryTick) || entryTick < 0) throw new ReviewClipError('invalid-request');
  return `mirv_cmd load ${quote(next.xmlPath)}; ${next.demoPath === currentDemo ? `demo_gototick ${entryTick}; demo_resume` : `playdemo ${quote(next.demoPath)}; demo_resume`}`;
}

export async function recordReviewSession(
  groups: ResolvedBatchItem[][],
  folder: string,
  signal: AbortSignal,
  progress: (segment: number, encoding: boolean) => void,
  launched: () => void,
  itemRecorded: (item: ResolvedBatchItem, groupFolder: string, signal: AbortSignal) => Promise<void>,
  shouldPause: () => boolean,
) {
  if (isUpdateMaintenance()) throw new ReviewClipError('update-maintenance');
  if (await isCounterStrikeRunning()) throw new ReviewClipError('game-running');
  await assertReviewGameFiles(await getCsgoFolderPathOrThrow(Game.CS2));
  const ffmpeg = await getFfmpegExecutablePath();
  const steps: SessionStep[] = [];
  let reservedMediaBytes = 0;
  for (const [groupIndex, items] of groups.entries()) {
    if (!items.length) continue;
    signal.throwIfAborted();
    const staging = path.join(folder, `demo-${groupIndex + 1}`);
    const input = items[0].input;
    try {
      const source = await fs.stat(input.demoPath).catch(() => undefined);
      if (!source?.isFile()) throw new ReviewClipError('demo-missing');
      if ((await getDemoChecksumFromDemoPath(input.demoPath)) !== input.request.checksum)
        throw new ReviewClipError('demo-changed');
      if (path.dirname(staging) !== folder) throw new ReviewClipError('invalid-request');
      await fs.rm(staging, { recursive: true, force: true });
      await fs.mkdir(staging, { recursive: true });
      const disk = await fs.statfs(staging);
      const mediaBytes = items.reduce((sum, entry) => sum + entry.item.segments.length, 0) * 100 * 1024 * 1024;
      if (disk.bavail * disk.bsize < source.size + reservedMediaBytes + mediaBytes)
        throw new ReviewClipError('insufficient-space');
      const video = buildReviewClipVideo(input, path.basename(folder), staging, ffmpeg);
      await fs.copyFile(input.demoPath, video.demoPath);
      const fresh = await fs.stat(input.demoPath);
      if (fresh.size !== source.size || fresh.mtimeMs !== source.mtimeMs) throw new ReviewClipError('demo-changed');
      reservedMediaBytes += mediaBytes;
      video.sequences = items.flatMap((entry) =>
        entry.item.segments.map((segment) => ({
          ...buildReviewClipVideo(
            {
              ...entry.input,
              request: {
                ...entry.input.request,
                steamId: segment.steamId,
                startTick: segment.startTick,
                endTick: segment.endTick,
              },
              playerName: segment.playerName,
            },
            path.basename(folder),
            staging,
            ffmpeg,
          ).sequences[0],
          number: segment.index,
        })),
      );
      await createCs2VideoJsonFile({
        ...video,
        type: 'record',
        players: Object.entries(items[0].slots).map(([steamId, slot]) => ({
          steamId,
          slot,
          userId: slot,
          side: 2 as const,
        })),
        cameras: [],
      });
      const json: { actions: { tick: number; cmd: string }[] }[] = JSON.parse(
        await fs.readFile(`${video.demoPath}.json`, 'utf8'),
      );
      const groupSteps: SessionStep[] = [];
      for (const item of items)
        for (const segment of item.item.segments) {
          const sequence = video.sequences.find((entry) => entry.number === segment.index)!;
          const position = video.sequences.findIndex((entry) => entry.number === segment.index);
          groupSteps.push({
            item,
            sequence,
            folder: staging,
            demoPath: video.demoPath,
            xmlPath: path.join(staging, `segment-${segment.index}.xml`),
            tickrate: item.input.tickrate,
            actions: json[position].actions,
            video,
          });
        }
      steps.push(...planReviewCapturePasses(groupSteps));
    } catch (error) {
      if (signal.aborted) throw error;
      for (const entry of items)
        await itemRecorded(
          {
            ...entry,
            item: {
              ...entry.item,
              status: 'failed',
              issue: error instanceof ReviewClipError ? error.issue : 'recording-failed',
            },
          },
          staging,
          signal,
        );
    }
  }
  if (!steps.length || shouldPause()) return;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  let current = steps[0];
  const pendingSteps = steps.slice(1);
  const startedItems = new Set([current.item.item.index]);
  const remainingSegments = new Map(groups.flat().map(({ item }) => [item.index, item.segments.length]));
  const failedItems = new Set<number>();
  const encodings = new Set<Promise<void>>();
  let encodingTail = Promise.resolve();
  let finished = false;
  let failure: unknown;
  let watchdog: ReturnType<typeof setTimeout>;
  const arm = () => {
    clearTimeout(watchdog);
    // Per-segment loading/recording/encoding deadline, not an unbounded game wait.
    watchdog = setTimeout(() => {
      failure = new ReviewClipError('recording-failed', 'The recording session stopped responding');
      controller.abort();
    }, 240_000);
  };
  const encode = (step: SessionStep) => {
    const task = encodingTail.then(async () => {
      controller.signal.throwIfAborted();
      const index = step.item.item.index;
      if (failedItems.has(index)) return;
      try {
        await generateVideoWithFFmpeg(
          {
            ...step.video.ffmpegSettings,
            ffmpegExecutablePath: ffmpeg,
            game: Game.CS2,
            recordingSystem: step.video.recordingSystem,
            recordingOutput: step.video.recordingOutput,
            outputFolderPath: step.folder,
            framerate: step.video.framerate,
            sequence: step.sequence,
            recordAudio: step.sequence.recordAudio,
          },
          controller.signal,
        );
        // Keep only the muxed sequence needed by the final edit. Raw capture folders are owned
        // children of this session's staging directory and are never user-provided media paths.
        const rawFolder = path.resolve(step.folder, getSequenceName(step.sequence));
        const muxed = await fs
          .stat(getSequenceOutputFilePath(step.folder, step.sequence, step.video.ffmpegSettings.videoContainer))
          .catch(() => undefined);
        if (path.dirname(rawFolder) === path.resolve(step.folder) && muxed?.isFile() && muxed.size > 0)
          await fs.rm(rawFolder, { recursive: true, force: true }).catch((error) => logger.error(error));
        const remaining = remainingSegments.get(index)! - 1;
        remainingSegments.set(index, remaining);
        if (remaining === 0) await itemRecorded(step.item, step.folder, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) throw error;
        failedItems.add(index);
        await itemRecorded(
          {
            ...step.item,
            item: {
              ...step.item.item,
              status: 'failed',
              issue: 'recording-failed',
              segments: step.item.item.segments.map((segment) => ({ ...segment, status: 'failed' })),
              errorDetail: error instanceof Error ? error.message : String(error),
            },
          },
          step.folder,
          controller.signal,
        );
      }
    });
    // One encoder at a time; game capture may overlap it. All rejections are observed immediately.
    const observed = task.catch((error: unknown) => {
      if (!controller.signal.aborted) failure = error;
      controller.abort();
    });
    encodingTail = observed;
    encodings.add(observed);
    void observed.then(() => encodings.delete(observed));
  };
  const prepareStep = async (step: SessionStep, previous?: SessionStep): Promise<number> => {
    const warmupTick = reviewWarmupTick(step);
    // HLAE runs commands over the crossed tick interval. A direct forward seek must land before
    // initialization; camera setup remains later, avoiding spec_player and demo_gototick on one tick.
    const forward = previous?.demoPath === step.demoPath && warmupTick > reviewBoundaryTick(previous) + 1;
    const bootstrapTick = forward ? warmupTick : 1;
    const actions = step.actions
      .filter(
        (action) =>
          action.cmd !== 'quit' &&
          action.cmd !== 'go_to_next_sequence' &&
          !((forward || warmupTick <= 1) && /^demo_gototick \d+$/.test(action.cmd)),
      )
      .map((action) => ({
        // The shared JSON generator clamps initialization to tick 96, not literally tick 1.
        tick: forward && action.tick < bootstrapTick ? bootstrapTick : action.tick,
        cmd: /^demo_gototick \d+$/.test(action.cmd) ? `demo_gototick ${warmupTick}` : action.cmd,
      }));
    const gate = path.join(step.folder, `boundary-${step.sequence.number}.js`);
    await fs.writeFile(gate, buildReviewBoundaryScript(bridge.url, step.sequence.number));
    actions.push({
      tick: reviewBoundaryTick(step),
      cmd: `demo_pause; mirv_script_load "${gate.replaceAll('\\', '/')}"`,
    });
    await fs.writeFile(step.xmlPath, buildReviewHlaeCommands(actions, bootstrapTick));
    return forward ? warmupTick - 1 : 0;
  };
  const bridge = await createReviewSessionBridge({
    failed: (error) => {
      failure = error;
      controller.abort();
    },
    completed: async (number) => {
      const step = current;
      if (!step || step.sequence.number !== number)
        throw new ReviewClipError('recording-failed', 'Unexpected recording boundary');
      arm();
      progress(number, true);
      encode(step);
      // At most two captured segments may await the serial encoder. Back-pressure pauses CS2 at
      // its acknowledged boundary instead of accumulating unbounded raw videos on disk.
      while (encodings.size >= 2) await Promise.race(encodings);
      controller.signal.throwIfAborted();
      const nextIndex = pendingSteps.findIndex(
        (candidate) =>
          !failedItems.has(candidate.item.item.index) &&
          (!shouldPause() || startedItems.has(candidate.item.item.index)),
      );
      if (nextIndex === -1) {
        finished = true;
        return 'quit';
      }
      const [next] = pendingSteps.splice(nextIndex, 1);
      const entryTick = await prepareStep(next, step);
      current = next;
      startedItems.add(next.item.item.index);
      progress(next.sequence.number, false);
      return nextReviewSessionCommand(step.demoPath, { ...next, entryTick });
    },
  });
  try {
    await prepareStep(current);
    arm();
    const first = steps[0];
    await watchDemoWithHlae({
      demoPath: first.demoPath,
      game: Game.CS2,
      width: 1280,
      height: 720,
      displayMode: DisplayMode.Windowed,
      signal: controller.signal,
      uninstallPluginOnExit: false,
      registerFfmpegLocation: true,
      refuseRunningGame: true,
      configFolderPath: path.join(first.folder, 'game-config'),
      nativeCommandsPath: first.xmlPath,
      onGameStart: () => {
        launched();
        progress(first.sequence.number, false);
      },
    });
    if (failure) throw failure;
    if (!finished) throw new ReviewClipError('recording-failed', 'CS2 exited before the recording session completed');
    await encodingTail;
    if (failure) throw failure;
    controller.signal.throwIfAborted();
  } catch (error) {
    throw failure ?? error;
  } finally {
    controller.abort();
    clearTimeout(watchdog!);
    signal.removeEventListener('abort', abort);
    await bridge.close();
    // The caller removes staging after this promise settles. Never leave FFmpeg writing there.
    await encodingTail;
  }
}
