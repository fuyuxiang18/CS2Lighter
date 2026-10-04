import type { ReactNode } from 'react';
import React from 'react';

type Props = {
  description?: string | ReactNode;
  title: string | ReactNode;
  interactiveComponent: ReactNode;
};

export function SettingsEntry({ title, interactiveComponent, description }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-12 border-b border-b-gray-300 py-8">
      <div className="min-w-0 flex-1">
        <p className="text-body-strong">{title}</p>
        {description && <div className="mt-4">{description}</div>}
      </div>
      <div className="max-w-full min-w-0">{interactiveComponent}</div>
    </div>
  );
}
