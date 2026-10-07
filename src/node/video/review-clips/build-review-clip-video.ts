import path from 'node:path';
import { Game } from 'csdm/common/types/counter-strike';
import type { AddVideoPayload } from 'csdm/common/types/video';
import type { ResolvedReviewClip } from './review-clip-service';

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
