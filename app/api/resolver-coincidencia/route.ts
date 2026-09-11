import { createClient } from '@/lib/supabase-server';
import { registrarEvento } from '@/lib/bitacora';
import { FUNDAMENTOS } from '@/lib/ebr-engine';
import { OBLIGACIONES_SANCIONES, esListaDeSanciones, nombreLista } from '@/lib/listas';

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
 * QUÉ DISPARA LA RUTA REFORZADA
 *
 * Confirmar una coincidencia en una lista de SANCIONES —LPB, OFAC u ONU, según
 * `TIPOS_SANCIONES` de `lib/listas.ts`— devuelve el aviso con las obligaciones
 * del apartado 10.10 y las asienta en la bitácora. Es la misma regla con la que
 * el motor EBR eleva a ALTO con alerta crítica. Hasta el 11 de septiembre de
 * 2026 esta ruta solo reaccionaba a la LPB, y con OFAC como lista operativa el
 * sistema se contradecía: el motor alarmaba y aquí no pasaba nada. El SAT 69-B
 * no la dispara: es materia fiscal.
 *
 * LO QUE ESTA RUTA NO HACE — NI PARA LA LPB, NI ANTES NI AHORA
 *
 * No bloquea al cliente y no exige firma. Al confirmar una coincidencia en una
 * lista de sanciones hace tres cosas, y ninguna obliga a nada: cambia el estado
 * de la coincidencia, escribe las obligaciones como texto dentro de un asiento
 * de bitácora que ningún proceso lee, y devuelve un aviso que la bandeja pinta
 * en un recuadro que se pierde al recargar la página.
 *
 * Eso vale también para la LPB. Extender el aviso a OFAC y ONU no restauró
 * ninguna paridad: el bloqueo y la firma nunca existieron, para ninguna lista.
 *
 * PENDIENTE · 23 de septiembre de 2026 · requiere DDL
 *   1. Bloqueo del cliente: una marca persistente que impida operar con él
 *      desde que se confirma la coincidencia hasta que se levante con firma.
 *   2. Registro de firma: la validación del Oficial de Cumplimiento sobre la
 *      confirmación, con quién firmó y cuándo.
 * Mientras no existan, suspender operaciones depende de que alguien lea el
 * aviso y actúe.
 *
 * EL SISTEMA NUNCA PRESENTA EL REPORTE DE 24 HORAS, ni ahora ni cuando existan
 * el bloqueo y la firma: marca, bloquea y exige firma. Quién presenta y cuándo
 * lo deciden Claudio Bustamante y el Oficial de Cumplimiento. Hay un test
 * (route.test.ts) que falla si esta ruta llama a la red o escribe fuera de la
 * coincidencia y la bitácora.
 *
 * Ningún dato del cliente se escribe a logs: solo mensajes genéricos.
 */

const ESTADOS = ['confirmada', 'descartada'] as const;
type EstadoResolucion = (typeof ESTADOS)[number];

/**
 * Qué pasa con la clasificación del cliente después de confirmar.
 *
 * Confirmar no reevalúa: el motor EBR lee las coincidencias cuando corre, no
 * cuando se resuelven. Sin este aviso, confirmar parecería cerrar el expediente
 * de riesgo, y la clasificación vigente sigue siendo la de antes.
 */
function avisoTrasConfirmar(tipo: string, codigoCliente: string): string {
  const base =
    `La clasificación vigente de ${codigoCliente} no cambia con esta confirmación: el ` +
    'motor EBR la lee en la próxima evaluación del cliente. ';

  if (esListaDeSanciones(tipo)) {
    return (
      base +
      'Al reevaluarlo quedará en riesgo ALTO, con alerta crítica, por coincidencia ' +
      'confirmada en listas de sanciones.'
    );
  }
  if (tipo === 'PEP_NACIONAL') {
    return (
      base +
      'No eleva el grado —el PEP nacional no reclasifica de oficio—, pero la evaluación ' +
      'quedará preliminar mientras la declaración PEP del Cliente no concuerde con la lista.'
    );
  }
  return (
    base +
    `No eleva el grado: ${nombreLista(tipo)} no es lista de sanciones` +
    (tipo === 'SAT_69B' ? ', es materia fiscal' : '') +
    '. Constará en el expediente como debida diligencia.'
  );
}

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

  // El tipo decide si esta confirmación dispara la ruta reforzada, así que se
  // lee de la base y no se recibe del llamador.
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

  const confirmada = estado === 'confirmada';
  const disparaRutaReforzada = confirmada && esListaDeSanciones(lista.tipo);

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
      (disparaRutaReforzada
        ? ` · OBLIGACIONES INMEDIATAS (apartado 10.10): ${OBLIGACIONES_SANCIONES.join(' ')}`
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
      // Se llamó `dispara_obligaciones_lpb` hasta el 11-sep-2026. Se renombró
      // con cero asientos escritos: ninguna consulta tiene que buscar las dos.
      dispara_ruta_reforzada: disparaRutaReforzada,
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
    ...(disparaRutaReforzada
      ? {
          advertencia: {
            titulo: `Coincidencia CONFIRMADA en lista de sanciones: ${nombreLista(lista.tipo)}.`,
            obligaciones: OBLIGACIONES_SANCIONES,
            plazo: '24 horas contadas desde esta confirmación.',
            // El mismo fundamento con el que el motor eleva a ALTO: la ruta y
            // el expediente no pueden citar dos cosas distintas.
            fundamento: FUNDAMENTOS.listasBloqueadas,
          },
        }
      : {}),
    ...(confirmada ? { pendiente: avisoTrasConfirmar(lista.tipo, coincidencia.codigo_cliente) } : {}),
  });
}
