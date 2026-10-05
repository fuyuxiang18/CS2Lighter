import React from 'react';
import { Trans } from '@lingui/react/macro';
import { Button } from 'csdm/ui/components/buttons/button';
import { useAnalyses } from 'csdm/ui/analyses/use-analyses';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { AnalysisStatus } from 'csdm/common/types/analysis-status';

export function RemoveAllAnalysesButton() {
  const analyses = useAnalyses();
  const client = useWebSocketClient();
  const removable = analyses.filter(
    ({ status }) =>
      status !== AnalysisStatus.Analyzing &&
      status !== AnalysisStatus.AnalyzeSuccess &&
      status !== AnalysisStatus.Inserting,
  );
  const isDisabled = removable.length === 0;

  const onClick = async () => {
    const checksums = removable.map((analysis) => analysis.demoChecksum);
    await client.send({
      name: RendererClientMessageName.RemoveDemosFromAnalyses,
      payload: checksums,
    });
  };

  return (
    <Button onClick={onClick} isDisabled={isDisabled}>
      <Trans>Remove pending and finished</Trans>
    </Button>
  );
}
