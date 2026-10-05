/**
 * [expediente] Fuente única del cálculo IPS de UN cliente.
 *
 * Contiene la lógica que antes vivía en app/api/calcular-ips/route.ts. Ese
 * route ahora es una envoltura delgada que solo traduce el resultado a códigos
 * HTTP; el lote masivo llamará a esta misma función. Una sola escritura en
 * `perfil_riesgo`, un solo asiento de bitácora, un solo lugar que cambiar.
 *
 * Contrato con el orquestador: NUNCA lanza por un problema del expediente.
 * Devuelve { ok: false, codigo_error, error } y deja que el lote continúe.
 *
 * CLIENTE BLOQUEADO · decisión de Claudio, 29-sep-2026, vigente desde el 5-oct.
 * Si el cliente tiene un bloqueo abierto en `cliente_bloqueos` (coincidencia
 * confirmada en lista de sanciones), devuelve `cliente_bloqueado` y NO escribe:
 * el perfil vigente queda intacto. Un error al leer el bloqueo es `lectura` y
 * tampoco escribe: no se opera con un cliente cuyo bloqueo no se pudo verificar.
 * El EBR, en cambio, sí corre para un bloqueado (sale ALTO con alerta crítica).
 *
 * ---------------------------------------------------------------------------
 * PENDIENTE · «ErrorIPS tipado» — va en su propio día
 *
 * `calcularPerfilIPS` lanza `Error` pelado en dos sitios —datos bloqueantes
 * faltantes y edad menor a 18—, sin un tipo propio como el `ErrorEBR` del otro
 * motor. Aquí, en consecuencia, CUALQUIER excepción del motor se traduce a
 * `datos_bloqueantes` (400), que es lo que la ruta hacía antes y por eso se
 * conserva.
 *
 * Eso significa que un bug real del motor se le reporta al usuario como
 * «faltan datos bloqueantes»: se le está mintiendo, y se le manda a corregir un
 * expediente que no tiene nada malo. El arreglo es un `ErrorIPS` tipado que
 * distinga expediente incompleto (400) de fallo del motor (500), y va en su
 * propio commit: mezclar el refactor con el cambio de semántica de los errores
 * hace imposible saber cuál de los dos rompió qué.
 *
 * SEÑAL PARA EL RESUMEN DEL LOTE: si una corrida masiva devuelve
 * `datos_bloqueantes` en 28 de 30 clientes, eso no son 28 expedientes
 * incompletos, es un bug del motor. El lote es justo lo que lo va a hacer
 * visible, y el resumen debería poder decirlo en vez de repetir 28 veces el
 * mismo mensaje.
 *
 * PENDIENTE · el ajuste manual que queda colgando
 *
 * Hay 1 cliente con `perfil_ajustado` puesto a mano por el Asesor. Al
 * recalcular, ese ajuste queda colgando de un cálculo que ya no existe: el
 * motor escribe `resultado_perfil` nuevo y el ajuste sigue ahí, apuntando a una
 * corrida anterior. NO se resuelve aquí, y a propósito: decidir si un ajuste
 * sobrevive a un recálculo es criterio del Asesor, no del código. Lo que toca
 * es que el resumen del lote lo señale como REVISIÓN PERSONAL, con su
 * codigo_cliente, para que alguien lo mire uno por uno.
 * ---------------------------------------------------------------------------
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { calcularPerfilIPS, type IPSInputs } from '@/lib/ips-engine';
import type { PerfilRiesgo } from '@/lib/ips-catalogo';
import { registrarEvento } from '@/lib/bitacora';
import { leerBloqueoAbierto, mensajeClienteBloqueado } from '@/lib/bloqueo';
import type { ResultadoLote, ResumenLote } from '@/lib/ebr-lote';
import type { ConExcluidos } from '@/lib/cartera';

export type CodigoErrorIPS =
  | 'no_existe'
  | 'cliente_bloqueado'
  | 'sin_cuestionario'
  | 'datos_bloqueantes'
  | 'lectura'
  | 'guardado'
  | 'motor';

/**
 * Extiende `ResultadoLote<PerfilRiesgo>` sin tocarlo: el orquestador [core]
 * sigue sin conocer el motor. `payload` lleva el cálculo completo para que el
 * route lo devuelva tal cual, incluido el caso en que se calculó pero no se
 * guardó.
 */
