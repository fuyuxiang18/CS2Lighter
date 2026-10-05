import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getAppFolderPath } from 'csdm/node/filesystem/get-app-folder-path';
import { Game } from 'csdm/common/types/counter-strike';
import type { AddVideoPayload } from 'csdm/common/types/video';
import { VideoStatus } from 'csdm/common/types/video-status';
import type { ReviewClipIssue, ReviewClipRequirements } from 'csdm/common/types/review-clip';
import { getCounterStrikeExecutablePath } from 'csdm/node/counter-strike/get-counter-strike-executable-path';
import { isCounterStrikeRunning } from 'csdm/node/counter-strike/is-counter-strike-running';
import { isSteamRunning } from 'csdm/node/counter-strike/is-steam-running';
import { isWindows } from 'csdm/node/os/is-windows';
import { getFfmpegExecutablePath } from 'csdm/node/video/ffmpeg/ffmpeg-location';
import { isFfmpegInstalled } from 'csdm/node/video/ffmpeg/is-ffmpeg-installed';
import { isHlaeInstalled } from 'csdm/node/video/hlae/is-hlae-installed';
import { getHlaeFolderPath } from 'csdm/node/video/hlae/hlae-location';
import { getDemoChecksumFromDemoPath } from 'csdm/node/demo/get-demo-checksum-from-demo-path';
import { videoQueue } from 'csdm/server/video-queue';
import { server } from 'csdm/server/server';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { isUpdateMaintenance } from 'csdm/server/update-maintenance';
import { getSequenceOutputFilePath } from 'csdm/node/video/generation/get-sequence-output-file-path';
import { ReviewClipError, ReviewClipService, type ResolvedReviewClip } from './review-clip-service';
import { resolveReviewClip } from './resolve-review-clip';
import { assertReviewGameFiles } from './assert-review-game-files';
import { getCsgoFolderPathOrThrow } from 'csdm/node/counter-strike/get-csgo-folder-path';
import { isReviewPovBusy } from './watch-review-pov';
import { isReviewBatchBusy } from './review-batches';

const execute = promisify(execFile);
function directory() {
  return path.join(getAppFolderPath(), 'review-clips');
}

