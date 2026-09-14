/**
 * FB-PI-01 — Campanita del admin: badge de aprobaciones pendientes + link a
 * Aprobaciones, y límite de rol para los 3 roles (constitución §13).
 *
 *  - Topbar (render real con Testing Library): afirma el resultado VISIBLE
 *    — si el badge existe, qué texto muestra, a dónde lleva la campanita —,
 *    no strings de clases.
 *  - AppLayout (server component invocado directo): el conteo se consulta
 *    SOLO para admin; supervisor y empleado no disparan ninguna lectura ni
 *    reciben número.
 *  - Guard de CSS compilado: las clases del badge existen en el CSS que
 *    emite Tailwind (bug del franco, PR #49: una clase que el JIT no emitió
 *    deja el elemento invisible aunque el atributo class esté en el DOM).
 */

import { vi, describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import tailwindConfig from '@/tailwind.config';

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/aprobaciones', () => ({ contarAprobacionesPendientes: vi.fn() }));

import { requireAuth } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { contarAprobacionesPendientes } from '@/lib/aprobaciones';
import AppLayout from '@/app/(app)/layout';
import { AppShell } from '@/components/layout/AppShell';
import { Topbar, CAMPANITA_BADGE_CLASS } from '@/components/layout/Topbar';
import { copy } from '@/lib/copy';
import type { UserRole } from '@/lib/roles';

function renderTopbar(aprobacionesPendientes?: number) {
  return render(
    <Topbar onMenuToggle={() => {}} userName="Ana" aprobacionesPendientes={aprobacionesPendientes} />
  );
}

// ─── Topbar: badge y navegación ──────────────────────────────

describe('Topbar — campanita con aprobaciones pendientes', () => {
  it('con pendientes: badge con el número y la campanita lleva a /aprobaciones', () => {
    renderTopbar(3);

    const campanita = screen.getByRole('link', {
      name: `${copy.topbar.aprobacionesPendientesPrefijo} 3 ${copy.topbar.aprobacionesPendientesSufijo}`,
    });
    expect(campanita).toHaveAttribute('href', '/aprobaciones');
    expect(within(campanita).getByTestId('campanita-badge')).toHaveTextContent(/^3$/);
  });

  it('con 1 pendiente: aria-label en singular', () => {
    renderTopbar(1);
    expect(
      screen.getByRole('link', {
        name: `${copy.topbar.aprobacionesPendientesPrefijo} 1 ${copy.topbar.aprobacionesPendientesSufijoUna}`,
      })
    ).toBeInTheDocument();
    expect(screen.getByTestId('campanita-badge')).toHaveTextContent(/^1$/);
  });

  it('con 0 pendientes: NO hay badge (tampoco un "0"), pero sigue llevando a Aprobaciones', () => {
    renderTopbar(0);

    const campanita = screen.getByRole('link', { name: copy.topbar.aprobacionesSinPendientes });
    expect(campanita).toHaveAttribute('href', '/aprobaciones');
    expect(screen.queryByTestId('campanita-badge')).not.toBeInTheDocument();
    expect(campanita).not.toHaveTextContent('0');
  });

  it('muestra el número exacto hasta 99', () => {
    renderTopbar(99);
    expect(screen.getByTestId('campanita-badge')).toHaveTextContent(/^99$/);
  });

  it('de 100 en adelante muestra "99+" (el aria-label conserva el número real)', () => {
    renderTopbar(150);
    expect(screen.getByTestId('campanita-badge')).toHaveTextContent(copy.topbar.aprobacionesPendientesTope);
    expect(
      screen.getByRole('link', {
        name: `${copy.topbar.aprobacionesPendientesPrefijo} 150 ${copy.topbar.aprobacionesPendientesSufijo}`,
      })
    ).toBeInTheDocument();
  });

  it('sin número (no admin): campanita inerte como antes — sin badge y sin link a Aprobaciones', () => {
    renderTopbar(undefined);

    expect(screen.getByRole('button', { name: copy.topbar.notifications })).toBeInTheDocument();
    expect(screen.queryByTestId('campanita-badge')).not.toBeInTheDocument();
    expect(document.querySelector('a[href="/aprobaciones"]')).toBeNull();
  });
});

// ─── AppLayout: límite de rol (3 roles) ───────────────────────

type ElementLike = { type?: unknown; props?: Record<string, unknown> };

async function layoutFor(role: UserRole): Promise<ElementLike> {
  vi.mocked(requireAuth).mockResolvedValue({
    id: `${role}-1`,
    role,
    full_name: 'Usuario',
    email: `${role}@firstblades.test`,
    status: 'activo',
  } as never);
  const tree = (await AppLayout({ children: null })) as ElementLike;
  expect(tree.type).toBe(AppShell);
  return tree;
}

describe('AppLayout — el contador es solo de admin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createServerClient).mockResolvedValue({} as never);
    vi.mocked(contarAprobacionesPendientes).mockResolvedValue(4);
  });

  it('admin: consulta el conteo y lo baja a AppShell', async () => {
    const tree = await layoutFor('admin');
    expect(contarAprobacionesPendientes).toHaveBeenCalledTimes(1);
    expect(tree.props!.aprobacionesPendientes).toBe(4);
  });

  it.each<UserRole>(['supervisor', 'empleado'])(
    '%s: no consulta nada y no recibe número',
    async (role) => {
      const tree = await layoutFor(role);
      expect(contarAprobacionesPendientes).not.toHaveBeenCalled();
      expect(tree.props!.aprobacionesPendientes).toBeUndefined();
    }
  );

  it('admin con lectura fallida (helper → null): degrada a 0, el layout renderiza igual', async () => {
    vi.mocked(contarAprobacionesPendientes).mockResolvedValue(null);
    const tree = await layoutFor('admin');
    expect(tree.props!.aprobacionesPendientes).toBe(0);
  });

  it.each<[UserRole, boolean]>([
    ['admin', true],
    ['supervisor', false],
    ['empleado', false],
  ])('%s → badge visible en la topbar: %s', async (role, esperaBadge) => {
    const tree = await layoutFor(role);
    render(
      <Topbar
        onMenuToggle={() => {}}
        userName="Usuario"
        aprobacionesPendientes={tree.props!.aprobacionesPendientes as number | undefined}
      />
    );
    if (esperaBadge) {
      expect(screen.getByTestId('campanita-badge')).toHaveTextContent(/^4$/);
    } else {
      expect(screen.queryByTestId('campanita-badge')).not.toBeInTheDocument();
    }
  });
});

