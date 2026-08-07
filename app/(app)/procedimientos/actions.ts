'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/auth';
import { createServerClient } from '@/lib/supabase/server';
import { uploadProcedureFile, removeProcedureFile } from '@/lib/storage';
import { copy } from '@/lib/copy';
import type { ProcedureEstado } from '@/lib/db-types';

// Contrato return-based (constitución §2.5): nunca throw para un error
// esperado — un throw que cruza el límite de una Server Action se redacta
// en build de producción. Los call sites chequean `!ok`.
export type ProcedimientoActionResult = { ok: true } | { ok: false; error: string };
export type CrearProcedimientoResult = { ok: true; id: string } | { ok: false; error: string };

// ─── Excepción documentada: el guard de rol NO usa el contrato { ok } ──
// (FB-F5-AUD-05 Hallazgo 3 — decisión tomada, no re-abrir)
//
// Las tres actions de abajo empiezan con `await requireAdmin()`, que corta
// con `redirect('/dashboard')` si quien llama no es admin — no devuelve
// `{ ok: false }`. Es intencional:
//
//   - El contrato return-based existe porque un `throw new Error(...)` que
//     cruza el límite de una Server Action llega REDACTADO al cliente en
//     build de producción (el motivo original de §2.5). `redirect()` no es
//     eso: es un mecanismo propio de Next.js que funciona igual en
//     producción — no hay nada que redactar ni que envolver.
//   - Un no-admin invocando estas RPCs no es un error de negocio que haya
//     que explicarle con un mensaje: es alguien fuera de lugar. Redirigirlo
//     es la respuesta correcta, y de paso no le confirma ni le niega nada
//     sobre lo que existe del otro lado (a diferencia de un `{ ok: false,
//     error: "..." }` con detalle).
//   - `requireAdmin()` es un helper compartido por todo el portal — no se
//     lo toca acá para "prolijizar" esta pieza puntual.
//
// El contrato `{ ok }` aplica a partir de este punto: a los errores de
// negocio de una llamada YA AUTORIZADA (RPC que falla, archivo inválido,
// fila no encontrada). Ver docs/constitucion.md §2.5.

// ─── Exclusividad de contenido (regla de aplicación, no de la base) ────
// La base acepta que contenido_texto y file_path estén los dos a la vez
// (el CHECK de la migración 0020 pide "al menos uno"); la exclusividad
// ("nunca los dos") es una decisión de producto de FB-F5-06 que se impone
// acá, no en el esquema — no valía la pena una migración nueva para esto
// con la tabla recién estrenada. Se valida contra lo que efectivamente
// llegó en el FormData, no contra un selector de "tipo" separado: así un
// caller que mande ambos campos por error (o con mala intención) lo
// rechaza igual, sin depender de que el cliente se haya comportado.
type ContenidoExtraido = { contenidoTexto: string | null; file: File | null };

function extraerContenido(formData: FormData): { ok: true; value: ContenidoExtraido } | { ok: false; error: string } {
  const contenidoTextoRaw = ((formData.get('contenido_texto') as string | null) ?? '').trim();
  const file = formData.get('file') as File | null;

  const hasTexto = contenidoTextoRaw.length > 0;
  const hasFile = !!file && file.size > 0;

  if (hasTexto && hasFile) return { ok: false, error: copy.procedimientos.errors.contenidoExclusivo };
  if (!hasTexto && !hasFile) return { ok: false, error: copy.procedimientos.errors.contenidoRequerido };

  return {
    ok: true,
    value: { contenidoTexto: hasTexto ? contenidoTextoRaw : null, file: hasFile ? file : null },
  };
}

// ─── Crear (solo admin) ─────────────────────────────────────────

export async function crearProcedimiento(formData: FormData): Promise<CrearProcedimientoResult> {
  // Guard de rol: corta por redirect(), no por el contrato { ok } — ver
  // "Excepción documentada" arriba.
  await requireAdmin();

  const titulo = ((formData.get('titulo') as string | null) ?? '').trim();
  if (!titulo) return { ok: false, error: copy.procedimientos.errors.tituloRequerido };

  const categoria = ((formData.get('categoria') as string | null) ?? '').trim() || null;

  const contenido = extraerContenido(formData);
  if (!contenido.ok) return contenido;

  // createServerClient(), nunca createAdminClient(): la guarda is_admin()
  // de la RPC resuelve auth.uid() del JWT de la sesión — con el cliente
  // admin (service_role) no hay `sub` en el token y la guarda abortaría.
  const supabase = await createServerClient();

  let filePath: string | null = null;
  if (contenido.value.file) {
    const uploadResult = await uploadProcedureFile(supabase, contenido.value.file);
    if (!uploadResult.ok) return uploadResult;
    filePath = uploadResult.storagePath;
  }

  // El cliente de createServerClient() (@supabase/ssr) colapsa el genérico de
  // postgrest-js a `never`/`undefined` en .rpc() — mismo bug ya documentado
  // en el resto del repo (ver aprobaciones/ausencia-actions.ts). El args
  // object ya está tipado por la firma real de la función (supabase/types.ts,
  // con la salvedad de que p_categoria/p_contenido_texto/p_file_path
  // figuran ahí como `string` no-nullable porque esos parámetros TEXT no
  // tienen DEFAULT en el SQL — Postgres sí acepta NULL en runtime, ver
  // docs/prompts/FB-F5-RUN-01-VERIF-REPORT.md bloque 7). La exclusividad ya
  // se validó arriba (extraerContenido): nunca llegan los dos NULL ni los
  // dos con valor.
  const { data, error } = await supabase.rpc('crear_procedimiento', {
    p_titulo: titulo,
    p_categoria: categoria,
    p_contenido_texto: contenido.value.contenidoTexto,
    p_file_path: filePath,
  } as never);

  if (error) {
    if (filePath) {
      const cleanup = await removeProcedureFile(supabase, filePath);
      if (!cleanup.ok) {
        console.error(`[crearProcedimiento] no se pudo limpiar el archivo subido (${filePath}):`, cleanup.error);
      }
    }
    console.error('[crearProcedimiento] error en crear_procedimiento:', error.message);
    return { ok: false, error: copy.procedimientos.errors.generic };
  }

  revalidatePath('/procedimientos');
  return { ok: true, id: data as string };
}

