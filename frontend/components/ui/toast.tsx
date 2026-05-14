'use client';

import * as React from 'react';
import { X, CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Toast } from '@/types';

interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

function ToastItem({ toast, onRemove }: ToastItemProps) {
  const icons = {
    default: <Info className="h-4 w-4 text-blue-400 flex-shrink-0" />,
    success: <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0" />,
    warning: <AlertTriangle className="h-4 w-4 text-amber-400 flex-shrink-0" />,
    destructive: <XCircle className="h-4 w-4 text-red-400 flex-shrink-0" />,
  };

  const borderColors = {
    default: 'border-blue-700',
    success: 'border-green-700',
    warning: 'border-amber-700',
    destructive: 'border-red-700',
  };

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border bg-gray-800 p-4 shadow-lg',
        'min-w-[300px] max-w-[420px]',
        borderColors[toast.variant]
      )}
      role="alert"
    >
      {icons[toast.variant]}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-100">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-xs text-gray-400 break-words">{toast.description}</p>
        )}
      </div>
      <button
        onClick={() => onRemove(toast.id)}
        className="ml-2 flex-shrink-0 rounded p-0.5 text-gray-500 hover:bg-gray-700 hover:text-gray-300 transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export { ToastItem };
