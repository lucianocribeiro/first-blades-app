import { copy } from '@/lib/copy';
import type { EstadoDia } from '@/lib/db-types';

const ESTADOS: { key: EstadoDia; bgClass: string }[] = [
  { key: 'trabajando', bgClass: 'bg-calendar-trabajando' },
  { key: 'en_viaje', bgClass: 'bg-calendar-enViaje' },
  { key: 'en_franco', bgClass: 'bg-calendar-enFranco' },
  { key: 'periodo_fuera_trabajo', bgClass: 'bg-calendar-fueraTrabajo' },
];

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-neutral">
      <span className="font-semibold text-secondary">{copy.calendario.leyenda.title}</span>
      {ESTADOS.map((e) => (
        <span key={e.key} className="flex items-center gap-1.5">
          <span className={`inline-block w-3 h-3 rounded ${e.bgClass}`} />
          {copy.status[e.key]}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded bg-calendar-vacio" />
        {copy.calendario.leyenda.sinCargar}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded bg-calendar-trabajando/35" />
        {copy.calendario.leyenda.estimado}
      </span>
    </div>
  );
}
