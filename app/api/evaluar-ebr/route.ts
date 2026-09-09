import { createClient } from '@/lib/supabase-server';
import { ErrorEBR, construirInputsEBR, evaluarEBR } from '@/lib/ebr-engine';
import { registrarEvento } from '@/lib/bitacora';

/**
 * POST /api/evaluar-ebr
 *
 * Recibe { codigo_cliente }, corre el motor de Evaluación Basada en Riesgo
 * PLD/FT y guarda el resultado en `ebr_evaluaciones`. Devuelve la evaluación
 * completa con sus supuestos, su matriz y su bitácora de observaciones.
 *
 * HISTÓRICO: cada llamada INSERTA una fila nueva. Nunca actualiza la anterior.
 * La vigente es la de `fecha_evaluacion` más reciente. El grado que se le
 * asignó a un cliente en una fecha debe seguir siendo recuperable después de
 * reevaluar: el expediente tiene que poder reconstruirse como estaba.
 *
 * SOLO `clientes` ES OBLIGATORIA. Si falta la fila de `kyc_detalle`,
 * `pep_listas` o `transaccionalidad`, no es error: el motor está hecho para
 * eso y marca la evaluación como preliminar diciendo qué faltó. Hoy
 * `pep_listas` tiene tres filas y `transaccionalidad` dos, así que abortar por
 * ausencia dejaría la ruta inservible sobre la cartera real.
 *
 * Un error de lectura sí aborta, en cambio. «La consulta falló» y «no hay
 * fila» son cosas distintas: tratar la primera como la segunda produciría una
 * evaluación preliminar inventada sobre datos que sí existen.
 *
 * Ningún dato del cliente se escribe a logs: solo mensajes genéricos.
 */

