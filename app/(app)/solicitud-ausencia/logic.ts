import { copy } from '@/lib/copy';
import type { AusenciaRequestInsert } from '@/lib/db-types';

// Postgres SQLSTATE de exclusion_violation — dispara con la exclusion
// constraint ausencia_requests_no_solapamiento_pendiente (0014) cuando ya
// existe una solicitud pendiente del mismo user_id cuyo rango se solapa
// (mismo motivo o no; un día de trámite es un rango de un solo día).
const EXCLUSION_VIOLATION = '23P01';

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

// Traduce el choque con la exclusion constraint a copy amigable.
// Devuelve null para cualquier otro error — la action no debe tragarlo,
// sino propagar el mensaje genérico.
export function translateAusenciaInsertError(
  error: { code?: string } | null | undefined
): string | null {
  if (!error) return null;
  if (error.code === EXCLUSION_VIOLATION) return copy.solicitudAusencia.errors.pendienteDuplicada;
  return null;
}
