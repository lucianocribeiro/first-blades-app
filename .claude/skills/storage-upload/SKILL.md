# Skill: storage-upload

Patrón reutilizable para subir archivos a Supabase Storage con control de acceso y previsualización por signed URL. Lo usa Carga de Documentos (Fase 1) y se reutiliza en onboarding/precarga, estudio médico y cualquier carga futura.

## Cuándo usar
Cualquier feature donde un usuario (o el admin) sube un archivo asociado a un `profile_id`, con acceso restringido y vista previa segura.

## Bucket
- Bucket privado único: `documentos` (no público). Nunca exponer URLs públicas.
- Si hace falta separar por tipo de carga, usar carpetas dentro del bucket, no buckets nuevos.

## Convención de path
`{profile_id}/{categoria}/{uuid}-{nombre_archivo}`
- `profile_id` como primer segmento: habilita el control de acceso por carpeta.
- `categoria`: por ejemplo `dni`, `licencia`, `foto_carnet`, `certificado`, `estudio_medico`.
- `uuid` para evitar colisiones; nombre de archivo saneado (sin espacios ni caracteres raros).

## RLS de Storage (storage.objects)
- INSERT/SELECT propio: el primer segmento del path debe ser el `auth.uid()` del usuario.
  `(storage.foldername(name))[1] = auth.uid()::text`
- Admin: SELECT (y lo que aplique) sobre todo el bucket vía `is_admin()`.
- Sin políticas públicas. El bucket es privado.

## Flujo de carga
1. Validar el archivo en el cliente y reforzar en el servidor: tipo permitido (PDF / imagen), tamaño máximo, extensión.
2. Subir a Storage con `supabase.storage.from('documentos').upload(path, file, { contentType, upsert: false })`.
3. Insertar la fila en la tabla de dominio (`documents`) con `file_path = path` y `estado = pendiente` (la RLS fuerza el estado).
4. Si falla el insert, borrar el objeto subido para no dejar huérfanos.

## Previsualización (signed URL)
- Generar el signed URL del lado servidor con la key apropiada: `createSignedUrl(path, expiresIn)`.
- TTL corto (por ejemplo 300 s). No cachear la URL firmada ni guardarla en la base.
- Nunca devolver la secret key al cliente.

## Validación recomendada
- Tipos: `application/pdf`, `image/jpeg`, `image/png`.
- Tamaño máximo: definir por feature (por ejemplo 10 MB).
- Saneo del nombre del archivo.

## Gotchas
- Bucket privado obligatorio: si fuera público, el control de acceso se pierde.
- El control de acceso vive en la RLS de `storage.objects`, no solo en la UI.
- El signed URL es temporal por diseño: regenerarlo cada vez que se previsualiza.
- Borrado: al rechazar o eliminar un documento, definir si se borra el objeto de Storage o se conserva para historial. Coordinar con el flujo de purgatorio.
