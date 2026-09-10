/**
 * [core] Orquestador de lote EBR — genérico, clonable.
 *
 * No conoce Supabase, ni Next, ni el motor EBR. Recibe una función
 * `evaluarUno` y la corre en secuencia sobre una lista de códigos,
 * emitiendo eventos conforme avanza.
 *
 * Por qué está separado: así se puede probar la tolerancia a fallos,
 * el timeout y el resumen con Vitest sin base de datos, sin red y sin
 * servidor. Si mañana clonas el CRM para otra práctica, este archivo
 * viaja intacto.
 */

export type GradoEBR = 'ALTO' | 'BAJO';

/** Resultado de evaluar UN cliente. Lo produce la capa [expediente]. */
export type ResultadoEBR = {
  codigo_cliente: string;
  ok: boolean;
  /** Grado calculado en esta corrida. Ausente si ok === false. */
  grado?: GradoEBR;
  /** Grado de la evaluación inmediatamente anterior. null = nunca se evaluó. */
  grado_anterior?: GradoEBR | null;
  /** Puntaje de la matriz de 15 factores (43-130). */
  puntaje?: number;
  /** Motivos del §4.6 que dispararon el grado. */
  motivos?: string[];
  /**
   * Campos que la evaluación necesitaba y encontró en null.
   * NO es un error: la evaluación se guardó, pero con huecos declarados.
   * Ver pendiente #11 (realiza_actividad_vulnerable).
   */
  campos_faltantes?: string[];
  /** Id de la fila insertada en ebr_evaluaciones. */
  evaluacion_id?: string;
  /** Mensaje de error si ok === false. */
  error?: string;
};

export type EventoLote =
  | { tipo: 'inicio'; lote_id: string; total: number; iniciado_en: string }
  | {
      tipo: 'avance';
      lote_id: string;
      indice: number; // 1-based
      total: number;
      resultado: ResultadoEBR;
    }
  | { tipo: 'resumen'; lote_id: string; resumen: ResumenLote };

export type ResumenLote = {
  lote_id: string;
  iniciado_en: string;
  terminado_en: string;
  duracion_ms: number;
  total: number;
  ok: number;
  fallidos: number;
  /** Cortado por el cliente o por AbortSignal antes de terminar. */
  abortado: boolean;
  por_grado: Record<GradoEBR, number>;
  /** Clientes cuyo grado cambió respecto de su evaluación anterior. */
  cambios: Array<{
    codigo_cliente: string;
    de: GradoEBR | null;
    a: GradoEBR;
  }>;
  /** Clientes evaluados con campos en null. Estos son los huecos reales. */
  con_huecos: Array<{ codigo_cliente: string; campos: string[] }>;
  /** Clientes que no se pudieron evaluar. El lote NO se detiene por ellos. */
  errores: Array<{ codigo_cliente: string; error: string }>;
};

export type OpcionesLote = {
  /** Identificador del lote. Va a bitácora en cada escritura. */
  lote_id: string;
  /** Corta una evaluación colgada para que no mate el lote. Default 20 s. */
  timeout_ms?: number;
  /** Pausa entre clientes. Default 0. Súbelo si Supabase se queja. */
  pausa_ms?: number;
  /** Permite cancelar desde la UI (el usuario cierra la pestaña). */
  signal?: AbortSignal;
  /** Inyectable para tests deterministas. */
  ahora?: () => number;
};

/** Error tipado para distinguir un timeout de un fallo del motor. */
export class TimeoutEvaluacion extends Error {
  constructor(codigo: string, ms: number) {
    super(`Timeout de ${ms} ms evaluando ${codigo}`);
    this.name = 'TimeoutEvaluacion';
  }
}

function esperar(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

async function conTimeout<T>(
  promesa: Promise<T>,
  ms: number,
  codigo: string,
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promesa;
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promesa,
      new Promise<never>((_, reject) => {
        t = setTimeout(() => reject(new TimeoutEvaluacion(codigo, ms)), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

/**
 * Corre el lote en secuencia y emite eventos.
 *
 * Secuencial a propósito: cada evaluación escribe en ebr_evaluaciones y en
 * bitacora. En paralelo perderías el orden de la bitácora y podrías chocar
 * con la restricción única de perfil_riesgo. La velocidad no es el objetivo;
 * la trazabilidad sí.
 *
 * Tolerante a fallos: un cliente que revienta se registra como error y el
 * lote continúa. Nunca lanza por culpa de un cliente individual.
 */
export async function* correrLoteEBR(
  codigos: readonly string[],
  evaluarUno: (codigo: string) => Promise<ResultadoEBR>,
  opciones: OpcionesLote,
): AsyncGenerator<EventoLote, ResumenLote, void> {
  const {
    lote_id,
    timeout_ms = 20_000,
    pausa_ms = 0,
    signal,
    ahora = () => Date.now(),
  } = opciones;

  const t0 = ahora();
  const iniciado_en = new Date(t0).toISOString();
  const total = codigos.length;

  const resumen: ResumenLote = {
    lote_id,
    iniciado_en,
    terminado_en: iniciado_en,
    duracion_ms: 0,
    total,
    ok: 0,
    fallidos: 0,
    abortado: false,
    por_grado: { ALTO: 0, BAJO: 0 },
    cambios: [],
    con_huecos: [],
    errores: [],
  };

  yield { tipo: 'inicio', lote_id, total, iniciado_en };

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) {
      resumen.abortado = true;
      break;
    }

    const codigo = codigos[i];
    let resultado: ResultadoEBR;

    try {
      resultado = await conTimeout(evaluarUno(codigo), timeout_ms, codigo);
      // Blindaje: si la capa de abajo devuelve basura, no la propagamos.
      if (!resultado || typeof resultado !== 'object') {
        throw new Error('evaluarUno devolvió un resultado no interpretable');
      }
    } catch (e) {
      resultado = {
        codigo_cliente: codigo,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    if (resultado.ok && resultado.grado) {
      resumen.ok++;
      resumen.por_grado[resultado.grado]++;

      const anterior = resultado.grado_anterior ?? null;
      if (anterior !== resultado.grado) {
        resumen.cambios.push({
          codigo_cliente: codigo,
          de: anterior,
          a: resultado.grado,
        });
      }

      if (resultado.campos_faltantes?.length) {
        resumen.con_huecos.push({
          codigo_cliente: codigo,
          campos: resultado.campos_faltantes,
        });
      }
    } else {
      resumen.fallidos++;
      resumen.errores.push({
        codigo_cliente: codigo,
        error: resultado.error ?? 'Error no especificado',
      });
    }

    yield { tipo: 'avance', lote_id, indice: i + 1, total, resultado };

    if (pausa_ms > 0 && i < total - 1) await esperar(pausa_ms, signal);
  }

  const t1 = ahora();
  resumen.terminado_en = new Date(t1).toISOString();
  resumen.duracion_ms = t1 - t0;

  yield { tipo: 'resumen', lote_id, resumen };
  return resumen;
}
