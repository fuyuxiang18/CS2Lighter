import React from 'react';
import type { ReactNode } from 'react';
import clsx from 'clsx';

type Props = {
  children: ReactNode;
  label: string;
  onClick: () => void;
  variant?: 'danger' | 'default';
};

export function Control({ children, onClick, variant, label }: Props) {
  return (
    <button
      type="button"
      aria-label={label}
      className={clsx(
        'flex h-full w-48 cursor-default items-center justify-center',
        variant === 'danger' ? 'hover:bg-red-700 hover:text-white' : 'hover:bg-gray-200',
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
