import React from 'react';
import { Trans } from '@lingui/react/macro';
import { CenteredContent } from 'csdm/ui/components/content';

export function UnsupportedMap() {
  return (
    <CenteredContent>
      <p className="text-subtitle">
        <Trans>Map not supported.</Trans>
      </p>
      <p>
        <Trans>You can add a radar image and map coordinates in Settings → Maps.</Trans>
      </p>
    </CenteredContent>
  );
}
