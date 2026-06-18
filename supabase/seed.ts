// Script de seed: crea el primer admin leyendo FIRST_ADMIN_EMAIL del entorno.
// Uso: npm run seed
// Requiere en .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   FIRST_ADMIN_EMAIL y FIRST_ADMIN_PASSWORD (sin default; generá uno fuerte).

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminEmail = process.env.FIRST_ADMIN_EMAIL;
const adminPassword = process.env.FIRST_ADMIN_PASSWORD;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local');
}
if (!adminEmail) {
  throw new Error('Falta FIRST_ADMIN_EMAIL en .env.local');
}
if (!adminPassword) {
  throw new Error(
    'Falta FIRST_ADMIN_PASSWORD en .env.local. ' +
    'Generá una contraseña fuerte (mínimo 12 caracteres) y configurala antes de correr el seed.'
  );
}

const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users.find((u) => u.email === adminEmail);

  if (existing) {
    await admin.from('profiles').update({ role: 'admin' }).eq('id', existing.id);
    console.log(`✓ Admin actualizado: ${adminEmail}`);
    return;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: adminEmail,
    password: adminPassword,
    email_confirm: true,
    user_metadata: { full_name: 'Administrador' },
  });

  if (error) throw error;

  await admin
    .from('profiles')
    .update({ role: 'admin', full_name: 'Administrador' })
    .eq('id', data.user.id);

  console.log(`✓ Admin creado: ${adminEmail}`);
  console.log('  Cambiá la contraseña después del primer ingreso.');
}

main().catch((err) => {
  console.error('Error en seed:', err.message);
  process.exit(1);
});
