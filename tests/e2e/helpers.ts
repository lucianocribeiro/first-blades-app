// Helpers compartidos por las specs de e2e (FB-F4-11).
//
// SOLO corre contra el stack efímero de CI/local (Supabase local, migrado y
// sembrado por `npm run seed:e2e`) — nunca contra producción. Las
// credenciales se leen de variables de entorno (nunca hardcodeadas acá),
// las mismas que usa `supabase/seed-e2e.ts` para crear admin/supervisor/
// empleado.
import { type Page, expect } from '@playwright/test';
import { createAdminClient } from '../../lib/supabase/admin';
import { copy } from '../../lib/copy';
import type { MotivoAusencia, MotivoViaje } from '../../lib/db-types';

export type Role = 'admin' | 'supervisor' | 'empleado';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. Corré \`npm run seed:e2e\` contra un Supabase ` +
      'local con las credenciales E2E_* exportadas antes de correr los tests de e2e (ver .env.example).'
    );
  }
  return value;
}

export function credentialsFor(role: Role): { email: string; password: string } {
  const prefix = role === 'admin' ? 'E2E_ADMIN' : role === 'supervisor' ? 'E2E_SUPERVISOR' : 'E2E_EMPLEADO';
  return {
    email: requireEnv(`${prefix}_EMAIL`),
    password: requireEnv(`${prefix}_PASSWORD`),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Matchea el accessible name EXACTO de un <label>, tolerando el "*" que
// Input/Select/Textarea/DatePicker le agregan cuando el campo es required
// (label + '*' en el mismo elemento — ver components/ui/Input.tsx). Sin
// esto: {exact:true} nunca matchea un campo required (el accessible name
// real es "Contraseña*", no "Contraseña"), y sin exact a secas, "Contraseña"
// matchea también "Mostrar/Ocultar contraseña" (aria-label del botón de
// ojito) por substring — ambos rompieron en corridas reales de CI.
export function exactLabel(text: string): RegExp {
  return new RegExp(`^${escapeRegExp(text)}\\*?$`);
}

// Login real vía el form nativo (no bypass de sesión) — ejercita el mismo
// camino que un usuario real: signInWithPassword() del lado del cliente +
// el middleware refrescando la sesión antes de redirigir a /dashboard.
export async function login(page: Page, role: Role): Promise<void> {
  const { email, password } = credentialsFor(role);
  await page.goto('/login');
  await page.getByLabel(exactLabel(copy.auth.login.email)).fill(email);
  await page.getByLabel(exactLabel(copy.auth.login.password)).fill(password);
  await page.getByRole('button', { name: copy.auth.login.submit, exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

// Fecha futura determinística en formato YYYY-MM-DD — lejos de cualquier
// borde de huso horario o de "hoy", para no depender de la hora de corrida
// frente a la validación de no-retroactiva (getBusinessToday(), huso
// Argentina). daysFromNow debería ser >= 2 para dar margen de sobra.
export function futureDate(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

// ─── Seed de datos vía cliente admin (bypassea RLS a propósito) ───────────
//
// Las specs de Aprobaciones necesitan solicitudes YA pendientes para poder
// ejercer aprobar/rechazar/previsualización de forma determinística, sin
// depender del orden de otras specs. Se insertan directo con el cliente
// admin (mismo `createAdminClient()` que usa la app), igual que
// `supabase/seed-e2e.ts` para los usuarios.

export async function resolveUserId(email: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.from('profiles').select('id').eq('email', email).single();
  if (error || !data) {
    throw new Error(`[e2e] no se encontró el perfil para ${email}: ${error?.message ?? 'sin datos'}`);
  }
  return data.id;
}

export async function seedRotationAssignment(opts: {
  userId: string;
  fecha: string;
  estadoDia?: 'trabajando' | 'en_franco';
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from('rotation_assignments').upsert(
    {
      user_id: opts.userId,
      fecha: opts.fecha,
      estado_dia: opts.estadoDia ?? 'trabajando',
      es_estimado: false,
    },
    { onConflict: 'user_id,fecha' }
  );
  if (error) throw new Error(`[e2e] no se pudo sembrar rotation_assignments: ${error.message}`);
}

export async function seedPendingAusencia(opts: {
  userId: string;
  fechaInicio: string;
  fechaFin: string;
  motivo?: MotivoAusencia;
  // Marcador único para que la spec ubique SU fila sin ambigüedad entre
  // varios pendientes en la misma bandeja (independiente del orden de specs).
  nota?: string;
}): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('ausencia_requests')
    .insert({
      user_id: opts.userId,
      motivo_ausencia: opts.motivo ?? 'vacaciones',
      fecha_inicio: opts.fechaInicio,
      fecha_fin: opts.fechaFin,
      notas: opts.nota ?? null,
      estado: 'pendiente',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`[e2e] no se pudo sembrar la ausencia pendiente: ${error?.message}`);
  return data.id;
}

export async function seedPendingPasaje(opts: {
  solicitanteId: string;
  empleadoId: string;
  diasViaje: string[];
  motivoViaje?: MotivoViaje;
  // Marcador único (recorrido) para que la spec ubique SU fila sin
  // ambigüedad — se muestra en la tabla como "origen → destino".
  destino?: string;
}): Promise<string> {
  const admin = createAdminClient();
  const diasOrdenados = [...opts.diasViaje].sort();
  const { data, error } = await admin
    .from('pasaje_requests')
    .insert({
      solicitante_id: opts.solicitanteId,
      empleado_id: opts.empleadoId,
      motivo_viaje: opts.motivoViaje ?? 'traslado_proyectos',
      fecha_viaje: diasOrdenados[0],
      origen: 'Base',
      destino: opts.destino ?? 'Sitio remoto',
      dias_viaje: diasOrdenados,
      estado: 'pendiente',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`[e2e] no se pudo sembrar el pasaje pendiente: ${error?.message}`);
  return data.id;
}
