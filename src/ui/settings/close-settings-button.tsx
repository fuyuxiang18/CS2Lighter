import React from 'react';
import { useLingui } from '@lingui/react/macro';
import { TimesCircleIcon } from 'csdm/ui/icons/times-circle';
import { useSettingsOverlay } from './use-settings-overlay';

export function CloseSettingsButton() {
  const { t } = useLingui();
  const { closeSettings } = useSettingsOverlay();

  return (
    <button
      role="button"
      aria-label={t`Close settings`}
      aria-pressed="false"
      className="mb-16 flex cursor-pointer flex-col items-center transition-all duration-85 hover:text-gray-900"
      onClick={closeSettings}
    >
      <TimesCircleIcon height={40} />
    </button>
  );
}
