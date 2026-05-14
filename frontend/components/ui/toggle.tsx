'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'default';
}

function Toggle({ checked, onChange, label, disabled, className, size = 'default' }: ToggleProps) {
  const id = React.useId();

  return (
    <label
      htmlFor={id}
      className={cn(
        'flex items-center gap-2',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        className
      )}
    >
      <div className="relative">
        <input
          id={id}
          type="checkbox"
          className="sr-only"
          checked={checked}
          onChange={(e) => !disabled && onChange(e.target.checked)}
          disabled={disabled}
        />
        <div
          className={cn(
            'rounded-full transition-colors duration-200',
            size === 'sm' ? 'h-4 w-7' : 'h-6 w-11',
            checked ? 'bg-blue-600' : 'bg-gray-600'
          )}
        />
        <div
          className={cn(
            'absolute top-0.5 rounded-full bg-white shadow transition-transform duration-200',
            size === 'sm' ? 'h-3 w-3 left-0.5' : 'h-5 w-5 left-0.5',
            checked
              ? size === 'sm'
                ? 'translate-x-3'
                : 'translate-x-5'
              : 'translate-x-0'
          )}
        />
      </div>
      {label && <span className="text-sm text-gray-300">{label}</span>}
    </label>
  );
}

export { Toggle };
