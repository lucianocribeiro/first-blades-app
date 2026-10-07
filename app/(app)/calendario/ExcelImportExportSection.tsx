'use client';

import { useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { copy } from '@/lib/copy';

// FB-PI-12: agrupa los paneles de export e import de Excel en un bloque
// colapsable, para que no le quiten lugar al calendario.
//
// Siempre arranca CERRADO y no recuerda el estado (decisión de Luciano: se
// usa pocas veces, recordarlo agrega complejidad sin beneficio) — a
// diferencia de las otras secciones de CalendarioSections, que lo guardan en
// cookie. Por eso el estado es local y no pasa por collapseState.
//
// Recibe los paneles como children: page.tsx decide del lado del servidor
// qué se renderiza (solo admin), y este componente solo decide si se ve. No
// es el control de acceso: lo son requireAdmin() en las actions y la guarda
// de la RPC.
//
// Colapsado, CollapsibleSection no renderiza el contenido: cerrarlo a mitad
// de una previsualización la descarta, y para confirmar hay que volver a
// previsualizar (nunca habilita escribir algo no visto).
export function ExcelImportExportSection({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const t = copy.calendario.excel.seccion;

  return (
    <CollapsibleSection
      title={t.title}
      subtitle={t.subtitle}
      icon={<FileSpreadsheet size={18} className="text-primary shrink-0" />}
      expanded={expanded}
      onToggle={() => setExpanded((prev) => !prev)}
    >
      {children}
    </CollapsibleSection>
  );
}
