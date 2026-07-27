// Opciones de `motivo_ausencia` para cualquier <Select> de la app (calendario,
// Solicitud de Ausencia). Extraído de app/(app)/calendario/CellEditModal.tsx
// (FB-F4-05) para que Solicitud de Ausencia lo reuse sin importar un módulo
// 'use client' de otra ruta ni duplicar el mapeo enum → copy.
import { copy } from '@/lib/copy';
import type { MotivoAusencia } from '@/lib/db-types';

export const MOTIVO_OPTIONS: { value: MotivoAusencia; label: string }[] = [
  { value: 'vacaciones', label: copy.calendario.motivos.vacaciones },
  { value: 'licencia_medica', label: copy.calendario.motivos.licencia_medica },
  { value: 'dia_tramite', label: copy.calendario.motivos.dia_tramite },
  { value: 'matrimonio', label: copy.calendario.motivos.matrimonio },
  { value: 'fallecimiento', label: copy.calendario.motivos.fallecimiento },
  { value: 'otros', label: copy.calendario.motivos.otros },
];
