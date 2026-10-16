import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * [expediente] Acceso de servidor al bucket privado `expediente`.
 * ---------------------------------------------------------------------------
 * La llave secreta (SUPABASE_SERVICE_ROLE_KEY, tipo `sb_secret_`) se salta la
 * RLS. Por eso este módulo:
 *
 * - Lleva `import 'server-only'`: si algún componente de cliente lo importa, el
 *   build falla en lugar de mandar la llave al navegador.
 * - Devuelve SOLO el bucket `expediente`, no el cliente completo. Con él no se
 *   puede consultar ni escribir ninguna tabla: las escrituras del expediente van
 *   con la sesión del usuario, por fn_registrar_documento, para que la bitácora
 *   lleve su correo.
 * - Se usa únicamente en rutas de servidor, y solo DESPUÉS de verificar la
 *   sesión.
 *
 * El bucket no tiene políticas en storage.objects (2026-10-14-documentos-
 * expediente.sql): con la llave anónima o la de sesión no se puede subir ni
 * leer nada. Esta es la única puerta.
 */

export const BUCKET_EXPEDIENTE = 'expediente';

export function bucketExpediente() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !llave) {
    throw new Error('Falta la configuración de Storage del servidor.');
  }
  return createClient(url, llave, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }).storage.from(BUCKET_EXPEDIENTE);
}
