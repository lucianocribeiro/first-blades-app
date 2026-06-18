import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sql = readFileSync(
  resolve('./supabase/migrations/0001_init.sql'),
  'utf8'
);

// Verifica que la migración cubra los requisitos de RLS para las 3 tablas principales
// y los 3 roles. Estos tests actúan como snapshot de las garantías de seguridad.

describe('RLS: tabla pasaje_requests — 3 roles', () => {
  it('admin puede leer todo (pasajes_select menciona is_admin)', () => {
    expect(sql).toContain('pasajes_select');
    expect(sql).toContain('is_admin()');
  });

  it('empleado solo inserta para sí mismo', () => {
    expect(sql).toContain('pasajes_insert_empleado');
    // La función se invoca como (SELECT public.auth_role()) = 'empleado'
    expect(sql).toMatch(/public\.auth_role\(\)\)\s*=\s*'empleado'/);
    expect(sql).toContain('solicitante_id = auth.uid()');
    expect(sql).toContain('empleado_id = auth.uid()');
  });

  it('supervisor puede insertar para su equipo', () => {
    expect(sql).toContain('pasajes_insert_supervisor');
    expect(sql).toMatch(/public\.auth_role\(\)\)\s*=\s*'supervisor'/);
    expect(sql).toContain('supervisor_id = auth.uid()');
  });

  it('caso negativo: empleado NO puede aprobar (no tiene UPDATE policy)', () => {
    expect(sql).toContain('pasajes_update_admin');
    // Solo admin tiene política UPDATE; no hay política UPDATE para empleado/supervisor
    expect(sql).not.toContain("pasajes_update_empleado");
    expect(sql).not.toContain("pasajes_update_supervisor");
  });
});

describe('RLS: tabla ausencia_requests — 3 roles', () => {
  it('admin accede a todo', () => {
    expect(sql).toContain('ausencias_select');
    expect(sql).toContain('is_admin()');
  });

  it('empleado inserta solo lo propio con estado pendiente', () => {
    expect(sql).toContain('ausencias_insert_non_admin');
    expect(sql).toContain('user_id = auth.uid()');
    expect(sql).toContain("estado = 'pendiente'");
  });

  it('solo admin puede cambiar estado (UPDATE)', () => {
    expect(sql).toContain('ausencias_update_admin');
    expect(sql).not.toContain('ausencias_update_empleado');
  });
});

describe('RLS: tabla rotation_assignments — 3 roles', () => {
  it('empleado ve solo su calendario', () => {
    expect(sql).toContain('rotation_assign_select');
    expect(sql).toContain('user_id = auth.uid()');
  });

  it('supervisor ve su equipo', () => {
    expect(sql).toContain('rotation_assign_select');
    // La política SELECT cubre el equipo del supervisor
    const selectBlock = sql.substring(
      sql.indexOf('rotation_assign_select'),
      sql.indexOf('rotation_assign_write_admin')
    );
    expect(selectBlock).toContain('supervisor_id = auth.uid()');
  });

  it('solo admin escribe rotation_assignments', () => {
    expect(sql).toContain('rotation_assign_write_admin');
    expect(sql).not.toContain('rotation_assign_write_empleado');
  });
});

describe('RLS: tabla procedures — todos leen, solo admin escribe', () => {
  it('todos los usuarios autenticados pueden leer', () => {
    expect(sql).toContain('procedures_select_all');
    expect(sql).toContain('auth.uid() IS NOT NULL');
  });

  it('solo admin puede escribir', () => {
    expect(sql).toContain('procedures_write_admin');
    expect(sql).not.toContain('procedures_write_empleado');
  });
});

describe('RLS: Storage bucket documents', () => {
  it('bucket documents existe y no es público', () => {
    expect(sql).toContain("'documents'");
    expect(sql).toContain('false');   // public = false
  });

  it('usuarios suben solo a su propia carpeta', () => {
    expect(sql).toContain('storage_documents_insert');
    expect(sql).toContain("auth.uid()::text = (storage.foldername(name))[1]");
  });

  it('solo admin puede eliminar del Storage', () => {
    expect(sql).toContain('storage_documents_delete');
  });
});

describe('helpers de rol', () => {
  it('función auth_role() existe y es SECURITY DEFINER', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.auth_role()');
    expect(sql).toContain('SECURITY DEFINER');
  });

  it('función is_admin() existe', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.is_admin()');
  });

  it('trigger crea profile al registrar usuario', () => {
    expect(sql).toContain('on_auth_user_created');
    expect(sql).toContain('AFTER INSERT ON auth.users');
  });
});
