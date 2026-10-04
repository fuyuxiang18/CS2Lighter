import React, { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import type { Match } from 'csdm/common/types/match';
import type { MatchTable } from 'csdm/common/types/match-table';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { Button, ButtonVariant } from 'csdm/ui/components/buttons/button';
import { Select } from 'csdm/ui/components/inputs/select';
import { TextInput } from 'csdm/ui/components/inputs/text-input';
import { TextArea } from 'csdm/ui/components/inputs/text-area';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { useFormatDate } from 'csdm/ui/hooks/use-format-date';
import { HabitsPanel } from './habits-layout';
import { HabitsPlaybackButton } from './habits-playback-button';
import { buildEvidencePath } from './habits-evidence';
import { LearningRoundPreview } from './learning-round-preview';
import type { LearningNote } from './habits-storage';

type Props = {
  title: ReactNode;
  matches: MatchTable[];
  defaultSteamId?: string;
  onSaveNote?: (note: LearningNote) => boolean;
};

export function LearningReviewCard({ title, matches, defaultSteamId, onSaveNote }: Props) {
  const { t } = useLingui();
  const client = useWebSocketClient();
  const formatDate = useFormatDate();
  const [search, setSearch] = useState('');
  const [checksum, setChecksum] = useState('');
  const [selectedSteamId, setSelectedSteamId] = useState('');
  const [roundNumber, setRoundNumber] = useState(1);
  const [result, setResult] = useState<{ checksum: string; match: Match | null; failed: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const filteredMatches = matches.filter((match) =>
    `${match.name} ${match.mapName} ${match.players.map((player) => player.name).join(' ')}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );
  const selectedMatch = filteredMatches.find((match) => match.checksum === checksum) ?? filteredMatches[0];
  const selectedChecksum = selectedMatch?.checksum;
  const loading = Boolean(selectedChecksum && result?.checksum !== selectedChecksum);
  const failed = result?.checksum === selectedChecksum && result?.failed;
  const match = result?.checksum === selectedChecksum ? result?.match : null;

  useEffect(() => {
    let cancelled = false;
    if (!selectedChecksum) return;
    void client
      .send({ name: RendererClientMessageName.FetchMatchByChecksum, payload: selectedChecksum })
      .then((result) => {
        if (!cancelled) {
          setResult({ checksum: selectedChecksum, match: result, failed: false });
          setSelectedSteamId(defaultSteamId ?? result.players[0]?.steamId ?? '');
          setRoundNumber(result.rounds[0]?.number ?? 1);
        }
      })
      .catch(() => {
        if (!cancelled) setResult({ checksum: selectedChecksum, match: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [client, selectedChecksum, defaultSteamId]);

  const player = match?.players.find((player) => player.steamId === selectedSteamId) ?? match?.players[0];
  const round = match?.rounds.find((round) => round.number === roundNumber) ?? match?.rounds[0];
  const matchChoices = filteredMatches.slice(0, 100);
  if (selectedMatch && !matchChoices.includes(selectedMatch)) matchChoices.push(selectedMatch);

  return (
    <HabitsPanel title={title}>
      <TextInput
        label={<Trans>Find a match</Trans>}
        placeholder={t`Search player, map or demo name`}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      {selectedMatch ? (
        <Select
          value={selectedMatch.checksum}
          onChange={setChecksum}
          options={matchChoices.map((match) => ({
            value: match.checksum,
            label: `${match.mapName} · ${formatDate(match.date)} · ${match.name}`,
          }))}
        />
      ) : (
        <p className="text-gray-700">
          <Trans>No matching analyzed demos. Add a folder or change your search.</Trans>
        </p>
      )}
      {filteredMatches.length > 100 && (
        <p className="text-caption text-gray-700">
          <Trans>Showing up to 100 matches. Refine your search to find older demos.</Trans>
        </p>
      )}
      {loading && selectedMatch && (
        <p role="status">
          <Trans>Loading the selected match…</Trans>
        </p>
      )}
      {failed && (
        <p role="alert" className="text-red-500">
          <Trans>This match could not be opened. Select another match or refresh the library.</Trans>
        </p>
      )}
      {match && player && round && (
        <>
          <div className="flex flex-wrap gap-12">
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <Select
                label={<Trans>Player</Trans>}
                value={player.steamId}
                onChange={setSelectedSteamId}
                options={match.players.map((player) => ({ value: player.steamId, label: player.name }))}
              />
            </div>
            <div className="flex flex-col gap-4">
              <Select
                label={<Trans>Round</Trans>}
                value={round.number}
                onChange={setRoundNumber}
                options={match.rounds.map((round) => ({ value: round.number, label: String(round.number) }))}
              />
            </div>
          </div>
          <LearningRoundPreview
            key={`${match.checksum}-${round.number}-${player.steamId}`}
            match={match}
            round={round}
            steamId={player.steamId}
          />
          <div className="flex flex-wrap items-center gap-12">
            <Link
              className="text-blue-500"
              to={buildEvidencePath(match.checksum, round.number, player.steamId, round.freezetimeEndTick)}
            >
              <Trans>Open full 2D replay</Trans>
            </Link>
            <HabitsPlaybackButton checksum={match.checksum} steamId={player.steamId} roundNumber={round.number} />
          </div>
          {onSaveNote && (
            <div className="flex flex-col gap-12 border-t border-gray-300 pt-16">
              <label className="flex flex-col gap-8">
                <span className="text-body-strong">
                  <Trans>One thing to practice</Trans>
                </span>
                <TextArea
                  value={note}
                  onChange={(event) => {
                    setNote(event.target.value);
                    setSaved(false);
                  }}
                  placeholder={t`What did you notice? What will you try in your next match?`}
                  rows={3}
                />
              </label>
              <div className="flex items-center gap-12">
                <Button
                  variant={ButtonVariant.Primary}
                  isDisabled={note.trim().length === 0}
                  onClick={() => {
                    if (
                      onSaveNote({
                        id: crypto.randomUUID(),
                        checksum: match.checksum,
                        steamId: player.steamId,
                        playerName: player.name,
                        mapName: match.mapName,
                        roundNumber: round.number,
                        note: note.trim(),
                        createdAt: new Date().toISOString(),
                      })
                    ) {
                      setNote('');
                      setSaved(true);
                    }
                  }}
                >
                  <Trans>Save with this round</Trans>
                </Button>
                {saved && (
                  <span role="status" className="text-green-500">
                    <Trans>Saved locally</Trans>
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </HabitsPanel>
  );
}
