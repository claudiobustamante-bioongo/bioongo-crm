import { createClient } from '@/lib/supabase-server';
import { registrarEvento } from '@/lib/bitacora';

/**
 * POST /api/resolver-coincidencia
 *
 * Recibe { id, estado, motivo } y resuelve una coincidencia detectada contra
 * una lista de control. `estado` es 'confirmada' o 'descartada'.
 *
 * EL MOTIVO ES OBLIGATORIO EN AMBOS SENTIDOS. Descartar una coincidencia
 * contra la Lista de Personas Bloqueadas por homonimia es una decisión
 * legítima y frecuente; hacerlo sin dejar escrito por qué es lo que convierte
 * el expediente en indefendible. La bitácora existe para el porqué, no para el
 * qué: el trigger de la tabla ya registra el qué.
 *
 * NO REABRE. Una coincidencia ya resuelta responde 409 con quién la resolvió y
 * cuándo. Permitir que un segundo UPDATE pise al primero borraría de la
 * evidencia quién decidió qué, que es justo lo que hay que poder mostrar.
 *
 * Ningún dato del cliente se escribe a logs: solo mensajes genéricos.
 */

const ESTADOS = ['confirmada', 'descartada'] as const;
type EstadoResolucion = (typeof ESTADOS)[number];

/**
 * Las dos obligaciones que nacen al confirmar una coincidencia contra la LPB.
 *
 * Manual de Cumplimiento, apartado 10.10 (III.10). Se devuelven al llamador Y
 * se escriben dentro del motivo del asiento: una respuesta HTTP se pierde al
 * cerrar la pestaña, el asiento es lo que queda como evidencia de que la
 * obligación se conoció en el momento.
 */
const OBLIGACIONES_LPB = [
  'Suspender de inmediato la realización de cualquier acto u operación con el Cliente.',
  'Reportar a la CNBV dentro de las 24 horas siguientes, vía SITI, con la leyenda «Reporte de 24 horas».',
] as const;

