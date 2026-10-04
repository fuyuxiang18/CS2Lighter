import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import { DemoSource, TeamNumber } from 'csdm/common/types/counter-strike';
import type { HabitsSummary } from 'csdm/common/types/habits';
import type { PersonalStatsSummary } from 'csdm/common/types/personal-stats';
import type { ReviewInsightsSummary } from 'csdm/common/types/review-insights';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { Select } from 'csdm/ui/components/inputs/select';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { useGetDemoSourceName } from 'csdm/ui/demos/use-demo-sources';
import { RoutePath } from 'csdm/ui/routes-paths';
import { HabitsIdentitySetup } from './habits-identity';
import { HabitsLayout, HabitsPanel } from './habits-layout';
import { readHabitsIdentity, saveHabitsIdentity, type HabitsIdentity } from './habits-storage';
import {
  defaultReviewPreferences,
  readReviewPreferences,
  saveReviewPreferences,
  type ReviewPreferences,
} from './review-storage';
import { ReviewWorkbench } from './review-workbench';
import { ReviewStyle } from './review-style';
import { ReviewProgress } from './review-progress';
import { ReviewMaps } from './review-maps';
import { ReviewMatches } from './review-matches';
import { ReviewButton } from './review-button';

type ReviewData = { key: string; summary: HabitsSummary; stats: PersonalStatsSummary; insights: ReviewInsightsSummary };

export function HabitsDashboard() {
  const { t } = useLingui();
  const { pathname } = useLocation();
  const [identity, setIdentity] = useState(readHabitsIdentity);
  const [storageError, setStorageError] = useState(false);
  const saveIdentity = useCallback((value: HabitsIdentity | null) => {
    try {
      saveHabitsIdentity(value);
      setIdentity(value);
      setStorageError(false);
    } catch (error) {
      logger.error(error);
      setStorageError(true);
    }
  }, []);
  const page = pathname === RoutePath.HabitsMaps ? 'maps' : pathname === RoutePath.HabitsMatches ? 'matches' : 'review';
  return (
    <HabitsLayout
      title={page === 'maps' ? t`Map habits` : page === 'matches' ? t`Match notebook` : t`Review workspace`}
      description={
        page === 'maps'
          ? t`Where you go, where you fight, and the rounds that explain it.`
          : page === 'matches'
            ? t`Your local matches, ready when you want the details.`
            : t`Find a recurring situation. Review the evidence. Try one change.`
      }
    >
      <HabitsIdentitySetup identity={identity} onSave={saveIdentity} />
      {storageError && (
        <p role="alert" className="text-red-500">
          <Trans>Could not save your account locally. Check that app storage is writable and try again.</Trans>
        </p>
      )}
      {identity?.steamId && <ReviewContent key={identity.steamId} steamId={identity.steamId} page={page} />}
    </HabitsLayout>
  );
}

