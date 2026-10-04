import React from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { Button, ButtonVariant } from 'csdm/ui/components/buttons/button';
import { ExternalLink } from 'csdm/ui/components/external-link';
import { useAppUpdate } from 'csdm/ui/hooks/use-app-update';

export function AppUpdates() {
  const update = useAppUpdate();
  const { t } = useLingui();
  const version = update.version;
  const percent = Math.round(update.percent);
  const busy = ['checking', 'downloading', 'installing'].includes(update.status);

  return (
    <section className="flex flex-col gap-y-8 rounded-8 border border-gray-300 p-16">
      <h2 className="text-subtitle">
        <Trans>Application updates</Trans>
      </h2>
      <p>
        <Trans>Current version: {APP_VERSION}</Trans>
      </p>
      {update.status === 'idle' && (
        <p>
          <Trans>Check GitHub Releases for new versions.</Trans>
        </p>
      )}
      {update.status === 'checking' && (
        <p role="status">
          <Trans>Checking for updates…</Trans>
        </p>
      )}
      {update.status === 'current' && (
        <p role="status">
          <Trans>You are using the latest version.</Trans>
        </p>
      )}
      {update.status === 'available' && (
        <p role="status">
          <Trans>Version {version} is available.</Trans>
        </p>
      )}
      {update.status === 'downloading' && (
        <div role="status">
          <p>
            <Trans>Downloading update: {percent}%</Trans>
          </p>
          <progress className="w-full" value={percent} max={100} aria-label={t`Update download progress`} />
        </div>
      )}
      {update.downloaded && update.status !== 'installing' && (
        <p role="status">
          <Trans>Version {version} is ready. Restart to finish updating.</Trans>
        </p>
      )}
      {update.status === 'installing' && (
        <p role="status">
          <Trans>Closing the database safely and restarting…</Trans>
        </p>
      )}
      {update.status === 'unavailable' && (
        <p>
          <Trans>Update checks are available in the installed application.</Trans>
        </p>
      )}
      {update.error === 'network' && (
        <p role="alert">
          <Trans>Could not check or download the update. Check your connection and retry.</Trans>
        </p>
      )}
      {update.error === 'busy' && (
        <p role="alert">
          <Trans>Parsing or another task is still running. Wait for it to finish before restarting.</Trans>
        </p>
      )}
      {update.error === 'install' && (
        <p role="alert">
          <Trans>
            The update could not be installed. Restart the application and try again, or use the installer from GitHub
            Releases.
          </Trans>
        </p>
      )}
      <div className="flex flex-wrap gap-8">
        <Button
          isDisabled={busy || update.downloaded || update.status === 'unavailable'}
          onClick={() => void window.csdm.checkForUpdates()}
        >
          <Trans>Check for updates</Trans>
        </Button>
        {version && !update.downloaded && (
          <Button variant={ButtonVariant.Primary} isDisabled={busy} onClick={() => void window.csdm.downloadUpdate()}>
            <Trans>Download update</Trans>
          </Button>
        )}
        {update.downloaded && (
          <Button variant={ButtonVariant.Primary} isDisabled={busy} onClick={() => void window.csdm.installUpdate()}>
            <Trans>Restart and update</Trans>
          </Button>
        )}
        <ExternalLink href="https://github.com/fuyuxiang18/CS2Lighter/releases">
          <Trans>Release notes</Trans>
        </ExternalLink>
      </div>
      <p className="text-gray-600">
        <Trans>Updates keep your demo folders, parsed matches, account and learning notes.</Trans>
      </p>
    </section>
  );
}
