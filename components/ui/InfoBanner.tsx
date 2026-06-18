import { Info } from 'lucide-react';

type InfoBannerProps = {
  message: string;
  className?: string;
};

export function InfoBanner({ message, className = '' }: InfoBannerProps) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm ${className}`}
      role="note"
    >
      <Info size={16} className="shrink-0 text-primary" />
      <span>{message}</span>
    </div>
  );
}
