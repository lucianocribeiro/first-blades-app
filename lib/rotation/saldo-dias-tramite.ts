// FB-F3-21: saldo derivado de días de trámite (consumidos/restantes por año
// calendario). Se calcula a partir de rotation_assignments — no hay tabla ni
// contador propio, así que "recalcula solo" si una celda se borra o le
// cambia el motivo: la próxima lectura ya refleja el estado real.
import { getBusinessToday } from './promote-estimated';

// Tope plano, no acumulable entre años. Constante de config, no tabla.
export const TOPE_DIAS_TRAMITE_ANUAL = 3;

// Rango [inicio, fin] del año calendario de `today` (YYYY-MM-DD), en la
// zona horaria del negocio vía getBusinessToday() — nunca UTC crudo.
export function getYearRange(today: string = getBusinessToday()): { start: string; end: string } {
  const year = today.slice(0, 4);
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

export type SaldoDiasTramiteEmployee = {
  id: string;
  full_name: string | null;
  email: string;
};

export type DiaTramiteRow = {
  user_id: string;
  fecha: string;
  es_estimado: boolean;
};

// `esEstimado` es metadata de DISPLAY únicamente (la vista de empleado la usa
// para mostrar "Planificado" junto a la fecha, copy.calendario.leyenda.estimado
// — nunca la palabra "estimado" a secas). No participa del conteo: ver nota
// abajo, es_estimado SÍ suma al consumo.
export type FechaConsumida = {
  fecha: string;
  esEstimado: boolean;
};

export type SaldoDiasTramite = {
  employeeId: string;
  fullName: string | null;
  email: string;
  consumidos: number;
  restantes: number; // puede ser negativo
  excedido: boolean;
  fechas: FechaConsumida[]; // fechas consumidas del año, orden ascendente
};

// A diferencia de la racha de franco (francoAlerts.ts), acá `es_estimado`
// SÍ cuenta: un día de trámite planificado a futuro consume el cupo igual
// que uno ya confirmado (regla explícita, opuesta a la de franco a
// propósito — no copiar ese patrón de exclusión).
export function computeSaldoDiasTramite(
  employees: SaldoDiasTramiteEmployee[],
  dias: DiaTramiteRow[],
  tope: number = TOPE_DIAS_TRAMITE_ANUAL
): SaldoDiasTramite[] {
  const fechasPorEmpleado = new Map<string, FechaConsumida[]>();
  for (const dia of dias) {
    const entry: FechaConsumida = { fecha: dia.fecha, esEstimado: dia.es_estimado };
    const list = fechasPorEmpleado.get(dia.user_id);
    if (list) {
      list.push(entry);
    } else {
      fechasPorEmpleado.set(dia.user_id, [entry]);
    }
  }

  return employees.map((emp) => {
    const fechas = (fechasPorEmpleado.get(emp.id) ?? [])
      .slice()
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
    const consumidos = fechas.length;
    return {
      employeeId: emp.id,
      fullName: emp.full_name,
      email: emp.email,
      consumidos,
      restantes: tope - consumidos,
      excedido: consumidos > tope,
      fechas,
    };
  });
}