export type ResultadoIPSDetallado = ResultadoLote<PerfilRiesgo> & {
  codigo_error?: CodigoErrorIPS;
  payload?: Record<string, unknown>;
  /**
   * El expediente traía un `perfil_ajustado` puesto a mano por el Asesor, y este
   * recálculo acaba de dejarlo colgando de un cálculo que ya no existe.
   *
   * NO va en `payload`: la respuesta de /api/calcular-ips no cambia de forma, y
   * hay un caso del arnés que lo fija. Esta bandera existe para que el resumen
   * del lote pueda señalar al cliente como REVISIÓN PERSONAL.
   *
   * Solo se pone cuando el recálculo se guardó. Si el guardado falló, nada se
   * sobrescribió y no hay ajuste colgando que revisar.
   */
  ajuste_manual?: boolean;
};

/**
 * El resumen del lote IPS: el genérico más lo que solo la capa IPS puede saber.
 *
 * Va aquí y no en el orquestador [core] porque `ajuste_manual` y `codigo_error`
 * son conceptos del expediente IPS; el orquestador no debe conocerlos.
 *
 * NO lleva columna de «con huecos»: el IPS no tiene el concepto de evaluación
 * preliminar que tiene el EBR, así que `campos_faltantes` viene siempre vacío y
 * una columna de huecos saldría en blanco en todas las corridas.
 */
export type ResumenIPS = ResumenLote<PerfilRiesgo> & {
  /**
   * Clientes recalculados que traían `perfil_ajustado` del Asesor. Se listan por
   * código y no solo se cuentan: el resumen tiene que decir A QUIÉN revisar.
   */
  ajuste_manual: string[];
  /**
   * Fallos agrupados por `codigo_error`. Agrupar importa: 28 clientes con
   * `datos_bloqueantes` no son 28 expedientes incompletos, son un bug del motor,
   * y eso solo se ve si el resumen los junta en vez de repetir el mensaje.
   */
  por_codigo_error: Record<string, string[]>;
} & ConExcluidos;

/** Los eventos que emite /api/ips-masivo. El `fatal` lo agrega la ruta. */
export type EventoIPS =
  | { tipo: 'inicio'; lote_id: string; total: number; iniciado_en: string }
  | {
      tipo: 'avance';
      lote_id: string;
      indice: number;
      total: number;
      resultado: ResultadoIPSDetallado;
    }
  | { tipo: 'resumen'; lote_id: string; resumen: ResumenIPS };

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
  codigo_error: CodigoErrorIPS,
  error: string,
  extra: Partial<ResultadoIPSDetallado> = {},
): ResultadoIPSDetallado => ({
  codigo_cliente,
  ok: false,
  codigo_error,
  error,
  ...extra,
});

/** Convierte a número los `numeric` de Postgres, que pueden llegar como texto. */
function aNumero(valor: unknown): number | undefined {
  if (valor === null || valor === undefined) return undefined;
  const n = typeof valor === 'number' ? valor : Number(valor);
  return Number.isFinite(n) ? n : undefined;
}

/** Normaliza texto: cadenas vacías o solo espacios se tratan como ausentes. */
function aTexto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() ? valor : undefined;
}

