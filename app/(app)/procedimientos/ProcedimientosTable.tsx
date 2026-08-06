'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Archive, RotateCcw } from 'lucide-react';
import { copy } from '@/lib/copy';
import { Table } from '@/components/ui/Table';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { isWithinBusinessDays } from '@/lib/business-date';
import { cambiarEstadoProcedimiento } from './actions';
import type { Procedure } from '@/lib/db-types';

const NUEVO_BADGE_WINDOW_DAYS = 7;

function NuevoBadge() {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border bg-blue-50 text-primary border-blue-200">
      {copy.procedimientos.nuevoBadge}
    </span>
  );
}

type ProcedimientosTableProps = {
  procedimientos: Procedure[];
  isAdmin: boolean;
  emptyMessage: string;
};

export function ProcedimientosTable({ procedimientos, isAdmin, emptyMessage }: ProcedimientosTableProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmTarget, setConfirmTarget] = useState<Procedure | null>(null);
  const [actionError, setActionError] = useState('');

  const confirmToArchive = confirmTarget?.estado === 'vigente';

  function handleConfirm() {
    if (!confirmTarget) return;
    const nuevoEstado = confirmTarget.estado === 'vigente' ? 'archivado' : 'vigente';

    startTransition(async () => {
      const result = await cambiarEstadoProcedimiento(confirmTarget.id, nuevoEstado);
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      setConfirmTarget(null);
      router.refresh();
    });
  }

  const dateFormatter = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  return (
    <>
      <Table
        columns={[
          {
            key: 'titulo',
            header: copy.procedimientos.table.titulo,
            render: (row) => (
              <div className="flex items-center gap-2">
                <Link href={`/procedimientos/${row.id}`} className="font-medium text-primary hover:underline">
                  {row.titulo}
                </Link>
                {isWithinBusinessDays(row.updated_at, NUEVO_BADGE_WINDOW_DAYS) && <NuevoBadge />}
                {isAdmin && row.estado === 'archivado' && <StatusBadge status="archivado" />}
              </div>
            ),
          },
          {
            key: 'categoria',
            header: copy.procedimientos.table.categoria,
            render: (row) => row.categoria || <span className="text-neutral/60">—</span>,
          },
          {
            key: 'actualizado',
            header: copy.procedimientos.table.actualizado,
            render: (row) => dateFormatter.format(new Date(row.updated_at)),
          },
          ...(isAdmin
            ? [
                {
                  key: 'acciones',
                  header: copy.procedimientos.table.acciones,
                  render: (row: Procedure) => (
                    <div className="flex items-center gap-3">
                      <Link href={`/procedimientos/${row.id}/editar`} className="text-sm text-primary hover:underline">
                        {copy.procedimientos.editButton}
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setActionError('');
                          setConfirmTarget(row);
                        }}
                        className="inline-flex items-center gap-1 text-sm text-neutral hover:text-secondary transition-colors"
                      >
                        {row.estado === 'vigente' ? (
                          <>
                            <Archive size={13} /> {copy.procedimientos.archiveButton}
                          </>
                        ) : (
                          <>
                            <RotateCcw size={13} /> {copy.procedimientos.restoreButton}
                          </>
                        )}
                      </button>
                    </div>
                  ),
                },
              ]
            : []),
        ]}
        rows={procedimientos}
        keyExtractor={(row) => row.id}
        emptyMessage={emptyMessage}
      />

      <Modal
        open={!!confirmTarget}
        onClose={() => setConfirmTarget(null)}
        title={confirmToArchive ? copy.procedimientos.confirmArchivar.title : copy.procedimientos.confirmRestaurar.title}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmTarget(null)} disabled={isPending}>
              {copy.general.cancel}
            </Button>
            <Button variant={confirmToArchive ? 'danger' : 'primary'} onClick={handleConfirm} loading={isPending}>
              {confirmToArchive ? copy.procedimientos.confirmArchivar.confirm : copy.procedimientos.confirmRestaurar.confirm}
            </Button>
          </>
        }
      >
        <p className="text-sm text-neutral">
          {confirmToArchive ? copy.procedimientos.confirmArchivar.message : copy.procedimientos.confirmRestaurar.message}
        </p>
        {actionError && <p className="text-sm text-error mt-3">{actionError}</p>}
      </Modal>
    </>
  );
}