// ─── Guard: las clases del badge existen en el CSS compilado ──

const declaracionesPorSelector = new Map<string, string>();

beforeAll(async () => {
  const result = await postcss([tailwindcss(tailwindConfig)]).process('@tailwind utilities;', {
    from: undefined,
  });
  result.root.walkRules((rule) => {
    const previo = declaracionesPorSelector.get(rule.selector) ?? '';
    declaracionesPorSelector.set(rule.selector, `${previo}${rule.nodes.map(String).join(';')};`);
  });
}, 60_000);

// Escapa los caracteres especiales de la clase tal como Tailwind los emite en
// el selector (`min-w-[18px]` → `.min-w-\[18px\]`, `-top-0.5` → `.-top-0\.5`).
function ruleFor(className: string): string | undefined {
  return declaracionesPorSelector.get(`.${className.replace(/([[\]./])/g, '\\$1')}`);
}

describe('campanita — clases del badge en el CSS compilado', () => {
  it.each(CAMPANITA_BADGE_CLASS.split(/\s+/))('la clase %s se emitió al CSS', (clase) => {
    expect(
      ruleFor(clase),
      `La clase "${clase}" del badge NO está en el CSS compilado: revisá que esté escrita literal.`
    ).toBeDefined();
  });

  it('el badge pinta fondo (bg-error) y texto (text-white) — no queda transparente', () => {
    expect(ruleFor('bg-error')).toContain('background-color');
    expect(ruleFor('text-white')).toContain('color');
  });
});
