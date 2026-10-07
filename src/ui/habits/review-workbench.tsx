import React, { useState } from 'react';
import { Link } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import { TeamNumber } from 'csdm/common/types/counter-strike';
import type {
  ReviewCardId,
  ReviewComparison,
  ReviewEvidence,
  ReviewInsightsSummary,
} from 'csdm/common/types/review-insights';
import { buildMatch2dViewerRoundPath } from 'csdm/ui/routes-paths';
import { useFormatDate } from 'csdm/ui/hooks/use-format-date';
import { useGetDemoSourceName } from 'csdm/ui/demos/use-demo-sources';
import { useGetGameModeTranslation } from 'csdm/ui/hooks/use-get-game-mode-translation';
import { Select } from 'csdm/ui/components/inputs/select';
import { HabitsPanel } from './habits-layout';
import { ReviewButton } from './review-button';
import { ReviewClipButton } from './review-clip-viewer';
import { useReviewLabels } from './use-review-labels';
import type { ReviewFocus, ReviewPreferences } from './review-storage';

function evidenceKey(id: ReviewCardId, evidence: ReviewEvidence) {
  return `${id}:${evidence.checksum}:${evidence.roundNumber}`;
}

export function ReviewWorkbench({
  insights,
  preferences,
  update,
}: {
  insights: ReviewInsightsSummary;
  preferences: ReviewPreferences;
  update: (patch: Partial<ReviewPreferences>) => void;
}) {
  const { t } = useLingui();
  const labels = useReviewLabels();
  const formatDate = useFormatDate();
  const [showAll, setShowAll] = useState(false);
  const [editingFocus, setEditingFocus] = useState(false);
  const cards = insights.cards
    .filter((card) => card.occurrenceCount > 0)
    .toSorted((a, b) => b.affectedMatches - a.affectedMatches || b.occurrenceCount - a.occurrenceCount);
  const selected = cards.find((card) => card.id === preferences.selectedCard) ?? cards[0];
  const expanded = showAll || Boolean(selected && !cards.slice(0, 3).includes(selected));
  const visibleCards = expanded ? cards : cards.slice(0, 3);
  const selectedLabel = selected && labels.cards[selected.id];
  const affectedMatches = selected?.affectedMatches ?? 0;
  const evidenceTotal = selected?.evidenceTotal ?? 0;
  const evidenceShown = selected?.evidence.length ?? 0;
  const choose = (id: ReviewCardId) => {
    update({ selectedCard: id });
    setEditingFocus(false);
  };
  return (
    <div className="flex min-w-0 flex-col gap-20">
      {preferences.focus && (
        <div className="flex flex-wrap items-center justify-between gap-16 rounded-12 border border-accent-muted bg-accent-soft p-20">
          <div className="flex min-w-0 flex-col gap-4">
            <p className="text-caption font-semibold text-accent">
              <Trans>YOUR NEXT MATCH FOCUS</Trans>
            </p>
            <p className="text-body-strong wrap-anywhere">{preferences.focus.action}</p>
            <p className="text-caption text-gray-700">
              {preferences.focus.scope.mapName} · {preferences.focus.scope.side === TeamNumber.CT ? 'CT' : 'T'}
            </p>
          </div>
          <ReviewButton onClick={() => update({ tab: 'progress' })}>
            <Trans>Track this practice</Trans>
          </ReviewButton>
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-12">
        <div>
          <h2 className="text-subtitle">
            <Trans>Recurring situations</Trans>
          </h2>
        </div>
        {cards.length > 3 && (
          <button
            className="text-caption text-accent"
            onClick={() => {
              if (expanded && cards[0]) choose(cards[0].id);
              setShowAll(!expanded);
            }}
          >
            {expanded ? <Trans>Show top situations</Trans> : <Trans>Show all situations</Trans>}
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-12 md:grid-cols-3">
        {visibleCards.map((card, index) => {
          const denominator = labels.denominators[card.denominatorKind];
          const count = card.occurrenceCount;
          const total = card.denominator;
          return (
            <button
              key={card.id}
              aria-pressed={selected?.id === card.id}
              onClick={() => choose(card.id)}
              className={`flex min-w-0 flex-col gap-16 rounded-12 border p-20 text-left transition-colors ${selected?.id === card.id ? 'border-accent-muted bg-accent-soft' : 'border-gray-300 bg-gray-100 hover:border-gray-500'}`}
            >
              <span className="flex w-full items-center justify-between gap-8">
                <span className="text-caption text-gray-600">0{index + 1}</span>
                <span className="text-caption text-gray-700">
                  {card.sampleStatus === 'limited' ? <Trans>Small sample</Trans> : <Trans>Review candidate</Trans>}
                </span>
              </span>
              <span className="text-subtitle">{labels.cards[card.id].title}</span>
              <span className="flex flex-wrap items-baseline gap-8">
                <span className="text-display tabular-nums">
                  {card.percentage.toFixed(0)}
                  <span className="text-subtitle text-gray-600">%</span>
                </span>
                <span className="text-caption text-gray-700">
                  <Trans>
                    {count} / {total} {denominator}
                  </Trans>
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {!selected && (
        <HabitsPanel title={<Trans>No review candidates in this selection</Trans>}>
          <p className="text-gray-700">
            <Trans>Try another map or side, or explore your playing style.</Trans>
          </p>
        </HabitsPanel>
      )}
      {selected && selectedLabel && (
        <HabitsPanel title={selectedLabel.title}>
          <div className="flex flex-col gap-8">
            <p>{selectedLabel.question}</p>
            <p className="text-caption text-gray-600">
              <Trans>
                {affectedMatches} affected matches · {evidenceShown} recent examples of {evidenceTotal} matching rounds
              </Trans>
            </p>
          </div>
          <details className="text-caption text-gray-700">
            <summary className="cursor-pointer">
              <Trans>Calculation details</Trans>
            </summary>
            <p className="mt-8">{selectedLabel.context}</p>
          </details>
          <div className="flex flex-col gap-8">
            {selected.evidence.map((item) => {
              const key = evidenceKey(selected.id, item);
              const mark = preferences.marks[key];
              const round = item.roundNumber;
              const query = new URLSearchParams({ player: item.steamId, tick: String(item.tick), review: selected.id });
              return (
                <article
                  key={key}
                  className="flex flex-wrap items-center justify-between gap-12 rounded-8 border border-gray-300 bg-gray-75 p-16"
                >
                  <div className="flex min-w-0 flex-col gap-4">
                    <p className="text-body-strong">
                      {item.mapName}{' '}
                      <span className="ml-8 text-caption text-gray-700">
                        <Trans>Round {round}</Trans> · {item.side === TeamNumber.CT ? 'CT' : 'T'}
                      </span>
                    </p>
                    <p className="text-caption text-gray-700">
                      {formatDate(item.date)} · {item.won ? t`Round won` : t`Round lost`} ·{' '}
                      {item.precision === 'round-start' ? t`From round start` : t`With pre-event context`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-8">
                    <Link
                      className="rounded-8 bg-accent px-16 py-10 text-body-strong text-on-accent no-underline"
                      onClick={() => update({ selectedCard: selected.id })}
                      to={`${buildMatch2dViewerRoundPath(item.checksum, round)}?${query}`}
                    >
                      <Trans>Watch round</Trans>
                    </Link>
                    <button
                      className={`rounded-8 border px-12 py-10 text-caption ${mark === 'reviewed' ? 'border-accent-muted text-accent' : 'border-gray-300 text-gray-700'}`}
                      aria-pressed={mark === 'reviewed'}
                      onClick={() => update({ marks: { ...preferences.marks, [key]: 'reviewed' } })}
                    >
                      <Trans>Reviewed</Trans>
                    </button>
                    <button
                      className={`rounded-8 border px-12 py-10 text-caption ${mark === 'context' ? 'border-accent-muted text-accent' : 'border-gray-300 text-gray-700'}`}
                      aria-pressed={mark === 'context'}
                      onClick={() => update({ marks: { ...preferences.marks, [key]: 'context' } })}
                    >
                      <Trans>Intentional play</Trans>
                    </button>
                    {mark && (
                      <button
                        className="text-caption text-gray-600"
                        onClick={() => {
                          const marks = { ...preferences.marks };
                          delete marks[key];
                          update({ marks });
                        }}
                      >
                        <Trans>Undo</Trans>
                      </button>
                    )}
                  </div>
                  <ReviewClipButton
                    request={{
                      checksum: item.checksum,
                      steamId: item.steamId,
                      roundNumber: item.roundNumber,
                      startTick: item.tick,
                    }}
                  />
                </article>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-12 border-t border-gray-300 pt-16">
            <p className="text-gray-700">
              <Trans>Worth changing after watching? Pick one action for your next matches.</Trans>
            </p>
            <ReviewButton primary={true} onClick={() => setEditingFocus(!editingFocus)}>
              <Trans>Make this my practice focus</Trans>
            </ReviewButton>
          </div>
          {editingFocus && (
            <FocusEditor
              key={selected.id}
              cardId={selected.id}
              comparisons={insights.comparisons}
              replacing={preferences.focus !== null}
              onSave={(focus) => {
                update({ focus, tab: 'progress' });
                setEditingFocus(false);
              }}
              onCancel={() => setEditingFocus(false)}
            />
          )}
        </HabitsPanel>
      )}
    </div>
  );
}

function FocusEditor({
  cardId,
  comparisons,
  replacing,
  onSave,
  onCancel,
}: {
  cardId: ReviewCardId;
  comparisons: ReviewComparison[];
  replacing: boolean;
  onSave: (focus: ReviewFocus) => void;
  onCancel: () => void;
}) {
  const { t } = useLingui();
  const labels = useReviewLabels();
  const getSourceName = useGetDemoSourceName();
  const getModeName = useGetGameModeTranslation();
  const [key, setKey] = useState(comparisons[0]?.key ?? '');
  const [action, setAction] = useState(labels.cards[cardId].action);
  const cohort = comparisons.find((item) => item.key === key);
  return (
    <div className="flex flex-col gap-12 rounded-8 border border-accent-muted bg-accent-soft p-20">
      <h3 className="text-body-strong">
        <Trans>Practice one situation</Trans>
      </h3>
      <p className="text-caption text-gray-700">
        <Trans>
          Choose a map and side. Later matches will be compared with your previous matches in the same source, mode and
          game build.
        </Trans>
      </p>
      <div className="flex min-w-0 flex-col gap-4">
        <Select
          label={t`Practice scenario`}
          value={key}
          onChange={setKey}
          options={comparisons.map((item) => ({
            value: item.key,
            label: `${item.mapName} · ${item.side === TeamNumber.CT ? 'CT' : 'T'} · ${getSourceName(item.source)} · ${getModeName(item.gameMode)} · ${item.buildNumber}`,
          }))}
        />
      </div>
      <label className="flex flex-col gap-8">
        <span className="text-caption text-gray-700">
          <Trans>What will you do differently?</Trans>
        </span>
        <textarea
          aria-label={t`Practice action`}
          rows={2}
          maxLength={400}
          className="w-full resize-y rounded-8 border border-gray-300 bg-gray-75 p-12 text-body text-gray-900"
          value={action}
          onChange={(event) => setAction(event.target.value)}
        />
      </label>
      {replacing && (
        <p className="text-caption text-orange-500">
          <Trans>This replaces your current practice focus and starts a new tracking period.</Trans>
        </p>
      )}
      <div className="flex flex-wrap gap-8">
        <ReviewButton
          primary={true}
          disabled={!cohort || !action.trim()}
          onClick={() => {
            if (cohort)
              onSave({
                action: action.trim(),
                scope: {
                  cardId,
                  startedAt: new Date().toISOString(),
                  mapName: cohort.mapName,
                  side: cohort.side,
                  source: cohort.source,
                  gameMode: cohort.gameMode,
                  buildNumber: cohort.buildNumber,
                },
              });
          }}
        >
          <Trans>Start this practice</Trans>
        </ReviewButton>
        <ReviewButton onClick={onCancel}>
          <Trans>Cancel</Trans>
        </ReviewButton>
      </div>
    </div>
  );
}