export async function inspectReviewClipRequirements(includeBatchBusy = true): Promise<ReviewClipRequirements> {
  const [cs2Installed, hlaeInstalled, ffmpegInstalled, steamRunning, gameRunning] = await Promise.all([
    getCounterStrikeExecutablePath(Game.CS2)
      .then(() => true)
      .catch(() => false),
    isHlaeInstalled().then(
      async (installed) =>
        installed &&
        fs
          .stat(
            path.join(await getHlaeFolderPath(), 'resources', 'AfxHookSource2', 'snippets', 'mirv_script_spec_lock.js'),
          )
          .then((stat) => stat.isFile())
          .catch(() => false),
    ),
    isFfmpegInstalled(),
    isSteamRunning(),
    isCounterStrikeRunning(),
  ]);
  const queueBusy = videoQueue.isBusy() || isReviewPovBusy() || (includeBatchBusy && isReviewBatchBusy());
  const missingReasons: ReviewClipIssue[] = [];
  if (!isWindows) missingReasons.push('unsupported-platform');
  if (!cs2Installed) missingReasons.push('cs2-missing');
  if (!hlaeInstalled) missingReasons.push('hlae-missing');
  if (!ffmpegInstalled) missingReasons.push('ffmpeg-missing');
  if (!steamRunning) missingReasons.push('steam-not-running');
  if (gameRunning) missingReasons.push('game-running');
  if (queueBusy) missingReasons.push('queue-busy');
  if (cs2Installed) {
    await assertReviewGameFiles(await getCsgoFolderPathOrThrow(Game.CS2)).catch(() =>
      missingReasons.push('game-files-conflict'),
    );
  }
  if (/[^\x20-\x7E]/.test(directory()) || /["\r\n]/.test(directory())) missingReasons.push('incompatible-path');
  if (isUpdateMaintenance()) missingReasons.push('update-maintenance');
  return {
    supportedPlatform: isWindows,
    cs2Installed,
    hlaeInstalled,
    ffmpegInstalled,
    steamRunning,
    gameRunning,
    queueBusy,
    missingReasons,
  };
}

export function buildReviewClipVideo(
  input: ResolvedReviewClip,
  id: string,
  outputFolderPath: string,
  ffmpegPath: string,
): AddVideoPayload {
  const { request, tickrate } = input;
  return {
    id,
    checksum: request.checksum,
    demoPath: path.join(outputFolderPath, 'source.dem'),
    game: Game.CS2,
    mapName: input.mapName,
    tickrate,
    recordingSystem: 'HLAE',
    recordingOutput: 'video',
    encoderSoftware: 'FFmpeg',
    framerate: 30,
    width: 1280,
    height: 720,
    closeGameAfterRecording: true,
    concatenateSequences: false,
    outputFileName: 'clip',
    outputFolderPath,
    trueView: false,
    safeReviewRecording: true,
    ffmpegSettings: {
      audioBitrate: 128,
      constantRateFactor: 23,
      customLocationEnabled: true,
      customExecutableLocation: ffmpegPath,
      videoContainer: 'mp4',
      videoCodec: 'libx264',
      audioCodec: 'aac',
      inputParameters: '',
      outputParameters: '',
    },
    sequences: [
      {
        number: 1,
        startTick: request.startTick,
        endTick: request.endTick,
        showXRay: false,
        showAssists: true,
        showOnlyDeathNotices: false,
        playersOptions: [],
        cameras: [],
        playerVoicesEnabled: false,
        recordAudio: true,
        deathNoticesDuration: 5,
        playerCameras: [
          {
            tick: Math.max(1, request.startTick - Math.round(tickrate)),
            playerSteamId: request.steamId,
            playerName: input.playerName,
          },
        ],
      },
    ],
  };
}

export const reviewClips = new ReviewClipService({
  directory,
  resolve: resolveReviewClip,
  requirements: inspectReviewClipRequirements,
  changed: (clip) => server.sendPushMessage({ name: ServerPushMessageName.ReviewClipUpdated, payload: clip }),
  async record(input, id, folder, signal, update) {
    const ffmpegPath = await getFfmpegExecutablePath();
    const video = buildReviewClipVideo(input, id, folder, ffmpegPath);
    let preparationError: unknown;
    const cancel = () => videoQueue.removeVideos([id]);
    signal.addEventListener('abort', cancel, { once: true });
    // A broken game/plugin must not keep the recording queue busy indefinitely.
    const timeout = setTimeout(cancel, 10 * 60_000);
    let recordingReported = false;
    let captureMayStart = false;
    let encoding = false;
    const recordingProgress = setInterval(() => {
      void fs
        .stat(path.join(folder, '1-sequence', 'video.mp4'))
        .then((stat) => {
          if (captureMayStart && stat.size > 0 && !recordingReported && !encoding && !signal.aborted) {
            recordingReported = true;
            update('recording');
          }
        })
        .catch(() => {});
    }, 500);
    try {
      if (signal.aborted) throw new ReviewClipError('interrupted');
      const result = await videoQueue.runSingleVideo(
        video,
        async () => {
          try {
            update('preparing');
            if (isReviewPovBusy()) throw new ReviewClipError('queue-busy');
            if (isUpdateMaintenance()) throw new ReviewClipError('update-maintenance');
            if (await isCounterStrikeRunning()) throw new ReviewClipError('game-running');
            await assertReviewGameFiles(await getCsgoFolderPathOrThrow(Game.CS2));
            const source = await fs.stat(input.demoPath).catch(() => undefined);
            if (!source?.isFile()) throw new ReviewClipError('demo-missing');
            if ((await getDemoChecksumFromDemoPath(input.demoPath)) !== input.request.checksum)
              throw new ReviewClipError('demo-changed');
            await fs.mkdir(folder, { recursive: true });
            await fs.rm(path.join(folder, '1-sequence'), { recursive: true, force: true });
            const disk = await fs.statfs(folder);
            if (disk.bavail * disk.bsize < source.size + 512 * 1024 * 1024)
              throw new ReviewClipError('insufficient-space');
            // The existing recording engine writes an action JSON next to its input. Always use a copy.
            await fs.copyFile(input.demoPath, video.demoPath);
            const fresh = await fs.stat(input.demoPath);
            if (fresh.size !== source.size || fresh.mtimeMs !== source.mtimeMs)
              throw new ReviewClipError('demo-changed');
            captureMayStart = true;
          } catch (error) {
            preparationError = error;
            throw error;
          }
        },
        (state) => {
          if (
            state.status === VideoStatus.Converting ||
            state.status === VideoStatus.MovingFiles ||
            state.status === VideoStatus.Concatenating
          ) {
            encoding = true;
            update('encoding');
          }
        },
      );
      if (signal.aborted) throw new ReviewClipError('interrupted');
      if (preparationError) throw preparationError;
      if (result?.status !== VideoStatus.Success)
        throw new ReviewClipError('recording-failed', result?.output || 'Recording was canceled or timed out');
      const output = getSequenceOutputFilePath(folder, video.sequences[0], 'mp4');
      update('encoding');
      // Verify that the real recording has at least one decodable video frame before declaring it ready.
      await execute(ffmpegPath, ['-v', 'error', '-i', output, '-frames:v', '1', '-f', 'null', '-'], {
        windowsHide: true,
        timeout: 60_000,
        signal,
      });
      return output;
    } finally {
      clearTimeout(timeout);
      clearInterval(recordingProgress);
      signal.removeEventListener('abort', cancel);
      await Promise.all(
        [video.demoPath, `${video.demoPath}.json`, `${video.demoPath}.xml`].map((file) =>
          fs.unlink(file).catch(() => {}),
        ),
      );
    }
  },
});
