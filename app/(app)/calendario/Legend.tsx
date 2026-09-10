import { copy } from '@/lib/copy';
import { ESTADO_BG_CLASS, ESTADO_BG_CLASS_ESTIMADO, CELDA_VACIA_BG_CLASS } from './utils';
import type { EstadoDia } from '@/lib/db-types';

// Orden de la leyenda (no es el orden del enum: es el que le sirve al admin
// para leer la grilla). Las clases NO se declaran acá — salen del SSOT de
// utils.ts, para que la referencia visual y la grilla no puedan divergir.
// Antes esta lista repetía el mapeo estado→clase, y era además el único lugar
// donde la variante translúcida de trabajando quedaba escrita entera: por eso
// esa sola existía en el CSS y las otras tres no (FB-F3-FIX-01). No escribir
// esas clases completas en comentarios — ver la nota en utils.ts.
const ESTADOS: EstadoDia[] = ['trabajando', 'en_viaje', 'en_franco', 'periodo_fuera_trabajo'];

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-neutral">
      <span className="font-semibold text-secondary">{copy.calendario.leyenda.title}</span>
      {ESTADOS.map((estado) => (
        <span key={estado} className="flex items-center gap-1.5">
          <span className={`inline-block w-3 h-3 rounded ${ESTADO_BG_CLASS[estado]}`} />
          {copy.status[estado]}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className={`inline-block w-3 h-3 rounded ${CELDA_VACIA_BG_CLASS}`} />
        {copy.calendario.leyenda.sinCargar}
      </span>
      <span className="flex items-center gap-1.5">
        <span className={`inline-block w-3 h-3 rounded ${ESTADO_BG_CLASS_ESTIMADO.trabajando}`} />
        {copy.calendario.leyenda.estimado}
      </span>
    </div>
  );
}
