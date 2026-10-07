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
import { isUpdateMaintenance } from 'csdm/server/update-maintenance';
import { buildReviewClipVideo } from './build-review-clip-video';
import { buildReviewHlaeCommands } from './create-review-hlae-commands';
import { buildReviewBoundaryScript, createReviewSessionBridge } from './review-session-bridge';
import { assertReviewGameFiles } from './assert-review-game-files';
import { ReviewClipError } from './review-clip-service';
import type { ResolvedBatchItem } from './resolve-review-batch';

type SessionStep = {
  item: ResolvedBatchItem;
  sequence: Sequence;
  folder: string;
  demoPath: string;
  xmlPath: string;
  lastForItem: boolean;
  video: ReturnType<typeof buildReviewClipVideo>;
};

/** A same-demo rewind and a cross-demo load both replace the native scheduler before playback resumes. */
export function nextReviewSessionCommand(
  currentDemo: string,
  next: { demoPath: string; xmlPath: string } | undefined,
): string {
  if (!next) return 'quit';
  const quote = (value: string) => {
    if (/["\r\n;]/.test(value)) throw new ReviewClipError('invalid-request');
    return `"${value.replaceAll('\\', '/')}"`;
  };
  return `mirv_cmd load ${quote(next.xmlPath)}; ${next.demoPath === currentDemo ? 'demo_gototick 0; demo_resume' : `playdemo ${quote(next.demoPath)}; demo_resume`}`;
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
      for (const item of items)
        for (const [index, segment] of item.item.segments.entries()) {
          const sequence = video.sequences.find((entry) => entry.number === segment.index)!;
          steps.push({
            item,
            sequence,
            folder: staging,
            demoPath: video.demoPath,
            xmlPath: path.join(staging, `segment-${segment.index}.xml`),
            lastForItem: index === item.item.segments.length - 1,
            video,
          });
        }
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
  let expected = 0;
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
  const bridge = await createReviewSessionBridge({
    failed: (error) => {
      failure = error;
      controller.abort();
    },
    completed: async (number) => {
      const step = steps[expected];
      if (!step || step.sequence.number !== number)
        throw new ReviewClipError('recording-failed', 'Unexpected recording boundary');
      arm();
      progress(number, true);
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
      if (step.lastForItem) await itemRecorded(step.item, step.folder, controller.signal);
      expected++;
      if ((step.lastForItem && shouldPause()) || expected === steps.length) {
        finished = true;
        return 'quit';
      }
      const next = steps[expected];
      progress(next.sequence.number, false);
      return nextReviewSessionCommand(step.demoPath, next);
    },
  });
  try {
    for (const step of steps) {
      const json: { actions: { tick: number; cmd: string }[] }[] = JSON.parse(
        await fs.readFile(`${step.demoPath}.json`, 'utf8'),
      );
      const position = step.video.sequences.findIndex((entry) => entry.number === step.sequence.number);
      const gate = path.join(step.folder, `boundary-${step.sequence.number}.js`);
      await fs.writeFile(gate, buildReviewBoundaryScript(bridge.url, step.sequence.number));
      // Decode several seconds before the requested output. A one-second seek-to-capture gap can stall
      // CS2/HLAE on a cold, late-round seek; this warm-up does not change any recorded range or death cutoff.
      const seekTick = Math.max(96, step.sequence.startTick - Math.ceil(step.item.input.tickrate * 4));
      const actions = json[position].actions
        .filter((action) => action.cmd !== 'quit' && action.cmd !== 'go_to_next_sequence')
        .map((action) =>
          /^demo_gototick \d+$/.test(action.cmd) ? { ...action, cmd: `demo_gototick ${seekTick}` } : action,
        );
      actions.push({
        tick: step.sequence.endTick + Math.max(1, Math.round(step.item.input.tickrate)),
        cmd: `demo_pause; mirv_script_load "${gate.replaceAll('\\', '/')}"`,
      });
      await fs.writeFile(step.xmlPath, buildReviewHlaeCommands(actions));
    }
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
  } catch (error) {
    throw failure ?? error;
  } finally {
    controller.abort();
    clearTimeout(watchdog!);
    signal.removeEventListener('abort', abort);
    await bridge.close();
  }
}
