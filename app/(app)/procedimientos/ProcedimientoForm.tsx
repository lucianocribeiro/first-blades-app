'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { copy } from '@/lib/copy';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { MarkdownEditor } from './MarkdownEditor';
import { crearProcedimiento, actualizarProcedimiento } from './actions';

type TipoContenido = 'texto' | 'archivo';

export type ProcedimientoFormInitial = {
  titulo: string;
  categoria: string | null;
  contenidoTexto: string | null;
  filePath: string | null;
};

type ProcedimientoFormProps =
  | { mode: 'crear'; categoriaSuggestions: string[] }
  | { mode: 'editar'; procedureId: string; initial: ProcedimientoFormInitial; categoriaSuggestions: string[] };

export function ProcedimientoForm(props: ProcedimientoFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const initial = props.mode === 'editar' ? props.initial : null;

  const [titulo, setTitulo] = useState(initial?.titulo ?? '');
  const [categoria, setCategoria] = useState(initial?.categoria ?? '');
  const [tipoContenido, setTipoContenido] = useState<TipoContenido>(
    initial?.filePath ? 'archivo' : 'texto'
  );
  const [contenidoTexto, setContenidoTexto] = useState(initial?.contenidoTexto ?? '');
  const fileRef = useRef<HTMLInputElement>(null);

  const datalistId = 'procedimientos-categorias';

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!titulo.trim()) {
      setError(copy.procedimientos.errors.tituloRequerido);
      return;
    }

    const formData = new FormData();
    formData.set('titulo', titulo);
    formData.set('categoria', categoria);

    if (tipoContenido === 'texto') {
      if (!contenidoTexto.trim()) {
        setError(copy.procedimientos.errors.contenidoRequerido);
        return;
      }
      formData.set('contenido_texto', contenidoTexto);
    } else {
      const file = fileRef.current?.files?.[0];
      if (file) {
        formData.set('file', file);
      } else if (props.mode === 'crear') {
        setError(copy.procedimientos.errors.archivoRequerido);
        return;
      } else {
        // Editar sin elegir un archivo nuevo: conservar el actual sin
        // volver a subirlo. La action distingue este caso con un flag
        // explícito (no puede inferirlo de "no vino ni file ni
        // contenido_texto", que es justo el caso de error genérico).
        formData.set('mantener_archivo_actual', '1');
      }
    }

    startTransition(async () => {
      if (props.mode === 'crear') {
        const result = await crearProcedimiento(formData);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.push(`/procedimientos/${result.id}`);
      } else {
        const result = await actualizarProcedimiento(props.procedureId, formData);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.push(`/procedimientos/${props.procedureId}`);
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        label={copy.procedimientos.form.titulo}
        value={titulo}
        onChange={(e) => setTitulo(e.target.value)}
        placeholder={copy.procedimientos.form.tituloPlaceholder}
        required
        maxLength={200}
      />

      <div className="flex flex-col gap-1">
        <label htmlFor="procedimiento-categoria" className="text-sm font-medium text-secondary">
          {copy.procedimientos.form.categoria}
        </label>
        <input
          id="procedimiento-categoria"
          list={datalistId}
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          placeholder={copy.procedimientos.form.categoriaPlaceholder}
          maxLength={80}
          className="w-full border rounded-lg px-3 py-2 text-sm bg-white border-color-border hover:border-neutral/40 focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
        />
        <datalist id={datalistId}>
          {props.categoriaSuggestions.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium text-secondary">
          {copy.procedimientos.form.tipoContenido}
          <span className="text-error ml-1">*</span>
        </span>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
            <input
              type="radio"
              name="tipo_contenido"
              checked={tipoContenido === 'texto'}
              onChange={() => setTipoContenido('texto')}
            />
            {copy.procedimientos.form.tipoTexto}
          </label>
          <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer">
            <input
              type="radio"
              name="tipo_contenido"
              checked={tipoContenido === 'archivo'}
              onChange={() => setTipoContenido('archivo')}
            />
            {copy.procedimientos.form.tipoArchivo}
          </label>
        </div>
        <p className="text-xs text-neutral">{copy.procedimientos.form.tipoContenidoHint}</p>
      </div>

      {tipoContenido === 'texto' ? (
        <MarkdownEditor
          label={copy.procedimientos.form.contenidoTexto}
          value={contenidoTexto}
          onChange={setContenidoTexto}
          required
        />
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor="procedimiento-archivo" className="text-sm font-medium text-secondary">
            {copy.procedimientos.form.archivo}
            {props.mode === 'crear' && <span className="text-error ml-1">*</span>}
          </label>
          <input
            ref={fileRef}
            id="procedimiento-archivo"
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            className="text-sm text-secondary file:mr-4 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-primary file:text-white hover:file:bg-primary/90 file:cursor-pointer"
          />
          <p className="text-xs text-neutral">
            {props.mode === 'crear'
              ? copy.procedimientos.form.archivoHintNuevo
              : copy.procedimientos.form.archivoHintExistente}
          </p>
        </div>
      )}

      {error && (
        <p className="text-sm text-error bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="secondary" onClick={() => router.back()} disabled={isPending}>
          {copy.procedimientos.form.cancelar}
        </Button>
        <Button type="submit" variant="primary" loading={isPending}>
          {isPending ? copy.procedimientos.form.guardando : copy.procedimientos.form.guardar}
        </Button>
      </div>
    </form>
  );
}
