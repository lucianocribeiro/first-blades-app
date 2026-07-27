// Helpers de presentación para filas de ausencia_requests, compartidos por
// MisSolicitudesTable (Solicitud de Ausencia) y AprobacionesTable (FB-F4-05):
// ambas necesitan mostrar el rango de fechas y el motivo (con su detalle
// libre si es 'otros') de la misma forma.
import { copy } from '@/lib/copy';
import type { MotivoAusencia } from '@/lib/db-types';

// fecha viene como 'YYYY-MM-DD' (columna date); T00:00:00 local evita que el
// locale corra un día por interpretarlo como UTC.
export function formatFechaAusencia(fecha: string): string {
  return new Date(`${fecha}T00:00:00`).toLocaleDateString('es-AR');
}

// Un día de trámite (y cualquier solicitud de un solo día) tiene
// fecha_inicio === fecha_fin: se muestra como fecha única, no como rango.
export function formatRangoAusencia(fechaInicio: string, fechaFin: string): string {
  if (fechaInicio === fechaFin) return formatFechaAusencia(fechaInicio);
  return `${formatFechaAusencia(fechaInicio)} – ${formatFechaAusencia(fechaFin)}`;
}

export function motivoAusenciaLabel(
  motivo: MotivoAusencia,
  motivoOtrosTexto?: string | null
): string {
  const base = copy.calendario.motivos[motivo];
  if (motivo === 'otros' && motivoOtrosTexto) return `${base} — ${motivoOtrosTexto}`;
  return base;
}
