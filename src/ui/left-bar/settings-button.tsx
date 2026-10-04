import React from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { useSettingsOverlay } from 'csdm/ui/settings/use-settings-overlay';
import { LeftBarTooltip } from './left-bar-tooltip';
import { CogsIcon } from 'csdm/ui/icons/cogs-icon';
import { modifierKey } from '../keyboard/keyboard-shortcut';

export function SettingsButton() {
  const { t } = useLingui();
  const { openSettings } = useSettingsOverlay();

  const onClick = () => {
    openSettings();
  };

  const shortcut = `${modifierKey}+,`;

  return (
    <LeftBarTooltip content={<Trans>Settings ({shortcut})</Trans>}>
      <button
        aria-label={t`Settings`}
        className="flex w-full cursor-pointer flex-col items-center border border-transparent py-4 text-gray-400 no-underline outline-hidden transition-all duration-85 hover:text-gray-900"
        onClick={onClick}
      >
        <div className="flex w-32 justify-center">
          <CogsIcon />
        </div>
      </button>
    </LeftBarTooltip>
  );
}
