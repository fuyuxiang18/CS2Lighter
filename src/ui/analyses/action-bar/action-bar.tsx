import React from 'react';
import { ActionBar } from 'csdm/ui/components/action-bar';
import { RemoveAnalysesSucceedButton } from './remove-analyses-succeed-button';
import { RemoveAllAnalysesButton } from './remove-all-analyses-button';
import { ImportQueueControls } from 'csdm/ui/imports/import-queue-controls';

export function AnalysesActionBar() {
  return (
    <ActionBar
      left={
        <>
          <RemoveAllAnalysesButton />
          <RemoveAnalysesSucceedButton />
          <ImportQueueControls />
        </>
      }
    />
  );
}
