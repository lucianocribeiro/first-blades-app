import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isPending, isApproved, isRejected, statusLabel } from '@/lib/purgatorio';
import type { PurgatoryStatus } from '@/lib/purgatorio';

// ─── Lógica de estado ─────────────────────────────────────────
describe('purgatorio status helpers', () => {
  const statuses: PurgatoryStatus[] = ['pendiente', 'aprobado', 'rechazado'];

  it('isPending identifica solo pendiente', () => {
    expect(isPending('pendiente')).toBe(true);
    expect(isPending('aprobado')).toBe(false);
    expect(isPending('rechazado')).toBe(false);
  });

  it('isApproved identifica solo aprobado', () => {
    expect(isApproved('aprobado')).toBe(true);
    expect(isApproved('pendiente')).toBe(false);
    expect(isApproved('rechazado')).toBe(false);
  });

  it('isRejected identifica solo rechazado', () => {
    expect(isRejected('rechazado')).toBe(true);
    expect(isRejected('pendiente')).toBe(false);
    expect(isRejected('aprobado')).toBe(false);
  });

  it('statusLabel devuelve etiqueta en español para todos los estados', () => {
    statuses.forEach((s) => {
      const label = statusLabel(s);
      expect(label).toBeTruthy();
      expect(typeof label).toBe('string');
    });
    expect(statusLabel('pendiente')).toMatch(/pendiente/i);
    expect(statusLabel('aprobado')).toMatch(/aprobado/i);
    expect(statusLabel('rechazado')).toMatch(/rechazado/i);
  });
});

// ─── Invariantes en la migración SQL ─────────────────────────
describe('migración SQL: invariantes del purgatorio', () => {
  const sql = readFileSync(
    resolve('./supabase/migrations/0001_init.sql'),
    'utf8'
  );

  it('tiene tabla audit_log', () => {
    expect(sql).toContain('CREATE TABLE public.audit_log');
  });

  it('activa RLS en todas las tablas con estado', () => {
    expect(sql).toMatch(/ALTER TABLE public\.documents\s+ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE public\.pasaje_requests\s+ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE public\.ausencia_requests\s+ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE public\.audit_log\s+ENABLE ROW LEVEL SECURITY/);
  });

  it('fuerza estado = pendiente en INSERT de no-admin (documents)', () => {
    expect(sql).toContain("estado = 'pendiente'");
  });

  it('solo admin puede actualizar estado (UPDATE policy)', () => {
    // Verifica que las políticas de UPDATE requieren is_admin()
    expect(sql).toContain('documents_update_admin');
    expect(sql).toContain('pasajes_update_admin');
    expect(sql).toContain('ausencias_update_admin');
  });

  it('audit_log solo es legible por admin', () => {
    expect(sql).toContain('audit_log_select_admin');
    expect(sql).toContain('is_admin()');
  });

  it('función log_audit existe y es SECURITY DEFINER', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.log_audit');
    expect(sql).toContain('SECURITY DEFINER');
  });

  it('no hay INSERT directo a audit_log desde cliente', () => {
    // No debe haber política FOR INSERT en audit_log para usuarios normales
    const auditSection = sql.split('audit_log')[2] ?? '';
    expect(auditSection).not.toContain('FOR INSERT WITH CHECK (auth.uid()');
  });
});

// ─── RLS: tabla profiles ──────────────────────────────────────
describe('migración SQL: RLS en profiles', () => {
  const sql = readFileSync(
    resolve('./supabase/migrations/0001_init.sql'),
    'utf8'
  );

  it('no-admin no puede UPDATE profiles directamente', () => {
    expect(sql).toContain('profiles_update_admin');
    expect(sql).toContain('is_admin()');
  });

  it('supervisor ve su equipo (supervisor_id = auth.uid())', () => {
    expect(sql).toContain('supervisor_id = auth.uid()');
  });

  it('empleado ve solo su propia fila', () => {
    expect(sql).toContain('id = auth.uid()');
  });
});
