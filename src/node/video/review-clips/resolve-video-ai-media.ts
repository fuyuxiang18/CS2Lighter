import fs from 'node:fs/promises';
import path from 'node:path';
import type { AiVideoSource, ResolvedVideoAiMedia } from 'csdm/common/types/ai';
import { db } from 'csdm/node/database/database';
import { getAppFolderPath } from 'csdm/node/filesystem/get-app-folder-path';
import { ReviewClipError } from './review-clip-service';
import { reviewClips } from './review-clips';
import { reviewBatches, reviewBatchDirectory } from './review-batches';
import { resolveReviewClip } from './resolve-review-clip';
import { aliveEndTick } from './resolve-review-batch';

// Resolve only controlled, completed local media. This function never schedules recording or launches CS2.
export async function resolveVideoAiMedia(source: AiVideoSource): Promise<ResolvedVideoAiMedia> {
  const segments: ResolvedVideoAiMedia['segments'] = [];
  let metadata;
  let revision: string;
  let eventTick: number | undefined;
  let inputs: {
    perspective: 'player' | 'opponent';
    steamId: string;
    filePath: string;
    startTick: number;
    endTick: number;
    offsetSeconds: number;
    durationSeconds: number;
  }[];
  if (source.kind === 'clip') {
    metadata = await resolveReviewClip(source.request);
    const { clip } = await reviewClips.inspect(source.request);
    if (clip.status !== 'ready') throw new ReviewClipError('output-missing');
    revision = `${clip.id}:${clip.updatedAt}`;
    inputs = [
      {
        perspective: 'player',
        steamId: metadata.request.steamId,
        filePath: path.join(getAppFolderPath(), 'review-clips', clip.id, 'clip.mp4'),
        startTick: metadata.request.startTick,
        endTick: metadata.request.endTick,
        offsetSeconds: 0,
        durationSeconds: (metadata.request.endTick - metadata.request.startTick) / metadata.tickrate,
      },
    ];
  } else if (source.kind === 'batch' && Number.isSafeInteger(source.itemIndex)) {
    const batch = await reviewBatches.get(source.id);
    const item = batch?.items.find((entry) => entry.index === source.itemIndex);
    if (!batch || !item || item.status !== 'ready') throw new ReviewClipError('output-missing');
    metadata = await resolveReviewClip(item.request);
    eventTick = item.eventTick;
    revision = `${batch.id}:${batch.updatedAt}:${item.index}`;
    inputs = item.segments.map((segment) => ({
      perspective: segment.perspective,
      steamId: segment.steamId,
      filePath: path.join(reviewBatchDirectory(), batch.id, `event-${item.index}.mp4`),
      startTick: segment.startTick,
      endTick: segment.endTick,
      offsetSeconds: segment.offsetSeconds ?? NaN,
      durationSeconds: segment.durationSeconds ?? NaN,
    }));
  } else throw new ReviewClipError('invalid-request');
  const deaths = await db
    .selectFrom('kills')
    .select(['victim_steam_id', 'killer_steam_id', 'killer_side', 'victim_side', 'tick'])
    .where('match_checksum', '=', metadata.request.checksum)
    .where('round_number', '=', metadata.request.roundNumber)
    .orderBy('tick', 'asc')
    .execute();
  if (eventTick === undefined) {
    eventTick = deaths.find(
      (kill) =>
        kill.tick >= metadata.request.startTick &&
        kill.tick <= metadata.request.endTick &&
        [2, 3].includes(kill.killer_side) &&
        [2, 3].includes(kill.victim_side) &&
        kill.killer_side !== kill.victim_side &&
        (kill.killer_steam_id === metadata.request.steamId || kill.victim_steam_id === metadata.request.steamId),
    )?.tick;
    if (eventTick === undefined)
      eventTick = (
        await db
          .selectFrom('damages')
          .select('tick')
          .where('match_checksum', '=', metadata.request.checksum)
          .where('round_number', '=', metadata.request.roundNumber)
          .where('tick', '>=', metadata.request.startTick)
          .where('tick', '<=', metadata.request.endTick)
          .where('attacker_side', 'in', [2, 3])
          .where('victim_side', 'in', [2, 3])
          .whereRef('attacker_side', '!=', 'victim_side')
          .where((eb) =>
            eb.or([
              eb('attacker_steam_id', '=', metadata.request.steamId),
              eb('victim_steam_id', '=', metadata.request.steamId),
            ]),
          )
          .orderBy('tick', 'asc')
          .executeTakeFirst()
      )?.tick;
  }
  for (const input of inputs) {
    const endTick = aliveEndTick(
      input.startTick,
      input.endTick,
      deaths.find((death) => death.victim_steam_id === input.steamId)?.tick,
    );
    if (
      endTick === undefined ||
      input.startTick < metadata.request.startTick ||
      input.endTick > metadata.request.endTick ||
      !Number.isFinite(input.offsetSeconds) ||
      input.offsetSeconds < 0 ||
      !Number.isFinite(input.durationSeconds) ||
      input.durationSeconds <= 0
    )
      throw new ReviewClipError('invalid-request', 'No trustworthy living-player video interval');
    const stat = await fs.stat(input.filePath).catch(() => undefined);
    if (!stat?.isFile() || stat.size === 0) throw new ReviewClipError('output-missing');
    segments.push({
      perspective: input.perspective,
      filePath: input.filePath,
      startTick: input.startTick,
      endTick,
      offsetSeconds: input.offsetSeconds,
      durationSeconds: Math.min(input.durationSeconds, (endTick - input.startTick) / metadata.tickrate),
    });
  }
  if (!segments.length) throw new ReviewClipError('output-missing');
  return {
    revision,
    checksum: metadata.request.checksum,
    roundNumber: metadata.request.roundNumber,
    steamId: metadata.request.steamId,
    mapName: metadata.mapName,
    tickrate: metadata.tickrate,
    eventTick,
    segments,
  };
}
