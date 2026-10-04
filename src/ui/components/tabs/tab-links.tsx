import type { ReactNode } from 'react';
import React from 'react';

type Props = {
  children: ReactNode;
};

export function TabLinks({ children }: Props) {
  return (
    <div className="flex min-w-0 shrink-0 border-b border-b-gray-300">
      <div className="mx-auto flex h-40 max-w-full min-w-0 list-none overflow-x-auto px-4">{children}</div>
    </div>
  );
}
