// FB-F3-09: alertas de franco derivadas de rotation_assignments (sin cron,
// sin mail — esa es FB-F3-10). Dos alertas espejo:
//   A) sin_franco: racha de días trabajados consecutivos sin franco (48/60).
//   B) franco_excedido: racha de en_franco consecutivos (10/12).
import type { EstadoDia } from '@/lib/db-types';
import { getBusinessToday } from '@/lib/rotation/promote-estimated';
import type { RosterEmployee } from './RosterGrid';

// Ventana de lectura hacia atrás desde hoy: cubre el umbral más alto (60)
// con margen, sin traer todo el histórico (PRD: "acotar la lectura a esa
// ventana por empleado").
export const FRANCO_ALERT_WINDOW_DAYS = 65;

export function getFrancoAlertWindowStart(
  today: string,
  windowDays: number = FRANCO_ALERT_WINDOW_DAYS
): string {
  const [y, m, d] = today.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, d - windowDays));
  return start.toISOString().split('T')[0];
}

type EstadoEfecto = 'suma' | 'resetea' | 'neutral';

export type FrancoAlertTipo = 'sin_franco' | 'franco_excedido';

type AlertaConfig = {
  tipo: FrancoAlertTipo;
  // Único lugar parametrizable del mapeo estado→efecto: cambiar qué estado
  // suma/resetea/es neutral para una alerta es editar esta tabla, no el
  // algoritmo de racha (computeStreak) de abajo.
  efectos: Record<EstadoDia, EstadoEfecto>;
  umbralPrimero: number;
  umbralSegundo: number;
};

export const FRANCO_ALERTAS: AlertaConfig[] = [
  {
    tipo: 'sin_franco',
    efectos: {
      trabajando: 'suma',
      en_franco: 'resetea',
      en_viaje: 'neutral',
      periodo_fuera_trabajo: 'neutral',
    },
    umbralPrimero: 48,
    umbralSegundo: 60,
  },
  {
    tipo: 'franco_excedido',
    efectos: {
      trabajando: 'resetea',
      en_franco: 'suma',
      en_viaje: 'neutral',
      periodo_fuera_trabajo: 'neutral',
    },
    umbralPrimero: 10,
    umbralSegundo: 12,
  },
];

export type FrancoAlertaDia = {
  user_id: string;
  fecha: string;
  estado_dia: EstadoDia;
  es_estimado: boolean;
};

export type FrancoAlertRow = {
  employeeId: string;
  fullName: string | null;
  email: string;
  tipo: FrancoAlertTipo;
  valor: number;
  umbral: number;
  nivel: 1 | 2;
};

function addDays(fecha: string, delta: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().split('T')[0];
}

function diaKey(userId: string, fecha: string): string {
  return `${userId}|${fecha}`;
}

// FB-F3-10 (fix de FB-F3-AUD-09, Hallazgo 1): camina por CADA fecha de
// calendario consecutiva desde `today` hacia atrás, no sobre las filas
// existentes. Un día SIN fila (hueco) corta la racha igual que un
// 'resetea': no hay dato de ese día, no se puede afirmar continuidad. Solo
// los estados mapeados como 'neutral' se saltean sin cortar. `index` debe
// tener SOLO días reales (es_estimado = false): un día estimado (o
// ausente) es indistinguible de un hueco, ambos cortan.
function computeStreak(
  index: Map<string, FrancoAlertaDia>,
  userId: string,
  today: string,
  windowDays: number,
  efectos: Record<EstadoDia, EstadoEfecto>
): number {
  let streak = 0;
  for (let i = 0; i < windowDays; i++) {
    const fecha = addDays(today, -i);
    const dia = index.get(diaKey(userId, fecha));
    if (!dia) break; // hueco: corta
    const efecto = efectos[dia.estado_dia];
    if (efecto === 'resetea') break;
    if (efecto === 'suma') streak++;
    // 'neutral': ni suma ni corta, sigue a la fecha anterior.
  }
  return streak;
}

// Agrega, por empleado, las alertas de franco vigentes hoy. Un día
// estimado no entra al índice (se comporta como hueco, ver computeStreak).
// `windowDays` acota cuántas fechas hacia atrás camina el walker — el
// mismo tamaño de la ventana que se leyó de la base (FRANCO_ALERT_WINDOW_DAYS
// por default); más allá de eso ya no hay datos, así que un hueco cortaría
// igual. Un empleado puede aparecer 0, 1 (una alerta) o 2 veces (ambas
// alertas simultáneamente); si alcanzó el segundo umbral, no se muestra
// también el primero (el umbral alcanzado es el más alto).
export function computeFrancoAlerts(
  employees: RosterEmployee[],
  dias: FrancoAlertaDia[],
  today: string = getBusinessToday(),
  windowDays: number = FRANCO_ALERT_WINDOW_DAYS
): FrancoAlertRow[] {
  const index = new Map<string, FrancoAlertaDia>();
  for (const dia of dias) {
    if (dia.es_estimado) continue;
    index.set(diaKey(dia.user_id, dia.fecha), dia);
  }

  const rows: FrancoAlertRow[] = [];
  for (const emp of employees) {
    for (const alerta of FRANCO_ALERTAS) {
      const valor = computeStreak(index, emp.id, today, windowDays, alerta.efectos);
      if (valor >= alerta.umbralSegundo) {
        rows.push({
          employeeId: emp.id,
          fullName: emp.full_name,
          email: emp.email,
          tipo: alerta.tipo,
          valor,
          umbral: alerta.umbralSegundo,
          nivel: 2,
        });
      } else if (valor >= alerta.umbralPrimero) {
        rows.push({
          employeeId: emp.id,
          fullName: emp.full_name,
          email: emp.email,
          tipo: alerta.tipo,
          valor,
          umbral: alerta.umbralPrimero,
          nivel: 1,
        });
      }
    }
  }

  return rows;
}