export async function calcularYGuardarIPS(
  codigo_cliente: string,
  ctx: ContextoEjecucion,
): Promise<ResultadoIPSDetallado> {
  const { supabase, usuario, lote_id } = ctx;

  try {
    // --- Lecturas ---------------------------------------------------------
    // Un error de LECTURA y «no hay fila» son cosas distintas: el primero es
    // fallo del sistema, el segundo es estado del expediente.

    const { data: cliente, error: errorCliente } = await supabase
      .from('clientes')
      .select(
        'nombre, apellido_paterno, apellido_materno, fecha_nacimiento, ocupacion, ingreso_neto_mensual',
      )
      .eq('codigo_cliente', codigo_cliente)
      .maybeSingle();

    if (errorCliente) return fallo(codigo_cliente, 'lectura', 'Error al leer el cliente.');
    if (!cliente) return fallo(codigo_cliente, 'no_existe', 'El cliente no existe.');

    // Antes de leer el perfil y mucho antes de escribir: un bloqueado no se
    // recalcula. Ver la cabecera.
    const { bloqueo, error: errorBloqueo } = await leerBloqueoAbierto(supabase, codigo_cliente);
    if (errorBloqueo)
      return fallo(codigo_cliente, 'lectura', 'Error al verificar si el cliente está bloqueado.');
    if (bloqueo)
      return fallo(codigo_cliente, 'cliente_bloqueado', mensajeClienteBloqueado(bloqueo));

    // `perfil_riesgo` tiene restricción única en `codigo_cliente`
    // (`perfil_riesgo_codigo_cliente_key`): hay como máximo una fila por
    // cliente, así que el order/limit es una red y no un desempate real.
    //
    // Desde la migración del 23-sep-2026 el UPDATE de más abajo ya NO pierde el
    // estado anterior: `trg_archivar_perfil_riesgo` archiva la versión previa en
    // `perfil_riesgo_historico` antes de que se escriba la nueva.
    //
    // `nullsFirst: false` evita que una fila sin fecha desplace a una fechada
    // (DESC pone NULL primero).
    const { data: perfil, error: errorPerfil } = await supabase
      .from('perfil_riesgo')
      // El select debe ser un literal: supabase-js infiere los tipos parseando
      // la cadena, y una concatenación en runtime le deja `GenericStringError`.
      .select(
        'id, resultado_perfil, perfil_ajustado, tolerancia_perdida, reaccion_caida_10, negocio_propio, percepcion_riesgo_empleo, prefiere_ingreso_seguro, no_puede_perder, colchon_liquidez, dependientes, situacion_habitacional, tiene_ahorros, ahorros, hipoteca, otras_deudas, objetivo_inversion, ganancia_deseada, horizonte',
      )
      .eq('codigo_cliente', codigo_cliente)
      .order('fecha_evaluacion', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (errorPerfil)
      return fallo(codigo_cliente, 'lectura', 'Error al leer el perfil de riesgo.');

    // Sin fila no hay dónde guardar: un update afectaría 0 renglones en silencio.
    if (!perfil)
      return fallo(
        codigo_cliente,
        'sin_cuestionario',
        'Este cliente no tiene cuestionario de riesgo capturado.',
      );

    // --- Mapeo a IPSInputs ------------------------------------------------

    const nombreCompleto = [
      cliente.nombre,
      cliente.apellido_paterno,
      cliente.apellido_materno,
    ]
      .filter((parte): parte is string => typeof parte === 'string' && !!parte.trim())
      .join(' ')
      .trim();

    const inputs: IPSInputs = {
      nombreCompleto,
      fechaNacimiento: aTexto(cliente.fecha_nacimiento) ?? '',
      ocupacion: aTexto(cliente.ocupacion) ?? '',
      // Si viene nulo o ilegible pasa NaN, y el motor lo reporta como bloqueante.
      ingresoMensual: aNumero(cliente.ingreso_neto_mensual) ?? Number.NaN,

      escenarioGananciaPerdida: aTexto(perfil.tolerancia_perdida),
      reaccionCaida10: aTexto(perfil.reaccion_caida_10),
      negocioPropio: aTexto(perfil.negocio_propio),
      percepcionRiesgoEmpleo: aTexto(perfil.percepcion_riesgo_empleo),
      prefiereIngresoSeguro: aTexto(perfil.prefiere_ingreso_seguro),
      noPuedePerder: aTexto(perfil.no_puede_perder),

      colchonLiquidez: aTexto(perfil.colchon_liquidez),
      dependientes: aNumero(perfil.dependientes),
      situacionHabitacional: aTexto(perfil.situacion_habitacional),
      // `null` en la base significa "no se preguntó": debe llegar como undefined,
      // no como false, o el motor lo leería como "declaró no tener ahorros".
      tieneAhorros: perfil.tiene_ahorros ?? undefined,
      ahorros: aNumero(perfil.ahorros),
      hipoteca: aNumero(perfil.hipoteca),
      otrasDeudas: aNumero(perfil.otras_deudas),

      objetivoInversion: aTexto(perfil.objetivo_inversion),
      gananciaEsperada: aTexto(perfil.ganancia_deseada),
      horizonteDeclarado: aTexto(perfil.horizonte),
    };

    // --- Motor ------------------------------------------------------------

    let resultado;
    try {
      resultado = calcularPerfilIPS(inputs);
    } catch (e) {
      // Ver el PENDIENTE «ErrorIPS tipado» de la cabecera: el motor no distingue
      // expediente incompleto de fallo propio, así que todo cae en 400. Se
      // conserva el comportamiento anterior a propósito.
      return fallo(
        codigo_cliente,
        'datos_bloqueantes',
        e instanceof Error ? e.message : 'No se pudo calcular el perfil.',
      );
    }

    // --- Guardado ---------------------------------------------------------
    // Se actualiza por `id`, no por codigo_cliente: si el cliente tuviera varias
    // filas, filtrar por código sobrescribiría todas.

    const payload = { codigo_cliente, nombreCompleto, ...resultado };

    const { error: errorGuardado } = await supabase
      .from('perfil_riesgo')
      .update({
        fase: resultado.fase,
        tolerancia_puntos: resultado.toleranciaPuntos,
        tolerancia_nivel: resultado.toleranciaNivel,
        capacidad_puntos: resultado.capacidadPuntos,
        capacidad_nivel: resultado.capacidadNivel,
        puntuacion_ponderada: resultado.puntuacionPonderada,
        resultado_perfil: resultado.perfilFinal,
        bitacora_calculo: resultado.bitacora,
        fecha_calculo: new Date().toISOString(),
      })
      .eq('id', perfil.id);

    if (errorGuardado) {
      // El cálculo se devuelve aunque no se haya guardado: perder el guardado no
      // debe perder el trabajo.
      return fallo(
        codigo_cliente,
        'guardado',
        'El perfil se calculó pero no se pudo guardar.',
        { payload },
      );
    }

    // --- Bitácora ---------------------------------------------------------
    // Después del guardado y no antes: la bitácora nunca dice que ocurrió algo
    // que no ocurrió. El lote se identifica en el propio motivo para que una
    // corrida masiva pueda aislarse completa.

    await registrarEvento(supabase, {
      entidad: 'perfil_riesgo',
      entidadId: perfil.id,
      accion: 'calculo_ips',
      motivo:
        (lote_id ? `[lote ${lote_id}] ` : '') +
        `Cálculo del perfil IPS con el motor. Resultado: ${resultado.perfilFinal}, ` +
        `fase ${resultado.fase}, puntuación ponderada ${resultado.puntuacionPonderada}.`,
      usuario,
      campo: 'resultado_perfil',
      valorAnterior: perfil.resultado_perfil ?? null,
      valorNuevo: resultado.perfilFinal,
      // `resultado` ya trae dentro la bitácora del motor, así que no se duplica.
      metadata: {
        codigo_cliente,
        resultado,
        ...(lote_id ? { lote_id } : {}),
      },
    });

    // --- Resultado --------------------------------------------------------
    // `grado` es el perfil: para el orquestador es la clasificación de esta
    // corrida, igual que el grado en el EBR. `evaluacion_id` es la fila de
    // perfil_riesgo que se actualizó, no una fila nueva: el IPS actualiza en
    // sitio y la versión anterior la guarda el trigger del espejo.

    return {
      codigo_cliente,
      ok: true,
      grado: resultado.perfilFinal,
      // La base guarda `resultado_perfil` como texto libre: puede contener algo
      // fuera de la unión si alguien lo escribió a mano. Se reporta tal cual en
      // vez de descartarlo, que es lo que permite ver el cambio.
      grado_anterior: (perfil.resultado_perfil as PerfilRiesgo | null) ?? null,
      puntaje: resultado.puntuacionPonderada,
      motivos: [],
      campos_faltantes: [],
      evaluacion_id: perfil.id,
      // Ver el PENDIENTE de la cabecera: el ajuste no se toca ni se borra, solo
      // se señala. Decidir si sobrevive a un recálculo es criterio del Asesor.
      ajuste_manual: perfil.perfil_ajustado !== null && perfil.perfil_ajustado !== undefined,
      payload,
    };
  } catch (e) {
    // Red de seguridad. Que un cliente reviente por una causa no prevista no
    // debe tumbar un lote de 30.
    return fallo(codigo_cliente, 'motor', e instanceof Error ? e.message : String(e));
  }
}
