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
