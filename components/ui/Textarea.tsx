import { forwardRef } from 'react';

type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label?: string;
  error?: string;
  hint?: string;
  maxLength?: number;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, hint, maxLength, className = '', id, value, onChange, ...props }, ref) => {
    const textareaId = id ?? label?.toLowerCase().replace(/\s+/g, '-');
    const currentLength = typeof value === 'string' ? value.length : 0;

    return (
      <div className="flex flex-col gap-1">
        {label && (
          <label htmlFor={textareaId} className="text-sm font-medium text-secondary">
            {label}
            {props.required && <span className="text-error ml-1">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          maxLength={maxLength}
          value={value}
          onChange={onChange}
          className={[
            'w-full border rounded-lg px-3 py-2 text-sm bg-white transition-colors resize-y min-h-[80px]',
            'placeholder:text-neutral/60',
            'focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary',
            error ? 'border-error' : 'border-color-border hover:border-neutral/40',
            props.disabled ? 'bg-surface text-neutral cursor-not-allowed' : '',
            className,
          ].join(' ')}
          {...props}
        />
        <div className="flex justify-between items-center">
          <span>{error && <p className="text-xs text-error">{error}</p>}</span>
          <span>{hint && !error && <p className="text-xs text-neutral">{hint}</p>}</span>
          {maxLength !== undefined && (
            <span className="text-xs text-neutral ml-auto">
              {currentLength}/{maxLength}
            </span>
          )}
        </div>
      </div>
    );
  }
);

Textarea.displayName = 'Textarea';
