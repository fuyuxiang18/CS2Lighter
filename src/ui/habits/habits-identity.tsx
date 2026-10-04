import React, { useEffect, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { HabitsIdentityCandidate } from 'csdm/common/types/habits';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { Button, ButtonVariant } from 'csdm/ui/components/buttons/button';
import { TextInput } from 'csdm/ui/components/inputs/text-input';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { useFormatDate } from 'csdm/ui/hooks/use-format-date';
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
  const [nickname, setNickname] = useState(identity?.nickname ?? '');
  const [lookup, setLookup] = useState<{ key: string; candidates: HabitsIdentityCandidate[]; failed: boolean } | null>(
    null,
  );
  const [revision, setRevision] = useState(0);
  const requestKey = JSON.stringify([identity?.nickname, revision]);
  const loading = Boolean(identity && !identity.steamId && lookup?.key !== requestKey);
  const failed = lookup?.key === requestKey && lookup.failed;
  const candidates = lookup?.key === requestKey ? lookup.candidates : [];

  useEffect(() => {
    const onMatchInserted = () => setRevision((value) => value + 1);
    client.on(ServerPushMessageName.MatchInserted, onMatchInserted);
    return () => client.off(ServerPushMessageName.MatchInserted, onMatchInserted);
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    if (!identity || identity.steamId) {
      return;
    }
    void client
      .send({
        name: RendererClientMessageName.FindHabitsIdentity,
        payload: { nickname: identity.nickname },
      })
      .then((results) => {
        if (cancelled) return;
        setLookup({ key: requestKey, candidates: results, failed: false });
        if (results.length === 1) {
          onSave({ nickname: identity.nickname, steamId: results[0].steamId });
        }
      })
      .catch(() => {
        if (!cancelled) setLookup({ key: requestKey, candidates: [], failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [client, identity, onSave, requestKey]);

  if (identity?.steamId) {
    const name = identity.nickname;
    return (
      <div className="flex flex-wrap items-center justify-between gap-16 rounded-8 border border-gray-300 bg-gray-50 p-16">
        <div>
          <p className="text-body-strong">
            <Trans>Reviewing {name}</Trans>
          </p>
          <p className="text-caption text-gray-700">
            <Trans>Account linked. Future name changes will not split your match history.</Trans>
          </p>
        </div>
        <Button onClick={() => onSave(null)}>
          <Trans>Change player</Trans>
        </Button>
      </div>
    );
  }

  const submit = () => {
    if (nickname.trim().length > 0) {
      onSave({ nickname, steamId: null });
      setRevision((value) => value + 1);
    }
  };

  return (
    <HabitsPanel title={<Trans>Start with your recorded nickname</Trans>}>
      <p className="text-gray-700">
        <Trans>
          Add your demo folders, then enter the exact nickname used when the demo was recorded. An old nickname works
          too. We will find your account after a demo is analyzed.
        </Trans>
      </p>
      <div className="flex flex-wrap items-end gap-12">
        <div className="flex-1">
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
      {identity && !loading && !failed && candidates.length === 0 && (
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
                    onClick={() =>
                      onSave({ nickname: identity?.nickname ?? candidate.nickname, steamId: candidate.steamId })
                    }
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
