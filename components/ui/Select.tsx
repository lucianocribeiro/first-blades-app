import { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';

type SelectOption = {
  value: string;
  label: string;
};

type SelectProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'children'> & {
  label?: string;
  options: SelectOption[];
  placeholder?: string;
  error?: string;
  hint?: string;
};

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, options, placeholder, error, hint, className = '', id, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-');

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={selectId} className="text-sm font-medium text-secondary">
            {label}
            {props.required && <span className="text-error ml-1">*</span>}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={[
              'w-full appearance-none border rounded-lg px-3 py-2 pr-10 text-sm bg-white transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
              error ? 'border-error' : 'border-color-border hover:border-neutral/40',
              props.disabled ? 'bg-surface text-neutral cursor-not-allowed' : '',
              className,
            ].join(' ')}
            {...props}
          >
            {placeholder && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral pointer-events-none"
          />
        </div>
        {error && <p className="text-xs text-error">{error}</p>}
        {hint && !error && <p className="text-xs text-neutral">{hint}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
