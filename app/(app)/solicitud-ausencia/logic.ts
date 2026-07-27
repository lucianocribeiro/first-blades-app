import { copy } from '@/lib/copy';
import { getBusinessToday } from '@/lib/business-date';
import type { AusenciaRequestInsert, MotivoAusencia } from '@/lib/db-types';

// Postgres SQLSTATE de exclusion_violation — dispara con la exclusion
// constraint ausencia_requests_no_solapamiento_pendiente (0014) cuando ya
// existe una solicitud pendiente del mismo user_id cuyo rango se solapa,
// sea cual sea el motivo de cualquiera de las dos.
const EXCLUSION_VIOLATION = '23P01';

export type CreateAusenciaInput = {
  motivo: MotivoAusencia;
  fechaInicio: string;
  fechaFin: string;
  motivoOtrosTexto?: string;
  nota?: string;
};

export type ValidateAusenciaInput = {
  motivo: MotivoAusencia | '';
  fechaInicio: string;
  fechaFin: string;
  motivoOtrosTexto?: string;
};

export type ValidationResult = { valid: true } | { valid: false; error: string };

// Regla de negocio compartida por cliente (UX, con la fecha local del
// navegador) y server (autoridad, con getBusinessToday() — zona horaria del
// negocio). No es un CHECK de base: CURRENT_DATE no es inmutable, así que
// "no-retroactiva" vive en la capa de app (FB-F4-05), igual que el scope de
// motivo de la resolución.
export function validateAusenciaRequestInput(
  input: ValidateAusenciaInput,
  today: string = getBusinessToday()
): ValidationResult {
  if (!input.motivo) {
    return { valid: false, error: copy.solicitudAusencia.errors.motivoRequerido };
  }

  if (!input.fechaInicio || !input.fechaFin) {
    return { valid: false, error: copy.solicitudAusencia.errors.fechaRequerida };
  }

  // Comparación lexicográfica de 'YYYY-MM-DD': válida para fechas ISO, sin
  // necesidad de parsear a Date (mismo criterio que calendario/utils.ts).
  if (input.fechaFin < input.fechaInicio) {
    return { valid: false, error: copy.solicitudAusencia.errors.fechaFinAnteriorAInicio };
  }

  if (input.fechaInicio < today) {
    return { valid: false, error: copy.solicitudAusencia.errors.fechaRetroactiva };
  }

  if (input.motivo === 'otros') {
    const texto = input.motivoOtrosTexto?.trim() ?? '';
    if (texto.length === 0) {
      return { valid: false, error: copy.solicitudAusencia.errors.motivoOtrosRequerido };
    }
    if (texto.length > 80) {
      return { valid: false, error: copy.solicitudAusencia.errors.motivoOtrosMaximo };
    }
  }

  return { valid: true };
}

// Construye el payload de INSERT: user_id y estado quedan fijos (nunca
// vienen del input del usuario). motivo_otros_texto solo se persiste cuando
// el motivo es 'otros' — para cualquier otro motivo se fuerza a null, igual
// que el patrón ya usado en calendario (CellEditModal/RangeEditModal).
export function buildAusenciaInsertPayload(
  userId: string,
  input: CreateAusenciaInput
): AusenciaRequestInsert {
  return {
    user_id:            userId,
    motivo_ausencia:    input.motivo,
    motivo_otros_texto: input.motivo === 'otros' ? (input.motivoOtrosTexto?.trim() || null) : null,
    fecha_inicio:       input.fechaInicio,
    fecha_fin:          input.fechaFin,
    notas:              input.nota?.trim() || null,
    estado:             'pendiente',
  };
}

// Traduce el choque con la exclusion constraint a copy amigable, para
// cualquier motivo (el rango se solapa con otra pendiente del mismo
// empleado, sea cual sea el motivo de cualquiera de las dos solicitudes).
// Devuelve null para cualquier otro error — la action no debe tragarlo,
// sino propagar el mensaje genérico.
export function translateAusenciaInsertError(
  error: { code?: string } | null | undefined
): string | null {
  if (!error) return null;
  if (error.code === EXCLUSION_VIOLATION) return copy.solicitudAusencia.errors.pendienteDuplicada;
  return null;
}
