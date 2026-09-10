/**
 * [expediente] Fuente única de la evaluación EBR de UN cliente.
 *
 * Contiene la lógica que antes vivía en app/api/evaluar-ebr/route.ts. Ese
 * route ahora es una envoltura delgada que solo traduce el resultado a
 * códigos HTTP; el lote llama a esta misma función. Una sola escritura en
 * `ebr_evaluaciones`, un solo asiento de bitácora, un solo lugar que cambiar.
 *
 * Contrato con el orquestador: NUNCA lanza por un problema del expediente.
 * Devuelve { ok: false, codigo_error, error } y deja que el lote continúe.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ErrorEBR, construirInputsEBR, evaluarEBR } from '@/lib/ebr-engine';
import { registrarEvento } from '@/lib/bitacora';
import type { ResultadoEBR } from '@/lib/ebr-lote';

export type CodigoErrorEBR =
  | 'no_existe'
  | 'expediente_incompleto'
  | 'lectura'
  | 'motor'
  | 'guardado';

/**
 * Extiende ResultadoEBR sin tocarlo: el orquestador [core] sigue sin conocer
 * el motor. `payload` lleva la evaluación completa para que el route la
 * devuelva tal cual, incluido el caso en que se calculó pero no se guardó.
 */
export type ResultadoEBRDetallado = ResultadoEBR & {
  codigo_error?: CodigoErrorEBR;
  payload?: Record<string, unknown>;
  fecha_evaluacion?: string;
};

export type ContextoEjecucion = {
  /** Cliente de Supabase con la sesión del usuario (respeta RLS). */
  supabase: SupabaseClient;
  /** Quién autoriza. Va al campo `usuario` de bitacora. */
  usuario: string;
  /** Id del lote cuando viene de una corrida masiva. Ausente si es individual. */
  lote_id?: string;
};

const fallo = (
  codigo_cliente: string,
  codigo_error: CodigoErrorEBR,
  error: string,
  extra: Partial<ResultadoEBRDetallado> = {},
): ResultadoEBRDetallado => ({
  codigo_cliente,
  ok: false,
  codigo_error,
  error,
  ...extra,
});

