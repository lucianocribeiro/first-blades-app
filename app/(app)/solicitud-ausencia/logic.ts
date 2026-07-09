import { copy } from '@/lib/copy';
import type { AusenciaRequestInsert } from '@/lib/db-types';

// Postgres SQLSTATE de unique_violation — dispara con el índice único parcial
// ausencia_requests_pendiente_unica (0012) cuando ya existe una solicitud
// pendiente para el mismo user_id/motivo/fecha.
const UNIQUE_VIOLATION = '23505';

export type CreateDiaTramiteInput = {
  fecha: string;
  nota?: string;
};

// Construye el payload de INSERT: motivo_ausencia y estado quedan fijos
// (nunca vienen del input del usuario), y fecha_inicio = fecha_fin porque
// un día de trámite es puntual (modelo de rango de la tabla, ver 0012).
export function buildAusenciaInsertPayload(
  userId: string,
  input: CreateDiaTramiteInput
): AusenciaRequestInsert {
  return {
    user_id:         userId,
    motivo_ausencia: 'dia_tramite',
    fecha_inicio:    input.fecha,
    fecha_fin:       input.fecha,
    notas:           input.nota?.trim() || null,
    estado:          'pendiente',
  };
}

// Traduce el choque con el índice único parcial a copy amigable.
// Devuelve null para cualquier otro error — la action no debe tragarlo,
// sino propagar el mensaje genérico.
export function translateAusenciaInsertError(
  error: { code?: string } | null | undefined
): string | null {
  if (!error) return null;
  if (error.code === UNIQUE_VIOLATION) return copy.solicitudAusencia.errors.pendienteDuplicada;
  return null;
}
