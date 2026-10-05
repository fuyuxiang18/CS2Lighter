import type { AiVideoSource, VideoAiFacts } from 'csdm/common/types/ai';
import { loadDemoCaches } from 'csdm/node/demo-cache/demo-cache-service';
import { getFfmpegExecutablePath } from 'csdm/node/video/ffmpeg/ffmpeg-location';
import { resolveVideoAiMedia } from 'csdm/node/video/review-clips/resolve-video-ai-media';
import { AiServiceError } from './ai-error';
import { extractVideoAiFrame, prepareVideoFrames } from './video-ai-frames';

let preparing = false;

/** Explicit local preparation only. No credentials, provider requests or game launches. */
export async function prepareVideoAiReview(source: AiVideoSource, locale: 'zh-CN' | 'en') {
  if (preparing) throw new AiServiceError('busy');
  if (!source || !['clip', 'batch'].includes(source.kind) || !['zh-CN', 'en'].includes(locale))
    throw new AiServiceError('invalid-scope');
  preparing = true;
  try {
    const media = await resolveVideoAiMedia(source).catch(() => {
      throw new AiServiceError('video-not-ready');
    });
    const [cache] = await loadDemoCaches([media.checksum]);
    const player = cache?.metrics.find((item) => item.steamId === media.steamId);
    const round = player?.rounds.find((item) => item.roundNumber === media.roundNumber);
    if (!round) throw new AiServiceError('no-data');
    const facts: VideoAiFacts = {
      map: /^de_[a-z0-9_]{1,60}$/.test(media.mapName) ? media.mapName : 'custom-map',
      round: media.roundNumber,
      tickrate: media.tickrate,
      side: round.side,
      won: round.won,
      kills: round.kills,
      deaths: round.deaths,
      damage: round.damage,
      openingKill: round.openingKill,
      openingDeath: round.openingDeath,
      tradeKills: round.tradeKills,
      tradedDeaths: round.tradedDeaths,
      utilityThrown: round.flashesThrown + round.smokesThrown + round.heThrown + round.fireThrown + round.decoysThrown,
      utilityDamage: round.utilityDamage,
    };
    const ffmpeg = await getFfmpegExecutablePath();
    return await prepareVideoFrames(source, media, facts, locale, (file, seconds) =>
      extractVideoAiFrame(ffmpeg, file, seconds),
    );
  } finally {
    preparing = false;
  }
}
