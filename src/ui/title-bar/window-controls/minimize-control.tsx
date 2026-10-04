import React from 'react';
import { useLingui } from '@lingui/react/macro';
import { Control } from './control';
import { MinimizeIcon } from './minimize-icon';

export function MinimizeControl() {
  const { t } = useLingui();
  const onClick = () => {
    window.csdm.minimizeWindow();
  };

  return (
    <Control onClick={onClick} label={t`Minimize window`}>
      <MinimizeIcon />
    </Control>
  );
}
