'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from './Card';

type CollapsibleSectionProps = {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

// Encabezado colapsable reutilizable: un único lugar para la lógica de
// expandir/colapsar una sección (evita repetirla por cada tarjeta). El
// botón de encabezado es nativo (operable por teclado sin trabajo extra) y
// expone aria-expanded. Colapsada, el contenido no se renderiza.
export function CollapsibleSection({
  title,
  subtitle,
  icon,
  expanded,
  onToggle,
  children,
}: CollapsibleSectionProps) {
  return (
    <Card padding="sm">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center justify-between gap-2 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="flex items-center gap-2 min-w-0">
          {icon}
          <span className="text-base font-semibold text-secondary truncate">{title}</span>
        </span>
        {expanded ? (
          <ChevronDown size={18} className="text-neutral shrink-0" />
        ) : (
          <ChevronRight size={18} className="text-neutral shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {subtitle && <p className="text-sm text-neutral">{subtitle}</p>}
          {children}
        </div>
      )}
    </Card>
  );
}
