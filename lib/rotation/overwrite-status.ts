// Contrato de previsualización de sobrescritura (FB-F4-06), compartido por
// la cola de Aprobaciones (aprobar pisa un día ya cargado) y la vista de
// Solicitudes Aprobadas (editar fechas pisa un día ya cargado) — mismo
// significado en los dos: 'ok' distingue días=[] (nada que sobrescribir) de
// 'error' (no se pudo calcular); ambos casos son no bloqueantes.
import type { EstadoDia } from '@/lib/db-types';

export type OverwriteDay = { fecha: string; estado_dia: EstadoDia; es_estimado: boolean };

export type OverwriteStatus = { status: 'ok'; days: OverwriteDay[] } | { status: 'error' };
