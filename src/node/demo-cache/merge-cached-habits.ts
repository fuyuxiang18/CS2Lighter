import type { HabitsCohort, HabitsPositionBin, HabitsSummary } from 'csdm/common/types/habits';
import { createHabitsAccumulator } from 'csdm/node/database/habits/aggregate-habits';

export function createCachedHabitsMerger(steamId: string, mapNames: string[]) {
  const summary = createHabitsAccumulator(steamId, undefined, mapNames).summary;
  const cohorts = new Map<string, { cohort: HabitsCohort; bins: Map<string, HabitsPositionBin> }>();
  const seen = new Set<string>();
  function add(checksum: string, source: HabitsSummary) {
    if (seen.has(checksum)) return;
    seen.add(checksum);
    for (const key of [
      'matchCount',
      'roundCount',
      'matchesWithPositions',
      'positionRoundCount',
      'observedSeconds',
      'kills',
      'deaths',
      'openingKills',
      'openingDeaths',
      'evidenceTotalCount',
    ] as const)
      summary[key] += source[key];
    summary.evidence.push(...source.evidence.slice(0, Math.max(0, 100 - summary.evidence.length)));
    for (const sourceCohort of source.cohorts) {
      const key = JSON.stringify([
        sourceCohort.mapName,
        sourceCohort.buildNumber,
        sourceCohort.gameMode,
        sourceCohort.source,
      ]);
      let item = cohorts.get(key);
      if (!item) {
        const cohort = { ...sourceCohort, bins: [] };
        item = { cohort, bins: new Map() };
        cohorts.set(key, item);
        summary.cohorts.push(cohort);
      } else {
        for (const name of [
          'matchCount',
          'roundCount',
          'positionRoundCount',
          'observedSeconds',
          'openingSeconds',
          'kills',
          'deaths',
          'openingKills',
          'openingDeaths',
        ] as const)
          item.cohort[name] += sourceCohort[name];
      }
      for (const sourceBin of sourceCohort.bins) {
        const binKey = JSON.stringify([sourceBin.x, sourceBin.y, sourceBin.level ?? sourceBin.z]);
        const bin = item.bins.get(binKey);
        if (bin) {
          for (const name of ['seconds', 'openingSeconds', 'roundCount', 'openingRoundCount'] as const)
            bin[name] += sourceBin[name];
          bin.evidence.push(...sourceBin.evidence.slice(0, Math.max(0, 3 - bin.evidence.length)));
          bin.openingEvidence.push(...sourceBin.openingEvidence.slice(0, Math.max(0, 3 - bin.openingEvidence.length)));
        } else {
          const copy = {
            ...sourceBin,
            evidence: [...sourceBin.evidence],
            openingEvidence: [...sourceBin.openingEvidence],
          };
          item.bins.set(binKey, copy);
          item.cohort.bins.push(copy);
        }
      }
    }
  }
  return { add, summary };
}
