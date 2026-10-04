import React from 'react';
import { BarsIcon } from 'csdm/ui/icons/bars-icon';
import { useLingui } from '@lingui/react/macro';

export function MenuButton() {
  const { t } = useLingui();
  return (
    <button
      type="button"
      aria-label={t`Application menu`}
      className="flex h-full w-40 shrink-0 cursor-default items-center justify-center text-gray-700 no-drag hover:bg-gray-200 hover:text-gray-900"
      onClick={() => {
        window.csdm.showTitleBarMenu();
      }}
    >
      <BarsIcon width={12} />
    </button>
  );
}
