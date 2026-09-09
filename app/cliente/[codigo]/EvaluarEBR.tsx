'use client';

import { useState } from 'react';
import type { EBRResultado, FactorMatriz, ObservacionEBR, SupuestoEvaluado } from '@/lib/ebr-engine';

// `import type` se borra al compilar. Importa aquí más que en otros paneles:
// importar el motor como valor arrastraría al bundle del cliente el Anexo 2
// completo, el Anexo 3, el catálogo de las 23 ocupaciones PB y la tabla de
// alias de países. Nada de eso tiene por qué viajar al navegador.

/**
 * Respuesta de POST /api/evaluar-ebr.
 *
 * `id` es opcional a propósito, y no por descuido: cuando el motor corre bien
 * pero el INSERT falla, la ruta responde 500 con el resultado completo y SIN
 * `id`. Ese caso se pinta igual, marcado como no guardado, en vez de tirarse a
 * la basura: el Asesor alcanza a ver la clasificación que se calculó.
 */
type Respuesta = EBRResultado & {
  id?: string;
  codigo_cliente: string;
};

/**
 * La última evaluación guardada en `ebr_evaluaciones`, precargada por la ficha.
 *
 * Es un subconjunto de `EBRResultado`, y no por olvido de la ruta: la tabla no
 * tiene columna para `medidas` ni para `matriz_valoracion_referencial` porque
 * las dos se derivan del régimen y de la banda. Rearmarlas aquí con el texto de
 * hoy y colgarlas de una evaluación vieja las presentaría como las medidas que
 * se le aplicaron, que es justo lo que la fotografía de `entrada` existe para
 * evitar. Se muestran solo cuando la evaluación se acaba de correr.
 *
 * `gradoRiesgo` y `regimen` se tipan como `string` y no como las uniones del
 * motor: en la base son texto y los protege un CHECK, no el compilador.
 */
export type EBRGuardado = {
  id: string | null;
  fechaEvaluacion: string;
  gradoRiesgo: string;
  regimen: string;
  razonClasificacion: string;
  fundamentoClasificacion: string;
  supuestosEvaluados: SupuestoEvaluado[];
  matrizFactores: FactorMatriz[];
  matrizPuntajeTotal: number | null;
  matrizBanda: string;
  esPep: boolean;
  pepExtranjero: boolean;
  aplicaMedidasPep: boolean;
  requiereAprobacionOficial: boolean;
  enListaBloqueadas: boolean;
  alertaCritica: string | null;
  evaluacionPreliminar: boolean;
  motivosPreliminar: string[];
  verificacionesPendientes: string[];
  observaciones: ObservacionEBR[];
  overrideSource: string;
  elaboro: string;
  revisaAutoriza: string;
};

/**
 * Lo que el panel pinta, venga de la corrida de esta sesión o de la base.
 *
 * `origen` no es decorativo: una evaluación de hace meses y una de hace treinta
 * segundos se ven idénticas, y confundirlas es leer como vigente un grado que
 * ya se recalculó. La fecha sola no basta cuando se reevalúa el mismo día.
 */
type Vista = EBRGuardado & {
  origen: 'sesion' | 'guardada';
  medidas: string | null;
  valoracionReferencial: string | null;
};

