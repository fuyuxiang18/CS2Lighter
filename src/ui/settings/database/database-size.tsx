import React, { useState, useEffect, useCallback } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import type { DatabaseStorage } from 'csdm/common/types/database-storage';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { ServerPushMessageName } from 'csdm/server/messages/server-push-message-name';
import { Button } from 'csdm/ui/components/buttons/button';
import { useLocale } from 'csdm/ui/settings/ui/use-locale';

export function DatabaseSize() {
  const { t } = useLingui();
  const locale = useLocale();
  const client = useWebSocketClient();
  const [storage, setStorage] = useState<DatabaseStorage | null>(null);
  const [hasError, setHasError] = useState(false);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(
    () =>
      client
        .send({ name: RendererClientMessageName.GetDatabaseStorage })
        .then((result) => {
          setStorage(result);
          setHasError(false);
        })
        .catch((error: unknown) => {
          logger.error(error);
          setHasError(true);
        })
        .finally(() => {
          setLoading(false);
        }),
    [client],
  );
  useEffect(() => {
    client.on(ServerPushMessageName.OptimizeDatabaseSuccess, refresh);
    void refresh();
    return () => {
      client.off(ServerPushMessageName.OptimizeDatabaseSuccess, refresh);
    };
  }, [client, refresh]);
  const labels: Record<DatabaseStorage['parts'][number]['id'], string> = {
    players: t`Player trajectories`,
    utility: t`Grenade, fire and hostage trajectories`,
    chickens: t`Legacy decorative chicken trajectories`,
    other: t`Other match data and database overhead`,
  };
  const format = (bytes: number) => {
    const size = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      bytes / 1024 ** 3,
    );
    return t`${size} GiB`;
  };
  return (
    <section className="flex flex-col gap-8 border-b border-gray-300 pb-12">
      <div className="flex items-center justify-between gap-12">
        <h2 className="text-body-strong">
          <Trans>Database storage</Trans>
        </h2>
        <Button
          onClick={() => {
            setLoading(true);
            void refresh();
          }}
          isDisabled={loading}
        >
          <Trans>Refresh storage</Trans>
        </Button>
      </div>
      {hasError && (
        <p role="alert" className="text-red-500">
          <Trans>Storage information could not be read. Check the database connection and retry.</Trans>
        </p>
      )}
      {storage && (
        <>
          <p className="text-body-strong">{format(storage.totalBytes)}</p>
          <dl className="flex flex-col gap-8">
            {storage.parts.map((part) => (
              <div className="flex justify-between gap-12" key={part.id}>
                <dt>{labels[part.id]}</dt>
                <dd>{format(part.bytes)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 text-body-strong">
            <Trans>Actual database directory</Trans>
          </p>
          <p className="break-all select-text">
            {storage.location === 'external'
              ? t`Managed by the external PostgreSQL server`
              : (storage.physicalDataDirectory ?? t`The physical directory could not be resolved`)}
          </p>
          {storage.logicalDataDirectory && storage.logicalDataDirectory !== storage.physicalDataDirectory && (
            <p className="text-caption break-all text-gray-600 select-text">{storage.logicalDataDirectory}</p>
          )}
        </>
      )}
    </section>
  );
}
