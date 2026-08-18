'use client';

import { useState, useTransition } from 'react';
import { copy } from '@/lib/copy';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { updateProfile } from './actions';
import type { Profile, EntrevistaTecnica } from '@/lib/db-types';

type ProfileEditFormProps = {
  profile: Profile;
};

const statusOptions = [
  { value: 'activo',    label: copy.status.activo },
  { value: 'inactivo',  label: copy.status.inactivo },
];

const TIPOS_TRABAJO = Object.entries(copy.miPerfil.adminFields.tiposTrabajo) as [
  keyof EntrevistaTecnica,
  string
][];

export function ProfileEditForm({ profile }: ProfileEditFormProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const entrevistaInit = (profile.entrevista_tecnica ?? {}) as EntrevistaTecnica;

  const [fullName,     setFullName]     = useState(profile.full_name ?? '');
  const [phone,        setPhone]        = useState(profile.phone ?? '');
  const [cuit,         setCuit]         = useState(profile.cuit ?? '');
  const [windaId,      setWindaId]      = useState(profile.winda_id ?? '');
  const [dni,          setDni]          = useState(profile.dni ?? '');
  const [fechaIngreso, setFechaIngreso] = useState(profile.fecha_ingreso ?? '');
  const [status,       setStatus]       = useState<Profile['status']>(profile.status);
  const [entrevista,   setEntrevista]   = useState<EntrevistaTecnica>(entrevistaInit);

  function toggleTipo(key: keyof EntrevistaTecnica) {
    setEntrevista((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    startTransition(async () => {
      try {
        await updateProfile({
          id: profile.id,
          full_name: fullName, phone, cuit, winda_id: windaId,
          dni, fecha_ingreso: fechaIngreso || undefined,
          status, entrevista_tecnica: entrevista,
        });
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : copy.miPerfil.messages.updateError);
      }
    });
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        {copy.miPerfil.editButton}
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={copy.miPerfil.editButton}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>
              {copy.general.cancel}
            </Button>
            <Button variant="primary" type="submit" form="profile-edit-form" loading={isPending}>
              {copy.miPerfil.saveButton}
            </Button>
          </>
        }
      >
        <form id="profile-edit-form" onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={copy.miPerfil.fields.nombreCompleto}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder={copy.miPerfil.placeholders.nombreCompleto}
          />

          <Input
            label={copy.miPerfil.fields.email}
            value={profile.email}
            readOnly
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label={copy.miPerfil.fields.telefono}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={copy.miPerfil.placeholders.telefono}
            />
            <Input
              label={copy.miPerfil.fields.cuit}
              value={cuit}
              onChange={(e) => setCuit(e.target.value)}
              placeholder={copy.miPerfil.placeholders.cuit}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label={copy.miPerfil.fields.windaId}
              value={windaId}
              onChange={(e) => setWindaId(e.target.value)}
              placeholder={copy.miPerfil.placeholders.windaId}
            />
            <Input
              label={copy.miPerfil.fields.dni}
              value={dni}
              onChange={(e) => setDni(e.target.value)}
              placeholder={copy.miPerfil.placeholders.dni}
            />
          </div>

          <Input
            label={copy.miPerfil.fields.fechaIngreso}
            type="date"
            value={fechaIngreso}
            onChange={(e) => setFechaIngreso(e.target.value)}
          />

          {/* Campos solo-admin */}
          <Select
            label={copy.miPerfil.fields.estado}
            value={status}
            onChange={(e) => setStatus(e.target.value as Profile['status'])}
            options={statusOptions}
            required
          />

          <fieldset className="border border-color-border rounded-lg px-4 py-3">
            <legend className="text-sm font-medium text-secondary px-1">
              {copy.miPerfil.adminFields.entrevistaTecnica}
            </legend>
            <p className="text-xs text-neutral mb-3">
              {copy.miPerfil.adminFields.tiposTrabajoTitle}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {TIPOS_TRABAJO.map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!entrevista[key]}
                    onChange={() => toggleTipo(key)}
                    className="rounded border-color-border text-primary focus:ring-primary"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          {error && (
            <p className="text-sm text-error bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </form>
      </Modal>
    </>
  );
}
