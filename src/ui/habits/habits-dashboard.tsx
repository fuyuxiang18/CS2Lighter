import React, { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { GameMode, TeamNumber } from 'csdm/common/types/counter-strike';
import type { HabitsCohort, HabitsSummary } from 'csdm/common/types/habits';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { Button } from 'csdm/ui/components/buttons/button';
import { Select } from 'csdm/ui/components/inputs/select';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { useGetGameModeTranslation } from 'csdm/ui/hooks/use-get-game-mode-translation';
import { useGetDemoSourceName } from 'csdm/ui/demos/use-demo-sources';
import { HabitsIdentitySetup } from './habits-identity';
import { HabitsLayout, HabitsPanel } from './habits-layout';
import { HabitsMap } from './habits-map';
import { HabitsEvidenceList } from './habits-evidence';
import { readHabitsIdentity, saveHabitsIdentity, type HabitsIdentity } from './habits-storage';

export function HabitsDashboard() {
  const { t } = useLingui();
  const client = useWebSocketClient();
  const getGameModeTranslation = useGetGameModeTranslation();
  const getDemoSourceName = useGetDemoSourceName();
  const [identity, setIdentity] = useState(readHabitsIdentity);
  const [storageError, setStorageError] = useState(false);
  const [mapName, setMapName] = useState('all');
  const [side, setSide] = useState<'all' | 'ct' | 't'>('all');
  const [selectedCohort, setSelectedCohort] = useState('');
  const [result, setResult] = useState<{ key: string; summary: HabitsSummary | null; failed: boolean } | null>(null);
  const [revision, setRevision] = useState(0);
  const steamId = identity?.steamId;
  const requestKey = JSON.stringify([steamId, mapName, side, revision]);
  const summary = result?.summary;
  const loading = Boolean(steamId && result?.key !== requestKey);
  const failed = result?.key === requestKey && result.failed;
  const saveIdentity = useCallback((value: HabitsIdentity | null) => {
    try {
      saveHabitsIdentity(value);
      setIdentity(value);
      setStorageError(false);
      setMapName('all');
    } catch (error) {
      logger.error(error);
      setStorageError(true);
    }
  }, []);

  useEffect(() => {
    const onMatchInserted = () => setRevision((value) => value + 1);
    client.on(ServerPushMessageName.MatchInserted, onMatchInserted);
    return () => client.off(ServerPushMessageName.MatchInserted, onMatchInserted);
  }, [client]);

  useEffect(() => {
    if (!steamId) {
      return;
    }
    let cancelled = false;
    void client
      .send({
        name: RendererClientMessageName.FetchHabitsSummary,
        payload: {
          steamId,
          ...(mapName === 'all' ? {} : { mapName }),
          ...(side === 'all' ? {} : { side: side === 'ct' ? TeamNumber.CT : TeamNumber.T }),
        },
      })
      .then((result) => {
        if (!cancelled) {
          setResult({ key: requestKey, summary: result, failed: false });
        }
      })
      .catch(() => {
        if (!cancelled)
          setResult((previous) => ({ key: requestKey, summary: previous?.summary ?? null, failed: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [client, steamId, mapName, side, requestKey]);

  const cohort = summary?.cohorts.find((cohort) => cohortKey(cohort) === selectedCohort) ?? summary?.cohorts[0];
  const coverage =
    summary && summary.roundCount > 0 ? Math.round((100 * summary.positionRoundCount) / summary.roundCount) : 0;
  const evidenceCount = summary?.evidence.length ?? 0;
  const evidenceTotal = summary?.evidenceTotalCount ?? 0;

  return (
    <HabitsLayout>
      <HabitsIdentitySetup identity={identity} onSave={saveIdentity} />
      {storageError && (
        <p role="alert" className="text-red-500">
          <Trans>Could not save your account locally. Check that app storage is writable and try again.</Trans>
        </p>
      )}
      {steamId && (
        <>
          <div className="flex flex-wrap items-end gap-16">
            <div className="flex flex-col gap-4">
              <Select
                label={<Trans>Map</Trans>}
                value={mapName}
                onChange={setMapName}
                options={[
                  { value: 'all', label: t`All maps` },
                  ...(summary?.mapNames ?? []).map((name) => ({ value: name, label: name })),
                ]}
              />
            </div>
            <div className="flex flex-col gap-4">
              <Select
                label={<Trans>Side</Trans>}
                value={side}
                onChange={setSide}
                options={[
                  { value: 'all', label: t`Both sides` },
                  { value: 'ct', label: 'CT' },
                  { value: 't', label: 'T' },
                ]}
              />
            </div>
            <Button isDisabled={loading} onClick={() => setRevision((value) => value + 1)}>
              <Trans>Refresh</Trans>
            </Button>
            <p className="pb-4 text-caption text-gray-700">
              <Trans>CS2 · your linked account · all imported dates</Trans>
            </p>
          </div>
          {loading && (
            <p role="status">
              <Trans>Building your cross-match profile…</Trans>
            </p>
          )}
          {failed && (
            <p role="alert" className="text-red-500">
              <Trans>Could not load your match history. Use Refresh to try again.</Trans>
            </p>
          )}
          {!loading && !failed && summary && (
            <>
              <div className="grid grid-cols-2 gap-12 xl:grid-cols-4">
                <Metric
                  title={<Trans>Matches / rounds</Trans>}
                  value={`${summary.matchCount} / ${summary.roundCount}`}
                  detail={<Trans>Rounds included in this selection</Trans>}
                />
                <Metric
                  title={<Trans>Kills / deaths</Trans>}
                  value={`${summary.kills} / ${summary.deaths}`}
                  detail={<Trans>Across your selected matches</Trans>}
                />
                <Metric
                  title={<Trans>Opening kills / deaths</Trans>}
                  value={`${summary.openingKills} / ${summary.openingDeaths}`}
                  detail={<Trans>First enemy elimination of each round</Trans>}
                />
                <Metric
                  title={<Trans>Position coverage</Trans>}
                  value={`${coverage}%`}
                  detail={<Trans>Rounds with usable position data</Trans>}
                />
              </div>
              {summary.matchCount === 0 ? (
                <HabitsPanel title={<Trans>Your profile is ready for matches</Trans>}>
                  <p>
                    <Trans>
                      No analyzed matches match this account and filter. Add your Perfect World demo folders or choose
                      another map.
                    </Trans>
                  </p>
                </HabitsPanel>
              ) : (
                <>
                  <HabitsPanel title={<Trans>Where you spend your rounds</Trans>}>
                    <p className="text-gray-700">
                      <Trans>
                        Matches are grouped by map and game build. The installed radar is a reference and may differ
                        from older map layouts.
                      </Trans>
                    </p>
                    {summary.cohorts.length > 0 && (
                      <Select
                        value={cohort ? cohortKey(cohort) : ''}
                        onChange={setSelectedCohort}
                        options={summary.cohorts.map((cohort) => {
                          const map = cohort.mapName;
                          const version = cohort.buildNumber;
                          const count = cohort.matchCount;
                          const gameMode = Object.values(GameMode).find((mode) => mode === cohort.gameMode);
                          const mode = gameMode ? getGameModeTranslation(gameMode) : cohort.gameMode;
                          const source = getDemoSourceName(cohort.source);
                          return {
                            value: cohortKey(cohort),
                            label: t`${map} · build ${version} · ${mode} · ${source} · ${count} matches`,
                          };
                        })}
                      />
                    )}
                    {cohort && (
                      <HabitsMap
                        key={`${cohort.mapName}-${cohort.buildNumber}-${cohort.gameMode}-${cohort.source}`}
                        cohort={cohort}
                        gridSize={summary.gridSize}
                        steamId={steamId}
                        openingWindowSeconds={summary.openingWindowSeconds}
                      />
                    )}
                    {summary.positionRoundCount < summary.roundCount && (
                      <p className="text-caption text-orange-500">
                        <Trans>
                          Some rounds have no usable positions. Their combat events still count; enable position
                          analysis in settings and reanalyze older demos to fill the map.
                        </Trans>
                      </p>
                    )}
                  </HabitsPanel>
                  <HabitsPanel title={<Trans>Return to the evidence</Trans>}>
                    <p className="text-gray-700">
                      <Trans>Review the fight, your teammates and your equipment before deciding what to change.</Trans>
                    </p>
                    <p className="text-caption text-gray-700">
                      <Trans>
                        Showing {evidenceCount} stored examples from {evidenceTotal} events. This is a review sample,
                        not the full event export.
                      </Trans>
                    </p>
                    <HabitsEvidenceList key={`${mapName}-${side}`} evidence={summary.evidence} steamId={steamId} />
                  </HabitsPanel>
                </>
              )}
            </>
          )}
        </>
      )}
    </HabitsLayout>
  );
}

function Metric({ title, value, detail }: { title: ReactNode; value: string; detail: ReactNode }) {
  return (
    <div className="flex flex-col gap-8 rounded-8 border border-gray-300 bg-gray-50 p-20">
      <p className="text-caption text-gray-700">{title}</p>
      <p className="text-title">{value}</p>
      <p className="text-caption text-gray-700">{detail}</p>
    </div>
  );
}

function cohortKey(cohort: HabitsCohort) {
  return JSON.stringify([cohort.mapName, cohort.buildNumber, cohort.gameMode, cohort.source]);
}
