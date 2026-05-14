'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  side?: 'right' | 'left';
  width?: string;
}

function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  className,
  side = 'right',
  width = 'w-[480px]',
}: DrawerProps) {
  React.useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  React.useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        className={cn(
          'absolute top-0 bottom-0 flex flex-col border-gray-700 bg-gray-900 shadow-2xl',
          side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
          width,
          className
        )}
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        {(title || description) && (
          <div className="flex items-start justify-between border-b border-gray-700 p-6 flex-shrink-0">
            <div>
              {title && <h2 className="text-lg font-semibold text-gray-100">{title}</h2>}
              {description && <p className="mt-1 text-sm text-gray-400">{description}</p>}
            </div>
            <button
              onClick={onClose}
              className="ml-4 rounded p-1 text-gray-400 hover:bg-gray-700 hover:text-gray-100 transition-colors"
              aria-label="Close drawer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export { Drawer };
