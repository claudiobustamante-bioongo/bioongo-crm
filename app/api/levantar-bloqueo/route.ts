import { createClient } from '@/lib/supabase-server';
import { registrarEvento } from '@/lib/bitacora';
import { estatusErrorFirma, validarFirma } from '@/lib/firma';

/**
 * POST /api/levantar-bloqueo
 *
 * Recibe { bloqueo_id, motivo, rol, declaracion, autorizacion_oficial? } y
 * levanta el bloqueo de un cliente que abrió una coincidencia confirmada en
 * lista de sanciones.
 *
 * EL LEVANTAMIENTO SE FIRMA. Una sola llamada a fn_levantar_bloqueo (SECURITY
 * DEFINER, migraciones/2026-10-05-bloqueo-y-firma.sql) escribe la firma con
 * acto `levantamiento_bloqueo` y cierra el bloqueo, todo o nada. El espejo
 * `cliente_bloqueos_historico` guarda el bloqueo tal como estaba abierto. El
 * firmante NO se recibe: lo toma la base del JWT de la sesión.
 *
 * QUIÉN PUEDE LEVANTAR · decisión de Claudio, 5-oct-2026. Los dos roles. Pero
 * levantar un bloqueo por sanciones es decisión del Oficial de Cumplimiento:
 * si firma el asesor —porque el Oficial no usa el sistema—, firma con su
 * propio rol y `autorizacion_oficial` es OBLIGATORIA (quién autorizó, cuándo y
 * por qué medio). Con rol oficial_cumplimiento es opcional. La regla vive
 * también en la base (CHECK y validación en la función). El rol se DECLARA y no
 * se verifica hasta la Fase G.
 *
 * Los errores propios de la función (BL400, BL401, BL404, BL409) salen como su
 * 4xx; nunca como 500. Un bloqueo ya levantado responde 409: no se re-levanta.
 *
 * El sistema no presenta ningún reporte ni avisa a nadie por la red: levantar
 * es un acto en el expediente, no una comunicación.
 *
 * Ningún dato del cliente se escribe a logs: solo mensajes genéricos.
 */
export async function POST(request: Request) {
  let cuerpo: Record<string, unknown>;
  try {
    cuerpo = await request.json();
  } catch {
    return Response.json({ error: 'El cuerpo de la petición no es JSON válido.' }, { status: 400 });
  }

  const bloqueoId = cuerpo?.bloqueo_id;
  if (typeof bloqueoId !== 'string' || !bloqueoId.trim()) {
    return Response.json({ error: 'Falta `bloqueo_id`.' }, { status: 400 });
  }

  const motivo = typeof cuerpo?.motivo === 'string' ? cuerpo.motivo.trim() : '';
  if (!motivo) {
    return Response.json(
      {
        error:
          'Falta `motivo`. Un bloqueo por sanciones levantado sin razón escrita no es ' +
          'defendible ante el supervisor.',
      },
      { status: 400 }
    );
  }

  const validacion = validarFirma(cuerpo, { levantamiento: true });
  if (!validacion.ok) {
    return Response.json({ error: validacion.error }, { status: 400 });
  }
  const { firma } = validacion;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  // Sin `firmante`: la función lo toma del JWT.
  const { data: rpc, error: errorRpc } = await supabase.rpc('fn_levantar_bloqueo', {
    p_bloqueo_id: bloqueoId,
    p_motivo: motivo,
    p_rol: firma.rol,
    p_declaracion: firma.declaracion,
    p_autorizacion_oficial: firma.autorizacion_oficial,
  });

  if (errorRpc) {
    const status = estatusErrorFirma(errorRpc.code);
    if (status) {
      return Response.json(
        {
          error:
            status === 409
              ? 'El bloqueo ya fue levantado. Vuelve a cargar la ficha.'
              : errorRpc.message,
        },
        { status }
      );
    }
    console.error('levantar-bloqueo: fallo al levantar el bloqueo.');
    return Response.json({ error: 'No se pudo levantar el bloqueo.' }, { status: 500 });
  }

  const resultado = (rpc ?? {}) as Record<string, unknown>;
  const codigoCliente = typeof resultado.codigo_cliente === 'string' ? resultado.codigo_cliente : '';
  const levantadoPor =
    typeof resultado.levantado_por === 'string' ? resultado.levantado_por : (user.email ?? user.id);
  const firmaId = typeof resultado.firma_id === 'string' ? resultado.firma_id : null;

  // Después de escribir: la bitácora nunca dice que ocurrió algo que no ocurrió.
  // Mismo `entidad_id` que usa trg_bitacora en cliente_bloqueos: el código del
  // cliente, para que la mecánica y el porqué salgan intercalados.
  const bitacora = await registrarEvento(supabase, {
    entidad: 'cliente_bloqueos',
    entidadId: codigoCliente || bloqueoId,
    accion: 'levantamiento_bloqueo',
    campo: 'levantado_en',
    valorAnterior: null,
    valorNuevo: 'levantado',
    motivo:
      `Bloqueo por sanciones levantado. Motivo: ${motivo} · Firmó ${levantadoPor} como ` +
      `${firma.rol}.` +
      (firma.autorizacion_oficial
        ? ` · Autorización del Oficial: ${firma.autorizacion_oficial}`
        : ''),
    usuario: user.email ?? user.id,
    metadata: {
      bloqueo_id: bloqueoId,
      codigo_cliente: codigoCliente,
      firma: {
        id: firmaId,
        rol: firma.rol,
        declaracion: firma.declaracion,
        autorizacion_oficial: firma.autorizacion_oficial,
      },
    },
  });

  return Response.json({
    ok: true,
    bloqueo: { id: bloqueoId, codigo_cliente: codigoCliente, levantado_por: levantadoPor },
    firma: { id: firmaId, rol: firma.rol, autorizacion_oficial: firma.autorizacion_oficial },
    bitacora,
  });
}
