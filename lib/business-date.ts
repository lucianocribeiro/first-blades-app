// Fecha de negocio (Argentina), sin dependencias server-only — importable
// tanto desde código server (actions, cron) como desde componentes cliente
// (validación de UX). Extraído de lib/rotation/promote-estimated.ts (FB-F4-05):
// ese módulo importa el cliente admin de Supabase a nivel de archivo, así que
// no es seguro importarlo desde un componente 'use client'.
const BUSINESS_TIMEZONE = 'America/Argentina/Buenos_Aires';

// Fecha local YYYY-MM-DD en la zona horaria del negocio (Argentina), no UTC
// crudo. Evita que un límite de fecha se corra un día por el offset AR
// (UTC-3): a las 00:00–02:59 UTC todavía es "ayer" en Argentina.
export function getBusinessToday(referenceDate: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE }).format(referenceDate);
}

// ¿`date` cae dentro de los últimos `days` días de calendario (Argentina),
// contando el día de hoy como día 0? Usado por el badge "Nuevo" de
// Procedimientos (FB-F5-06): 7 días de ventana, borde exacto en el día 7
// (día 6 todavía es "nuevo", día 7 ya no). Comparación por día de
// calendario en huso AR, no por milisegundos crudos — evita que el badge
// dependa de la hora exacta de publicación.
export function isWithinBusinessDays(
  date: string | Date,
  days: number,
  referenceDate: Date = new Date()
): boolean {
  const targetDay = getBusinessToday(new Date(date));
  const today = getBusinessToday(referenceDate);
  const diffDays = Math.round((Date.parse(today) - Date.parse(targetDay)) / 86_400_000);
  return diffDays >= 0 && diffDays < days;
}
