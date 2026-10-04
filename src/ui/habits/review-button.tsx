import React, { type ReactNode } from 'react';

export function ReviewButton({
  children,
  onClick,
  primary = false,
  disabled = false,
  pressed,
}: {
  children: ReactNode;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-8 border px-16 py-10 text-body font-medium transition-colors disabled:cursor-default disabled:opacity-50 ${primary ? 'border-accent bg-accent text-on-accent hover:opacity-90' : 'border-gray-300 bg-gray-100 text-gray-800 hover:border-accent-muted hover:text-gray-900'}`}
    >
      {children}
    </button>
  );
}