// ─── Actualizar (solo admin, reemplazo en el lugar) ─────────────

export async function actualizarProcedimiento(
  id: string,
  formData: FormData
): Promise<ProcedimientoActionResult> {
  // Guard de rol: corta por redirect(), no por el contrato { ok } — ver
  // "Excepción documentada" al principio del archivo.
  await requireAdmin();

  const titulo = ((formData.get('titulo') as string | null) ?? '').trim();
  if (!titulo) return { ok: false, error: copy.procedimientos.errors.tituloRequerido };

  const categoria = ((formData.get('categoria') as string | null) ?? '').trim() || null;

  // Editar sin tocar un archivo existente: el form no reenvía el archivo
  // (no se re-sube lo que ya está en Storage), así que no hay forma de
  // distinguir "conservar el archivo actual" de "no mandaron nada" mirando
  // solo contenido_texto/file — de ahí este flag explícito, que solo tiene
  // sentido en actualizar (crear siempre parte de cero).
  const mantenerArchivoActual = formData.get('mantener_archivo_actual') === '1';

  const supabase = await createServerClient();

  // Fila actual: hace falta el file_path viejo tanto para "conservarlo" en
  // la rama de arriba como para saber si hay que borrarlo después si queda
  // reemplazado (por texto o por un archivo nuevo).
  const { data: currentRowRaw, error: currentError } = await supabase
    .from('procedures')
    .select('file_path')
    .eq('id', id)
    .single();

  if (currentError || !currentRowRaw) {
    console.error('[actualizarProcedimiento] no se pudo leer la fila actual:', currentError?.message);
    return { ok: false, error: copy.procedimientos.errors.noEncontrado };
  }

  const oldFilePath = (currentRowRaw as { file_path: string | null }).file_path;

  let contenidoTexto: string | null = null;
  let newFilePath: string | null = null;
  let uploadedFilePath: string | null = null; // solo si esta llamada subió un archivo nuevo (para limpiar en caso de error)

  if (mantenerArchivoActual) {
    if (!oldFilePath) return { ok: false, error: copy.procedimientos.errors.contenidoRequerido };
    newFilePath = oldFilePath;
  } else {
    const contenido = extraerContenido(formData);
    if (!contenido.ok) return contenido;
    contenidoTexto = contenido.value.contenidoTexto;

    if (contenido.value.file) {
      const uploadResult = await uploadProcedureFile(supabase, contenido.value.file);
      if (!uploadResult.ok) return uploadResult;
      newFilePath = uploadResult.storagePath;
      uploadedFilePath = uploadResult.storagePath;
    }
  }

  // Mismo bug de postgrest-js/@supabase-ssr que en crearProcedimiento — ver
  // comentario ahí.
  const { error } = await supabase.rpc('actualizar_procedimiento', {
    p_id: id,
    p_titulo: titulo,
    p_categoria: categoria,
    p_contenido_texto: contenidoTexto,
    p_file_path: newFilePath,
  } as never);

  if (error) {
    // La RPC no tomó: si esta llamada había subido un archivo nuevo (no el
    // que se estaba conservando), es huérfano.
    if (uploadedFilePath) {
      const cleanup = await removeProcedureFile(supabase, uploadedFilePath);
      if (!cleanup.ok) {
        console.error(`[actualizarProcedimiento] no se pudo limpiar el archivo subido (${uploadedFilePath}):`, cleanup.error);
      }
    }
    console.error('[actualizarProcedimiento] error en actualizar_procedimiento:', error.message);
    return { ok: false, error: copy.procedimientos.errors.generic };
  }

  // Reemplazo en el lugar (sin historial — decisión cerrada del PRD): si
  // había un archivo viejo y quedó reemplazado, se borra best-effort. Si
  // el borrado falla, la operación YA se guardó y no se revierte — solo
  // queda logueado (regla técnica de FB-F5-06: un archivo huérfano es un
  // problema menor, un procedimiento que no se guarda es uno grande).
  if (oldFilePath && oldFilePath !== newFilePath) {
    const cleanup = await removeProcedureFile(supabase, oldFilePath);
    if (!cleanup.ok) {
      console.error(`[actualizarProcedimiento] no se pudo borrar el archivo anterior (${oldFilePath}):`, cleanup.error);
    }
  }

  revalidatePath('/procedimientos');
  revalidatePath(`/procedimientos/${id}`);
  return { ok: true };
}

// ─── Archivar / restaurar (solo admin) ──────────────────────────

export async function cambiarEstadoProcedimiento(
  id: string,
  estado: ProcedureEstado
): Promise<ProcedimientoActionResult> {
  // Guard de rol: corta por redirect(), no por el contrato { ok } — ver
  // "Excepción documentada" al principio del archivo.
  await requireAdmin();
  const supabase = await createServerClient();

  const { error } = await supabase.rpc('archivar_procedimiento', {
    p_id: id,
    p_estado: estado,
  } as never);

  if (error) {
    console.error('[cambiarEstadoProcedimiento] error en archivar_procedimiento:', error.message);
    return { ok: false, error: copy.procedimientos.errors.generic };
  }

  revalidatePath('/procedimientos');
  revalidatePath(`/procedimientos/${id}`);
  return { ok: true };
}
