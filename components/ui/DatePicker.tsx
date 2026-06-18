import { forwardRef } from 'react';
import { CalendarDays } from 'lucide-react';

type DatePickerProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: string;
  error?: string;
  hint?: string;
};

export const DatePicker = forwardRef<HTMLInputElement, DatePickerProps>(
  ({ label, error, hint, className = '', id, ...props }, ref) => {
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
          <CalendarDays
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral pointer-events-none"
          />
          <input
            ref={ref}
            id={inputId}
            type="date"
            className={[
              'w-full border rounded-lg pl-10 pr-3 py-2 text-sm bg-white transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
              error ? 'border-error' : 'border-color-border hover:border-neutral/40',
              props.disabled ? 'bg-surface text-neutral cursor-not-allowed' : '',
              className,
            ].join(' ')}
            {...props}
          />
        </div>
        {error && <p className="text-xs text-error">{error}</p>}
        {hint && !error && <p className="text-xs text-neutral">{hint}</p>}
      </div>
    );
  }
);

DatePicker.displayName = 'DatePicker';
