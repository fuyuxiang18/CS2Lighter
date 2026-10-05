import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ReviewBatchItem } from 'csdm/common/types/review-batch';
import { getAppFolderPath } from 'csdm/node/filesystem/get-app-folder-path';
import { getFfmpegExecutablePath } from 'csdm/node/video/ffmpeg/ffmpeg-location';
import { getDemoChecksumFromDemoPath } from 'csdm/node/demo/get-demo-checksum-from-demo-path';
import { getCsgoFolderPathOrThrow } from 'csdm/node/counter-strike/get-csgo-folder-path';
import { isCounterStrikeRunning } from 'csdm/node/counter-strike/is-counter-strike-running';
import { Game } from 'csdm/common/types/counter-strike';
import { VideoStatus } from 'csdm/common/types/video-status';
import { getSequenceOutputFilePath } from 'csdm/node/video/generation/get-sequence-output-file-path';
import { videoQueue } from 'csdm/server/video-queue';
import { server } from 'csdm/server/server';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { isUpdateMaintenance } from 'csdm/server/update-maintenance';
import { assertReviewGameFiles } from './assert-review-game-files';
import { buildReviewClipVideo, inspectReviewClipRequirements, reviewClips } from './review-clips';
import { isReviewPovBusy } from './watch-review-pov';
import { ReviewClipError } from './review-clip-service';
import { ReviewBatchService } from './review-batch-service';
import { resolveReviewBatch } from './resolve-review-batch';

const execute = promisify(execFile);
export function reviewBatchDirectory() {
  return path.join(getAppFolderPath(), 'review-batches');
}
export function isReviewBatchBusy() {
  return reviewBatches.isBusy();
}

async function duration(file: string): Promise<number> {
  const ffmpeg = await getFfmpegExecutablePath();
  const { stdout } = await execute(
    path.join(path.dirname(ffmpeg), 'ffprobe.exe'),
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file],
    { windowsHide: true, timeout: 60_000 },
  );
  const seconds = Number(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new ReviewClipError('output-missing');
  return seconds;
}

async function concatenate(files: string[], destination: string, signal: AbortSignal) {
  if (files.length === 1) {
    await fs.copyFile(files[0], destination);
    return;
  }
  const list = `${destination}.txt`;
  await fs.writeFile(
    list,
    files.map((file) => `file '${file.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`).join('\n'),
  );
  try {
    await execute(
      await getFfmpegExecutablePath(),
      [
        '-y',
        '-v',
        'error',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        list,
        '-c',
        'copy',
        '-movflags',
        '+faststart',
        destination,
      ],
      { windowsHide: true, signal, timeout: 120_000 },
    );
    await duration(destination);
  } finally {
    await fs.unlink(list).catch(() => {});
  }
}

async function editItem(
  item: ReviewBatchItem,
  groupFolder: string,
  outputFile: string,
  signal: AbortSignal,
): Promise<ReviewBatchItem> {
  const ffmpeg = await getFfmpegExecutablePath();
  const fontFile = 'C:/Windows/Fonts/msyh.ttc';
  const hasChineseFont = await fs
    .stat(fontFile)
    .then(() => true)
    .catch(() => false);
  const files: string[] = [];
  const segments = [];
  let offset = 0;
  for (const segment of item.segments) {
    const raw = getSequenceOutputFilePath(
      groupFolder,
      { number: segment.index, startTick: segment.startTick, endTick: segment.endTick } as Parameters<
        typeof getSequenceOutputFilePath
      >[1],
      'mp4',
    );
    const edited = path.join(groupFolder, `edited-${segment.index}.mp4`);
    const labelFile = path.join(groupFolder, `label-${segment.index}.txt`);
    const role =
      segment.perspective === 'player'
        ? hasChineseFont
          ? '本人 / PLAYER POV'
          : 'PLAYER POV'
        : hasChineseFont
          ? '对手 / OPPONENT POV'
          : 'OPPONENT POV';
    const sharedTime = hasChineseFont ? '同一交战时间段' : 'SAME ENGAGEMENT';
    const cut = segment.truncatedAtDeath ? (hasChineseFont ? ' · 死亡前截止' : ' · ENDS BEFORE DEATH') : '';
    await fs.writeFile(
      labelFile,
      `R${item.request.roundNumber} · ${role}\n${sharedTime}: ${(item.request.startTick / item.tickrate).toFixed(2)}s · tick ${segment.startTick}–${segment.endTick}${cut}`,
      'utf8',
    );
    const filterPath = (value: string) => value.replaceAll('\\', '/').replaceAll(':', '\\:').replaceAll("'", "\\'");
    const filter = `drawtext=${hasChineseFont ? `fontfile='${filterPath(fontFile)}':` : ''}textfile='${filterPath(labelFile)}':fontcolor=white:fontsize=22:line_spacing=7:box=1:boxcolor=black@0.68:boxborderw=10:x=24:y=h-150`;
    const temporary = `${edited}.tmp.mp4`;
    await execute(
      ffmpeg,
      [
        '-y',
        '-v',
        'error',
        '-i',
        raw,
        '-vf',
        filter,
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-ar',
        '48000',
        '-ac',
        '2',
        '-movflags',
        '+faststart',
        temporary,
      ],
      { windowsHide: true, signal, timeout: 180_000 },
    );
    const seconds = await duration(temporary);
    await fs.rename(temporary, edited);
    files.push(edited);
    segments.push({ ...segment, status: 'ready' as const, offsetSeconds: offset, durationSeconds: seconds });
    offset += seconds;
  }
  const temporaryOutput = `${outputFile}.tmp.mp4`;
  await concatenate(files, temporaryOutput, signal);
  await fs.rename(temporaryOutput, outputFile);
  return { ...item, segments, durationSeconds: await duration(outputFile) };
}