export async function evaluarYGuardarEBR(
  codigo_cliente: string,
  ctx: ContextoEjecucion,
): Promise<ResultadoEBRDetallado> {
  const { supabase, usuario, lote_id } = ctx;

  try {
    // --- Lecturas ---------------------------------------------------------
    // Solo `clientes` es obligatoria. La ausencia de kyc_detalle, pep_listas o
    // transaccionalidad NO es error: el motor la traduce en evaluación
    // preliminar. Un error de LECTURA sí aborta — «la consulta falló» y «no hay
    // fila» son cosas distintas.

    const { data: cliente, error: errorCliente } = await supabase
      .from('clientes')
      .select(
        // `actividad_vulnerable_fuente` y `_fecha` viajan con el valor: sin ellas
        // el motor no puede decir si la respuesta la dio el Cliente o la
        // determinó el Asesor, y trataría toda la cartera como hueco.
        'nombre, apellido_paterno, apellido_materno, rfc, curp, fecha_nacimiento, genero, ocupacion, ocupacion_pb, realiza_actividad_vulnerable, actividades_vulnerables, actividad_vulnerable_detalle, actividad_vulnerable_fuente, actividad_vulnerable_fecha, documentos_completos',
      )
      .eq('codigo_cliente', codigo_cliente)
      .maybeSingle();

    if (errorCliente) return fallo(codigo_cliente, 'lectura', 'Error al leer el cliente.');
    if (!cliente) return fallo(codigo_cliente, 'no_existe', 'El cliente no existe.');

    const { data: kyc, error: errorKyc } = await supabase
      .from('kyc_detalle')
      .select(
        'nacionalidad, pais_nacimiento, entidad_federativa_pb, calle, numero_exterior, colonia, municipio, estado, codigo_postal',
      )
      .eq('codigo_cliente', codigo_cliente)
      .maybeSingle();

    if (errorKyc) return fallo(codigo_cliente, 'lectura', 'Error al leer el expediente KYC.');

    const { data: pep, error: errorPep } = await supabase
      .from('pep_listas')
      .select(
        'es_pep_nacional, es_pep_extranjero, familiar_pep_nacional, familiar_pep_extranjero',
      )
      .eq('codigo_cliente', codigo_cliente)
      .order('created_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (errorPep) return fallo(codigo_cliente, 'lectura', 'Error al leer la declaración PEP.');

    const { data: transaccionalidad, error: errorTrx } = await supabase
      .from('transaccionalidad')
      .select('monto_inicial_deposito, depositos_mensuales, retiros_mensuales, fecha_declaracion')
      .eq('codigo_cliente', codigo_cliente)
      .order('fecha_declaracion', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (errorTrx)
      return fallo(codigo_cliente, 'lectura', 'Error al leer la transaccionalidad declarada.');

    // --- Listas de control ------------------------------------------------
    // Las vigentes dicen contra qué se cotejó; las coincidencias, con qué
    // resultado. Dos preguntas distintas, dos consultas.

    const { data: listasVigentes, error: errorListas } = await supabase
      .from('listas_control')
      .select('tipo, fecha_lista, fecha_carga')
      .eq('vigente', true);

    if (errorListas)
      return fallo(codigo_cliente, 'lectura', 'Error al leer las listas de control.');

    // No se filtra por vigencia: retirar una lista no des-confirma un match ya
    // revisado por un humano. Las `descartada` sí quedan fuera.
    const { data: coincidencias, error: errorCoincidencias } = await supabase
      .from('listas_coincidencias')
      .select('estado')
      .eq('codigo_cliente', codigo_cliente)
      .in('estado', ['pendiente', 'confirmada']);

    if (errorCoincidencias)
      return fallo(
        codigo_cliente,
        'lectura',
        'Error al leer las coincidencias contra listas de control.',
      );

    // --- Motor ------------------------------------------------------------

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
      // ocupación del catálogo PB, o declaró actividades vulnerables sin
      // seleccionar ninguna. Es del llamador corregirlo. No se escribe nada.
      if (e instanceof ErrorEBR) {
        return fallo(codigo_cliente, 'expediente_incompleto', e.message);
      }
      return fallo(codigo_cliente, 'motor', 'No se pudo evaluar el riesgo del cliente.');
    }

    // --- Grado anterior ---------------------------------------------------
    // Se lee ANTES de insertar. Alimenta la transición del asiento y la lista
    // de cambios del lote. Si la consulta falla no se aborta: perder el valor
    // anterior degrada el asiento, no la evaluación.

    const { data: anterior } = await supabase
      .from('ebr_evaluaciones')
      .select('grado_riesgo')
      .eq('codigo_cliente', codigo_cliente)
      .order('fecha_evaluacion', { ascending: false })
      .limit(1)
      .maybeSingle();

    const grado_anterior = anterior?.grado_riesgo ?? null;

    // --- Guardado ---------------------------------------------------------

    const supuestosActivos = resultado.supuestos_evaluados.filter((s) => s.activo).length;

    const { data: guardado, error: errorGuardado } = await supabase
      .from('ebr_evaluaciones')
      .insert({
        codigo_cliente,

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
      return fallo(
        codigo_cliente,
        'guardado',
        'La evaluación se calculó pero no se pudo guardar.',
        { payload: { codigo_cliente, ...resultado } },
      );
    }

    // --- Bitácora ---------------------------------------------------------
    // Después del guardado: la bitácora nunca dice que ocurrió algo que no
    // ocurrió. El motivo lleva grado y razón porque es lo primero que lee un
    // revisor, sin abrir el metadata. El lote se identifica en el propio motivo
    // para que una corrida masiva pueda aislarse o revertirse completa.

    await registrarEvento(supabase, {
      entidad: 'ebr_evaluaciones',
      entidadId: guardado.id,
      accion: 'evaluacion_ebr',
      motivo:
        (lote_id ? `[lote ${lote_id}] ` : '') +
        `Evaluación Basada en Riesgo PLD/FT. Grado ${resultado.grado_riesgo}, ` +
        `régimen ${resultado.regimen}. ${resultado.razon_clasificacion}` +
        (resultado.evaluacion_preliminar
          ? ` Evaluación PRELIMINAR: ${resultado.motivos_preliminar.length} motivos pendientes.`
          : ''),
      usuario,
      campo: 'grado_riesgo',
      valorAnterior: grado_anterior,
      valorNuevo: resultado.grado_riesgo,
      // Redundante con la fila recién escrita, y a propósito: si alguien
      // borrara la evaluación desde SQL, el asiento seguiría conteniéndola.
      metadata: { codigo_cliente, resultado, ...(lote_id ? { lote_id } : {}) },
    });

    // --- Resultado --------------------------------------------------------
    // `campos_faltantes` NO se recalcula aquí: es exactamente lo que el motor
    // ya determinó como motivos de preliminaridad. Duplicar esa lógica sería
    // una segunda fuente de verdad que se desincroniza sola.

    return {
      codigo_cliente,
      ok: true,
      grado: resultado.grado_riesgo,
      grado_anterior,
      puntaje: resultado.matriz_puntaje_total,
      motivos: [resultado.razon_clasificacion].filter(Boolean),
      campos_faltantes: resultado.evaluacion_preliminar
        ? (resultado.motivos_preliminar ?? [])
        : [],
      evaluacion_id: guardado.id,
      fecha_evaluacion: guardado.fecha_evaluacion,
      payload: { ...resultado, id: guardado.id, codigo_cliente, fecha_evaluacion: guardado.fecha_evaluacion },
    };
  } catch (e) {
    // Red de seguridad. Que un cliente reviente por una causa no prevista no
    // debe tumbar un lote de 36.
    return fallo(
      codigo_cliente,
      'motor',
      e instanceof Error ? e.message : String(e),
    );
  }
}
