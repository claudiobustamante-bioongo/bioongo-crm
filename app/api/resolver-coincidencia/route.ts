import { createClient } from '@/lib/supabase-server';
import { registrarEvento } from '@/lib/bitacora';
import { FUNDAMENTOS } from '@/lib/ebr-engine';
import { OBLIGACIONES_SANCIONES, esListaDeSanciones, nombreLista } from '@/lib/listas';
import { estatusErrorFirma, validarFirma } from '@/lib/firma';

/**
 * POST /api/resolver-coincidencia
 *
 * Recibe { id, estado, motivo, rol, declaracion } y resuelve una coincidencia
 * detectada contra una lista de control. `estado` es 'confirmada' o
 * 'descartada'.
 *
 * TODA RESOLUCIÓN SE FIRMA, en los dos sentidos. Descartar es el acto más
 * riesgoso —un falso negativo deja operar a quien no debía—, así que pesa lo
 * mismo que confirmar: sin `rol` y `declaracion` responde 400 y no toca nada.
 * El firmante NO se recibe: lo toma la base del JWT de la sesión. El rol se
 * DECLARA y no se verifica hasta la Fase G (ver lib/firma.ts).
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
 * TODO O NADA, EN LA BASE
 *
 * La escritura es UNA llamada a fn_resolver_coincidencia (SECURITY DEFINER,
 * migraciones/2026-10-05-bloqueo-y-firma.sql): cambia la coincidencia, escribe
 * la firma y, si la lista es de sanciones, abre el bloqueo del cliente, en la
 * misma transacción. Las tablas de firma y bloqueo no admiten escritura
 * directa de la aplicación. Si el cliente ya tenía un bloqueo abierto por otra
 * coincidencia, la función devuelve ese y no abre otro.
 *
 * Los errores propios de la función (BL400, BL401, BL404, BL409) se traducen a
 * su 4xx; nunca salen como 500.
 *
 * QUÉ DISPARA LA RUTA REFORZADA
 *
 * Confirmar una coincidencia en una lista de SANCIONES —LPB, OFAC u ONU, según
 * `TIPOS_SANCIONES` de `lib/listas.ts`, que un test ata a fn_tipos_sanciones()
 * de la base— BLOQUEA al cliente, devuelve el aviso con las obligaciones del
 * apartado 10.10 y las asienta en la bitácora. Es la misma regla con la que el
 * motor EBR eleva a ALTO con alerta crítica. El SAT 69-B no la dispara: es
 * materia fiscal. PEP_NACIONAL tampoco.
 *
 * Desde el 5 de octubre de 2026 el bloqueo persiste: la bandeja y la ficha lo
 * leen de `cliente_bloqueos`, el IPS y el portafolio se niegan a generarse
 * mientras esté abierto, y solo se levanta con firma (/api/levantar-bloqueo).
 *
 * EL SISTEMA NUNCA PRESENTA EL REPORTE DE 24 HORAS: marca, bloquea y exige
 * firma. Quién presenta y cuándo lo deciden Claudio Bustamante y el Oficial de
 * Cumplimiento. Hay un test (route.test.ts) que falla si esta ruta llama a la
 * red o escribe por otra vía que la función de firma y la bitácora.
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
      'confirmada en listas de sanciones. El cliente ya quedó BLOQUEADO: el IPS y el ' +
      'portafolio no se generan hasta que el bloqueo se levante con firma.'
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

  let cuerpo: Record<string, unknown>;
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

  const validacion = validarFirma(cuerpo);
  if (!validacion.ok) {
    return Response.json({ error: validacion.error }, { status: 400 });
  }
  const { firma } = validacion;

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

  // --- 5. Resolución, firma y bloqueo: una sola transacción -----------------

  // Sin `firmante`: la función lo toma del JWT. La carrera entre dos revisores
  // la cierra la propia función (FOR UPDATE + estado pendiente → BL409).
  const { data: rpc, error: errorRpc } = await supabase.rpc('fn_resolver_coincidencia', {
    p_coincidencia_id: id,
    p_estado: estado,
    p_motivo: motivo,
    p_rol: firma.rol,
    p_declaracion: firma.declaracion,
  });

  if (errorRpc) {
    const status = estatusErrorFirma(errorRpc.code);
    if (status) {
      return Response.json(
        {
          error:
            status === 409
              ? 'Otro usuario resolvió esta coincidencia mientras la revisabas. Vuelve a cargarla.'
              : errorRpc.message,
        },
        { status }
      );
    }
    console.error('resolver-coincidencia: fallo al guardar la resolución.');
    return Response.json({ error: 'No se pudo guardar la resolución.' }, { status: 500 });
  }

  const resultado = (rpc ?? {}) as Record<string, unknown>;
  const firmaId = typeof resultado.firma_id === 'string' ? resultado.firma_id : null;
  const revisadaPor = typeof resultado.revisada_por === 'string' ? resultado.revisada_por : usuario;
  const bloqueo =
    typeof resultado.bloqueo_id === 'string'
      ? { id: resultado.bloqueo_id, nuevo: resultado.bloqueo_nuevo === true }
      : null;

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
      ` · Firmó ${revisadaPor} como ${firma.rol}.` +
      (bloqueo
        ? bloqueo.nuevo
          ? ' · Cliente BLOQUEADO.'
          : ' · El cliente ya estaba bloqueado por otra coincidencia; no se abrió otro bloqueo.'
        : '') +
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
      firma: { id: firmaId, rol: firma.rol, declaracion: firma.declaracion },
      bloqueo,
    },
  });

  // --- 7. Respuesta --------------------------------------------------------

  return Response.json({
    coincidencia: {
      id: coincidencia.id,
      codigo_cliente: coincidencia.codigo_cliente,
      tipo_match: coincidencia.tipo_match,
      valor_cliente: coincidencia.valor_cliente,
      valor_lista: coincidencia.valor_lista,
      estado,
      revisada_por: revisadaPor,
      motivo_resolucion: motivo,
    },
    firma: { id: firmaId, rol: firma.rol, firmante: revisadaPor },
    bloqueo,
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
