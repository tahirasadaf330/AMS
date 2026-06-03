import * as React from 'react';
import { cn } from '@/lib/utils';

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  required?: boolean;
}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, children, required, ...props }, ref) => {
    return (
      <label
        ref={ref}
        className={cn('text-sm font-medium text-gray-600 dark:text-gray-300 leading-none', className)}
        {...props}
      >
        {children}
        {required && <span className="ml-1 text-red-400">*</span>}
      </label>
    );
  }
);

Label.displayName = 'Label';

export { Label };
