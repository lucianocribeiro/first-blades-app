'use client';

import { copy } from '@/lib/copy';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ROLE_LABELS } from '@/lib/roles';
import type { Profile, EntrevistaTecnica } from '@/lib/db-types';

type ProfileViewProps = {
  profile: Profile;
  isAdmin: boolean;
};

function FieldRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-neutral font-medium uppercase tracking-wide">{label}</span>
      <span className="text-sm text-secondary">{value || copy.miPerfil.messages.noValue}</span>
    </div>
  );
}

export function ProfileView({ profile, isAdmin }: ProfileViewProps) {
  const entrevista = profile.entrevista_tecnica as EntrevistaTecnica | null;
  const tiposHabilitados = entrevista
    ? Object.entries(copy.miPerfil.adminFields.tiposTrabajo)
        .filter(([key]) => entrevista[key as keyof EntrevistaTecnica])
        .map(([, label]) => label)
    : [];

  return (
    <div className="space-y-6">
      {/* Datos personales */}
      <Card>
        <h3 className="text-base font-semibold text-secondary mb-4">
          {copy.miPerfil.sectionDatos}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FieldRow label={copy.miPerfil.fields.nombreCompleto} value={profile.full_name} />
          <FieldRow label={copy.miPerfil.fields.email}          value={profile.email} />
          <FieldRow label={copy.miPerfil.fields.telefono} value={profile.phone} />
          <FieldRow label={copy.miPerfil.fields.cuit}     value={profile.cuit} />
          <FieldRow label={copy.miPerfil.fields.windaId}  value={profile.winda_id} />
          <FieldRow label={copy.miPerfil.fields.dni}      value={profile.dni} />
          <FieldRow
            label={copy.miPerfil.fields.fechaIngreso}
            value={
              profile.fecha_ingreso
                ? new Date(profile.fecha_ingreso).toLocaleDateString('es-AR')
                : null
            }
          />
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-neutral font-medium uppercase tracking-wide">
              {copy.miPerfil.fields.rol}
            </span>
            <span className="text-sm text-secondary">{ROLE_LABELS[profile.role]}</span>
          </div>
          {/* estado: solo admin */}
          {isAdmin && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-neutral font-medium uppercase tracking-wide">
                {copy.miPerfil.fields.estado}
              </span>
              <StatusBadge status={profile.status} />
            </div>
          )}
        </div>

        {/* Solo admin: entrevista técnica */}
        {isAdmin && (
          <div className="mt-6 pt-5 border-t border-color-border">
            <h4 className="text-sm font-semibold text-secondary mb-3">
              {copy.miPerfil.adminFields.entrevistaTecnica}
            </h4>
            {tiposHabilitados.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {tiposHabilitados.map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200"
                  >
                    {label}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-neutral">{copy.miPerfil.messages.noValue}</p>
            )}
          </div>
        )}
      </Card>

      {/* Mensaje solo lectura para no-admin */}
      {!isAdmin && (
        <p className="text-xs text-neutral italic">{copy.miPerfil.readOnly}</p>
      )}
    </div>
  );
}
