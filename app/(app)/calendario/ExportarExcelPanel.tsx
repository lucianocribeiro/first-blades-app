'use client';

import { useState, useTransition } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DatePicker } from '@/components/ui/DatePicker';
import { copy } from '@/lib/copy';
import { exportarCalendarioExcel } from './export-actions';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

type ExportarExcelPanelProps = {
  // Rango sugerido: el mes visible en la grilla.
  defaultDesde: string;
  defaultHasta: string;
};

function descargar(base64: string, filename: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: XLSX_MIME }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// FB-PI-04: solo se renderiza para admin (page.tsx), pero ocultarlo no es el
// control — la action corta por requireAdmin() del lado del servidor.
export function ExportarExcelPanel({ defaultDesde, defaultHasta }: ExportarExcelPanelProps) {
  const t = copy.calendario.excel.panel;
  const [desde, setDesde] = useState(defaultDesde);
  const [hasta, setHasta] = useState(defaultHasta);
  const [error, setError] = useState<string | null>(null);
  const [exportado, setExportado] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleExport() {
    setError(null);
    setExportado(false);
    startTransition(async () => {
      const result = await exportarCalendarioExcel({ desde, hasta });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      descargar(result.base64, result.filename);
      setExportado(true);
    });
  }

  return (
    <Card padding="sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex items-start gap-3">
          <FileSpreadsheet size={20} className="text-primary shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-secondary">{t.title}</h3>
            <p className="text-xs text-neutral mt-0.5">{t.subtitle}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <DatePicker
            id="export-desde"
            label={t.desde}
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
            required
          />
          <DatePicker
            id="export-hasta"
            label={t.hasta}
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
            required
          />
          <Button type="button" onClick={handleExport} loading={isPending}>
            {t.exportar}
          </Button>
        </div>
      </div>
      {error && (
        <p className="text-sm text-error mt-3" role="alert">
          {error}
        </p>
      )}
      {exportado && (
        <p className="text-sm text-success mt-3" role="status">
          {t.exportado}
        </p>
      )}
    </Card>
  );
}
