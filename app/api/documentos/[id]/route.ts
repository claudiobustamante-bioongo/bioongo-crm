import { createClient } from '@/lib/supabase-server';
import { bucketExpediente } from '@/lib/supabase-admin';
import { SEGUNDOS_ENLACE, esUuid, estatusErrorDocumento } from '@/lib/documentos';

/**
 * GET /api/documentos/[id]
 *
 * Abre un documento del expediente. Es la liga interna que la base guarda en
 * carta_sofisticado_url (`/api/documentos/<id>`), así que nunca caduca: lo que
 * caduca es el enlace firmado al que redirige.
 *
 * ORDEN: sesión → fn_registrar_consulta_documento (asienta `consulta_documento`
 * con el usuario de la sesión y devuelve la ruta) → enlace firmado de 60 s →
 * 302. El asiento va ANTES de firmar: todo acceso a un documento con datos
 * personales queda trazado, aunque el enlace no se llegue a usar.
 *
 * El cliente admin (llave secreta) no se toca hasta que la sesión y la consulta
 * están verificadas.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!esUuid(id)) {
    return Response.json({ error: 'Identificador de documento inválido.' }, { status: 400 });
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  const { data: rpc, error: errorRpc } = await supabase.rpc('fn_registrar_consulta_documento', {
    p_documento_id: id,
  });
  if (errorRpc) {
    const status = estatusErrorDocumento(errorRpc.code);
    if (status) {
      return Response.json({ error: errorRpc.message }, { status });
    }
    console.error('documentos: fallo al registrar la consulta.');
    return Response.json({ error: 'No se pudo abrir el documento.' }, { status: 500 });
  }

  const ruta = (rpc as { ruta_storage?: unknown } | null)?.ruta_storage;
  if (typeof ruta !== 'string' || !ruta) {
    console.error('documentos: la consulta no devolvió la ruta.');
    return Response.json({ error: 'No se pudo abrir el documento.' }, { status: 500 });
  }

  let firmado: { signedUrl: string } | null = null;
  try {
    const { data, error } = await bucketExpediente().createSignedUrl(ruta, SEGUNDOS_ENLACE);
    if (!error && data?.signedUrl) firmado = data;
  } catch {
    // Configuración ausente: se trata igual que un fallo de Storage.
  }
  if (!firmado) {
    console.error('documentos: no se pudo emitir el enlace firmado.');
    return Response.json({ error: 'No se pudo abrir el documento.' }, { status: 502 });
  }

  return new Response(null, {
    status: 302,
    headers: {
      Location: firmado.signedUrl,
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}
