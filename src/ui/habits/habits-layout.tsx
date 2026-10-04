import React, { type ReactNode } from 'react';
import { NavLink } from 'react-router';
import { Trans, useLingui } from '@lingui/react/macro';
import { RoutePath } from 'csdm/ui/routes-paths';
import { Button } from 'csdm/ui/components/buttons/button';
import { Content } from 'csdm/ui/components/content';
import { useSettingsOverlay } from 'csdm/ui/settings/use-settings-overlay';
import { SettingsCategory } from 'csdm/ui/settings/settings-category';

export function HabitsLayout({ children }: { children: ReactNode }) {
  const { t } = useLingui();
  const { openSettings } = useSettingsOverlay();

  return (
    <Content>
      <div className="flex min-w-0 flex-col gap-24 pb-24 text-gray-900">
        <div className="flex flex-wrap items-center justify-between gap-16 border-b border-gray-300 pb-16">
          <div>
            <p className="text-caption text-blue-500">
              <Trans>Your local review workspace</Trans>
            </p>
            <h1 className="text-title">
              <Trans>From matches to better habits</Trans>
            </h1>
          </div>
          <Button onClick={() => openSettings(SettingsCategory.Folders)}>
            <Trans>Demo folders</Trans>
          </Button>
        </div>
        <nav className="flex flex-wrap gap-8" aria-label={t`Review`}>
          <WorkspaceLink to={RoutePath.Habits}>
            <Trans>My habits</Trans>
          </WorkspaceLink>
          <WorkspaceLink to={RoutePath.Learning}>
            <Trans>Learn from a player</Trans>
          </WorkspaceLink>
          <WorkspaceLink to={RoutePath.Matches}>
            <Trans>Match library</Trans>
          </WorkspaceLink>
        </nav>
        {children}
      </div>
    </Content>
  );
}

function WorkspaceLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `rounded-4 border px-16 py-8 no-underline ${isActive ? 'border-blue-500 bg-gray-100 text-blue-500' : 'border-gray-300 text-gray-700 hover:border-gray-600'}`
      }
    >
      {children}
    </NavLink>
  );
}

export function HabitsPanel({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-16 rounded-8 border border-gray-300 bg-gray-50 p-20">
      <h2 className="text-subtitle">{title}</h2>
      {children}
    </section>
  );
}
