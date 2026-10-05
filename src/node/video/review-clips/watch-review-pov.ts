import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ReviewClipRequest, ReviewPovState } from 'csdm/common/types/review-clip';
import { Game } from 'csdm/common/types/counter-strike';
import { DisplayMode } from 'csdm/common/types/display-mode';
import { getAppFolderPath } from 'csdm/node/filesystem/get-app-folder-path';
import { getCsgoFolderPathOrThrow } from 'csdm/node/counter-strike/get-csgo-folder-path';
import { getDemoChecksumFromDemoPath } from 'csdm/node/demo/get-demo-checksum-from-demo-path';
import { fetchMatchPlayersSlots } from 'csdm/node/database/match/fetch-match-players-slots';
import { startCounterStrikeWithHlae } from 'csdm/node/counter-strike/launcher/start-counter-strike-with-hlae';
import { videoQueue } from 'csdm/server/video-queue';
import { server } from 'csdm/server/server';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { ReviewClipError } from './review-clip-service';
import { resolveReviewClip } from './resolve-review-clip';
import { assertReviewGameFiles } from './assert-review-game-files';
import { buildReviewHlaeCommands } from './create-review-hlae-commands';
import { inspectReviewClipRequirements, reviewClips } from './review-clips';

let active = false;
export function isReviewPovBusy() {
  return active;
}

export async function watchReviewPov(request: ReviewClipRequest): Promise<ReviewPovState> {
  if (active || reviewClips.isBusy() || videoQueue.isBusy()) return { status: 'failed', request, issue: 'queue-busy' };
  active = true;
  let folder: string | undefined;
  try {
    const input = await resolveReviewClip(request);
    const requirements = await inspectReviewClipRequirements();
    const issue = requirements.missingReasons.find((reason) => reason !== 'ffmpeg-missing' && reason !== 'queue-busy');
    if (issue) throw new ReviewClipError(issue);
    const players = await fetchMatchPlayersSlots(request.checksum);
    const player = players.find((row) => row.steamId === request.steamId);
    if (!player) throw new ReviewClipError('invalid-request');
    await assertReviewGameFiles(await getCsgoFolderPathOrThrow(Game.CS2));
    if ((await getDemoChecksumFromDemoPath(input.demoPath)) !== request.checksum)
      throw new ReviewClipError('demo-changed');
    folder = path.join(getAppFolderPath(), 'review-pov', randomUUID());
    await fs.mkdir(folder, { recursive: true });
    const source = await fs.stat(input.demoPath);
    const disk = await fs.statfs(folder);
    if (disk.bavail * disk.bsize < source.size + 256 * 1024 * 1024) throw new ReviewClipError('insufficient-space');
    const demoPath = path.join(folder, 'source.dem');
    await fs.copyFile(input.demoPath, demoPath);
    const fresh = await fs.stat(input.demoPath);
    if (fresh.size !== source.size || fresh.mtimeMs !== source.mtimeMs) throw new ReviewClipError('demo-changed');
    const focusTick = Math.max(97, input.request.startTick - Math.round(input.tickrate));
    const commandsPath = path.join(folder, 'watch.xml');
    await fs.writeFile(
      commandsPath,
      buildReviewHlaeCommands([
        { tick: 96, cmd: 'sv_cheats 1' },
        { tick: 96, cmd: `demo_gototick ${Math.max(96, focusTick - 1)}` },
        { tick: focusTick, cmd: 'spec_mode 1' },
        { tick: focusTick, cmd: `spec_player ${player.slot}` },
        { tick: focusTick, cmd: 'spec_show_xray 0' },
      ]),
    );
    const state: ReviewPovState = { status: 'opening', request: input.request };
    if (reviewClips.isBusy() || videoQueue.isBusy()) throw new ReviewClipError('queue-busy');
    const publish = (patch: Partial<ReviewPovState>) =>
      server.sendPushMessage({ name: ServerPushMessageName.ReviewPovUpdated, payload: { ...state, ...patch } });
    const ownedFolder = folder;
    void startCounterStrikeWithHlae({
      game: Game.CS2,
      demoPath,
      nativeCommandsPath: commandsPath,
      width: 1280,
      height: 720,
      displayMode: DisplayMode.Windowed,
      refuseRunningGame: true,
      configFolderPath: path.join(folder, 'game-config'),
      registerFfmpegLocation: false,
      uninstallPluginOnExit: false,
      onGameStart: () => publish({ status: 'open' }),
    })
      .then(() => publish({ status: 'closed' }))
      .catch((error) =>
        publish({
          status: 'failed',
          issue: 'recording-failed',
          errorDetail: error instanceof Error ? error.message : String(error),
        }),
      )
      .finally(async () => {
        await fs.rm(ownedFolder, { recursive: true, force: true }).catch((error) => logger.error(error));
        active = false;
      });
    return state;
  } catch (error) {
    if (folder) await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
    active = false;
    return {
      status: 'failed',
      request,
      issue: error instanceof ReviewClipError ? error.issue : 'recording-failed',
      errorDetail: error instanceof Error ? error.message : String(error),
    };
  }
}
