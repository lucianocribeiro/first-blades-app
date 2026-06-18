import { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
  icon?: React.ReactNode;
};

const variantStyles: Record<ButtonVariant, string> = {
  primary:   'bg-primary text-white hover:bg-blue-700 disabled:bg-blue-300',
  secondary: 'border border-primary text-primary bg-white hover:bg-blue-50 disabled:opacity-50',
  danger:    'bg-error text-white hover:bg-red-800 disabled:opacity-50',
  ghost:     'text-neutral hover:bg-surface disabled:opacity-50',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', loading, icon, children, className = '', disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={[
          'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          variantStyles[variant],
          className,
        ].join(' ')}
        {...props}
      >
        {loading ? <Loader2 size={16} className="animate-spin" /> : icon}
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
