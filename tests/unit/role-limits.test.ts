import { describe, it, expect } from 'vitest';
import { canAccess, getAccessibleRoutes } from '@/lib/roles';
import type { RouteKey } from '@/lib/roles';

const ALL_ROUTES: RouteKey[] = [
  'miPerfil', 'equipo', 'calendario', 'solicitudPasaje',
  'solicitudAusencia', 'aprobaciones', 'procedimientos',
  'rendicionGastos', 'formularios', 'gestionUsuarios',
];

const ADMIN_ONLY: RouteKey[] = ['equipo', 'aprobaciones', 'gestionUsuarios'];
const SHARED: RouteKey[] = [
  'miPerfil', 'calendario', 'solicitudPasaje',
  'solicitudAusencia', 'procedimientos', 'rendicionGastos', 'formularios',
];

// ─── Admin ────────────────────────────────────────────────────
describe('admin', () => {
  it('tiene acceso a todas las rutas', () => {
    ALL_ROUTES.forEach((route) => {
      expect(canAccess('admin', route), `admin debería acceder a ${route}`).toBe(true);
    });
  });

  it('getAccessibleRoutes devuelve todas las rutas', () => {
    expect(getAccessibleRoutes('admin').length).toBe(ALL_ROUTES.length);
  });

  it('accede a rutas exclusivas de admin', () => {
    ADMIN_ONLY.forEach((route) => {
      expect(canAccess('admin', route)).toBe(true);
    });
  });
});

// ─── Supervisor ───────────────────────────────────────────────
describe('supervisor', () => {
  it('accede a rutas compartidas', () => {
    SHARED.forEach((route) => {
      expect(canAccess('supervisor', route), `supervisor debería acceder a ${route}`).toBe(true);
    });
  });

  it('NO accede a rutas de admin (caso negativo)', () => {
    ADMIN_ONLY.forEach((route) => {
      expect(canAccess('supervisor', route), `supervisor NO debería acceder a ${route}`).toBe(false);
    });
  });

  it('getAccessibleRoutes no incluye rutas de admin', () => {
    const routes = getAccessibleRoutes('supervisor');
    ADMIN_ONLY.forEach((r) => {
      expect(routes).not.toContain(r);
    });
  });
});

// ─── Empleado ─────────────────────────────────────────────────
describe('empleado', () => {
  it('accede a rutas compartidas', () => {
    SHARED.forEach((route) => {
      expect(canAccess('empleado', route), `empleado debería acceder a ${route}`).toBe(true);
    });
  });

  it('NO accede a rutas de admin (caso negativo)', () => {
    ADMIN_ONLY.forEach((route) => {
      expect(canAccess('empleado', route), `empleado NO debería acceder a ${route}`).toBe(false);
    });
  });

  it('getAccessibleRoutes no incluye rutas de admin', () => {
    const routes = getAccessibleRoutes('empleado');
    ADMIN_ONLY.forEach((r) => {
      expect(routes).not.toContain(r);
    });
  });
});

// ─── Comparación entre roles ──────────────────────────────────
describe('comparación de roles', () => {
  it('admin tiene más rutas que supervisor', () => {
    expect(getAccessibleRoutes('admin').length).toBeGreaterThan(
      getAccessibleRoutes('supervisor').length
    );
  });

  it('supervisor tiene las mismas rutas accesibles que empleado', () => {
    expect(getAccessibleRoutes('supervisor').sort()).toEqual(
      getAccessibleRoutes('empleado').sort()
    );
  });
});