export const reviewBatches = new ReviewBatchService({
  directory: reviewBatchDirectory,
  resolve: resolveReviewBatch,
  requirements: () => inspectReviewClipRequirements(false),
  busy: () => reviewClips.isBusy() || isReviewPovBusy() || videoQueue.isBusy(),
  changed: (batch) => server.sendPushMessage({ name: ServerPushMessageName.ReviewBatchUpdated, payload: batch }),
  concatenate,
  editItem,
  async recordGroup(items, folder, signal, progress, launched) {
    const ffmpeg = await getFfmpegExecutablePath();
    const input = items[0].input;
    const id = path.basename(path.dirname(folder)) + '-' + path.basename(folder);
    const video = buildReviewClipVideo(input, id, folder, ffmpeg);
    video.sequences = items.flatMap(({ input, item }) =>
      item.segments.map((segment) => ({
        ...buildReviewClipVideo(
          {
            ...input,
            request: {
              ...input.request,
              steamId: segment.steamId,
              startTick: segment.startTick,
              endTick: segment.endTick,
            },
            playerName: segment.playerName,
          },
          id,
          folder,
          ffmpeg,
        ).sequences[0],
        number: segment.index,
      })),
    );
    video.sequences.sort((a, b) => a.startTick - b.startTick);
    const cancel = () => videoQueue.removeVideos([id]);
    signal.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(
      cancel,
      Math.max(
        180_000,
        120_000 +
          video.sequences.reduce(
            (sum, sequence) => sum + ((sequence.endTick - sequence.startTick) / input.tickrate) * 7000,
            0,
          ),
      ),
    );
    let prepared = false;
    let encoding = false;
    let lastSegment: number | undefined;
    const timer = setInterval(() => {
      if (!prepared || encoding || signal.aborted) return;
      void Promise.all(
        video.sequences.map(async (sequence) => ({
          number: sequence.number,
          exists: await fs
            .stat(path.join(folder, `${sequence.number}-sequence`, 'video.mp4'))
            .then((stat) => stat.size > 0)
            .catch(() => false),
        })),
      ).then((states) => {
        const latest = states.filter((state) => state.exists).at(-1)?.number;
        if (latest && latest !== lastSegment && !signal.aborted && !encoding) {
          lastSegment = latest;
          progress(latest, false);
        }
      });
    }, 500);
    let preparationError: unknown;
    try {
      if (signal.aborted) throw new ReviewClipError('interrupted');
      const result = await videoQueue.runSingleVideo(
        video,
        async () => {
          try {
            if (isUpdateMaintenance()) throw new ReviewClipError('update-maintenance');
            if (await isCounterStrikeRunning()) throw new ReviewClipError('game-running');
            await assertReviewGameFiles(await getCsgoFolderPathOrThrow(Game.CS2));
            const source = await fs.stat(input.demoPath).catch(() => undefined);
            if (!source?.isFile()) throw new ReviewClipError('demo-missing');
            if ((await getDemoChecksumFromDemoPath(input.demoPath)) !== input.request.checksum)
              throw new ReviewClipError('demo-changed');
            await fs.rm(folder, { recursive: true, force: true });
            await fs.mkdir(folder, { recursive: true });
            const disk = await fs.statfs(folder);
            if (disk.bavail * disk.bsize < source.size + video.sequences.length * 100 * 1024 * 1024)
              throw new ReviewClipError('insufficient-space');
            await fs.copyFile(input.demoPath, video.demoPath);
            const fresh = await fs.stat(input.demoPath);
            if (source.size !== fresh.size || source.mtimeMs !== fresh.mtimeMs)
              throw new ReviewClipError('demo-changed');
            prepared = true;
          } catch (error) {
            preparationError = error;
            throw error;
          }
        },
        (state) => {
          if (state.status === VideoStatus.Converting) {
            encoding = true;
            progress(state.currentSequence ?? video.sequences[0].number, true);
          }
        },
        launched,
      );
      if (signal.aborted) throw new ReviewClipError('interrupted');
      if (preparationError) throw preparationError;
      if (result?.status !== VideoStatus.Success)
        throw new ReviewClipError('recording-failed', result?.output ?? 'Batch recording did not finish');
    } finally {
      clearTimeout(timeout);
      clearInterval(timer);
      signal.removeEventListener('abort', cancel);
      const names = await fs.readdir(folder).catch(() => [] as string[]);
      await Promise.all(
        names
          .filter((name) => /^source\.dem(?:\..*)?$/.test(name))
          .map((name) => fs.unlink(path.join(folder, name)).catch(() => {})),
      );
    }
  },
});
