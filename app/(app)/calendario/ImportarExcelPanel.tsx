'use client';

import { useRef, useState, useTransition } from 'react';
import { FileUp, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Table } from '@/components/ui/Table';
import { copy } from '@/lib/copy';
import type { EstadoDia } from '@/lib/db-types';
import {
  previsualizarImportCalendario,
  confirmarImportCalendario,
  type DiaPreview,
  type PrevisualizacionImport,
  type ResultadoImport,
} from './import-actions';

const t = copy.calendario.excel.importar;
const p = t.preview;

function estadoLabel(estado: EstadoDia | null): string {
  return estado ? copy.status[estado] : p.pisados.seBorra;
}

function Bloque({ titulo, children, tono = 'normal' }: { titulo: string; children: React.ReactNode; tono?: 'normal' | 'alerta' }) {
  return (
    <section
      aria-label={titulo}
      className={[
        'rounded-card border p-4 space-y-3',
        tono === 'alerta' ? 'border-warning bg-amber-50' : 'border-color-border bg-white',
      ].join(' ')}
    >
      <h4 className="text-sm font-semibold text-secondary">{titulo}</h4>
      {children}
    </section>
  );
}

function TablaDias({ dias, conSolicitud }: { dias: DiaPreview[]; conSolicitud: boolean }) {
  const c = p.columnas;
  return (
    <Table
      rows={dias}
      keyExtractor={(d) => `${d.fila}`}
      columns={[
        { key: 'fila', header: c.fila, render: (d) => d.fila },
        { key: 'empleado', header: c.empleado, render: (d) => d.nombre },
        { key: 'fecha', header: c.fecha, render: (d) => d.fecha },
        { key: 'actual', header: c.actual, render: (d) => estadoLabel(d.actual) },
        { key: 'nuevo', header: c.nuevo, render: (d) => estadoLabel(d.nuevo) },
        ...(conSolicitud
          ? [{
              key: 'solicitud',
              header: c.solicitud,
              render: (d: DiaPreview) => d.solicitudes.map((s) => p.pisados[s.tipo]).join(', '),
            }]
          : []),
      ]}
    />
  );
}

