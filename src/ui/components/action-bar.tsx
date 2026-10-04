import type { ReactNode } from 'react';
import React from 'react';

type Props = {
  left?: ReactNode;
  right?: ReactNode;
};

export function ActionBar({ left, right }: Props) {
  return (
    <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-8 border-b border-b-gray-300 p-8">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-8">{left}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-8">{right}</div>
    </div>
  );
}
