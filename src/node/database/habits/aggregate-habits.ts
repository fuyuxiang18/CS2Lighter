import { TeamNumber, type DemoSource } from 'csdm/common/types/counter-strike';
import type { HabitsCohort, HabitsEvidence, HabitsPositionBin, HabitsSummary } from 'csdm/common/types/habits';
import type { Kill } from 'csdm/common/types/kill';

export type HabitsPositionSample = {
  roundNumber: number;
  tick: number;
  side: TeamNumber;
  isAlive: boolean;
  x: number;
  y: number;
  z: number;
};

export type HabitsMatchInput = {
  checksum: string;
  date: string;
  mapName: string;
  buildNumber: number;
  gameMode: string;
  source: DemoSource;
  floorThresholdZ?: number;
  singleLevelMap?: boolean;
  tickrate: number;
  rounds: { number: number; freezeEndTick: number; endTick: number; side: TeamNumber }[];
  positions: HabitsPositionSample[];
  kills: Pick<
    Kill,
    | 'tick'
    | 'roundNumber'
    | 'killerSteamId'
    | 'victimSteamId'
    | 'killerSide'
    | 'victimSide'
    | 'killerX'
    | 'killerY'
    | 'killerZ'
    | 'victimX'
    | 'victimY'
    | 'victimZ'
  >[];
};

const gridSize = 256;
const openingWindowSeconds = 20;
const maximumPositionGapSeconds = 2;
const evidenceLimit = 100;

function isPlayingSide(side: TeamNumber) {
  return side === TeamNumber.T || side === TeamNumber.CT;
}

function isPositionValid(position: { x: number; y: number; z: number }) {
  return Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z);
}

function binKey(position: { x: number; y: number; z: number }) {
  return `${Math.floor(position.x / gridSize)},${Math.floor(position.y / gridSize)},${Math.floor(position.z / gridSize)}`;
}

