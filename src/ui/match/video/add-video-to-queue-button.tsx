import React from 'react';
import { useNavigate } from 'react-router';
import { Trans } from '@lingui/react/macro';
import { Button, ButtonVariant } from 'csdm/ui/components/buttons/button';
import { RoutePath } from 'csdm/ui/routes-paths';

export function AddVideoToQueueButton() {
  const navigate = useNavigate();
  return (
    <Button variant={ButtonVariant.Primary} onClick={() => void navigate(RoutePath.RecordingQueue)}>
      <Trans>Open recording queue</Trans>
    </Button>
  );
}
