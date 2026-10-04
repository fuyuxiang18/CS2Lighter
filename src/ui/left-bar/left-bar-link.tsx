import type { ReactNode } from 'react';
import React from 'react';
import { NavLink } from 'react-router';

type Props = {
  icon: ReactNode;
  tooltip: ReactNode;
  url: string;
  ariaLabel?: string;
  end?: boolean;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement, MouseEvent>) => void;
};

export function LeftBarLink({ url, tooltip, icon, onClick, ariaLabel, end }: Props) {
  return (
    <NavLink
      to={url}
      aria-label={ariaLabel}
      onClick={onClick}
      end={end}
      className={({ isActive }) => {
        return `flex min-h-40 w-full items-center gap-8 rounded-8 border px-8 py-10 no-underline duration-85 transition-colors max-[1100px]:px-4 ${
          isActive
            ? 'border-accent-muted bg-accent-soft text-accent text-body-strong'
            : 'border-transparent text-gray-700 hover:bg-gray-200 hover:text-gray-900'
        }`;
      }}
      viewTransition={true}
    >
      <span className="flex size-20 shrink-0 items-center justify-center *:size-full" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0 wrap-break-word">{tooltip}</span>
    </NavLink>
  );
}
