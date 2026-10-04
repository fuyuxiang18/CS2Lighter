import React, { useEffect, useState } from 'react';
import { Trans } from '@lingui/react/macro';
import { SettingsView } from 'csdm/ui/settings/settings-view';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import type { Migration } from 'csdm/node/database/migrations/fetch-migrations';
import { CopyButton } from 'csdm/ui/components/buttons/copy-button';
import { ExternalLink } from 'csdm/ui/components/external-link';
import { RevealLogFileButton } from 'csdm/ui/components/buttons/reveal-log-file-button';
import { ClearLogsButton } from './clear-logs-button';
import { ResetSettingsButton } from './reset-settings-button';
import { RevealCounterStrikeLogFileButton } from './reveal-counter-strike-log-file-button';
import { Game } from 'csdm/common/types/counter-strike';
import { DatabaseMode } from 'csdm/common/types/database-mode';
import { useDatabaseSettings } from 'csdm/ui/settings/database/use-database-settings';
import { AppUpdates } from './app-updates';
import { applicationName } from 'csdm/common/application-name';

export function About() {
  const client = useWebSocketClient();
  const [migrations, setMigrations] = useState<Migration[]>([]);
  const info = window.csdm.getAppInformation();
  const databaseSettings = useDatabaseSettings();
  const isEmbeddedDatabase = databaseSettings.mode === DatabaseMode.Embedded;

  useEffect(() => {
    void (async () => {
      const result = await client.send({
        name: RendererClientMessageName.FetchLastMigrations,
      });

      setMigrations(result);
    })();
  }, [client]);

  /* oxlint-disable lingui/no-unlocalized-strings */
  const data: string[] = [
    `Version: ${APP_VERSION}`,
    `OS: ${info.platform} ${info.arch} ${info.osVersion}`,
    `Electron: ${info.electronVersion}`,
    `Chrome: ${info.chromeVersion}`,
    isEmbeddedDatabase
      ? 'Database: embedded'
      : `Database: external (${databaseSettings.hostname}:${databaseSettings.port})`,
    'Last database migrations:',
    ...migrations.map((migration) => `v${migration.version} - ${migration.date}`),
  ];
  /* oxlint-enable lingui/no-unlocalized-strings */

  return (
    <SettingsView>
      <div className="flex flex-col gap-y-20">
        <h2 className="text-title">{applicationName}</h2>
        <AppUpdates />

        <section>
          <p>
            <Trans>Review local CS2 demos and explore your habits across matches.</Trans>
          </p>
        </section>

        <section className="flex flex-col">
          <h2 className="text-subtitle">
            <Trans>Information</Trans>
          </h2>
          {data.map((line) => (
            <p key={line} className="selectable">
              {line}
            </p>
          ))}
          <div className="mt-4 flex flex-wrap items-center gap-8">
            <CopyButton data={data.join('\n')} />
            <ResetSettingsButton />
          </div>
        </section>

        <section className="flex flex-col">
          <h2 className="text-subtitle">
            <Trans>Logs</Trans>
          </h2>
          <div className="mt-4 flex flex-wrap items-center gap-8">
            <RevealLogFileButton filePath={logger.getLogFilePath()}>
              <Trans>Reveal log file</Trans>
            </RevealLogFileButton>
            <ClearLogsButton />
            <RevealCounterStrikeLogFileButton game={Game.CS2} />
            <RevealCounterStrikeLogFileButton game={Game.CSGO} />
            {isEmbeddedDatabase && (
              <RevealLogFileButton filePath={window.csdm.embeddedDatabaseLogFilePath}>
                <Trans>Reveal PostgreSQL log file</Trans>
              </RevealLogFileButton>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-y-8">
          <h3 className="text-subtitle">
            <Trans>Acknowledgements</Trans>
          </h3>
          <p>
            <Trans>Built on the open-source work of CS Demo Manager and its contributors.</Trans>
          </p>
          <p>
            <ExternalLink href="https://github.com/akiver/cs-demo-manager">CS Demo Manager</ExternalLink> (MIT)
          </p>
          <p>
            <Trans>Original copyright and license notices are included with this application.</Trans>
          </p>
        </section>
      </div>
    </SettingsView>
  );
}
