/**
 * Tests de render (Testing Library) — panel de alertas de franco (FB-F3-09)
 *
 * Cubre: fila muestra empleado, tipo, racha y umbral; estado vacío cuando
 * no hay alertas; el nivel 2 (segundo umbral, más urgente) se distingue
 * visualmente del nivel 1.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FrancoAlertPanel } from '@/app/(app)/calendario/FrancoAlertPanel';
import { copy } from '@/lib/copy';
import type { FrancoAlertRow } from '@/app/(app)/calendario/francoAlerts';

describe('FrancoAlertPanel (render)', () => {
  it('estado vacío: muestra el mensaje de "sin alertas" cuando no hay filas', () => {
    render(<FrancoAlertPanel rows={[]} />);
    expect(screen.getByText(copy.calendario.alertasFranco.sinAlertas)).toBeInTheDocument();
  });

  it('fila muestra empleado, tipo, racha (valor) y umbral alcanzado', () => {
    const rows: FrancoAlertRow[] = [
      {
        employeeId: 'emp-1',
        fullName: 'Juan Pérez',
        email: 'juan@test.com',
        tipo: 'sin_franco',
        valor: 52,
        umbral: 48,
        nivel: 1,
      },
    ];
    render(<FrancoAlertPanel rows={rows} />);

    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
    expect(screen.getByText(copy.calendario.alertasFranco.tipos.sin_franco)).toBeInTheDocument();
    expect(screen.getByText(`52 ${copy.calendario.alertasFranco.diasLabel}`)).toBeInTheDocument();
    expect(screen.getByText('48')).toBeInTheDocument();
  });

  it('usa el email cuando no hay full_name', () => {
    const rows: FrancoAlertRow[] = [
      {
        employeeId: 'emp-2',
        fullName: null,
        email: 'pedro@test.com',
        tipo: 'franco_excedido',
        valor: 11,
        umbral: 10,
        nivel: 1,
      },
    ];
    render(<FrancoAlertPanel rows={rows} />);
    expect(screen.getByText('pedro@test.com')).toBeInTheDocument();
  });

  it('un empleado puede aparecer con ambas alertas simultáneamente', () => {
    const rows: FrancoAlertRow[] = [
      {
        employeeId: 'emp-3',
        fullName: 'Ana Ruiz',
        email: 'ana@test.com',
        tipo: 'sin_franco',
        valor: 60,
        umbral: 60,
        nivel: 2,
      },
      {
        employeeId: 'emp-3',
        fullName: 'Ana Ruiz',
        email: 'ana@test.com',
        tipo: 'franco_excedido',
        valor: 12,
        umbral: 12,
        nivel: 2,
      },
    ];
    render(<FrancoAlertPanel rows={rows} />);
    expect(screen.getAllByText('Ana Ruiz')).toHaveLength(2);
  });

  it('nivel 2 (segundo umbral) se distingue visualmente del nivel 1 (clases de color distintas)', () => {
    const rows: FrancoAlertRow[] = [
      {
        employeeId: 'emp-1',
        fullName: 'Nivel Uno',
        email: 'n1@test.com',
        tipo: 'sin_franco',
        valor: 48,
        umbral: 48,
        nivel: 1,
      },
      {
        employeeId: 'emp-2',
        fullName: 'Nivel Dos',
        email: 'n2@test.com',
        tipo: 'sin_franco',
        valor: 60,
        umbral: 60,
        nivel: 2,
      },
    ];
    render(<FrancoAlertPanel rows={rows} />);

    const badgeNivel1 = screen.getByText('48');
    const badgeNivel2 = screen.getByText('60');
    expect(badgeNivel1.className).toContain('warning');
    expect(badgeNivel2.className).toContain('error');
    expect(badgeNivel1.className).not.toBe(badgeNivel2.className);
  });
});
