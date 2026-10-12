import path from 'node:path';
import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { Game } from 'csdm/common/types/counter-strike';
import type { DeathEvidenceKey, DeathEvidenceReport, DeathEvidenceState } from 'csdm/common/types/death-evidence';
import { getDemoCacheDirectory } from 'csdm/node/demo-cache/cache-directory';
import { getDemoCacheGeneration } from 'csdm/node/demo-cache/invalidate-demo-cache';
import { getDemoChecksumFromDemoPath } from 'csdm/node/demo/get-demo-checksum-from-demo-path';
import { getCsgoFolderPathOrThrow } from 'csdm/node/counter-strike/get-csgo-folder-path';
import { getStaticFolderPath } from 'csdm/node/filesystem/get-static-folder-path';
import { assertMatchImportComplete } from 'csdm/node/database/matches/match-import-state';
import { db } from 'csdm/node/database/database';
import { server } from 'csdm/server/server';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { isUpdateMaintenance } from 'csdm/server/update-maintenance';
import { deathMatchRevision, readDeathReviewCache } from './death-review-cache';
import { listDeathMatches, isDeathMatchCurrent } from './fetch-death-match';
import { readDeathEvidenceCache, writeDeathEvidenceCache } from './death-evidence-cache';
import { DeathEvidenceService } from './death-evidence-service';
import { runDeathEvidenceProcess } from './death-evidence-process';
import type { EvidenceHeader, EvidenceFrame, EvidenceShot } from './evidence-protocol';
import { readVisibilityMapRevision, resolveVisibilityMap } from './visibility-map-provider';
import { buildSprayProviderEvidence } from './spray-provider';
import { describeSprayMotion } from './spray-motion';
import { buildGunlineEvidence, resolveGunlineEntityBounds } from './gunline-evidence';
import { createSource2ModelResourceResolver } from './source2-model-resources';