export function createHabitsAccumulator(steamId: string, side: TeamNumber | undefined, mapNames: string[]) {
  const summary: HabitsSummary = {
    steamId,
    mapNames,
    matchCount: 0,
    roundCount: 0,
    matchesWithPositions: 0,
    positionRoundCount: 0,
    observedSeconds: 0,
    kills: 0,
    deaths: 0,
    openingKills: 0,
    openingDeaths: 0,
    cohorts: [],
    evidence: [],
    evidenceTotalCount: 0,
    gridSize,
    openingWindowSeconds,
    maximumPositionGapSeconds,
  };
  const cohorts = new Map<string, { cohort: HabitsCohort; bins: Map<string, HabitsPositionBin> }>();
  const seenMatches = new Set<string>();

  function addMatch(match: HabitsMatchInput) {
    if (seenMatches.has(match.checksum)) {
      return;
    }
    seenMatches.add(match.checksum);
    const rounds = new Map(
      match.rounds
        .filter((round) => Number.isInteger(round.number) && round.number > 0)
        .filter((round) => isPlayingSide(round.side) && (side === undefined || round.side === side))
        .filter((round) => round.endTick > round.freezeEndTick && round.freezeEndTick >= 0)
        .map((round) => [round.number, round]),
    );
    if (rounds.size === 0) {
      return;
    }
    summary.matchCount++;
    summary.roundCount += rounds.size;
    const key = JSON.stringify([match.mapName, match.buildNumber, match.gameMode, match.source]);
    let item = cohorts.get(key);
    if (!item) {
      const cohort: HabitsCohort = {
        mapName: match.mapName,
        buildNumber: match.buildNumber,
        gameMode: match.gameMode,
        source: match.source,
        matchCount: 0,
        roundCount: 0,
        positionRoundCount: 0,
        observedSeconds: 0,
        openingSeconds: 0,
        kills: 0,
        deaths: 0,
        openingKills: 0,
        openingDeaths: 0,
        bins: [],
      };
      item = { cohort, bins: new Map() };
      cohorts.set(key, item);
      summary.cohorts.push(cohort);
    }
    const { cohort, bins } = item;
    cohort.matchCount++;
    cohort.roundCount += rounds.size;

    function evidence(kind: HabitsEvidence['kind'], tick: number, roundNumber: number, position: HabitsPositionSample) {
      return {
        checksum: match.checksum,
        date: match.date,
        mapName: match.mapName,
        roundNumber,
        tick,
        side: position.side,
        kind,
        x: position.x,
        y: position.y,
        z: position.z,
      };
    }

    const positionRounds = new Set<number>();
    const visitedBins = new Map<string, Set<number>>();
    const openingVisits = new Map<string, Set<number>>();
    const deathTicks = new Map<number, number>();
    for (const kill of match.kills) {
      if (kill.victimSteamId === steamId) {
        deathTicks.set(kill.roundNumber, Math.min(deathTicks.get(kill.roundNumber) ?? Infinity, kill.tick));
      }
    }
    // Raw samples only. Do not use the viewer's fillMissingTicks, which manufactures observations.
    const positions = match.positions.toSorted((a, b) => a.roundNumber - b.roundNumber || a.tick - b.tick);
    if (Number.isFinite(match.tickrate) && match.tickrate > 0) {
      for (let index = 0; index < positions.length - 1; index++) {
        const current = positions[index];
        const next = positions[index + 1];
        const round = rounds.get(current.roundNumber);
        if (
          !round ||
          current.roundNumber !== next.roundNumber ||
          current.side !== round.side ||
          next.side !== current.side ||
          !current.isAlive ||
          !isPositionValid(current) ||
          !isPositionValid(next)
        ) {
          continue;
        }
        const gap = (next.tick - current.tick) / match.tickrate;
        if (gap <= 0 || gap > maximumPositionGapSeconds) {
          continue;
        }
        const start = Math.max(current.tick, round.freezeEndTick);
        const deathTick = deathTicks.get(current.roundNumber);
        const end = Math.min(
          next.tick,
          round.endTick,
          deathTick !== undefined && deathTick >= current.tick ? deathTick : Infinity,
        );
        if (end <= start) {
          continue;
        }
        const seconds = (end - start) / match.tickrate;
        const openingEnd = Math.min(end, round.freezeEndTick + openingWindowSeconds * match.tickrate);
        const openingSeconds = Math.max(0, openingEnd - start) / match.tickrate;
        const level = match.singleLevelMap
          ? 'upper'
          : typeof match.floorThresholdZ === 'number' && Number.isFinite(match.floorThresholdZ)
            ? current.z < match.floorThresholdZ
              ? 'lower'
              : 'upper'
            : null;
        // Once radar levels are known, one 2D cell must have one time total: slopes and jumps
        // within a level must not produce overlapping rectangles or duplicate visit counts.
        const positionKey =
          level === null
            ? binKey(current)
            : `${Math.floor(current.x / gridSize)},${Math.floor(current.y / gridSize)},${level}`;
        let bin = bins.get(positionKey);
        if (!bin) {
          bin = {
            x: (Math.floor(current.x / gridSize) + 0.5) * gridSize,
            y: (Math.floor(current.y / gridSize) + 0.5) * gridSize,
            z: (Math.floor(current.z / gridSize) + 0.5) * gridSize,
            seconds: 0,
            openingSeconds: 0,
            roundCount: 0,
            openingRoundCount: 0,
            level,
            evidence: [],
            openingEvidence: [],
          };
          bins.set(positionKey, bin);
          cohort.bins.push(bin);
        }
        let visitedRounds = visitedBins.get(positionKey);
        if (!visitedRounds) {
          visitedRounds = new Set();
          visitedBins.set(positionKey, visitedRounds);
        }
        if (!visitedRounds.has(current.roundNumber)) {
          visitedRounds.add(current.roundNumber);
          bin.roundCount++;
          if (bin.evidence.length < 3) {
            bin.evidence.push(
              evidence(openingSeconds > 0 ? 'opening' : 'position', start, current.roundNumber, current),
            );
          }
        }
        if (openingSeconds > 0) {
          let rounds = openingVisits.get(positionKey);
          if (!rounds) {
            rounds = new Set();
            openingVisits.set(positionKey, rounds);
          }
          if (!rounds.has(current.roundNumber)) {
            rounds.add(current.roundNumber);
            bin.openingRoundCount++;
            if (bin.openingEvidence.length < 3) {
              bin.openingEvidence.push(evidence('opening', start, current.roundNumber, current));
            }
          }
        }
        bin.seconds += seconds;
        bin.openingSeconds += openingSeconds;
        cohort.observedSeconds += seconds;
        cohort.openingSeconds += openingSeconds;
        summary.observedSeconds += seconds;
        positionRounds.add(current.roundNumber);
      }
    }
    cohort.positionRoundCount += positionRounds.size;
    summary.positionRoundCount += positionRounds.size;
    if (positionRounds.size > 0) {
      summary.matchesWithPositions++;
    }

    const firstKills = new Set<number>();
    for (const kill of match.kills.toSorted((a, b) => a.tick - b.tick)) {
      const round = rounds.get(kill.roundNumber);
      if (!round || kill.tick < round.freezeEndTick || kill.tick > round.endTick || !isPlayingSide(kill.victimSide)) {
        continue;
      }
      const isOpponentKill =
        isPlayingSide(kill.killerSide) &&
        kill.killerSide !== kill.victimSide &&
        kill.killerSteamId !== kill.victimSteamId;
      const isOpening = isOpponentKill && !firstKills.has(kill.roundNumber);
      if (isOpponentKill) {
        firstKills.add(kill.roundNumber);
      }
      const isKill = isOpponentKill && kill.killerSteamId === steamId;
      const isDeath = kill.victimSteamId === steamId;
      if (!isKill && !isDeath) {
        continue;
      }
      const playerSide = isKill ? kill.killerSide : kill.victimSide;
      if (playerSide !== round.side) {
        continue;
      }
      const stat = isKill ? 'kills' : 'deaths';
      summary[stat]++;
      cohort[stat]++;
      if (isOpening) {
        const openingStat = isKill ? 'openingKills' : 'openingDeaths';
        summary[openingStat]++;
        cohort[openingStat]++;
      }
      summary.evidenceTotalCount++;
      if (summary.evidence.length < evidenceLimit) {
        summary.evidence.push(
          evidence(isKill ? 'kill' : 'death', kill.tick, kill.roundNumber, {
            tick: kill.tick,
            roundNumber: kill.roundNumber,
            side: playerSide,
            isAlive: isKill,
            x: isKill ? kill.killerX : kill.victimX,
            y: isKill ? kill.killerY : kill.victimY,
            z: isKill ? kill.killerZ : kill.victimZ,
          }),
        );
      }
    }
  }

  return { addMatch, summary };
}
