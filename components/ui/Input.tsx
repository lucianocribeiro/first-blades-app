import { forwardRef } from 'react';

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  error?: string;
  hint?: string;
  icon?: React.ReactNode;
  rightIcon?: React.ReactNode;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, icon, rightIcon, className = '', id, ...props }, ref) => {
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-secondary">
            {label}
            {props.required && <span className="text-error ml-1">*</span>}
          </label>
        )}
        <div className="relative">
          {icon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={[
              'w-full border rounded-lg py-2 text-sm bg-white transition-colors',
              'placeholder:text-neutral/60',
              'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
              icon ? 'pl-10' : 'pl-3',
              rightIcon ? 'pr-10' : 'pr-3',
              error
                ? 'border-error'
                : 'border-color-border hover:border-neutral/40',
              props.readOnly || props.disabled
                ? 'bg-surface text-neutral cursor-not-allowed'
                : '',
              className,
            ].join(' ')}
            {...props}
          />
          {rightIcon && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral">
              {rightIcon}
            </span>
          )}
        </div>
        {error && <p className="text-xs text-error">{error}</p>}
        {hint && !error && <p className="text-xs text-neutral">{hint}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
