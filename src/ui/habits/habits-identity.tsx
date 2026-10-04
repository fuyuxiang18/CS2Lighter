import React, { useEffect, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { HabitsIdentityCandidate } from 'csdm/common/types/habits';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { Button, ButtonVariant } from 'csdm/ui/components/buttons/button';
import { TextInput } from 'csdm/ui/components/inputs/text-input';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { useFormatDate } from 'csdm/ui/hooks/use-format-date';
import { useSettingsOverlay } from 'csdm/ui/settings/use-settings-overlay';
import { SettingsCategory } from 'csdm/ui/settings/settings-category';
import { HabitsPanel } from './habits-layout';
import type { HabitsIdentity } from './habits-storage';

type Props = {
  identity: HabitsIdentity | null;
  onSave: (identity: HabitsIdentity | null) => void;
};

export function HabitsIdentitySetup({ identity, onSave }: Props) {
  const { t } = useLingui();
  const client = useWebSocketClient();
  const formatDate = useFormatDate();
  const { openSettings } = useSettingsOverlay();
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState(identity?.nickname ?? '');
  const [submittedNickname, setSubmittedNickname] = useState<string | null>(null);
  const [lookup, setLookup] = useState<{ key: string; candidates: HabitsIdentityCandidate[]; failed: boolean } | null>(
    null,
  );
  const [revision, setRevision] = useState(0);
  const searchNickname = editing ? submittedNickname : identity && !identity.steamId ? identity.nickname : null;
  const requestKey = JSON.stringify([searchNickname, revision]);
  const loading = searchNickname !== null && lookup?.key !== requestKey;
  const failed = lookup?.key === requestKey && lookup.failed;
  const candidates = lookup?.key === requestKey ? lookup.candidates : [];

  useEffect(() => {
    const onMatchInserted = () => setRevision((value) => value + 1);
    client.on(ServerPushMessageName.MatchInserted, onMatchInserted);
    return () => client.off(ServerPushMessageName.MatchInserted, onMatchInserted);
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    if (searchNickname === null) {
      return;
    }
    void client
      .send({
        name: RendererClientMessageName.FindHabitsIdentity,
        payload: { nickname: searchNickname },
      })
      .then((results) => {
        if (cancelled) return;
        setLookup({ key: requestKey, candidates: results, failed: false });
        if (results.length === 1) {
          onSave({ nickname: searchNickname, steamId: results[0].steamId });
          setEditing(false);
          setSubmittedNickname(null);
        }
      })
      .catch(() => {
        if (!cancelled) setLookup({ key: requestKey, candidates: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [client, searchNickname, onSave, requestKey]);

  if (identity?.steamId && !editing) {
    const name = identity.nickname;
    return (
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-12 border-b border-gray-300 pb-12">
        <p className="min-w-0 text-caption wrap-break-word text-gray-700">
          <Trans>Linked account: {name}</Trans>
        </p>
        <Button
          onClick={() => {
            setNickname(identity.nickname);
            setSubmittedNickname(null);
            setLookup(null);
            setEditing(true);
          }}
        >
          <Trans>Change player</Trans>
        </Button>
      </div>
    );
  }

  const submit = () => {
    if (nickname.trim().length > 0) {
      if (editing) {
        setSubmittedNickname(nickname);
      } else {
        onSave({ nickname, steamId: null });
      }
      setRevision((value) => value + 1);
    }
  };

  return (
    <HabitsPanel title={editing ? <Trans>Change the linked account</Trans> : <Trans>Set up your local review</Trans>}>
      {editing ? (
        <p className="text-caption text-gray-700">
          <Trans>Your current account stays linked while you search. Cancel to keep it.</Trans>
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-12 border-b border-gray-300 pb-16">
          <div className="flex flex-col gap-4">
            <p className="text-body-strong">
              <Trans>1. Add your demo folders</Trans>
            </p>
            <p className="text-caption text-gray-700">
              <Trans>Choose the folders where your downloaded demos are saved.</Trans>
            </p>
          </div>
          <Button onClick={() => openSettings(SettingsCategory.Folders)}>
            <Trans>Choose folders</Trans>
          </Button>
        </div>
      )}
      {!editing && (
        <p className="text-body-strong">
          <Trans>2. Find your account in a demo</Trans>
        </p>
      )}
      <p className="text-gray-700">
        <Trans>
          Enter the exact nickname used when the demo was recorded. An old nickname works too. We will find your account
          after a demo is analyzed.
        </Trans>
      </p>
      <div className="flex flex-wrap items-end gap-12">
        <div className="min-w-0 flex-1">
          <TextInput
            label={<Trans>Your in-game nickname</Trans>}
            placeholder={t`Exact nickname, including symbols`}
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            onEnterKeyDown={submit}
          />
        </div>
        <Button variant={ButtonVariant.Primary} onClick={submit} isDisabled={loading || nickname.trim().length === 0}>
          <Trans>Find my account</Trans>
        </Button>
        {editing && (
          <Button
            onClick={() => {
              setEditing(false);
              setSubmittedNickname(null);
              setNickname(identity?.nickname ?? '');
              setLookup(null);
            }}
          >
            <Trans>Cancel</Trans>
          </Button>
        )}
      </div>
      {loading && (
        <p role="status">
          <Trans>Looking through analyzed matches…</Trans>
        </p>
      )}
      {failed && (
        <p role="alert" className="text-red-500">
          <Trans>Account lookup failed. Try again after checking the database connection.</Trans>
        </p>
      )}
      {searchNickname !== null && !loading && !failed && candidates.length === 0 && (
        <p className="text-gray-700">
          <Trans>
            Waiting for an analyzed CS2 match with this nickname. New matches will be checked automatically.
          </Trans>
        </p>
      )}
      {candidates.length > 1 && (
        <>
          <p>
            <Trans>More than one account uses this name. Confirm your account once:</Trans>
          </p>
          <div className="flex flex-col gap-8">
            {candidates.map((candidate) => {
              const matchCount = candidate.matchCount;
              const lastSeen = formatDate(candidate.lastSeen);
              return (
                <div
                  key={candidate.steamId}
                  className="flex flex-wrap items-center justify-between gap-12 rounded-4 border border-gray-300 p-12"
                >
                  <div>
                    <p>
                      {candidate.nickname} · {candidate.steamId}
                    </p>
                    <p className="text-caption text-gray-700">
                      <Trans>
                        {matchCount} matches · last seen {lastSeen}
                      </Trans>
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      onSave({ nickname: searchNickname ?? candidate.nickname, steamId: candidate.steamId });
                      setEditing(false);
                      setSubmittedNickname(null);
                    }}
                  >
                    <Trans>This is me</Trans>
                  </Button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </HabitsPanel>
  );
}
