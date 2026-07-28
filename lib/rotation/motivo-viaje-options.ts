// Opciones de `motivo_viaje` para el <Select> de Solicitud de Pasaje.
// Mismo patrón que motivo-options.ts (motivo_ausencia).
import { copy } from '@/lib/copy';
import type { MotivoViaje } from '@/lib/db-types';

export const MOTIVO_VIAJE_OPTIONS: { value: MotivoViaje; label: string }[] = [
  { value: 'inicio_franco', label: copy.solicitudPasaje.motivos.inicio_franco },
  { value: 'fin_franco', label: copy.solicitudPasaje.motivos.fin_franco },
  { value: 'traslado_proyectos', label: copy.solicitudPasaje.motivos.traslado_proyectos },
];
