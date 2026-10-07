import React from 'react';
import { Trans } from '@lingui/react/macro';
import { SettingsView } from 'csdm/ui/settings/settings-view';
import { Database } from 'csdm/ui/settings/database/database';
import { DatabaseSize } from './database-size';
import { OptimizeDatabaseButton } from './optimize-database-button';
import { ResetDatabaseButton } from './reset-database-button';

export function DatabaseSettings() {
  return (
    <SettingsView>
      <DatabaseSize />
      <div className="mt-8 mb-12 flex gap-8">
        <OptimizeDatabaseButton />
        <ResetDatabaseButton />
      </div>
      <details className="mt-12">
        <summary className="cursor-pointer text-body-strong">
          <Trans>Database connection</Trans>
        </summary>
        <div className="mt-12">
          <Database />
        </div>
      </details>
    </SettingsView>
  );
}
