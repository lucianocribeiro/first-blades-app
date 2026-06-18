type CardProps = {
  children: React.ReactNode;
  className?: string;
  padding?: 'sm' | 'md' | 'lg';
};

const paddingStyles = {
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

export function Card({ children, className = '', padding = 'md' }: CardProps) {
  return (
    <div
      className={`bg-white rounded-card shadow-card border border-color-border ${paddingStyles[padding]} ${className}`}
    >
      {children}
    </div>
  );
}
