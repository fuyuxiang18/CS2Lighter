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
import { Donate } from 'csdm/ui/components/donate';
import { SeeChangelogButton } from './see-changelog-button';
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

        <section className="flex flex-col gap-y-8">
          <p>
            <Trans>A local demo habits and learning app based on CS Demo Manager.</Trans>
          </p>
          <p>
            <Trans>Open-source foundation:</Trans>{' '}
            <ExternalLink href="https://github.com/akiver/cs-demo-manager">CS Demo Manager</ExternalLink> (MIT)
          </p>
          <div>
            <SeeChangelogButton />
          </div>
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

        <section>
          <h3 className="text-subtitle">
            <Trans>Credits</Trans>
          </h3>
          <p>
            <Trans>
              Special thanks to the following developers for their open-source work related to Counter-Strike that at
              some point helped create CS Demo Manager ❤️.
            </Trans>
          </p>
          <ul className="mt-4 selectable">
            <li>
              <Trans>
                <ExternalLink href="https://github.com/DandrewsDev">@DandrewsDev</ExternalLink> for his work on CS2
                demos{' '}
                <ExternalLink href="https://github.com/DandrewsDev/CS2VoiceData">voice data extraction</ExternalLink>.
              </Trans>
            </li>
            <li>
              <Trans>
                <ExternalLink href="https://github.com/dtugend">@dtugend</ExternalLink>, the main developer of{' '}
                <ExternalLink href="https://github.com/advancedfx/advancedfx">HLAE</ExternalLink> which CS Demo Manager
                uses to generate videos. Without HLAE the CS moviemaking community would not be the same. You can
                support the HLAE team{' '}
                <ExternalLink href="https://www.advancedfx.org/credits/#donors">here</ExternalLink>.
              </Trans>
            </li>
            <li>
              <Trans>
                <ExternalLink href="https://github.com/GAMMACASE">@GAMMACASE</ExternalLink>,{' '}
                <ExternalLink href="https://github.com/zer0k-z">@zer0.k</ExternalLink> and other AlliedModders
                contributors to the{' '}
                <ExternalLink href="https://github.com/alliedmodders/hl2sdk/tree/cs2">CS2 SDK</ExternalLink> internally
                used by CS Demo Manager.
              </Trans>
            </li>
            <li>
              <Trans>
                <ExternalLink href="https://github.com/LaihoE">@LaihoE</ExternalLink> for his reverse engineering work
                on CS2 demo parsing. His parser is available on{' '}
                <ExternalLink href="https://github.com/LaihoE/demoparser">GitHub</ExternalLink>.
              </Trans>
            </li>
            <li>
              <Trans>
                <ExternalLink href="https://github.com/main--">@main--</ExternalLink> and{' '}
                <ExternalLink href="https://github.com/moritzuehling">@moritzuehling</ExternalLink> for creating{' '}
                <ExternalLink href="https://github.com/StatsHelix/demoinfo">DemoInfo</ExternalLink>, one of the first
                CSGO demo parsers used for years in CSGO Demo Manager V2.
              </Trans>
            </li>
            <li>
              <Trans>
                <ExternalLink href="https://github.com/markus-wa">@markus-wa</ExternalLink> for creating and maintaining{' '}
                <ExternalLink href="https://github.com/markus-wa/demoinfocs-golang">demoinfocs-golang</ExternalLink>,
                the demo parser internally used by CS Demo Manager V3.
              </Trans>
            </li>
            <li>
              <Trans>
                <ExternalLink href="https://github.com/saul">@saul</ExternalLink>, a Source Engine/CS wizard who created
                a <ExternalLink href="https://github.com/saul/demofile">CSGO</ExternalLink> and{' '}
                <ExternalLink href="https://github.com/saul/demofile-net">CS2</ExternalLink> demo parser and share his
                CS related knowledge through various{' '}
                <ExternalLink href="https://github.com/saul/cvar-unhide-s2">open-source</ExternalLink>{' '}
                <ExternalLink href="https://github.com/saul/node-csgo-voice">projects</ExternalLink>. You can support
                him on <ExternalLink href="https://github.com/sponsors/saul">GitHub</ExternalLink>.
              </Trans>
            </li>
          </ul>
        </section>

        <section>
          <Donate />
        </section>
      </div>
    </SettingsView>
  );
}
