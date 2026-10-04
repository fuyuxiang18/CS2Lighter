import React from 'react';
import { useLingui } from '@lingui/react/macro';
import { CloseIcon } from './close-icon';
import { Control } from './control';

export function CloseControl() {
  const { t } = useLingui();
  const onClick = () => {
    window.csdm.closeWindow();
  };

  return (
    <Control variant="danger" onClick={onClick} label={t`Close window`}>
      <CloseIcon />
    </Control>
  );
}
