import { Clock, CheckCircle, XCircle, UserCheck, UserX } from 'lucide-react';
import { copy } from '@/lib/copy';
import type { Enums } from '@/supabase/types';

type Status =
  | Enums<'approval_status'>
  | Enums<'employee_status'>
  | Enums<'estado_dia'>;

type StatusBadgeProps = {
  status: Status;
  /** Sobrescribe el label por defecto (ej. concordancia de género: "Aprobada" en vez de "Aprobado"). */
  label?: string;
};

const config: Record<
  Status,
  { label: string; icon: React.ComponentType<{ size?: number }>; className: string }
> = {
  pendiente:             { label: copy.status.pendiente,             icon: Clock,       className: 'bg-amber-50 text-amber-700 border-amber-200' },
  aprobado:              { label: copy.status.aprobado,              icon: CheckCircle, className: 'bg-green-50 text-green-700 border-green-200' },
  rechazado:             { label: copy.status.rechazado,             icon: XCircle,     className: 'bg-red-50 text-red-700 border-red-200' },
  activo:                { label: copy.status.activo,                icon: UserCheck,   className: 'bg-green-50 text-green-700 border-green-200' },
  inactivo:              { label: copy.status.inactivo,              icon: UserX,       className: 'bg-gray-100 text-gray-600 border-gray-200' },
  trabajando:            { label: copy.status.trabajando,            icon: UserCheck,   className: 'bg-blue-50 text-blue-700 border-blue-200' },
  en_viaje:              { label: copy.status.en_viaje,              icon: Clock,       className: 'bg-purple-50 text-purple-700 border-purple-200' },
  en_franco:             { label: copy.status.en_franco,             icon: CheckCircle, className: 'bg-teal-50 text-teal-700 border-teal-200' },
  periodo_fuera_trabajo: { label: copy.status.periodo_fuera_trabajo, icon: XCircle,     className: 'bg-orange-50 text-orange-700 border-orange-200' },
};

export function StatusBadge({ status, label }: StatusBadgeProps) {
  const cfg = config[status];
  if (!cfg) return null;
  const Icon = cfg.icon;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.className}`}
    >
      <Icon size={11} />
      {label ?? cfg.label}
    </span>
  );
}
