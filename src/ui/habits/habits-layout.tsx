import React, { type ReactNode } from 'react';
import { Trans } from '@lingui/react/macro';
import { Content } from 'csdm/ui/components/content';
import { useSettingsOverlay } from 'csdm/ui/settings/use-settings-overlay';
import { SettingsCategory } from 'csdm/ui/settings/settings-category';

export function HabitsLayout({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
}) {
  const { openSettings } = useSettingsOverlay();
  return (
    <Content>
      <main className="flex min-w-0 flex-col gap-16 p-8 pb-32 text-gray-900 lg:p-16">
        <header className="flex flex-wrap items-start justify-between gap-16">
          <div className="flex min-w-0 flex-col gap-8">
            <h1 className="text-title font-semibold">{title}</h1>
            <p className="text-body text-gray-700">{description}</p>
          </div>
          <button
            className="rounded-8 border border-gray-300 bg-gray-100 px-16 py-10 text-body hover:border-accent-muted"
            onClick={() => openSettings(SettingsCategory.Folders)}
          >
            <Trans>Manage demo folders</Trans>
          </button>
        </header>
        {children}
      </main>
    </Content>
  );
}

export function HabitsPanel({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-16 rounded-12 border border-gray-300 bg-gray-100 p-20">
      <h2 className="text-subtitle font-semibold">{title}</h2>
      {children}
    </section>
  );
}
