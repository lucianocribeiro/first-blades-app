'use client';

import { useState } from 'react';
import { FileText, Eye, Clock } from 'lucide-react';
import { copy } from '@/lib/copy';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { DocumentUploadModal } from './DocumentUploadModal';
import { AdminDocumentUploadModal } from './AdminDocumentUploadModal';
import type { Document, CertificadoTipo } from '@/lib/db-types';

type DocumentWithUrl = Document & { signedUrl?: string };

type DocumentsSectionProps = {
  documents: DocumentWithUrl[];
  /** Cuando el admin está viendo el perfil de otro usuario, usar modal de admin */
  targetUserId?: string;
};

function documentTypeLabel(type: string): string {
  const labels: Record<string, string> = copy.documentos.tipos as unknown as Record<string, string>;
  return labels[type] ?? type;
}

function certTipoLabel(tipo: CertificadoTipo | null | undefined): string {
  if (!tipo) return '';
  const labels = copy.documentos.certificadoTipos as Record<string, string>;
  return labels[tipo] ?? tipo;
}

function formatDate(date: string | null | undefined): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('es-AR');
}

export function DocumentsSection({ documents, targetUserId }: DocumentsSectionProps) {
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-secondary">
          {copy.documentos.sectionTitle}
        </h3>
        <Button variant="primary" onClick={() => setUploadOpen(true)}>
          {copy.documentos.uploadButton}
        </Button>
      </div>

      {documents.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-neutral gap-2">
          <FileText size={32} className="text-neutral/40" />
          <p className="text-sm">{copy.documentos.noDocuments}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-color-border">
                {[
                  copy.documentos.table.tipo,
                  copy.documentos.table.archivo,
                  copy.documentos.table.vencimiento,
                  copy.documentos.table.estado,
                  copy.documentos.table.fecha,
                  copy.documentos.table.acciones,
                ].map((h) => (
                  <th key={h} className="text-left py-2 px-3 text-xs font-medium text-neutral uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-color-border">
              {documents.map((doc) => (
                <tr key={doc.id} className="hover:bg-surface/50 transition-colors">
                  <td className="py-3 px-3">
                    <div className="font-medium text-secondary">
                      {documentTypeLabel(doc.document_type)}
                    </div>
                    {doc.document_type === 'certificado' && doc.certificado_tipo && (
                      <div className="text-xs text-neutral mt-0.5">
                        {certTipoLabel(doc.certificado_tipo)}
                        {doc.certificado_otros_texto && ` — ${doc.certificado_otros_texto}`}
                      </div>
                    )}
                    {doc.motivo_rechazo && (
                      <div className="text-xs text-error mt-1">
                        <span className="font-medium">{copy.documentos.rechazadoBanner}:</span>{' '}
                        {doc.motivo_rechazo}
                      </div>
                    )}
                  </td>
                  <td className="py-3 px-3 text-neutral max-w-[160px] truncate" title={doc.filename}>
                    {doc.filename}
                  </td>
                  <td className="py-3 px-3 text-neutral">
                    {doc.fecha_vencimiento ? (
                      <span className="flex items-center gap-1">
                        <Clock size={12} />
                        {formatDate(doc.fecha_vencimiento)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="py-3 px-3">
                    <StatusBadge status={doc.estado} />
                  </td>
                  <td className="py-3 px-3 text-neutral text-xs">
                    {formatDate(doc.created_at)}
                  </td>
                  <td className="py-3 px-3">
                    {doc.file_purged_at ? (
                      <span className="text-xs text-neutral italic">
                        {copy.documentos.archivoEliminado}
                      </span>
                    ) : doc.signedUrl ? (
                      <a
                        href={doc.signedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        aria-label={copy.documentos.previewButton}
                      >
                        <Eye size={13} />
                        {copy.documentos.previewButton}
                      </a>
                    ) : (
                      <span className="text-xs text-neutral">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {targetUserId ? (
        <AdminDocumentUploadModal
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
          employeeId={targetUserId}
        />
      ) : (
        <DocumentUploadModal
          open={uploadOpen}
          onClose={() => setUploadOpen(false)}
        />
      )}
    </Card>
  );
}