export async function POST(request: Request) {
  // --- 1. Cuerpo -----------------------------------------------------------

  let cuerpo: { id?: unknown; estado?: unknown; motivo?: unknown };
  try {
    cuerpo = await request.json();
  } catch {
    return Response.json({ error: 'El cuerpo de la petición no es JSON válido.' }, { status: 400 });
  }

  const id = cuerpo?.id;
  if (typeof id !== 'string' || !id.trim()) {
    return Response.json({ error: 'Falta `id` de la coincidencia.' }, { status: 400 });
  }

  const estado = cuerpo?.estado;
  if (typeof estado !== 'string' || !ESTADOS.includes(estado as EstadoResolucion)) {
    return Response.json(
      {
        error:
          "`estado` debe ser 'confirmada' o 'descartada'. Esta ruta resuelve coincidencias; " +
          'no las regresa a pendiente.',
      },
      { status: 400 }
    );
  }

  const motivo = typeof cuerpo?.motivo === 'string' ? cuerpo.motivo.trim() : '';
  if (!motivo) {
    return Response.json(
      {
        error:
          'Falta `motivo`. Es obligatorio también al descartar: una coincidencia contra una ' +
          'lista de control descartada sin razón escrita no es defendible ante el supervisor.',
      },
      { status: 400 }
    );
  }

  // --- 2. Sesión -----------------------------------------------------------

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }
  const usuario = user.email ?? user.id;

  // --- 3. Estado actual ----------------------------------------------------

  const { data: coincidencia, error: errorLectura } = await supabase
    .from('listas_coincidencias')
    .select(
      'id, codigo_cliente, lista_id, registro_id, tipo_match, valor_cliente, valor_lista, estado, revisada_por, fecha_revision, motivo_resolucion, detectada_en'
    )
    .eq('id', id)
    .maybeSingle();

  if (errorLectura) {
    console.error('resolver-coincidencia: fallo al leer la coincidencia.');
    return Response.json({ error: 'Error al leer la coincidencia.' }, { status: 500 });
  }
  if (!coincidencia) {
    return Response.json({ error: 'La coincidencia no existe.' }, { status: 404 });
  }

  if (coincidencia.estado !== 'pendiente') {
    return Response.json(
      {
        error: `La coincidencia ya está ${coincidencia.estado}. No se re-resuelve: eso borraría de la evidencia quién decidió qué.`,
        resuelta: {
          estado: coincidencia.estado,
          revisada_por: coincidencia.revisada_por,
          fecha_revision: coincidencia.fecha_revision,
          motivo_resolucion: coincidencia.motivo_resolucion,
        },
      },
      { status: 409 }
    );
  }

  // --- 4. La lista de origen -----------------------------------------------

  // El tipo decide si esta confirmación dispara las obligaciones del 10.10, así
  // que se lee de la base y no se recibe del llamador.
  const { data: lista, error: errorLista } = await supabase
    .from('listas_control')
    .select('id, tipo, obligatoria, fuente, fecha_lista, vigente')
    .eq('id', coincidencia.lista_id)
    .maybeSingle();

  if (errorLista || !lista) {
    console.error('resolver-coincidencia: fallo al leer la lista de origen.');
    return Response.json(
      { error: 'No se pudo leer la lista de origen de la coincidencia.' },
      { status: 500 }
    );
  }

  const esLPB = lista.tipo === 'LPB';
  const confirmada = estado === 'confirmada';
  const disparaObligaciones = esLPB && confirmada;

  // --- 5. Resolución -------------------------------------------------------

  const fechaRevision = new Date().toISOString();

  const { data: actualizada, error: errorUpdate } = await supabase
    .from('listas_coincidencias')
    .update({
      estado,
      revisada_por: usuario,
      fecha_revision: fechaRevision,
      motivo_resolucion: motivo,
    })
    .eq('id', id)
    // Cierra la carrera entre dos revisores: si otro resolvió entre la lectura
    // y esta escritura, el UPDATE no toca nada y se responde 409.
    .eq('estado', 'pendiente')
    .select('id, estado, revisada_por, fecha_revision, motivo_resolucion')
    .maybeSingle();

  if (errorUpdate) {
    console.error('resolver-coincidencia: fallo al guardar la resolución.');
    return Response.json({ error: 'No se pudo guardar la resolución.' }, { status: 500 });
  }
  if (!actualizada) {
    return Response.json(
      { error: 'Otro usuario resolvió esta coincidencia mientras la revisabas. Vuelve a cargarla.' },
      { status: 409 }
    );
  }

  // --- 6. Bitácora ---------------------------------------------------------

  // Después de escribir: la bitácora nunca dice que ocurrió algo que no ocurrió.
  await registrarEvento(supabase, {
    entidad: 'listas_coincidencias',
    entidadId: coincidencia.id,
    accion: 'resolucion_coincidencia_lista',
    motivo:
      `Coincidencia ${coincidencia.tipo_match} contra lista ${lista.tipo} ` +
      `(corte ${lista.fecha_lista}, fuente ${lista.fuente}) sobre el cliente ` +
      `${coincidencia.codigo_cliente}: ${estado.toUpperCase()}. Motivo: ${motivo}` +
      (disparaObligaciones
        ? ` · OBLIGACIONES INMEDIATAS (apartado 10.10): ${OBLIGACIONES_LPB.join(' ')}`
        : ''),
    usuario,
    campo: 'estado',
    valorAnterior: 'pendiente',
    valorNuevo: estado,
    metadata: {
      codigo_cliente: coincidencia.codigo_cliente,
      lista: {
        id: lista.id,
        tipo: lista.tipo,
        obligatoria: lista.obligatoria,
        fuente: lista.fuente,
        fecha_lista: lista.fecha_lista,
        vigente: lista.vigente,
      },
      registro_id: coincidencia.registro_id,
      tipo_match: coincidencia.tipo_match,
      valor_cliente: coincidencia.valor_cliente,
      valor_lista: coincidencia.valor_lista,
      detectada_en: coincidencia.detectada_en,
      dispara_obligaciones_lpb: disparaObligaciones,
    },
  });

  // --- 7. Respuesta --------------------------------------------------------

  return Response.json({
    coincidencia: {
      id: actualizada.id,
      codigo_cliente: coincidencia.codigo_cliente,
      tipo_match: coincidencia.tipo_match,
      valor_cliente: coincidencia.valor_cliente,
      valor_lista: coincidencia.valor_lista,
      estado: actualizada.estado,
      revisada_por: actualizada.revisada_por,
      fecha_revision: actualizada.fecha_revision,
      motivo_resolucion: actualizada.motivo_resolucion,
    },
    lista: {
      id: lista.id,
      tipo: lista.tipo,
      obligatoria: lista.obligatoria,
      fecha_lista: lista.fecha_lista,
    },
    ...(disparaObligaciones
      ? {
          advertencia: {
            titulo: 'Coincidencia CONFIRMADA en la Lista de Personas Bloqueadas.',
            obligaciones: OBLIGACIONES_LPB,
            plazo: '24 horas contadas desde esta confirmación.',
            fundamento: 'Manual de Cumplimiento, apartado 10.10 (III.10).',
          },
        }
      : {}),
    // Sin esto, confirmar una coincidencia parecería cerrar el expediente de
    // riesgo del cliente, y no lo cierra: hoy el motor EBR no lee esta tabla.
    ...(confirmada
      ? {
          pendiente:
            'La EBR no consume todavía las coincidencias de listas: el motor sigue evaluando ' +
            `con la declaración del cliente. Reevalúa a ${coincidencia.codigo_cliente} teniendo ` +
            'esta confirmación a la vista.',
        }
      : {}),
  });
}