/** Fecha ISO a texto estable: sin locale, para no romper la hidratación. */
function fechaLegible(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

/**
 * Bandera de cumplimiento. Siempre se imprime, encendida o apagada, con su
 * Sí/No explícito. Ocultar las apagadas ahorraría tinta y dejaría al revisor
 * sin saber si el motor evaluó el punto o si nadie lo miró.
 */
function Bandera({ texto, encendida }: { texto: string; encendida: boolean }) {
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
        encendida ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
      }`}
    >
      {texto}: {encendida ? 'Sí' : 'No'}
    </span>
  );
}

export default function EvaluarEBR({
  codigo,
  inicial,
}: {
  codigo: string;
  inicial: EBRGuardado | null;
}) {
  const [resultado, setResultado] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  /** La evaluación corrió pero no quedó en la base. Se pinta con la advertencia. */
  const [sinGuardar, setSinGuardar] = useState(false);

  async function evaluar() {
    setCargando(true);
    setError('');
    setSinGuardar(false);

    try {
      const res = await fetch('/api/evaluar-ebr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo_cliente: codigo }),
      });

      // Sin sesión el middleware redirige a /login y responde HTML, no JSON.
      const tipo = res.headers.get('content-type') ?? '';
      if (!tipo.includes('application/json')) {
        setError('Tu sesión expiró. Vuelve a entrar y reintenta.');
        return;
      }

      const datos = await res.json();

      if (!res.ok) {
        setError(datos.error ?? 'No se pudo evaluar el riesgo del cliente.');
        // El 500 de guardado trae el resultado entero: se muestra, avisando
        // que no quedó asentado.
        if (datos.grado_riesgo) {
          setResultado(datos as Respuesta);
          setSinGuardar(true);
        }
        return;
      }

      setResultado(datos as Respuesta);
    } catch {
      setError('No se pudo contactar al servidor. Revisa tu sesión y vuelve a intentar.');
    } finally {
      setCargando(false);
    }
  }

  // Una evaluación recién corrida gana sobre la precargada. Que la precargada
  // quede obsoleta no importa: nunca se vuelve a leer mientras haya resultado.
  const vista: Vista | null = resultado
    ? {
        origen: 'sesion',
        id: resultado.id ?? null,
        fechaEvaluacion: resultado.fecha_evaluacion,
        gradoRiesgo: resultado.grado_riesgo,
        regimen: resultado.regimen,
        razonClasificacion: resultado.razon_clasificacion,
        fundamentoClasificacion: resultado.fundamento_clasificacion,
        supuestosEvaluados: resultado.supuestos_evaluados,
        matrizFactores: resultado.matriz_factores,
        matrizPuntajeTotal: resultado.matriz_puntaje_total,
        matrizBanda: resultado.matriz_banda,
        esPep: resultado.es_pep,
        pepExtranjero: resultado.pep_extranjero,
        aplicaMedidasPep: resultado.aplica_medidas_pep,
        requiereAprobacionOficial: resultado.requiere_aprobacion_oficial,
        enListaBloqueadas: resultado.en_lista_bloqueadas,
        alertaCritica: resultado.alerta_critica,
        evaluacionPreliminar: resultado.evaluacion_preliminar,
        motivosPreliminar: resultado.motivos_preliminar,
        verificacionesPendientes: resultado.verificaciones_pendientes,
        observaciones: resultado.observaciones,
        overrideSource: resultado.override_source,
        elaboro: resultado.elaboro,
        revisaAutoriza: resultado.revisa_autoriza,
        medidas: resultado.medidas,
        valoracionReferencial: resultado.matriz_valoracion_referencial,
      }
    : inicial
      ? { origen: 'guardada', ...inicial, medidas: null, valoracionReferencial: null }
      : null;

  const alto = vista?.gradoRiesgo === 'ALTO';

  return (
    <section className="mt-8">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-semibold">Evaluación Basada en Riesgo (PLD/FT)</h2>
        <button
          onClick={evaluar}
          disabled={cargando}
          className="bg-slate-900 text-white px-4 py-2 rounded text-sm hover:bg-slate-700 disabled:opacity-50"
        >
          {cargando ? 'Evaluando…' : vista ? 'Reevaluar EBR' : 'Evaluar EBR'}
        </button>
      </div>

      {/* La evaluación es histórica: cada corrida agrega una fila y ninguna
          reemplaza a la anterior. Por eso no hay confirmación de sobrescritura
          como en el panel de IPS: aquí no se sobrescribe nada. */}
      <p className="text-xs text-slate-500 mb-3">
        Cada evaluación se guarda como un registro nuevo. Las anteriores se
        conservan: el expediente debe poder reconstruirse como estaba.
      </p>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {!vista && !error && (
        <p className="text-sm text-slate-400 italic">
          Aún no se ha evaluado el riesgo PLD/FT de este cliente.
        </p>
      )}

      {vista && (
        <div className="space-y-4">
          {/* Antes que nada, de qué evaluación se está hablando. Va arriba y no
              en la trazabilidad del pie porque la pregunta «¿esto es lo que
              acabo de correr?» se hace al mirar el grado, no al final. */}
          <p className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
            <span
              className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                vista.origen === 'sesion'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {vista.origen === 'sesion'
                ? 'Evaluada en esta sesión'
                : 'Última evaluación guardada'}
            </span>
            <span>{fechaLegible(vista.fechaEvaluacion)}</span>
          </p>

          {sinGuardar && (
            <p className="border border-red-300 bg-red-50 rounded-lg px-4 py-3 text-sm text-red-900">
              <strong>La evaluación se calculó pero NO se guardó.</strong> Lo que
              ves abajo no está en el expediente ni en la bitácora. Reintenta.
            </p>
          )}

          {vista.alertaCritica && (
            <p className="border border-red-300 bg-red-50 rounded-lg px-4 py-3 text-sm text-red-900">
              <strong>Alerta crítica.</strong> {vista.alertaCritica}
            </p>
          )}

          {vista.evaluacionPreliminar && (
            <div className="border border-amber-300 bg-amber-50 rounded-lg px-4 py-3 text-sm text-amber-900">
              <strong>Evaluación preliminar.</strong> El expediente está
              incompleto; la clasificación no es definitiva hasta resolver:
              <ul className="list-disc ml-5 mt-2 space-y-1">
                {vista.motivosPreliminar.map((motivo, i) => (
                  <li key={i}>{motivo}</li>
                ))}
              </ul>
            </div>
          )}

          {/* --- Clasificación ---------------------------------------------- */}

          <div
            className={`border rounded-lg px-4 py-4 ${
              alto ? 'border-red-300 bg-red-50' : 'border-slate-200'
            }`}
          >
            <p className="text-sm text-slate-500">Grado de riesgo</p>
            <p
              className={`text-2xl font-semibold mt-1 ${
                alto ? 'text-red-800' : 'text-slate-900'
              }`}
            >
              {vista.gradoRiesgo}
            </p>
            <p className="text-sm text-slate-700 mt-1">
              Régimen <strong>{vista.regimen}</strong>
            </p>
            <p className="text-sm text-slate-800 mt-2">{vista.razonClasificacion}</p>
            <p className="text-xs text-slate-500 mt-2">
              {vista.fundamentoClasificacion}
            </p>
          </div>

          {/* --- Banderas ---------------------------------------------------- */}

          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Banderas</h3>
            <div className="flex flex-wrap gap-2">
              <Bandera texto="PEP" encendida={vista.esPep} />
              <Bandera texto="PEP extranjero" encendida={vista.pepExtranjero} />
              <Bandera texto="Medidas PEP" encendida={vista.aplicaMedidasPep} />
              <Bandera
                texto="Aprobación del Oficial"
                encendida={vista.requiereAprobacionOficial}
              />
              <Bandera
                texto="Lista de bloqueadas"
                encendida={vista.enListaBloqueadas}
              />
              <Bandera texto="Preliminar" encendida={vista.evaluacionPreliminar} />
            </div>
          </div>

          {/* --- Supuestos --------------------------------------------------- */}

          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              Supuestos evaluados
            </h3>
            <ol className="border border-slate-200 rounded-lg divide-y divide-slate-100">
              {vista.supuestosEvaluados.map((s, i) => (
                <li key={i} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        s.activo
                          ? 'bg-red-100 text-red-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {s.activo ? 'Se actualiza' : 'No se actualiza'}
                    </span>
                    <span className="text-sm font-medium text-slate-900">
                      {s.supuesto}
                    </span>
                  </div>
                  <p className="text-sm text-slate-800 mt-1.5">{s.detalle}</p>
                  {/* El fundamento va pegado al supuesto y no en una nota al
                      pie: es lo que sostiene la clasificación ante el
                      supervisor, y separarlo del hecho lo vuelve inútil. */}
                  <p className="text-xs text-slate-500 mt-1.5">{s.fundamento}</p>
                </li>
              ))}
            </ol>
          </div>

          {/* --- Matriz ------------------------------------------------------ */}

          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Matriz PB</h3>
            <div className="border border-slate-200 rounded-lg px-4 py-4">
              <p className="text-sm text-slate-500">Puntaje total</p>
              <p className="text-2xl font-semibold text-slate-900 mt-1">
                {vista.matrizPuntajeTotal}
                <span className="text-base font-normal text-slate-600">
                  {' '}· banda {vista.matrizBanda}
                </span>
              </p>
              {/* La valoración tampoco se guarda, pero su segunda mitad es una
                  advertencia fija del método, no un dato de esta corrida: se
                  imprime siempre para que la banda nunca se lea como grado. */}
              <p className="text-xs text-slate-500 mt-2">
                {vista.valoracionReferencial ??
                  'Referencial: es evidencia técnica del análisis y no determina el grado de riesgo.'}
              </p>

              <details className="mt-3">
                <summary className="text-sm text-slate-600 cursor-pointer">
                  Ver los {vista.matrizFactores.length} factores
                </summary>
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                        <th className="py-2 pr-3 font-medium">Factor</th>
                        <th className="py-2 pr-3 font-medium">Opción</th>
                        <th className="py-2 pr-3 font-medium text-right">Prob.</th>
                        <th className="py-2 pr-3 font-medium text-right">Imp.</th>
                        <th className="py-2 font-medium text-right">Puntaje</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {vista.matrizFactores.map((f, i) => (
                        <tr key={i}>
                          <td className="py-2 pr-3 text-slate-500">{f.factor}</td>
                          <td className="py-2 pr-3 text-slate-900">
                            {f.opcion_seleccionada}
                          </td>
                          <td className="py-2 pr-3 text-right text-slate-900">
                            {f.probabilidad}
                          </td>
                          <td className="py-2 pr-3 text-right text-slate-900">
                            {f.impacto}
                          </td>
                          <td className="py-2 text-right text-slate-900">{f.puntaje}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </div>
          </div>

          {/* --- Medidas ----------------------------------------------------- */}

          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              Medidas del régimen {vista.regimen}
            </h3>
            {vista.medidas ? (
              <p className="border border-slate-200 rounded-lg px-4 py-3 text-sm text-slate-800">
                {vista.medidas}
              </p>
            ) : (
              <p className="text-sm text-slate-400 italic">
                El texto de las medidas no se guarda con la evaluación: se deriva
                del régimen y cambia si cambia el Manual. Reevalúa para verlo con
                la redacción vigente, en lugar de leer la de hoy como si fuera la
                que se aplicó entonces.
              </p>
            )}
          </div>

          {/* --- Verificaciones ---------------------------------------------- */}

          {vista.verificacionesPendientes.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">
                Verificaciones pendientes
              </h3>
              <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {vista.verificacionesPendientes.map((v, i) => (
                  <li key={i} className="px-4 py-2 text-sm text-slate-800">
                    {v}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* --- Observaciones ------------------------------------------------ */}

          {vista.observaciones.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">
                Observaciones del motor
              </h3>
              <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {vista.observaciones.map((o, i) => (
                  <li key={i} className="px-4 py-2">
                    <p className="text-xs uppercase tracking-wide text-slate-400">
                      {o.factor}
                    </p>
                    <p className="text-sm text-slate-800">{o.nota}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* --- Trazabilidad -------------------------------------------------- */}

          <div className="text-xs text-slate-400 space-y-0.5">
            <p>
              Evaluado el {fechaLegible(vista.fechaEvaluacion)} · fuente{' '}
              {vista.overrideSource}
            </p>
            <p>
              Elaboró {vista.elaboro} · revisa y autoriza {vista.revisaAutoriza}
            </p>
            {vista.id && <p>Registro {vista.id}</p>}
          </div>
        </div>
      )}
    </section>
  );
}
