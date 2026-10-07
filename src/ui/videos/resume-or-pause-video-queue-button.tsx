import React from 'react';
import { Trans } from '@lingui/react/macro';
import { useNavigate } from 'react-router';
import { Button } from 'csdm/ui/components/buttons/button';
import { RoutePath } from 'csdm/ui/routes-paths';

export function ResumeOrPauseVideoQueueButton() {
  const navigate = useNavigate();
  return (
    <Button onClick={() => void navigate(RoutePath.RecordingQueue)}>
      <Trans>Open recording queue</Trans>
    </Button>
  );
}
