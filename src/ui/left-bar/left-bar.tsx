import React from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { useLocation } from 'react-router';
import { AnalysesLink } from './analyses-link';
import { SettingsButton } from './settings-button';
import { DemosLink } from './demos-link';
import { useImportProgress } from 'csdm/ui/imports/import-progress-provider';
import { MapIcon } from 'csdm/ui/icons/map-icon';
import { CalendarIcon } from 'csdm/ui/icons/calendar-icon';
import { ChevronDownIcon } from 'csdm/ui/icons/chevron-down-icon';
import { RoutePath } from 'csdm/ui/routes-paths';
import { LeftBarLink } from './left-bar-link';
import { ImportSummary } from './import-summary';

export function LeftBar() {
  const { t } = useLingui();
  const { pathname } = useLocation();
  const { progress } = useImportProgress();
  const isBlocked = !progress || progress.isBlocking;
  const isAdvancedPath = [RoutePath.Demos, RoutePath.Analyses].some((route) => pathname.startsWith(route));
  return (
    <aside className="flex h-full w-sidebar shrink-0 flex-col border-r border-gray-300 bg-gray-75">
      <nav
        className="flex min-h-0 flex-1 flex-col gap-24 overflow-y-auto p-12"
        aria-label={t`Main navigation`}
        inert={isBlocked}
        aria-disabled={isBlocked}
      >
        <div className="flex flex-col gap-4 pt-12">
          <p className="px-12 pb-12 text-caption text-gray-600">
            <Trans>PERSONAL REVIEW</Trans>
          </p>
          <LeftBarLink
            icon={<ReviewWorkspaceIcon />}
            tooltip={<Trans>Review workspace</Trans>}
            url={RoutePath.Habits}
            end={true}
          />
          <LeftBarLink icon={<MapIcon />} tooltip={<Trans>Map habits</Trans>} url={RoutePath.HabitsMaps} />
          <LeftBarLink icon={<CalendarIcon />} tooltip={<Trans>Match history</Trans>} url={RoutePath.HabitsMatches} />
          <LeftBarLink
            icon={<RecordingIcon />}
            tooltip={<Trans>Recording queue</Trans>}
            url={RoutePath.RecordingQueue}
          />
        </div>
        <details key={pathname} className="group" open={isAdvancedPath}>
          <summary className="flex min-h-40 cursor-pointer list-none items-center justify-between gap-8 rounded-8 px-12 py-8 text-caption text-gray-600 hover:bg-gray-200 hover:text-gray-900">
            <Trans>Advanced tools</Trans>
            <ChevronDownIcon
              className="size-12 shrink-0 -rotate-90 fill-none transition-transform duration-85 group-open:rotate-0"
              aria-hidden="true"
            />
          </summary>
          <div className="mt-4 flex flex-col gap-4">
            <DemosLink />
            <AnalysesLink />
          </div>
        </details>
      </nav>
      <div className="flex shrink-0 flex-col gap-8 border-t border-gray-300 p-12">
        <ImportSummary />
        <SettingsButton />
      </div>
    </aside>
  );
}

function RecordingIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 4h18v16H3V4Zm2 2v12h14V6H5Zm4 2 7 4-7 4V8Z" />
    </svg>
  );
}

function ReviewWorkspaceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3h8v8H3V3Zm10 0h8v5h-8V3Zm0 7h8v11h-8V10ZM3 13h8v8H3v-8Z" />
    </svg>
  );
}
