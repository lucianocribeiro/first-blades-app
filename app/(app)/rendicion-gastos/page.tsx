import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ExternalLink } from 'lucide-react';
import { copy } from '@/lib/copy';

export default function RendicionGastosPage() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="text-center max-w-sm w-full">
        <ExternalLink size={32} className="text-primary mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-secondary mb-2">
          {copy.pages.rendicionGastos.title}
        </h2>
        <p className="text-neutral text-sm mb-6">
          {copy.placeholder.externalLink}
        </p>
        <Button
          variant="primary"
          icon={<ExternalLink size={16} />}
          onClick={() => {
            // La URL de Google Workspace se configura en Fase 3
          }}
          disabled
        >
          {copy.placeholder.externalBtn}
        </Button>
        <p className="text-xs text-neutral mt-3">
          {copy.placeholder.externalPending}
        </p>
      </Card>
    </div>
  );
}
