// Seed determinístico para los tests de e2e (Playwright, FB-F4-11).
// SOLO corre contra el stack efímero de CI/local (Supabase local recién
// levantado con `supabase start`, migraciones ya aplicadas) — nunca contra
// producción: no hay noción de "prod" acá, sólo NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY apuntando a lo que sea que esté en el entorno,
// así que esta variable SIEMPRE debe apuntar al Supabase local.
//
// Uso: npm run seed:e2e
// Requiere en el entorno: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// (del Supabase local — ver `supabase status`), y las credenciales de los 3
// roles: E2E_ADMIN_EMAIL/PASSWORD, E2E_SUPERVISOR_EMAIL/PASSWORD,
// E2E_EMPLEADO_EMAIL/PASSWORD — nunca hardcodeadas acá; en CI se generan al
// vuelo (ver .github/workflows/ci.yml), en local se setean en el shell antes
// de correr el script.
//
// Siembra: admin, un supervisor, y un empleado A CARGO de ese supervisor
// (profiles.supervisor_id) — el mínimo para ejercer el scope de equipo
// (ej. supervisor pidiendo pasaje para su empleado).
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name} (seed e2e).`);
  return value;
}

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno.');
}

const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function upsertAuthUser(email: string, password: string, fullName: string): Promise<string> {
  const { data: list, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;

  const existing = list?.users.find((u) => u.email === email);
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password });
    if (error) throw error;
    return existing.id;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  return data.user.id;
}

async function main() {
  const adminEmail = requireEnv('E2E_ADMIN_EMAIL');
  const adminPassword = requireEnv('E2E_ADMIN_PASSWORD');
  const supervisorEmail = requireEnv('E2E_SUPERVISOR_EMAIL');
  const supervisorPassword = requireEnv('E2E_SUPERVISOR_PASSWORD');
  const empleadoEmail = requireEnv('E2E_EMPLEADO_EMAIL');
  const empleadoPassword = requireEnv('E2E_EMPLEADO_PASSWORD');

  const adminId = await upsertAuthUser(adminEmail, adminPassword, 'E2E Admin');
  const supervisorId = await upsertAuthUser(supervisorEmail, supervisorPassword, 'E2E Supervisor');
  const empleadoId = await upsertAuthUser(empleadoEmail, empleadoPassword, 'E2E Empleado');

  // handle_new_user() (0001) ya insertó la fila de profiles con role='empleado'
  // por defecto al crear cada auth.users — acá se ajustan rol/jerarquía.
  const { error: adminErr } = await admin
    .from('profiles')
    .update({ role: 'admin', full_name: 'E2E Admin' })
    .eq('id', adminId);
  if (adminErr) throw adminErr;

  const { error: supervisorErr } = await admin
    .from('profiles')
    .update({ role: 'supervisor', full_name: 'E2E Supervisor' })
    .eq('id', supervisorId);
  if (supervisorErr) throw supervisorErr;

  const { error: empleadoErr } = await admin
    .from('profiles')
    .update({ role: 'empleado', full_name: 'E2E Empleado', supervisor_id: supervisorId })
    .eq('id', empleadoId);
  if (empleadoErr) throw empleadoErr;

  // Procedimientos (FB-F5-06): un vigente y un archivado, sembrados por
  // INSERT directo (no por la RPC — no hay sesión de usuario en un script
  // de seed) para que el spec de empleado tenga algo que ver/buscar sin
  // depender de que el spec de admin haya corrido antes.
  await admin.from('procedures').delete().eq('titulo', 'E2E Procedimiento Vigente');
  await admin.from('procedures').delete().eq('titulo', 'E2E Procedimiento Archivado');

  const { error: procVigenteErr } = await admin.from('procedures').insert({
    titulo: 'E2E Procedimiento Vigente',
    categoria: 'E2E Seguridad',
    contenido_texto: 'Contenido de prueba del procedimiento vigente sembrado para e2e.',
    created_by: adminId,
    updated_by: adminId,
    estado: 'vigente',
  });
  if (procVigenteErr) throw procVigenteErr;

  const { error: procArchivadoErr } = await admin.from('procedures').insert({
    titulo: 'E2E Procedimiento Archivado',
    categoria: 'E2E Seguridad',
    contenido_texto: 'Contenido de prueba del procedimiento archivado sembrado para e2e.',
    created_by: adminId,
    updated_by: adminId,
    estado: 'archivado',
  });
  if (procArchivadoErr) throw procArchivadoErr;

  console.log('✓ Seed e2e: admin, supervisor, empleado a cargo, y procedimientos (vigente + archivado) sembrados.');
}

main().catch((err) => {
  console.error('Error en seed e2e:', err.message);
  process.exit(1);
});
