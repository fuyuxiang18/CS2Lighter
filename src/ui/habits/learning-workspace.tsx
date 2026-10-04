import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Trans } from '@lingui/react/macro';
import { Game } from 'csdm/common/types/counter-strike';
import type { MatchTable } from 'csdm/common/types/match-table';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { Button } from 'csdm/ui/components/buttons/button';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { useFormatDate } from 'csdm/ui/hooks/use-format-date';
import { RoutePath } from 'csdm/ui/routes-paths';
import { HabitsLayout, HabitsPanel } from './habits-layout';
import { LearningReviewCard } from './learning-review-card';
import { HabitsPlaybackButton } from './habits-playback-button';
import { buildEvidencePath } from './habits-evidence';
import { readHabitsIdentity, readLearningNotes, saveLearningNotes, type LearningNote } from './habits-storage';

export function LearningWorkspace() {
  const client = useWebSocketClient();
  const formatDate = useFormatDate();
  const [identity] = useState(readHabitsIdentity);
  const [library, setLibrary] = useState<{ revision: number; matches: MatchTable[]; failed: boolean } | null>(null);
  const [notes, setNotes] = useState(readLearningNotes);
  const [revision, setRevision] = useState(0);
  const [storageError, setStorageError] = useState(false);
  const loading = library?.revision !== revision;
  const failed = library?.revision === revision && library.failed;
  const matches = library?.matches ?? [];

  useEffect(() => {
    const onMatchInserted = () => setRevision((value) => value + 1);
    client.on(ServerPushMessageName.MatchInserted, onMatchInserted);
    return () => client.off(ServerPushMessageName.MatchInserted, onMatchInserted);
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    void client
      .send({
        name: RendererClientMessageName.FetchMatchesTable,
        payload: {
          games: [Game.CS2],
          demoSources: [],
          demoTypes: [],
          gameModes: [],
          tagIds: [],
          maxRounds: [],
          startDate: undefined,
          endDate: undefined,
        },
      })
      .then((result) => {
        if (!cancelled) setLibrary({ revision, matches: result, failed: false });
      })
      .catch(() => {
        if (!cancelled) setLibrary((previous) => ({ revision, matches: previous?.matches ?? [], failed: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [client, revision]);

  const updateNotes = (nextNotes: LearningNote[]) => {
    try {
      saveLearningNotes(nextNotes);
      setNotes(nextNotes);
      setStorageError(false);
      return true;
    } catch (error) {
      logger.error(error);
      setStorageError(true);
      return false;
    }
  };
  const ownMatches = identity?.steamId
    ? matches.filter((match) => match.players.some((player) => player.steamId === identity.steamId))
    : [];

  return (
    <HabitsLayout>
      <div className="flex flex-wrap items-center justify-between gap-12">
        <div>
          <h2 className="text-subtitle">
            <Trans>Study a round. Keep one idea.</Trans>
          </h2>
          <p className="text-gray-700">
            <Trans>
              Import a player's demo, choose their perspective, then compare movement and view direction with your own
              round. Match the map, side and situation before drawing conclusions.
            </Trans>
          </p>
        </div>
        <Button isDisabled={loading} onClick={() => setRevision((value) => value + 1)}>
          <Trans>Refresh library</Trans>
        </Button>
      </div>
      {loading && (
        <p role="status">
          <Trans>Loading your demo library…</Trans>
        </p>
      )}
      {failed && (
        <p role="alert" className="text-red-500">
          <Trans>Could not load the match library. Try Refresh library.</Trans>
        </p>
      )}
      {library && (
        <div className="grid grid-cols-1 items-start gap-20 xl:grid-cols-2">
          <LearningReviewCard
            title={<Trans>Reference player</Trans>}
            matches={matches}
            onSaveNote={(note) => updateNotes([note, ...notes])}
          />
          {identity?.steamId ? (
            <LearningReviewCard
              title={<Trans>My comparison round</Trans>}
              matches={ownMatches}
              defaultSteamId={identity.steamId}
            />
          ) : (
            <HabitsPanel title={<Trans>Add your perspective</Trans>}>
              <p>
                <Trans>Link your nickname to compare the reference round with your own matches.</Trans>
              </p>
              <Link className="text-blue-500" to={RoutePath.Habits}>
                <Trans>Set up my profile</Trans>
              </Link>
            </HabitsPanel>
          )}
        </div>
      )}
      <HabitsPanel title={<Trans>My practice notebook</Trans>}>
        <p className="text-gray-700">
          <Trans>Notes stay on this computer and keep a link to the exact reference round.</Trans>
        </p>
        {storageError && (
          <p role="alert" className="text-red-500">
            <Trans>
              Could not save the notebook. Your text is still in the editor; check available app storage and retry.
            </Trans>
          </p>
        )}
        {notes.length === 0 && (
          <p className="text-gray-700">
            <Trans>
              No practice notes yet. Review a reference round and save the first adjustment you want to try.
            </Trans>
          </p>
        )}
        {notes.map((note) => {
          const roundNumber = note.roundNumber;
          return (
            <article key={note.id} className="flex flex-col gap-12 rounded-4 border border-gray-300 p-16">
              <div className="flex flex-wrap justify-between gap-8">
                <h3 className="text-body-strong">
                  {note.playerName} · {note.mapName} · <Trans>Round {roundNumber}</Trans>
                </h3>
                <p className="text-caption text-gray-700">{formatDate(note.createdAt)}</p>
              </div>
              <p className="whitespace-pre-wrap">{note.note}</p>
              <div className="flex flex-wrap items-center gap-12">
                <Link className="text-blue-500" to={buildEvidencePath(note.checksum, note.roundNumber, note.steamId)}>
                  <Trans>Revisit 2D round</Trans>
                </Link>
                <HabitsPlaybackButton checksum={note.checksum} steamId={note.steamId} roundNumber={note.roundNumber} />
                <Button onClick={() => updateNotes(notes.filter((item) => item.id !== note.id))}>
                  <Trans>Remove note</Trans>
                </Button>
              </div>
            </article>
          );
        })}
      </HabitsPanel>
    </HabitsLayout>
  );
}
