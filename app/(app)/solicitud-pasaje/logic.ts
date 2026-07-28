import { copy } from '@/lib/copy';
import { getBusinessToday } from '@/lib/business-date';
import { sortDiasViaje } from '@/lib/rotation/pasaje-display';
import type { PasajeRequestInsert, MotivoViaje } from '@/lib/db-types';

export type CreatePasajeInput = {
  motivoViaje: MotivoViaje;
  origen: string;
  destino: string;
  diasViaje: string[];
  nota?: string;
};

export type ValidatePasajeInput = {
  motivoViaje: MotivoViaje | '';
  origen: string;
  destino: string;
  diasViaje: string[];
};

export type ValidationResult = { valid: true } | { valid: false; error: string };

// Regla de negocio compartida por cliente (UX) y server (autoridad, con
// getBusinessToday() — zona horaria del negocio). No es un CHECK de base:
// CURRENT_DATE no es inmutable, así que "no-retroactiva" vive en la capa de
// app (mismo criterio que solicitud-ausencia/logic.ts). A diferencia de
// ausencia (un rango fecha_inicio/fecha_fin), acá se revisa CADA día
// discreto de dias_viaje: un viaje puede tener días sueltos, y alcanza con
// que uno solo sea anterior a hoy para rechazar toda la solicitud.
export function validatePasajeRequestInput(
  input: ValidatePasajeInput,
  today: string = getBusinessToday()
): ValidationResult {
  if (!input.motivoViaje) {
    return { valid: false, error: copy.solicitudPasaje.errors.motivoRequerido };
  }

  if (!input.origen.trim()) {
    return { valid: false, error: copy.solicitudPasaje.errors.origenRequerido };
  }

  if (!input.destino.trim()) {
    return { valid: false, error: copy.solicitudPasaje.errors.destinoRequerido };
  }

  if (input.diasViaje.length === 0) {
    return { valid: false, error: copy.solicitudPasaje.errors.diasRequeridos };
  }

  if (input.diasViaje.some((dia) => dia < today)) {
    return { valid: false, error: copy.solicitudPasaje.errors.diaRetroactivo };
  }

  return { valid: true };
}

// Construye el payload de INSERT: solicitante_id/empleado_id y estado nunca
// vienen del input del usuario (los resuelve la action, con la
// revalidación de scope). dias_viaje se ordena y dedupea antes de persistir.
export function buildPasajeInsertPayload(
  solicitanteId: string,
  empleadoId: string,
  input: CreatePasajeInput
): PasajeRequestInsert {
  const diasOrdenados = sortDiasViaje([...new Set(input.diasViaje)]);

  return {
    solicitante_id: solicitanteId,
    empleado_id:    empleadoId,
    motivo_viaje:   input.motivoViaje,
    // fecha_viaje: columna legacy (single date, NOT NULL) previa a dias_viaje
    // (migración 0016) — se completa con el primer día ordenado para no
    // romper el NOT NULL. dias_viaje es la fuente de verdad real; ver el
    // comentario de la migración 0016 para la reconciliación de la columna.
    fecha_viaje:    diasOrdenados[0],
    origen:         input.origen.trim(),
    destino:        input.destino.trim(),
    dias_viaje:     diasOrdenados,
    notas:          input.nota?.trim() || null,
    estado:         'pendiente',
  };
}
