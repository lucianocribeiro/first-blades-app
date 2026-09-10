// FB-F3-FIX-01 — Test dirigido a la clase de bug que las unit (RTL/jsdom) no
// pueden detectar: la clase CSS existe en el DOM pero NO en la hoja de estilos
// compilada, así que la celda se pinta transparente.
//
// jsdom no aplica CSS real: un test de RTL puede afirmar que el <button> tiene
// class="bg-calendar-enFranco/35" y pasar en verde mientras el navegador no
// pinta nada — exactamente lo que pasó con el bug recO3SGuYGiB2qEJ3 (un franco
// PLANIFICADO se veía "en blanco" en vez de rojo). Solo un motor real puede
// afirmar el background-color computado, de ahí este pass de e2e.
//
// Complementa al guard de tests/unit/calendario-clases-tailwind.test.ts (que
// compila Tailwind y verifica que la clase se emita): acá se verifica el
// último tramo, que el navegador efectivamente la pinte sobre la celda.
import { test, expect, type Page, type Locator } from '@playwright/test';
import {
  login,
  credentialsFor,
  resolveUserId,
  seedRotationAssignment,
  clearRotationAssignments,
  exactLabel,
} from './helpers';
import { copy } from '../../lib/copy';

// Tokens de marca del calendario (tailwind.config.ts → colors.calendar):
// en_franco = #C62828 = rgb(198, 40, 40). La variante PLANIFICADA es el mismo
// color al 35%. Chromium serializa el computed style con alfa como rgba(...).
const FRANCO_REAL = 'rgb(198, 40, 40)';
const FRANCO_PLANIFICADO = 'rgba(198, 40, 40, 0.35)';
const TRANSPARENTE = 'rgba(0, 0, 0, 0)';

const NOMBRE_EMPLEADO = 'E2E Empleado';

