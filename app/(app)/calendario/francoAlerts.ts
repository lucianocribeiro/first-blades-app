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

// Camina hacia atrás desde el día más reciente (asume `diasDesc` ya ordenado
// descendente por fecha): suma en 'suma', corta en 'resetea', salvo en
// 'neutral' (ni suma ni corta, sigue mirando hacia atrás).
function computeStreak(diasDesc: FrancoAlertaDia[], efectos: Record<EstadoDia, EstadoEfecto>): number {
  let streak = 0;
  for (const dia of diasDesc) {
    const efecto = efectos[dia.estado_dia];
    if (efecto === 'resetea') break;
    if (efecto === 'suma') streak++;
  }
  return streak;
}

// Agrega, por empleado, las alertas de franco vigentes hoy. Solo cuenta
// días reales (es_estimado = false) con fecha <= hoy (zona horaria de
// negocio, ver getBusinessToday) — un día futuro o estimado no participa
// de la racha. Un empleado puede aparecer 0, 1 (una alerta) o 2 veces
// (ambas alertas simultáneas); si alcanzó el segundo umbral, no se muestra
// también el primero (el umbral alcanzado es el más alto).
export function computeFrancoAlerts(
  employees: RosterEmployee[],
  dias: FrancoAlertaDia[],
  today: string = getBusinessToday()
): FrancoAlertRow[] {
  const porEmpleado = new Map<string, FrancoAlertaDia[]>();
  for (const emp of employees) porEmpleado.set(emp.id, []);

  for (const dia of dias) {
    if (dia.es_estimado) continue;
    if (dia.fecha > today) continue;
    const lista = porEmpleado.get(dia.user_id);
    if (!lista) continue;
    lista.push(dia);
  }

  const rows: FrancoAlertRow[] = [];
  for (const emp of employees) {
    const diasEmpleado = porEmpleado.get(emp.id) ?? [];
    const diasDesc = [...diasEmpleado].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));

    for (const alerta of FRANCO_ALERTAS) {
      const valor = computeStreak(diasDesc, alerta.efectos);
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
