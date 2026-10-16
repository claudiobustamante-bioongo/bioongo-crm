import { createClient } from '@/lib/supabase-server';
import { bucketExpediente } from '@/lib/supabase-admin';
import { hoyCDMX } from '@/lib/baja';
import { TAMANO_MAXIMO_BYTES, estatusErrorDocumento } from '@/lib/documentos';
import { prepararDocumento, sha256Hex } from '@/lib/documentos-servidor';

/**
 * POST /api/documentos  (multipart/form-data)
 *
 * Campos: codigo_cliente, tipo, fecha_documento (AAAA-MM-DD; obligatoria para
 * la carta), reemplaza_a (opcional, uuid) y archivo (PDF, máximo 4 MB).
 *
 * Archiva un PDF en el bucket privado `expediente` y lo registra con UNA
 * llamada a fn_registrar_documento (SECURITY DEFINER,
 * migraciones/2026-10-14-documentos-expediente.sql), con la sesión del usuario.
 * Si es la carta de clasificación, la función mueve la clasificación en la
 * misma transacción (modos nueva / adjuntar / reemplazo) y escribe su propio
 * asiento de bitácora: esta ruta no llama a registrarEvento.
 *
 * ORDEN: sesión → validación → subida (sin sobrescribir) → función. Si la
 * función falla, se borra el objeto que esta petición subió. Un objeto sin fila
 * es basura que se detecta; una fila que apunta a un objeto inexistente sería
 * evidencia falsa. Por eso no se registra antes de subir.
 *
 * QUIÉN SUBE NO SE RECIBE: la función lo toma del JWT. El nombre original del
 * archivo no se usa en ningún lado: la ruta sale de tipo, código, fecha y sha256.
 *
 * Ningún dato del cliente se escribe a logs: solo mensajes genéricos.
 */
export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'La petición debe ser multipart/form-data.' }, { status: 400 });
  }

  const archivo = form.get('archivo');
  if (!(archivo instanceof File)) {
    return Response.json({ error: 'Falta el archivo PDF.' }, { status: 400 });
  }
  if (archivo.size > TAMANO_MAXIMO_BYTES) {
    return Response.json(
      { error: 'El PDF excede 4 MB. Comprímelo antes de subirlo.' },
      { status: 413 }
    );
  }

  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const v = prepararDocumento({
    codigo: form.get('codigo_cliente'),
    tipo: form.get('tipo'),
    fecha: form.get('fecha_documento'),
    reemplazaA: form.get('reemplaza_a'),
    bytes,
    hoy: hoyCDMX(),
  });
  if (!v.ok) {
    return Response.json({ error: v.error }, { status: 400 });
  }
  const doc = v.doc;

  // --- Subida -----------------------------------------------------------------
  let bucket: ReturnType<typeof bucketExpediente>;
  try {
    bucket = bucketExpediente();
  } catch {
    console.error('documentos: falta la configuración de Storage del servidor.');
    return Response.json({ error: 'El almacenamiento de documentos no está configurado.' }, { status: 500 });
  }

  let subidoAhora = false;
  const { error: errorSubida } = await bucket.upload(doc.ruta, bytes, {
    contentType: 'application/pdf',
    upsert: false,
  });

  if (errorSubida) {
    if (!yaExiste(errorSubida)) {
      console.error('documentos: fallo al subir el PDF a Storage.');
      return Response.json({ error: 'No se pudo guardar el PDF.' }, { status: 502 });
    }
    // Ya hay un objeto en esa ruta: o es el mismo archivo (un intento anterior
    // cuya fila no se escribió) o es otro. Solo se reutiliza si su sha256 es el
    // mismo; nunca se sobrescribe.
    const { data: existente, error: errorDescarga } = await bucket.download(doc.ruta);
    if (errorDescarga || !existente) {
      console.error('documentos: no se pudo verificar un objeto existente.');
      return Response.json({ error: 'No se pudo guardar el PDF.' }, { status: 502 });
    }
    const shaExistente = sha256Hex(new Uint8Array(await existente.arrayBuffer()));
    if (shaExistente !== doc.sha256) {
      return Response.json(
        { error: 'Ya hay un documento distinto guardado en esa ruta. Revisa la fecha o el archivo.' },
        { status: 409 }
      );
    }
  } else {
    subidoAhora = true;
  }

  // --- Registro ---------------------------------------------------------------
  const { data: rpc, error: errorRpc } = await supabase.rpc('fn_registrar_documento', {
    p_codigo_cliente: doc.codigo,
    p_tipo: doc.tipo,
    p_ruta_storage: doc.ruta,
    p_sha256: doc.sha256,
    p_tamano_bytes: doc.tamano,
    p_fecha_documento: doc.fecha,
    p_reemplaza_a: doc.reemplazaA,
  });

  if (errorRpc) {
    if (subidoAhora) {
      const { error: errorBorrado } = await bucket.remove([doc.ruta]);
      if (errorBorrado) {
        console.error('documentos: no se pudo borrar un PDF huérfano tras un registro fallido.');
      }
    }
    const status = estatusErrorDocumento(errorRpc.code);
    if (status) {
      return Response.json({ error: errorRpc.message }, { status });
    }
    console.error('documentos: fallo al registrar el documento.');
    return Response.json({ error: 'No se pudo registrar el documento.' }, { status: 500 });
  }

  return Response.json({ ok: true, documento: rpc });
}

/** Storage responde 409 / «already exists» cuando la ruta ya está ocupada. */
function yaExiste(error: unknown): boolean {
  const e = error as { statusCode?: string | number; status?: number; message?: string };
  return (
    String(e.statusCode ?? '') === '409' ||
    e.status === 409 ||
    /already exists/i.test(e.message ?? '')
  );
}
