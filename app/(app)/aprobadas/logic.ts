import { copy } from '@/lib/copy';
import { getBusinessToday } from '@/lib/business-date';

export type ValidationResult = { valid: true } | { valid: false; error: string };

// No-retroactiva de las fechas NUEVAS al editar (FB-F4-14 §3.3): la RPC
// (0017) ya aborta si p_nueva_fecha_fin < p_nueva_fecha_inicio (FB-F4-13),
// pero no valida contra "hoy" — esa regla, igual que en la creación
// (solicitud-ausencia/logic.ts), vive en la capa de app porque CURRENT_DATE
// no es un valor estable para un CHECK. today se inyecta para tests
// determinísticos; en producción usa getBusinessToday() (huso Argentina).
export function validateFechasEdicionAusencia(
  fechaInicio: string,
  fechaFin: string,
  today: string = getBusinessToday()
): ValidationResult {
  if (!fechaInicio || !fechaFin) {
    return { valid: false, error: copy.aprobadas.errors.fechaRequerida };
  }
  // Comparación lexicográfica de 'YYYY-MM-DD' — mismo criterio que
  // solicitud-ausencia/logic.ts. La RPC también aborta este caso (defensa
  // en profundidad, FB-F4-13), pero acá se valida antes de invocarla para
  // dar un copy amigable sin depender del mensaje crudo de Postgres.
  if (fechaFin < fechaInicio) {
    return { valid: false, error: copy.aprobadas.errors.fechaFinAnteriorAInicio };
  }
  if (fechaInicio < today) {
    return { valid: false, error: copy.aprobadas.errors.fechaRetroactiva };
  }
  return { valid: true };
}

// Análogo para pasaje: días discretos, no un rango — cada día se revisa
// individualmente (mismo criterio que solicitud-pasaje/logic.ts).
export function validateDiasEdicionPasaje(
  dias: string[],
  today: string = getBusinessToday()
): ValidationResult {
  if (dias.length === 0) {
    return { valid: false, error: copy.aprobadas.errors.diasRequeridos };
  }
  if (dias.some((dia) => dia < today)) {
    return { valid: false, error: copy.aprobadas.errors.diaRetroactivo };
  }
  return { valid: true };
}

// El detalle de qué aprobación(es) resolver primero, tal cual lo arma la RPC
// (0017): "tipo id (fechas, aprobada reviewed_at); tipo id (...)".
const LIFO_BLOCK_PATTERN =
  /hay aprobaciones posteriores que se superponen y deben resolverse primero: (.+)$/;

// cancelar_editar_ausencia_aprobada / cancelar_editar_pasaje_aprobado (0017)
// usan el mismo SQLSTATE '22023' para varias guardas internas (comentario
// obligatorio, acción inválida, rango invertido, reviewed_at NULL, etc.) —
// la app ya evita disparar la mayoría de esas antes de invocar la RPC
// (comentario/fechas se validan acá mismo, p_accion es un literal fijo), así
// que en la práctica sólo dos casos llegan con regularidad: el bloqueo LIFO
// y una condición de carrera (otro admin ya canceló/editó/la solicitud dejó
// de estar aprobada entre la re-lectura y la invocación). Se matchea por el
// TEXTO del mensaje, no solo el código — mismo criterio que
// aprobaciones/ausencia-logic.ts::translateResolverAusenciaError.
const RACE_CONDITION_PATTERN = /no está aprobada|ya fue cancelada|no existe/i;

// Traduce el error de la RPC a copy amigable es-AR. Devuelve null para
// cualquier otro error — la action no debe tragarlo, sino propagar el
// mensaje genérico (mismo contrato que translateResolverAusenciaError).
export function translateCancelarEditarError(
  error: { message?: string } | null | undefined
): string | null {
  if (!error?.message) return null;

  const lifoMatch = error.message.match(LIFO_BLOCK_PATTERN);
  if (lifoMatch) {
    return `${copy.aprobadas.errors.lifoBloqueo} ${lifoMatch[1]}`;
  }

  if (RACE_CONDITION_PATTERN.test(error.message)) {
    return copy.aprobadas.errors.yaNoVigente;
  }

  return null;
}
