// Helpers de presentación para filas de pasaje_requests, compartidos por
// MisSolicitudesPasajeTable (Solicitud de Pasaje) y AprobacionesTable
// (FB-F4-10) — mismo criterio que ausencia-display.ts para ausencia_requests.
import { copy } from '@/lib/copy';
import type { MotivoViaje } from '@/lib/db-types';

export function motivoViajeLabel(motivo: MotivoViaje): string {
  return copy.solicitudPasaje.motivos[motivo];
}

// fecha viene como 'YYYY-MM-DD' (columna date); T00:00:00 local evita que el
// locale corra un día por interpretarlo como UTC (mismo criterio que
// formatFechaAusencia).
function formatFechaViaje(fecha: string): string {
  return new Date(`${fecha}T00:00:00`).toLocaleDateString('es-AR');
}

// dias_viaje es un array de fechas discretas (no un rango): se listan todas,
// ordenadas, separadas por coma — a diferencia de formatRangoAusencia, que
// colapsa un rango contiguo en "inicio – fin".
export function formatDiasViaje(diasViaje: string[]): string {
  return sortDiasViaje(diasViaje).map(formatFechaViaje).join(', ');
}

export function sortDiasViaje(diasViaje: string[]): string[] {
  return [...diasViaje].sort();
}
