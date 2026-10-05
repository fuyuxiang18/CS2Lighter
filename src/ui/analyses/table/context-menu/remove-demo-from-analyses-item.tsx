import React from 'react';
import { Trans } from '@lingui/react/macro';
import { RendererClientMessageName } from 'csdm/server/messages/renderer-client-message-name';
import { useWebSocketClient } from 'csdm/ui/hooks/use-web-socket-client';
import { useSelectedAnalysis } from 'csdm/ui/analyses/use-selected-analysis-demo-id';
import { ContextMenuItem } from 'csdm/ui/components/context-menu/context-menu-item';
import { AnalysisStatus } from 'csdm/common/types/analysis-status';

export function RemoveDemoFromAnalysesItem() {
  const selectedAnalysis = useSelectedAnalysis();
  const client = useWebSocketClient();

  const onClick = async () => {
    if (selectedAnalysis === undefined) {
      return;
    }

    if (selectedAnalysis.status === AnalysisStatus.Analyzing) {
      await client.send({
        name: RendererClientMessageName.ControlImportQueue,
        payload: { action: 'cancel-active', checksums: [selectedAnalysis.demoChecksum] },
      });
      return;
    }

    await client.send({
      name: RendererClientMessageName.RemoveDemosFromAnalyses,
      payload: [selectedAnalysis.demoChecksum],
    });
  };

  return (
    <ContextMenuItem
      onClick={onClick}
      isDisabled={
        selectedAnalysis?.status === AnalysisStatus.Inserting ||
        selectedAnalysis?.status === AnalysisStatus.AnalyzeSuccess
      }
    >
      {selectedAnalysis?.status === AnalysisStatus.Analyzing ? (
        <Trans>Cancel current parsing</Trans>
      ) : (
        <Trans context="Context menu">Remove</Trans>
      )}
    </ContextMenuItem>
  );
}