// FB-PI-11: solo se renderiza para admin (page.tsx), pero ocultarlo no es el
// control — las actions cortan por requireAdmin() y la RPC tiene su guarda.
//
// La previsualización es obligatoria: el botón de confirmar solo existe
// después de previsualizar, manda el hash del archivo y los conteos vistos,
// y queda deshabilitado si hay errores.
export function ImportarExcelPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PrevisualizacionImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoImport | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setPreview(null);
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  function handlePreview() {
    setError(null);
    setResultado(null);
    setPreview(null);
    if (!file) {
      setError(t.errores.archivoRequerido);
      return;
    }
    const formData = new FormData();
    formData.append('file', file);
    startTransition(async () => {
      const result = await previsualizarImportCalendario(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPreview(result.preview);
    });
  }

  function handleConfirm() {
    if (!file || !preview?.conteos) return;
    setError(null);
    const formData = new FormData();
    formData.append('file', file);
    formData.append('hash', preview.archivo.hash);
    formData.append('esperado', JSON.stringify(preview.conteos));
    startTransition(async () => {
      const result = await confirmarImportCalendario(formData);
      if (!result.ok) {
        setError(result.error);
        // La foto ya no vale: se descarta para obligar a previsualizar de nuevo.
        if (result.desactualizado) setPreview(null);
        return;
      }
      setResultado(result.resultado);
      reset();
    });
  }

  const conErrores = (preview?.erroresTotal ?? 0) > 0;
  const c = p.columnas;

  return (
    <Card padding="sm">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex items-start gap-3">
          <FileUp size={20} className="text-primary shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-secondary">{t.panel.title}</h3>
            <p className="text-xs text-neutral mt-0.5">{t.panel.subtitle}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1">
            <label htmlFor="import-archivo" className="text-sm font-medium text-secondary">
              {t.panel.archivo}
            </label>
            <input
              ref={inputRef}
              id="import-archivo"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="text-sm text-neutral file:mr-3 file:rounded-lg file:border file:border-primary file:bg-white file:px-3 file:py-1.5 file:text-primary"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setPreview(null);
                setResultado(null);
                setError(null);
              }}
            />
          </div>
          <Button type="button" variant="secondary" onClick={handlePreview} loading={isPending && !preview} disabled={!file}>
            {t.panel.previsualizar}
          </Button>
        </div>
      </div>

      {error && (
        <p className="text-sm text-error mt-3" role="alert">
          {error}
        </p>
      )}

      {resultado && (
        <p className="text-sm text-success mt-3" role="status">
          {t.exito.titulo} {resultado.creadas} {t.exito.creadas}, {resultado.modificadas} {t.exito.modificadas},{' '}
          {resultado.borradas} {t.exito.borradas}, {resultado.sin_cambios} {t.exito.sinCambios}.
        </p>
      )}

      {preview && (
        <div className="mt-4 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-secondary">{p.titulo}</h3>
            <p className="text-xs text-neutral mt-0.5">
              {preview.archivo.nombre} · {preview.totalFilas} {p.filas}
              {preview.desde && preview.hasta && (
                <> · {p.archivoRango} {preview.desde} {p.a} {preview.hasta}</>
              )}
            </p>
            <p className="text-sm text-secondary mt-2">{p.nadaEscrito}</p>
          </div>

          {/* Bloque: errores de validación (bloquean la confirmación) */}
          <Bloque titulo={p.errores.titulo} tono={conErrores ? 'alerta' : 'normal'}>
            {conErrores ? (
              <>
                <p className="text-sm text-error font-medium">{p.errores.aviso}</p>
                {preview.erroresTotal > preview.errores.length && (
                  <p className="text-xs text-neutral">
                    {p.errores.mostrando} {preview.errores.length} {p.errores.de} {preview.erroresTotal}.
                  </p>
                )}
                <Table
                  rows={preview.errores}
                  keyExtractor={(e) => `${e.fila}-${e.mensaje}`}
                  columns={[
                    { key: 'fila', header: c.fila, render: (e) => e.fila ?? p.errores.archivo },
                    { key: 'motivo', header: c.motivo, render: (e) => e.mensaje },
                  ]}
                />
              </>
            ) : (
              <p className="text-sm text-neutral">{p.errores.ninguno}</p>
            )}
          </Bloque>

          {preview.conteos && (
            <>
              {/* Bloque: resumen — crear, modificar, sin cambios, borrar */}
              <Bloque titulo={p.resumen.titulo}>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {([
                    [p.resumen.crear, preview.conteos.crear],
                    [p.resumen.modificar, preview.conteos.modificar],
                    [p.resumen.sinCambios, preview.conteos.sin_cambios],
                    [p.resumen.borrar, preview.conteos.borrar],
                  ] as const).map(([label, n]) => (
                    <div key={label} className="rounded-lg bg-surface px-3 py-2">
                      <dt className="text-xs text-neutral">{label}</dt>
                      <dd className="text-lg font-semibold text-secondary">{n}</dd>
                    </div>
                  ))}
                </dl>
              </Bloque>

              {/* Bloque: días que se borran — dicho con todas las letras */}
              <Bloque titulo={`${p.borrados.titulo} (${preview.conteos.borrar})`} tono={preview.conteos.borrar > 0 ? 'alerta' : 'normal'}>
                <p className="flex items-start gap-2 text-sm text-secondary font-medium">
                  <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
                  <span>{p.borrados.aviso}</span>
                </p>
                {preview.conteos.borrar > 0 ? (
                  <TablaDias dias={preview.borrados} conSolicitud={false} />
                ) : (
                  <p className="text-sm text-neutral">{p.borrados.ninguno}</p>
                )}
              </Bloque>

              {/* Bloque: días de solicitudes aprobadas que se pisan */}
              <Bloque titulo={`${p.pisados.titulo} (${preview.conteos.pisados})`} tono={preview.conteos.pisados > 0 ? 'alerta' : 'normal'}>
                {preview.conteos.pisados > 0 ? (
                  <>
                    <p className="text-sm text-secondary">{p.pisados.aviso}</p>
                    <TablaDias dias={preview.pisados} conSolicitud />
                  </>
                ) : (
                  <p className="text-sm text-neutral">{p.pisados.ninguno}</p>
                )}
              </Bloque>

              {/* Bloque: impacto en el saldo de días de trámite */}
              <Bloque titulo={p.saldo.titulo} tono={preview.saldo.some((s) => s.excedido) ? 'alerta' : 'normal'}>
                <p className="text-sm text-secondary">{p.saldo.aviso}</p>
                {preview.saldo.length > 0 ? (
                  <Table
                    rows={preview.saldo}
                    keyExtractor={(s) => `${s.employeeId}-${s.anio}`}
                    columns={[
                      { key: 'empleado', header: c.empleado, render: (s) => s.nombre || s.email },
                      { key: 'anio', header: c.anio, render: (s) => s.anio },
                      { key: 'antes', header: c.antes, render: (s) => s.antes },
                      {
                        key: 'despues',
                        header: c.despues,
                        render: (s) => (
                          <span className={s.excedido ? 'text-error font-semibold' : ''}>
                            {s.despues}
                            {s.excedido && ` · ${p.saldo.excedido}`}
                          </span>
                        ),
                      },
                      { key: 'tope', header: c.tope, render: (s) => s.tope },
                    ]}
                  />
                ) : (
                  <p className="text-sm text-neutral">{p.saldo.ninguno}</p>
                )}
              </Bloque>
            </>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={reset} disabled={isPending}>
              {t.panel.cancelar}
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              loading={isPending}
              disabled={conErrores || !preview.conteos}
            >
              {t.panel.confirmar}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
