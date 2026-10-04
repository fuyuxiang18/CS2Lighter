import React from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { UpdateIcon } from 'csdm/ui/icons/update-icon';
import { Tooltip } from 'csdm/ui/components/tooltip';
import { useAppUpdate } from 'csdm/ui/hooks/use-app-update';
import { useSettingsOverlay } from 'csdm/ui/settings/use-settings-overlay';
import { SettingsCategory } from 'csdm/ui/settings/settings-category';

export function UpdateAvailableButton() {
  const update = useAppUpdate();
  const { t } = useLingui();
  const { openSettings } = useSettingsOverlay();
  if (!update.version) {
    return null;
  }

  return (
    <div className="no-drag">
      <Tooltip content={<Trans>Application updates</Trans>} placement="bottom" delay={0}>
        <button
          aria-label={t`Application updates`}
          className="flex border border-transparent text-green-400 no-underline outline-hidden transition-all duration-85 hover:text-green-700"
          onClick={() => openSettings(SettingsCategory.About)}
        >
          <UpdateIcon className="w-20" />
        </button>
      </Tooltip>
    </div>
  );
}