async function prepare(key: DeathEvidenceKey) {
  await assertMatchImportComplete(key.checksum);
  const match = (await listDeathMatches(key)).find((match) => match.checksum === key.checksum);
  if (!match) throw new Error('The selected match is no longer available');
  const directory = (await getDemoCacheDirectory()).path;
  const records = await readDeathReviewCache(path.join(directory, 'death-review'), match);
  const record = records?.find((record) => record.id === key.deathId && record.steamId === key.steamId);
  if (!record) throw new Error('Refresh the death review before inspecting this death');
  if (!Number.isSafeInteger(record.eventTick) || record.eventTick < 0 || record.tickrate <= 0)
    throw new Error('This death has no valid demo timing');
  const row = await db
    .selectFrom('matches')
    .select('demo_path')
    .where('checksum', '=', key.checksum)
    .executeTakeFirstOrThrow();
  const file = await stat(row.demo_path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const sourceStamp = file ? `${file.size}:${file.mtimeMs}:${file.ctimeMs}` : null;
  let csgoDirectory: string | undefined;
  try {
    csgoDirectory = path.join(await getCsgoFolderPathOrThrow(Game.CS2), 'game', 'csgo');
  } catch {
    /* Raw shot evidence remains available without a game installation. */
  }
  const mapRevision = csgoDirectory
    ? await readVisibilityMapRevision(csgoDirectory, record.mapName)
    : 'game-not-installed';
  const revision = createHash('sha256')
    .update(JSON.stringify([1, deathMatchRevision(match), sourceStamp, mapRevision]))
    .digest('hex');
  return {
    revision,
    directory,
    match,
    record,
    demoPath: row.demo_path,
    sourceStamp,
    csgoDirectory,
    mapRevision,
    generation: getDemoCacheGeneration(key.checksum),
  };
}
type Context = Awaited<ReturnType<typeof prepare>>;
type Progress = Pick<DeathEvidenceState, 'phase' | 'completedTicks' | 'totalTicks'>;

async function current(key: DeathEvidenceKey, context: Context) {
  if (context.sourceStamp === null) return false;
  if (getDemoCacheGeneration(key.checksum) !== context.generation || !(await isDeathMatchCurrent(context.match)))
    return false;
  const file = await stat(context.demoPath);
  if (`${file.size}:${file.mtimeMs}:${file.ctimeMs}` !== context.sourceStamp) return false;
  return (
    !context.csgoDirectory ||
    (await readVisibilityMapRevision(context.csgoDirectory, context.record.mapName)) === context.mapRevision
  );
}

async function build(
  key: DeathEvidenceKey,
  context: Context,
  signal: AbortSignal,
  progress: (value: Progress) => void,
): Promise<DeathEvidenceReport> {
  signal.throwIfAborted();
  if (context.sourceStamp === null)
    throw new Error('The original demo file is missing. Restore it before extracting new evidence.');
  if ((await getDemoChecksumFromDemoPath(context.demoPath)) !== key.checksum)
    throw new Error('The original demo has changed');
  const checksum = key.checksum;
  const [rounds, shots, damages, kills, blinds] = await Promise.all([
    db.selectFrom('rounds').selectAll().where('match_checksum', '=', checksum).execute(),
    db.selectFrom('shots').selectAll().where('match_checksum', '=', checksum).execute(),
    db.selectFrom('damages').selectAll().where('match_checksum', '=', checksum).execute(),
    db.selectFrom('kills').selectAll().where('match_checksum', '=', checksum).execute(),
    db.selectFrom('player_blinds').selectAll().where('match_checksum', '=', checksum).execute(),
  ]);
  signal.throwIfAborted();
  const { record } = context;
  const round = rounds.find((round) => round.number === record.roundNumber);
  if (!round) throw new Error('The selected round is no longer available');
  const startTick = Math.max(round.start_tick, record.eventTick - Math.ceil(record.tickrate * 7), 0);
  const endTick = record.eventTick;
  const totalTicks = endTick - startTick + 1;
  let header: EvidenceHeader | undefined;
  const frames: EvidenceFrame[] = [];
  const rawShots: EvidenceShot[] = [];
  progress({ phase: 'decode', completedTicks: 0, totalTicks });
  const end = await runDeathEvidenceProcess({
    executable: path.join(getStaticFolderPath(), 'death-evidence', 'death-evidence.exe'),
    request: { version: 1, demoPath: context.demoPath, windows: [{ startTick, endTick }] },
    signal,
    onMessage: (message) => {
      if (message.type === 'header') header = message;
      else if (message.type === 'frame') frames.push(message);
      else if (message.type === 'shot') rawShots.push(message);
      else if (message.type === 'progress')
        progress({ phase: 'decode', completedTicks: message.emittedTicks, totalTicks });
    },
  });
  if (!header || header.mapName !== record.mapName || Math.abs(header.tickRate - record.tickrate) > 0.001)
    throw new Error('Demo evidence does not match the selected map and tick rate');
  signal.throwIfAborted();
  progress({ phase: 'map', completedTicks: end.emittedTicks, totalTicks });
  const map =
    context.csgoDirectory && header.patch !== null
      ? await resolveVisibilityMap({
          csgoDirectory: context.csgoDirectory,
          mapName: record.mapName,
          demoPatch: header.patch,
          cacheDirectory: path.join(context.directory, 'visibility-maps'),
          vrfExecutable: path.join(getStaticFolderPath(), 'visibility', 'Source2Viewer-CLI.exe'),
          worker: {
            executable: process.execPath,
            args: [path.join(__dirname, 'visibility-mesh-worker.js')],
            runAsNode: true,
          },
          signal,
        })
      : { status: 'unavailable' as const, reason: context.csgoDirectory ? 'map-version' : 'game-not-installed' };
  signal.throwIfAborted();
  progress({ phase: 'evaluate', completedTicks: end.emittedTicks, totalTicks });
  const modelResolver =
    map.status === 'ready' && context.csgoDirectory
      ? createSource2ModelResourceResolver({
          vrfExecutablePath: path.join(getStaticFolderPath(), 'visibility', 'Source2Viewer-CLI.exe'),
          vpkPaths: [
            path.join(context.csgoDirectory, 'pak01_dir.vpk'),
            path.join(context.csgoDirectory, 'maps', `${record.mapName}.vpk`),
          ],
          cacheDirectory: path.join(context.directory, 'visibility-models', map.manifest.sourceFingerprint),
          sourceRevision: map.manifest.sourceFingerprint,
          signal,
        })
      : null;
  const gunline =
    map.status === 'ready' && modelResolver
      ? await buildGunlineEvidence({
          frames,
          end,
          tickrate: record.tickrate,
          targetSteamId: key.steamId,
          map,
          signal,
          resolveEntityBounds: async (entity) => {
            const handles = [
              ...new Set(
                Object.entries(entity.fields)
                  .filter(([name, field]) => name.endsWith('.m_modelState.m_hModel') && field.present)
                  .map(([, field]) => field.value)
                  .filter((value): value is string => typeof value === 'string' && /^\d{1,20}$/.test(value)),
              ),
            ];
            if (handles.length !== 1) return { status: 'unavailable', reasons: ['model-handle-unverified'] };
            const model = await modelResolver.resolveModel(handles[0], {
              includePhysicsBounds: entity.className === 'CFuncWater',
            });
            return resolveGunlineEntityBounds(entity, model);
          },
        })
      : {
          basis: 'environment-eye-reference' as const,
          status: 'unavailable' as const,
          reasons: map.status === 'unavailable' ? [map.reason] : ['model-resolver-unavailable'],
          gunlines: [],
          exposures: [],
        };
  signal.throwIfAborted();
  const spray = await buildSprayProviderEvidence({
    header,
    frames,
    shots: rawShots,
    end,
    match: {
      checksum,
      steamId: key.steamId,
      tickrate: record.tickrate,
      rounds,
      shots,
      damages,
      kills,
      blinds,
      shotsComplete: shots.length === context.match.shotCount,
    },
    ...(header.patch === 14190 ? { maximumUnlagSeconds: 1 } : {}),
  });
  const points = spray.rawTrajectory
    .filter((point) => point.identityVerified && point.steamId === key.steamId && point.direction)
    .map((point) => {
      const target = spray.evidence.points.find((item) => item.shotId === point.id)?.target;
      return {
        id: point.id,
        tick: point.tick,
        pitch: point.direction!.pitch,
        yaw: point.direction!.yaw,
        recoilIndex: point.recoilIndex,
        itemDefinitionIndex: point.itemDefinitionIndex,
        burstId: spray.evidence.segments.find((segment) => segment.shotIds.includes(point.id))?.id ?? null,
        target: target
          ? {
              steamId: target.targetSteamId,
              relativePitch: target.relativePitch,
              relativeYaw: target.relativeYaw,
              bodyPitchMin: target.bodyPitch.min,
              bodyPitchMax: target.bodyPitch.max,
              bodyYawMin: target.bodyYawOffset.min,
              bodyYawMax: target.bodyYawOffset.max,
            }
          : null,
      };
    });
  const ownRawShots = rawShots.filter((shot) => shot.steamId === key.steamId);
  const shotReasons: string[] = [];
  if (end.missingTicks.length > 0) shotReasons.push('extraction-incomplete');
  if (ownRawShots.length !== points.length || rawShots.some((shot) => shot.steamId === null))
    shotReasons.push('shot-identity-incomplete');
  if (points.length === 0) shotReasons.push('no-shots-in-window');
  else if (!spray.evidence.segments.some((segment) => segment.shotIds.length >= 8))
    shotReasons.push('no-continuous-burst');
  return {
    checksum: key.checksum,
    steamId: key.steamId,
    deathId: key.deathId,
    version: 1,
    matchRevision: deathMatchRevision(context.match),
    generatedAt: new Date().toISOString(),
    startTick,
    endTick,
    deathTick: record.eventTick,
    tickrate: record.tickrate,
    coverage: {
      requestedTicks: totalTicks,
      decodedTicks: end.emittedTicks,
      missingTicks: end.missingTicks.length,
      shots: points.length,
    },
    geometry: {
      status: map.status === 'ready' ? 'available' : 'unavailable',
      mapName: record.mapName,
      match: map.status === 'ready' ? map.manifest.matchType : 'unverified',
      reasons: map.status === 'ready' ? [] : [map.reason],
    },
    exposures: gunline.exposures,
    gunlines: gunline.gunlines,
    gunlineAnalysis: { basis: gunline.basis, status: gunline.status, reasons: gunline.reasons },
    spray: {
      status:
        end.missingTicks.length === 0 &&
        ownRawShots.length === points.length &&
        !rawShots.some((shot) => shot.steamId === null)
          ? 'evaluated'
          : points.length > 0
            ? 'partial'
            : 'blocked',
      reasons: shotReasons,
      points,
      findings: spray.evidence.segments.flatMap((segment) => segment.diagnoses),
      motion: describeSprayMotion(spray.rawTrajectory, spray.evidence.segments),
    },
  };
}

export const deathEvidence = new DeathEvidenceService({
  prepare,
  read: (key, context) =>
    readDeathEvidenceCache(
      path.join(context.directory, 'death-evidence'),
      key,
      context.revision,
      context.sourceStamp === null ? deathMatchRevision(context.match) : undefined,
    ),
  build,
  current,
  write: (context, report, signal) =>
    writeDeathEvidenceCache(
      path.join(context.directory, 'death-evidence'),
      context.revision,
      report,
      signal,
      context.generation,
    ),
  canStart: () => !isUpdateMaintenance(),
  changed: (state) => server.sendPushMessage({ name: ServerPushMessageName.DeathEvidenceUpdated, payload: state }),
});
