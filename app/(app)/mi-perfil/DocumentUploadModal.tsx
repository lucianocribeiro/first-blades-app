'use client';

import { useState, useTransition, useRef } from 'react';
import { copy } from '@/lib/copy';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { InfoBanner } from '@/components/ui/InfoBanner';
import { handleDocumentUpload } from './actions';
import type { DocumentType, CertificadoTipo } from '@/lib/db-types';

type DocumentUploadModalProps = {
  open: boolean;
  onClose: () => void;
};

const tipoOptions: { value: string; label: string }[] = [
  { value: 'dni',         label: copy.documentos.tipos.dni },
  { value: 'licencia',    label: copy.documentos.tipos.licencia },
  { value: 'foto_carnet', label: copy.documentos.tipos.foto_carnet },
  { value: 'certificado', label: copy.documentos.tipos.certificado },
];

const certTipoOptions = [
  { value: 'gwo',               label: copy.documentos.certificadoTipos.gwo },
  { value: 'cursos_elevadores', label: copy.documentos.certificadoTipos.cursos_elevadores },
  { value: 'espacio_confinado', label: copy.documentos.certificadoTipos.espacio_confinado },
  { value: 'manejo_defensivo',  label: copy.documentos.certificadoTipos.manejo_defensivo },
  { value: 'cursos_vestas',     label: copy.documentos.certificadoTipos.cursos_vestas },
  { value: 'otros',             label: copy.documentos.certificadoTipos.otros },
];

export function DocumentUploadModal({ open, onClose }: DocumentUploadModalProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const [documentType, setDocumentType] = useState<DocumentType>('dni');
  const [certTipo, setCertTipo] = useState<CertificadoTipo>('gwo');
  const [certOtrosText, setCertOtrosText] = useState('');
  const [fechaVenc, setFechaVenc] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const isCertificado = documentType === 'certificado';
  const isOtros = certTipo === 'otros';

  function resetForm() {
    setDocumentType('dni');
    setCertTipo('gwo');
    setCertOtrosText('');
    setFechaVenc('');
    setError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  function handleClose() {
    resetForm();
    onClose();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const fileInput = fileRef.current;
    const file = fileInput?.files?.[0];
    if (!file) {
      setError(copy.documentos.errors.archivoRequerido);
      return;
    }

    const formData = new FormData();
    formData.set('file', file);
    formData.set('document_type', documentType);
    if (isCertificado) {
      formData.set('certificado_tipo', certTipo);
      if (isOtros && certOtrosText) formData.set('certificado_otros_texto', certOtrosText);
    }
    if (fechaVenc) formData.set('fecha_vencimiento', fechaVenc);

    startTransition(async () => {
      try {
        await handleDocumentUpload(formData);
        handleClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : copy.documentos.messages.uploadError);
      }
    });
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={copy.documentos.uploadModalTitle}
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={isPending}>
            {copy.general.cancel}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="doc-upload-form"
            loading={isPending}
          >
            {isPending ? copy.documentos.messages.uploadingMsg : copy.general.confirm}
          </Button>
        </>
      }
    >
      <form id="doc-upload-form" onSubmit={handleSubmit} className="space-y-4">
        <InfoBanner message={copy.documentos.hints.purgatorio} />

        <Select
          label={copy.documentos.fields.tipo}
          value={documentType}
          onChange={(e) => setDocumentType(e.target.value as DocumentType)}
          options={tipoOptions}
          required
        />

        {isCertificado && (
          <>
            <Select
              label={copy.documentos.fields.certificadoTipo}
              value={certTipo}
              onChange={(e) => setCertTipo(e.target.value as CertificadoTipo)}
              options={certTipoOptions}
              required
            />
            {isOtros && (
              <Input
                label={copy.documentos.fields.otrosTexto}
                value={certOtrosText}
                onChange={(e) => setCertOtrosText(e.target.value)}
                placeholder={copy.documentos.placeholders.otrosTexto}
                maxLength={80}
                required
                hint={copy.documentos.hints.otrosTexto}
              />
            )}
          </>
        )}

        <Input
          label={copy.documentos.fields.fechaVencimiento}
          type="date"
          value={fechaVenc}
          onChange={(e) => setFechaVenc(e.target.value)}
          hint={copy.documentos.hints.fechaVencimiento}
        />

        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-secondary">
            {copy.documentos.fields.archivo}
            <span className="text-error ml-1">*</span>
          </label>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx"
            required
            className="text-sm text-secondary file:mr-4 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary file:text-white hover:file:bg-primary/90 file:cursor-pointer"
          />
          <p className="text-xs text-neutral">{copy.documentos.hints.archivo}</p>
        </div>

        {error && (
          <p className="text-sm text-error bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
