import type { Enums } from '@/supabase/types';
import { copy } from '@/lib/copy';

export type UserRole = Enums<'user_role'>;

export type RouteKey =
  | 'miPerfil'
  | 'equipo'
  | 'calendario'
  | 'solicitudPasaje'
  | 'solicitudAusencia'
  | 'aprobaciones'
  | 'procedimientos'
  | 'rendicionGastos'
  | 'formularios'
  | 'gestionUsuarios';

const roleAccess: Record<RouteKey, UserRole[]> = {
  miPerfil:          ['admin', 'supervisor', 'empleado'],
  equipo:            ['admin'],
  calendario:        ['admin', 'supervisor', 'empleado'],
  solicitudPasaje:   ['admin', 'supervisor', 'empleado'],
  solicitudAusencia: ['admin', 'supervisor', 'empleado'],
  aprobaciones:      ['admin'],
  procedimientos:    ['admin', 'supervisor', 'empleado'],
  rendicionGastos:   ['admin', 'supervisor', 'empleado'],
  formularios:       ['admin', 'supervisor', 'empleado'],
  gestionUsuarios:   ['admin'],
};

export function canAccess(role: UserRole, route: RouteKey): boolean {
  return roleAccess[route].includes(role);
}

export function getAccessibleRoutes(role: UserRole): RouteKey[] {
  return (Object.keys(roleAccess) as RouteKey[]).filter((key) =>
    roleAccess[key].includes(role)
  );
}

// Labels desde copy — única fuente de verdad para strings es-AR
export const ROLE_LABELS: Record<UserRole, string> = copy.roles;
