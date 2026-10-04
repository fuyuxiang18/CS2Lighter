import React, { useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { HabitsCohort, HabitsSummary } from 'csdm/common/types/habits';
import { useGetDemoSourceName } from 'csdm/ui/demos/use-demo-sources';
import { Select } from 'csdm/ui/components/inputs/select';
import { GameMode } from 'csdm/common/types/counter-strike';
import { useGetGameModeTranslation } from 'csdm/ui/hooks/use-get-game-mode-translation';
import { HabitsPanel } from './habits-layout';
import { HabitsMap } from './habits-map';
import { HabitsEvidenceList } from './habits-evidence';

function cohortKey(cohort: HabitsCohort) {
  return JSON.stringify([cohort.mapName, cohort.buildNumber, cohort.gameMode, cohort.source]);
}

export function ReviewMaps({ summary, steamId }: { summary: HabitsSummary; steamId: string }) {
  const { t } = useLingui();
  const getSource = useGetDemoSourceName();
  const getMode = useGetGameModeTranslation();
  const [selectedCohort, setSelectedCohort] = useState('');
  const cohort = summary.cohorts.find((item) => cohortKey(item) === selectedCohort) ?? summary.cohorts[0];
  const coverage =
    cohort && cohort.roundCount > 0 ? Math.round((100 * cohort.positionRoundCount) / cohort.roundCount) : 0;
  const matches = cohort?.matchCount ?? 0;
  const rounds = cohort?.roundCount ?? 0;
  return (
    <div className="flex min-w-0 flex-col gap-20">
      <HabitsPanel title={<Trans>Your space on the map</Trans>}>
        <p className="text-gray-700">
          <Trans>
            Switch to the opening window to see where your rounds begin. Click a lit area to inspect the rounds behind
            it.
          </Trans>
        </p>
        {cohort && (
          <>
            <div className="flex min-w-0 flex-col gap-4">
              <Select
                label={t`Heatmap scenario`}
                value={cohortKey(cohort)}
                onChange={setSelectedCohort}
                options={summary.cohorts.map((item) => {
                  const mode = Object.values(GameMode).find((mode) => mode === item.gameMode);
                  const modeName = mode ? getMode(mode) : t({ context: 'Game mode', message: 'Unknown' });
                  return {
                    value: cohortKey(item),
                    label: `${item.mapName} · ${getSource(item.source)} · ${modeName} · ${item.buildNumber}`,
                  };
                })}
              />
            </div>
            <p className="text-caption text-gray-700">
              <Trans>
                This heatmap only: {matches} matches · {rounds} rounds · position coverage {coverage}%
              </Trans>
            </p>
            <HabitsMap
              key={cohortKey(cohort)}
              cohort={cohort}
              gridSize={summary.gridSize}
              steamId={steamId}
              openingWindowSeconds={summary.openingWindowSeconds}
            />
          </>
        )}
        <p className="text-caption text-gray-600">
          <Trans>
            Time is counted while alive until the round is decided. Radar artwork may differ from older map versions.
            These positions describe where you play, not whether your crosshair placement is good.
          </Trans>
        </p>
      </HabitsPanel>
      <details className="rounded-12 border border-gray-300 bg-gray-100 p-20">
        <summary className="cursor-pointer text-body-strong">
          <Trans>More position and combat examples</Trans>
        </summary>
        <div className="mt-16">
          <HabitsEvidenceList evidence={summary.evidence} steamId={steamId} />
        </div>
      </details>
    </div>
  );
}
