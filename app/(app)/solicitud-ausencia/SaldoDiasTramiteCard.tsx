import { Card } from '@/components/ui/Card';
import { copy } from '@/lib/copy';
import type { SaldoDiasTramite } from '@/lib/rotation/saldo-dias-tramite';

// FB-F3-21: saldo del propio empleado (o supervisor, que también envía sus
// días de trámite desde este formulario), derivado del calendario del año
// en curso. Mismo criterio que MisSolicitudesTable: sin query propia, recibe
// el saldo ya calculado por page.tsx.
function formatFecha(fecha: string): string {
  return new Date(`${fecha}T00:00:00`).toLocaleDateString('es-AR');
}

type SaldoDiasTramiteCardProps = {
  saldo: SaldoDiasTramite;
};

export function SaldoDiasTramiteCard({ saldo }: SaldoDiasTramiteCardProps) {
  const t = copy.solicitudAusencia.saldo;

  const mensaje = saldo.excedido
    ? t.excedido
    : saldo.restantes <= 0
      ? t.sinDisponibles
      : `${t.restantesPrefix} ${saldo.restantes} ${t.restantesSufijo}`;

  return (
    <Card>
      <h3 className="text-base font-semibold text-secondary mb-2">{t.title}</h3>
      <p className="text-sm text-neutral mb-3">{mensaje}</p>
      <div>
        <p className="text-xs font-medium text-neutral uppercase tracking-wide mb-1">{t.fechasTitle}</p>
        {saldo.fechas.length === 0 ? (
          <p className="text-sm text-neutral">{t.sinFechas}</p>
        ) : (
          <ul className="text-sm text-secondary space-y-0.5">
            {saldo.fechas.map(({ fecha, esEstimado }) => (
              <li key={fecha}>
                {formatFecha(fecha)}
                {esEstimado && (
                  <span className="ml-2 text-xs text-neutral">({copy.calendario.leyenda.estimado})</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
