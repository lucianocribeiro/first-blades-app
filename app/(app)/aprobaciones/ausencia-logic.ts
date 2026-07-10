import { copy } from '@/lib/copy';

// resolver_ausencia_request (0013) usa el mismo SQLSTATE '22023' para varias
// validaciones internas (acción inválida, motivo obligatorio, solicitud ya
// resuelta) — la app ya evita los otros dos casos antes de invocar la RPC
// (p_accion es un literal fijo, motivo se valida en app), así que el único
// 22023 que puede llegar acá en la práctica es la condición de carrera. Se
// matchea por el texto del mensaje (no solo el código) para no confundirlo
// con una futura validación que reutilice el mismo SQLSTATE.
const RACE_CONDITION_PATTERN = /ya fue resuelta/i;

// Traduce el error de "otro admin ya la resolvió" a copy amigable.
// Devuelve null para cualquier otro error — la action no debe tragarlo,
// sino propagar el mensaje genérico.
export function translateResolverAusenciaError(
  error: { message?: string } | null | undefined
): string | null {
  if (!error?.message) return null;
  if (RACE_CONDITION_PATTERN.test(error.message)) {
    return copy.aprobaciones.messages.alreadyResolved;
  }
  return null;
}
