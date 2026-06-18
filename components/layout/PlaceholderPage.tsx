import { Card } from '@/components/ui/Card';
import { copy } from '@/lib/copy';

type PlaceholderPageProps = {
  icon?: React.ReactNode;
};

export function PlaceholderPage({ icon }: PlaceholderPageProps) {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="text-center max-w-sm w-full">
        {icon && <div className="flex justify-center mb-4 text-primary">{icon}</div>}
        <h2 className="text-lg font-semibold text-secondary mb-2">
          {copy.placeholder.comingSoon}
        </h2>
        <p className="text-neutral text-sm">{copy.placeholder.comingSoonDesc}</p>
      </Card>
    </div>
  );
}
