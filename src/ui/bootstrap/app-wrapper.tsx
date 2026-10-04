import React from 'react';
import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
};

export function AppWrapper({ children }: Props) {
  return <div className="flex h-(--app-content-height) min-w-0 overflow-hidden bg-gray-50">{children}</div>;
}
