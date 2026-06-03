import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600',
        success: 'bg-green-50 dark:bg-green-900/60 text-green-700 dark:text-green-300 border border-green-300 dark:border-green-700',
        warning: 'bg-amber-50 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700',
        destructive: 'bg-red-50 dark:bg-red-900/60 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-700',
        outline: 'border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300',
        blue: 'bg-blue-50 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-700',
        purple: 'bg-purple-50 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-700',
        green: 'bg-green-50 dark:bg-green-900/60 text-green-700 dark:text-green-300 border border-green-300 dark:border-green-700',
        gray: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600',
        amber: 'bg-amber-50 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