function ReviewContent({ steamId, page }: { steamId: string; page: 'review' | 'maps' | 'matches' }) {
  const { t } = useLingui();
  const client = useWebSocketClient();
  const getSourceName = useGetDemoSourceName();
  const [preferences, setPreferences] = useState(() => readReviewPreferences(steamId));
  const [storageError, setStorageError] = useState(false);
  const [data, setData] = useState<ReviewData | null>(null);
  const [availableSources, setAvailableSources] = useState<DemoSource[]>([]);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const { mapName, side, source, tab } = preferences;
  const trainingKey = JSON.stringify(preferences.focus?.scope ?? null);
  const requestKey = JSON.stringify([steamId, mapName, side, source, revision, trainingKey]);
  const loading = data?.key !== requestKey && failedKey !== requestKey;
  const failed = failedKey === requestKey;
  const update = (patch: Partial<ReviewPreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    try {
      saveReviewPreferences(steamId, next);
      setStorageError(false);
    } catch (error) {
      logger.error(error);
      setStorageError(true);
    }
  };
  useEffect(() => {
    const inserted = () => setRevision((value) => value + 1);
    client.on(ServerPushMessageName.MatchInserted, inserted);
    return () => client.off(ServerPushMessageName.MatchInserted, inserted);
  }, [client]);
  useEffect(() => {
    let cancelled = false;
    const payload = {
      steamId,
      ...(mapName === 'all' ? {} : { mapName }),
      ...(source === 'all' ? {} : { source }),
      ...(side === 'all' ? {} : { side: side === 'ct' ? TeamNumber.CT : TeamNumber.T }),
    };
    const training = JSON.parse(trainingKey) ?? undefined;
    void Promise.all([
      client.send({ name: RendererClientMessageName.FetchHabitsSummary, payload }),
      client.send({ name: RendererClientMessageName.FetchPersonalStats, payload }),
      client.send({ name: RendererClientMessageName.FetchReviewInsights, payload: { ...payload, training } }),
    ])
      .then(([summary, stats, insights]) => {
        if (!cancelled) {
          setData({ key: requestKey, summary, stats, insights });
          setAvailableSources((previous) => [...new Set([...previous, ...summary.cohorts.map((item) => item.source)])]);
          setFailedKey(null);
        }
      })
      .catch((error) => {
        logger.error(error);
        if (!cancelled) setFailedKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [client, steamId, mapName, source, side, trainingKey, requestKey]);
  const matches = data?.stats.matchCount ?? 0;
  const rounds = data?.stats.metrics.roundCount ?? 0;
  const dates = data?.stats.matches.map((match) => new Date(match.date).getTime()).filter(Number.isFinite) ?? [];
  const dateRange = dates.length
    ? `${new Date(Math.min(...dates)).toLocaleDateString()} – ${new Date(Math.max(...dates)).toLocaleDateString()}`
    : '—';
  return (
    <>
      <section
        aria-label={t`Review filters`}
        className="flex flex-wrap items-end gap-12 rounded-12 border border-gray-300 bg-gray-100 p-16"
      >
        <div className="flex min-w-0 flex-col gap-4">
          <Select
            label={t`Map`}
            value={mapName}
            onChange={(mapName) => update({ mapName })}
            options={[
              { value: 'all', label: t`All maps` },
              ...Array.from(
                new Set([...(data?.summary.mapNames ?? []), ...(mapName === 'all' ? [] : [mapName])]),
                (name) => ({ value: name, label: name }),
              ),
            ]}
          />
        </div>
        <div className="flex flex-col gap-4">
          <Select
            label={t`Side`}
            value={side}
            onChange={(side) => update({ side })}
            options={[
              { value: 'all', label: t`Both sides` },
              { value: 'ct', label: 'CT' },
              { value: 't', label: 'T' },
            ]}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Select
            label={t`Source`}
            value={source}
            onChange={(source) => update({ source })}
            options={[
              { value: 'all', label: t`All sources` },
              ...Array.from(new Set([...availableSources, ...(source === 'all' ? [] : [source])]), (value) => ({
                value,
                label: getSourceName(value),
              })),
            ]}
          />
        </div>
        <div className="flex-1" />
        <div className="flex flex-col gap-4 text-right">
          <p className="text-body-strong tabular-nums">
            {loading ? t`Loading saved data…` : t`${matches} matches · ${rounds} rounds`}
          </p>
          <p className="text-caption text-gray-600">{dateRange}</p>
        </div>
        {(mapName !== 'all' || side !== 'all' || source !== 'all') && (
          <button
            className="self-center px-8 text-caption text-accent"
            onClick={() => update({ mapName: 'all', side: 'all', source: 'all' })}
          >
            <Trans>Reset filters</Trans>
          </button>
        )}
      </section>
      {storageError && (
        <p role="alert" className="text-red-500">
          <Trans>Your changes could not be saved locally. Keep this window open and check storage permissions.</Trans>
        </p>
      )}
      {page === 'review' && (
        <nav aria-label={t`Review sections`} className="flex flex-wrap gap-8 border-b border-gray-300 pb-12">
          {[
            { value: 'review' as const, label: t`Review priorities` },
            { value: 'style' as const, label: t`My playing style` },
            { value: 'progress' as const, label: t`Practice and progress` },
          ].map((item) => (
            <button
              key={item.value}
              aria-current={tab === item.value ? 'page' : undefined}
              className={`rounded-8 px-20 py-10 text-body-strong ${tab === item.value ? 'bg-accent-soft text-accent' : 'text-gray-700 hover:bg-gray-100'}`}
              onClick={() => update({ tab: item.value })}
            >
              {item.label}
            </button>
          ))}
        </nav>
      )}
      {loading && (
        <div role="status" className="rounded-12 border border-gray-300 bg-gray-100 p-24 text-gray-700">
          <Trans>Reading your saved match data…</Trans>
        </div>
      )}
      {failed && (
        <HabitsPanel title={<Trans>Could not load your review</Trans>}>
          <p role="alert">
            <Trans>Your demo files are unchanged. Retry loading the saved data.</Trans>
          </p>
          <div>
            <ReviewButton onClick={() => setRevision((value) => value + 1)}>
              <Trans>Retry</Trans>
            </ReviewButton>
          </div>
        </HabitsPanel>
      )}
      {data && (
        <div className={loading || failed ? 'hidden' : 'flex min-w-0 flex-col gap-20'}>
          {page === 'review' && tab === 'progress' ? (
            <ReviewProgress insights={data.insights} preferences={preferences} update={update} />
          ) : matches === 0 ? (
            <HabitsPanel title={<Trans>No matches in this selection</Trans>}>
              <p className="text-gray-700">
                <Trans>
                  Reset the filters, or add a folder containing demos for this account. Imported files are analyzed once
                  and reused.
                </Trans>
              </p>
              <div>
                <ReviewButton
                  onClick={() =>
                    update({ ...defaultReviewPreferences(), focus: preferences.focus, marks: preferences.marks })
                  }
                >
                  <Trans>Reset filters</Trans>
                </ReviewButton>
              </div>
            </HabitsPanel>
          ) : (
            <>
              {page === 'review' && tab === 'review' && (
                <ReviewWorkbench insights={data.insights} preferences={preferences} update={update} />
              )}
              {page === 'review' && tab === 'style' && <ReviewStyle insights={data.insights} stats={data.stats} />}
              {page === 'maps' && <ReviewMaps summary={data.summary} steamId={steamId} />}
              {page === 'matches' && <ReviewMatches stats={data.stats} />}
            </>
          )}
          <p className="text-caption text-gray-600">
            <Trans>
              Local demo evidence · no upload required · proportions are observations, not automatic coaching verdicts.
            </Trans>
          </p>
        </div>
      )}
    </>
  );
}
