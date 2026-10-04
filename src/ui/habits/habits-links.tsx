import React from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { LeftBarLink } from 'csdm/ui/left-bar/left-bar-link';
import { MapIcon } from 'csdm/ui/icons/map-icon';
import { RoutePath } from 'csdm/ui/routes-paths';

export function HabitsLinks() {
  const { t } = useLingui();
  return (
    <>
      <LeftBarLink
        icon={<MapIcon />}
        tooltip={<Trans>My habits</Trans>}
        ariaLabel={t`My habits`}
        url={RoutePath.Habits}
      />
    </>
  );
}