export async function POST(request: Request) {
  let codigoCliente: unknown;
  try {
    const body = await request.json();
    codigoCliente = body?.codigo_cliente;
  } catch {
    return Response.json(
      { error: 'El cuerpo de la petición no es JSON válido.' },
      { status: 400 }
    );
  }

  if (typeof codigoCliente !== 'string' || !codigoCliente.trim()) {
    return Response.json({ error: 'Falta codigo_cliente.' }, { status: 400 });
  }

  const supabase = await createClient();

  // --- 1. Sesión ------------------------------------------------------------

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  // --- 2. Lecturas ----------------------------------------------------------

  const { data: cliente, error: errorCliente } = await supabase
    .from('clientes')
    .select(
      'nombre, apellido_paterno, apellido_materno, rfc, curp, fecha_nacimiento, genero, ocupacion, ocupacion_pb, realiza_actividad_vulnerable, actividades_vulnerables, actividad_vulnerable_detalle, documentos_completos'
    )
    .eq('codigo_cliente', codigoCliente)
    .maybeSingle();

  if (errorCliente) {
    console.error('evaluar-ebr: fallo al leer clientes.');
    return Response.json({ error: 'Error al leer el cliente.' }, { status: 500 });
  }
  if (!cliente) {
    return Response.json({ error: 'El cliente no existe.' }, { status: 404 });
  }

  // `kyc_detalle.codigo_cliente` sí es único, así que aquí basta maybeSingle.
  const { data: kyc, error: errorKyc } = await supabase
    .from('kyc_detalle')
    .select(
      'nacionalidad, pais_nacimiento, entidad_federativa_pb, calle, numero_exterior, colonia, municipio, estado, codigo_postal'
    )
    .eq('codigo_cliente', codigoCliente)
    .maybeSingle();

  if (errorKyc) {
    console.error('evaluar-ebr: fallo al leer kyc_detalle.');
    return Response.json({ error: 'Error al leer el expediente KYC.' }, { status: 500 });
  }

  // `pep_listas` y `transaccionalidad` NO tienen restricción única en
  // codigo_cliente: puede haber varias declaraciones. Se toma la más reciente,
  // igual que /api/calcular-ips hace con perfil_riesgo.
  const { data: pep, error: errorPep } = await supabase
    .from('pep_listas')
    .select(
      'es_pep_nacional, es_pep_extranjero, familiar_pep_nacional, familiar_pep_extranjero'
    )
    .eq('codigo_cliente', codigoCliente)
    .order('created_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (errorPep) {
    console.error('evaluar-ebr: fallo al leer pep_listas.');
    return Response.json({ error: 'Error al leer la declaración PEP.' }, { status: 500 });
  }

  const { data: transaccionalidad, error: errorTrx } = await supabase
    .from('transaccionalidad')
    .select(
      'monto_inicial_deposito, depositos_mensuales, retiros_mensuales, fecha_declaracion'
    )
    .eq('codigo_cliente', codigoCliente)
    .order('fecha_declaracion', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (errorTrx) {
    console.error('evaluar-ebr: fallo al leer transaccionalidad.');
    return Response.json(
      { error: 'Error al leer la transaccionalidad declarada.' },
      { status: 500 }
    );
  }

  // --- 2b. Listas de control ------------------------------------------------

  // El motor no consulta la base: se le entregan las filas y él las traduce.
  //
  // Las VIGENTES definen contra qué se cotejó; las coincidencias definen con
  // qué resultado. Son dos preguntas distintas y por eso van en dos consultas:
  // puede haber listas vigentes y ninguna coincidencia, que es justamente el
  // caso que hoy salía como «no consta la búsqueda» siendo falso.
  const { data: listasVigentes, error: errorListas } = await supabase
    .from('listas_control')
    .select('tipo, fecha_lista, fecha_carga')
    .eq('vigente', true);

  if (errorListas) {
    console.error('evaluar-ebr: fallo al leer las listas de control.');
    return Response.json({ error: 'Error al leer las listas de control.' }, { status: 500 });
  }

  // NO se filtra por vigencia de la lista: retirar una lista no des-confirma un
  // match que un humano ya revisó. Las `descartada` sí quedan fuera —son
  // homónimos ya resueltos— y contarlas reabriría una decisión tomada.
  const { data: coincidencias, error: errorCoincidencias } = await supabase
    .from('listas_coincidencias')
    .select('estado')
    .eq('codigo_cliente', codigoCliente)
    .in('estado', ['pendiente', 'confirmada']);

  if (errorCoincidencias) {
    console.error('evaluar-ebr: fallo al leer las coincidencias de listas.');
    return Response.json(
      { error: 'Error al leer las coincidencias contra listas de control.' },
      { status: 500 }
    );
  }

  // --- 3. Motor -------------------------------------------------------------

  const inputs = construirInputsEBR({
    cliente,
    kyc,
    pep,
    transaccionalidad,
    listas: { vigentes: listasVigentes ?? [], coincidencias: coincidencias ?? [] },
  });

  let resultado;
  try {
    resultado = evaluarEBR(inputs);
  } catch (e) {
    // ErrorEBR es expediente incompleto, no fallo del sistema: falta la
    // ocupación del catálogo PB, o el cliente dijo que sí realiza actividades
    // vulnerables sin seleccionar ninguna. Es 400 y el mensaje del motor va tal
    // cual al llamador, que es quien puede corregirlo. No se escribe nada.
    if (e instanceof ErrorEBR) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    console.error('evaluar-ebr: el motor falló por causa distinta de expediente incompleto.');
    return Response.json(
      { error: 'No se pudo evaluar el riesgo del cliente.' },
      { status: 500 }
    );
  }

  // --- 4. Grado anterior ----------------------------------------------------

  // Se lee ANTES de insertar, y sirve solo para que la bitácora pueda mostrar
  // la transición. Un cambio de BAJO a ALTO es justo lo que un revisor busca.
  // Si la consulta falla no se aborta: perder el valor anterior degrada el
  // asiento, no la evaluación.
  const { data: anterior } = await supabase
    .from('ebr_evaluaciones')
    .select('grado_riesgo')
    .eq('codigo_cliente', codigoCliente)
    .order('fecha_evaluacion', { ascending: false })
    .limit(1)
    .maybeSingle();

  // --- 5. Guardado ----------------------------------------------------------

  const supuestosActivos = resultado.supuestos_evaluados.filter((s) => s.activo).length;

  const { data: guardado, error: errorGuardado } = await supabase
    .from('ebr_evaluaciones')
    .insert({
      codigo_cliente: codigoCliente,

      grado_riesgo: resultado.grado_riesgo,
      regimen: resultado.regimen,
      razon_clasificacion: resultado.razon_clasificacion,
      fundamento_clasificacion: resultado.fundamento_clasificacion,
      supuestos_evaluados: resultado.supuestos_evaluados,
      supuestos_activos: supuestosActivos,

      matriz_factores: resultado.matriz_factores,
      matriz_puntaje_total: resultado.matriz_puntaje_total,
      matriz_banda: resultado.matriz_banda,

      es_pep: resultado.es_pep,
      pep_extranjero: resultado.pep_extranjero,
      aplica_medidas_pep: resultado.aplica_medidas_pep,
      requiere_aprobacion_oficial: resultado.requiere_aprobacion_oficial,
      en_lista_bloqueadas: resultado.en_lista_bloqueadas,
      alerta_critica: resultado.alerta_critica,

      evaluacion_preliminar: resultado.evaluacion_preliminar,
      motivos_preliminar: resultado.motivos_preliminar,
      verificaciones_pendientes: resultado.verificaciones_pendientes,
      observaciones: resultado.observaciones,

      // Fotografía de la entrada: sin ella la evaluación deja de ser
      // reproducible en cuanto alguien corrija un campo del cliente.
      entrada: inputs,

      fecha_evaluacion: new Date().toISOString(),
      override_source: resultado.override_source,
      elaboro: resultado.elaboro,
      revisa_autoriza: resultado.revisa_autoriza,
    })
    .select('id, fecha_evaluacion')
    .maybeSingle();

  if (errorGuardado || !guardado) {
    console.error('evaluar-ebr: fallo al guardar la evaluación.');
    return Response.json(
      {
        error: 'La evaluación se calculó pero no se pudo guardar.',
        codigo_cliente: codigoCliente,
        ...resultado,
      },
      { status: 500 }
    );
  }

  // --- 6. Bitácora ----------------------------------------------------------

  // Después del guardado: la bitácora nunca dice que ocurrió algo que no
  // ocurrió. El motivo lleva el grado y la razón porque es el asiento que un
  // revisor lee primero, sin abrir el metadata.
  await registrarEvento(supabase, {
    entidad: 'ebr_evaluaciones',
    entidadId: guardado.id,
    accion: 'evaluacion_ebr',
    motivo:
      `Evaluación Basada en Riesgo PLD/FT. Grado ${resultado.grado_riesgo}, ` +
      `régimen ${resultado.regimen}. ${resultado.razon_clasificacion}` +
      (resultado.evaluacion_preliminar
        ? ` Evaluación PRELIMINAR: ${resultado.motivos_preliminar.length} motivos pendientes.`
        : ''),
    usuario: user.email ?? user.id,
    campo: 'grado_riesgo',
    valorAnterior: anterior?.grado_riesgo ?? null,
    valorNuevo: resultado.grado_riesgo,
    // Redundante con la fila que acaba de escribirse, y a propósito: si alguien
    // borrara la evaluación desde SQL, el asiento seguiría conteniéndola entera.
    metadata: { codigo_cliente: codigoCliente, resultado },
  });

  // --- 7. Respuesta ---------------------------------------------------------

  // El spread va primero para que `fecha_evaluacion` sea la de la fila
  // guardada, con hora, y no la fecha sin hora que devuelve el motor.
  return Response.json({
    ...resultado,
    id: guardado.id,
    codigo_cliente: codigoCliente,
    fecha_evaluacion: guardado.fecha_evaluacion,
  });
}
