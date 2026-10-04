import React from 'react';
import { Trans } from '@lingui/react/macro';
import type { DemoCacheDirectory } from 'csdm/common/types/demo-data-cache';

export function DemoCacheLocation({ directory }: { directory: DemoCacheDirectory | null }) {
  if (!directory) return null;

  return (
    <div className="min-w-0 rounded-4 border border-gray-300 p-12">
      <p className="text-body-strong">
        <Trans>Demo cache folder</Trans>
      </p>
      <p className="mt-4 break-all select-text">{directory.path}</p>
      {directory.isFallback && (
        <p className="mt-4 text-caption text-orange-500">
          <Trans>The preferred cache folder is unavailable. The app is using this writable folder instead.</Trans>
        </p>
      )}
    </div>
  );
}