// Mes objetivo: 18 meses adelante.
//
// Todos sus días son futuros, así que el pintado por rango los marca
// PLANIFICADOS (es_estimado = fecha > hoy) — que es la variante que se quiere
// probar. Y está deliberadamente MÁS LEJOS que cualquier fecha que use el
// resto de la suite (la más lejana es futureDate(200)): esta spec borra y
// pinta días del empleado E2E, y con un mes más cercano pisaría fechas de
// otras specs. Con `fullyParallel` eso sería un flake cruzado difícil de leer;
// a +18 meses las specs no se tocan.
function mesObjetivo(): { year: number; month: number } {
  const hoy = new Date();
  const d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 18, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

const MES = mesObjetivo();

function dia(n: number): string {
  return `${MES.year}-${String(MES.month).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
}

function rango(desde: number, hasta: number): string[] {
  return Array.from({ length: hasta - desde + 1 }, (_, i) => dia(desde + i));
}

// La celda se ubica por el prefijo del aria-label ("Nombre — fecha — …"), sin
// incluir el estado: así el mismo locator sirve antes y después de pintar.
function celda(page: Page, fecha: string): Locator {
  return page.locator(`button[aria-label^="${NOMBRE_EMPLEADO} — ${fecha} — "]`);
}

async function colorDeFondo(cell: Locator): Promise<string> {
  return cell.evaluate((el) => getComputedStyle(el).backgroundColor);
}

async function irAlCalendario(page: Page): Promise<void> {
  await page.goto(`/calendario?year=${MES.year}&month=${MES.month}`);
  await expect(celda(page, dia(1))).toBeVisible();
}

// Pinta [desde..hasta] de la fila del empleado con shift-click + modal de
// rango, y devuelve el texto del reporte que muestra el modal al terminar.
async function pintarRango(page: Page, desde: number, hasta: number, estado: string): Promise<void> {
  await celda(page, dia(desde)).click({ modifiers: ['Shift'] });
  await celda(page, dia(hasta)).click({ modifiers: ['Shift'] });

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog
    .getByLabel(exactLabel(copy.calendario.modal.fields.estado))
    .selectOption({ label: estado });
  await dialog.getByRole('button', { name: copy.calendario.range.modal.guardar, exact: true }).click();

  const total = hasta - desde + 1;
  const r = copy.calendario.range.resultado;
  await expect(dialog).toContainText(`${r.aplicaronPrefijo} ${total} ${r.de} ${total} ${r.diasPlural}.`);
  await expect(dialog).not.toContainText(r.fallaronTitulo);

  // OJO: dentro del <dialog> hay DOS botones cuyo accessible name es
  // "Cerrar" — la X del header de Modal (aria-label = copy.general.close) y
  // el botón del footer (texto = copy.calendario.range.modal.cerrar). Los dos
  // strings son iguales, así que getByRole a secas es una strict mode
  // violation. Se filtra por TEXTO visible: la X solo tiene un ícono.
  await dialog
    .getByRole('button', { name: copy.calendario.range.modal.cerrar, exact: true })
    .filter({ hasText: copy.calendario.range.modal.cerrar })
    .click();
  await expect(dialog).not.toBeVisible();
}

// Afirma que cada día del rango quedó pintado como franco PLANIFICADO —
// visible, no transparente. Recarga primero para leer el estado ya persistido.
async function esperarFrancoPlanificado(page: Page, fechas: string[]): Promise<void> {
  await irAlCalendario(page);
  for (const fecha of fechas) {
    const cell = celda(page, fecha);
    await expect(cell, `${fecha} debería estar marcado como franco`).toHaveAttribute(
      'aria-label',
      `${NOMBRE_EMPLEADO} — ${fecha} — ${copy.status.en_franco}`
    );
    const bg = await colorDeFondo(cell);
    expect(bg, `${fecha} quedó SIN pintar (transparente): la clase de fondo no existe en el CSS`).not.toBe(
      TRANSPARENTE
    );
    expect(bg, `${fecha} no tiene el color de franco planificado`).toBe(FRANCO_PLANIFICADO);
  }
}

test.describe('Calendario: las celdas planificadas se pintan de verdad (no quedan en blanco)', () => {
  test('una celda de franco PLANIFICADA tiene fondo rojo translúcido, no transparente', async ({ page }) => {
    const empleadoId = await resolveUserId(credentialsFor('empleado').email);
    await clearRotationAssignments({ userId: empleadoId, desde: dia(5), hasta: dia(6) });
    // El día 5 planificado (la variante rota) y el 6 real (la que siempre
    // anduvo), para comparar en la misma corrida.
    await seedRotationAssignment({ userId: empleadoId, fecha: dia(5), estadoDia: 'en_franco', esEstimado: true });
    await seedRotationAssignment({ userId: empleadoId, fecha: dia(6), estadoDia: 'en_franco', esEstimado: false });

    await login(page, 'admin');
    await irAlCalendario(page);

    const planificada = celda(page, dia(5));
    const real = celda(page, dia(6));

    // El corazón del bug: el fondo computado NO puede ser transparente.
    const bgPlanificada = await colorDeFondo(planificada);
    expect(
      bgPlanificada,
      'La celda planificada quedó transparente: la clase de fondo está en el DOM pero no existe en el CSS compilado.'
    ).not.toBe(TRANSPARENTE);
    expect(bgPlanificada).toBe(FRANCO_PLANIFICADO);

    // …y tiene que seguir distinguiéndose del día real (intención visual del
    // PRD Fase 3 #2: planificado en tono más claro, no idéntico ni invisible).
    expect(await colorDeFondo(real)).toBe(FRANCO_REAL);
    expect(bgPlanificada).not.toBe(FRANCO_REAL);
  });

  test('regresión: franco por rango de 6 días TODOS futuros — los 6 quedan visibles', async ({ page }) => {
    // El caso reportado en prod: el admin pinta un franco largo a futuro y
    // los días planificados desaparecen. Franco no tiene tope: los 6 se
    // aplican y los 6 se ven.
    const empleadoId = await resolveUserId(credentialsFor('empleado').email);
    await clearRotationAssignments({ userId: empleadoId, desde: dia(10), hasta: dia(15) });

    await login(page, 'admin');
    await irAlCalendario(page);
    await pintarRango(page, 10, 15, copy.status.en_franco);

    await esperarFrancoPlanificado(page, rango(10, 15));
  });

  test('borde: el rango pisa días ya asignados y repintarlo es idempotente', async ({ page }) => {
    const empleadoId = await resolveUserId(credentialsFor('empleado').email);
    await clearRotationAssignments({ userId: empleadoId, desde: dia(18), hasta: dia(23) });
    // Días ya asignados DENTRO del rango, con otro estado: el upsert por día
    // (onConflict user_id,fecha) tiene que pisarlos sin fallar.
    await seedRotationAssignment({ userId: empleadoId, fecha: dia(19), estadoDia: 'trabajando', esEstimado: true });
    await seedRotationAssignment({ userId: empleadoId, fecha: dia(22), estadoDia: 'en_viaje', esEstimado: true });

    await login(page, 'admin');
    await irAlCalendario(page);

    await pintarRango(page, 18, 23, copy.status.en_franco);
    await esperarFrancoPlanificado(page, rango(18, 23));

    // Segunda pasada sobre el MISMO rango, ahora con las 6 filas existentes:
    // 6 de 6 otra vez, sin fallas y sin cambiar el resultado visual.
    await pintarRango(page, 18, 23, copy.status.en_franco);
    await esperarFrancoPlanificado(page, rango(18, 23));
  });
});
