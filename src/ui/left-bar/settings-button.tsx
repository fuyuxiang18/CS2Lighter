import React from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { useSettingsOverlay } from 'csdm/ui/settings/use-settings-overlay';
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
    <button
      type="button"
      aria-label={t`Settings`}
      title={t`Settings (${shortcut})`}
      className="flex min-h-40 w-full cursor-pointer items-center gap-10 rounded-8 border border-transparent px-12 py-10 text-gray-700 transition-colors duration-85 hover:bg-gray-200 hover:text-gray-900"
      onClick={onClick}
    >
      <CogsIcon className="size-20 shrink-0" aria-hidden="true" />
      <span>
        <Trans>Settings</Trans>
      </span>
    </button>
  );
}
