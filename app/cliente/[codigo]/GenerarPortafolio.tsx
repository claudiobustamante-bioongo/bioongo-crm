'use client';

import { useState } from 'react';
import type {
  ResultadoPortafolio,
  Ruta,
  Universo,
} from '@/lib/ips-portafolios';

// `import type` se borra al compilar. Importante aquí: importar UNIVERSOS o
// RUTAS como valores arrastraría al bundle del cliente las tablas completas de
// instrumentos de los dos universos. Los catálogos de la UI se declaran abajo
// como Record<Universo|Ruta, …>, que rompe la compilación si el motor agrega
// un universo o una ruta, sin costar un byte de payload.

/** Respuesta completa del endpoint. */
type Respuesta = ResultadoPortafolio & {
  id: string;
  codigo_cliente: string;
  fecha_generacion: string;
  perfil_origen: 'motor' | 'ajuste_asesor';
};

/** Sentinel de "aún no elegido". Ni universo ni ruta tienen default. */
const SIN_ELEGIR = '';

const UNIVERSOS_UI: Record<Universo, { etiqueta: string; nota: string }> = {
  UCITS: {
    etiqueta: 'UCITS — ETFs irlandeses',
    nota: 'Sin exposición al impuesto sucesorio de EE.UU. para no residentes.',
  },
  EEUU: {
    etiqueta: 'EE.UU. — ETFs estadounidenses',
    nota:
      'Situs estadounidense: exención sucesoria de 60,000 USD y tasa marginal ' +
      'de hasta 40% para no residentes.',
  },
};

// SIC primero, como en la ficha de operación.
const RUTAS_UI: Record<Ruta, { etiqueta: string; nota: string }> = {
  SIC: {
    etiqueta: 'SIC — Sistema Internacional de Cotizaciones',
    nota: 'Retención definitiva del 10% (art. 129 LISR). Se liquida en pesos, casa de bolsa mexicana.',
  },
  LSE: {
    etiqueta: 'LSE — Bolsa de Londres',
    nota: 'Ganancia acumulable a tasa marginal, hasta 35%. Cuenta en el extranjero.',
  },
  US: {
    etiqueta: 'US — NYSE Arca / Nasdaq',
    nota: 'Ganancia acumulable a tasa marginal, hasta 35%. Cuenta en el extranjero.',
  },
};

/**
 * Qué rutas admite cada universo. Espeja `rutasDisponibles` del motor, que es
 * la autoridad y revalida en el servidor. Va como Record<Universo, …> para que
 * agregar un universo rompa la compilación aquí.
 *
 * EE.UU. no ofrece SIC por estrategia fiscal, no por limitación técnica: quien
 * vaya a operar por bolsa mexicana conviene que use UCITS irlandeses, que suman
 * el 10% del art. 129 Y eliminan el impuesto sucesorio de EE.UU.
 */
const RUTAS_POR_UNIVERSO: Record<Universo, readonly Ruta[]> = {
  UCITS: ['SIC', 'LSE'],
  EEUU: ['US'],
};

const UNIVERSOS_LISTA = Object.keys(UNIVERSOS_UI) as Universo[];

/** Fracción del motor (0.05) a texto de porcentaje. */
function pct(fraccion: number): string {
  return `${(fraccion * 100).toFixed(2)}%`;
}

/** Fecha ISO a texto estable: sin locale, para no romper la hidratación. */
function fechaLegible(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

export default function GenerarPortafolio({ codigo }: { codigo: string }) {
  const [universo, setUniverso] = useState<string>(SIN_ELEGIR);
  const [ruta, setRuta] = useState<string>(SIN_ELEGIR);
  const [resultado, setResultado] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  const rutasDisponibles: readonly Ruta[] =
    universo === SIN_ELEGIR ? [] : RUTAS_POR_UNIVERSO[universo as Universo];

  // Con una sola ruta no hay decisión que ofrecer: el universo ya la fijó.
  const rutaUnica = rutasDisponibles.length === 1 ? rutasDisponibles[0]! : null;
  const rutaEfectiva: Ruta | null =
    rutaUnica ?? (ruta === SIN_ELEGIR ? null : (ruta as Ruta));

  const listo = universo !== SIN_ELEGIR && rutaEfectiva !== null;

  /** Al cambiar de universo se limpia la ruta: si no, quedaría pegada una que
   *  el universo nuevo no admite (elegir UCITS+SIC y pasar a EE.UU.). */
  function elegirUniverso(valor: string) {
    setUniverso(valor);
    setRuta(SIN_ELEGIR);
    setError('');
  }

  async function generar() {
    setCargando(true);
    setError('');

    try {
      const res = await fetch('/api/generar-portafolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo_cliente: codigo, universo, ruta: rutaEfectiva }),
      });

      // Sin sesión el middleware redirige a /login y responde HTML, no JSON.
      const tipo = res.headers.get('content-type') ?? '';
      if (!tipo.includes('application/json')) {
        setError('Tu sesión expiró. Vuelve a entrar y reintenta.');
        return;
      }

      const datos = await res.json();

      if (!res.ok) {
        setError(datos.error ?? 'No se pudo generar el portafolio.');
        // El 500 de guardado incluye el portafolio construido: se muestra
        // aunque no haya quedado en el histórico.
        if (Array.isArray(datos.posiciones)) setResultado(datos as Respuesta);
        return;
      }

      setResultado(datos as Respuesta);
    } catch {
      setError('No se pudo contactar al servidor. Revisa tu sesión y vuelve a intentar.');
    } finally {
      setCargando(false);
    }
  }

  const fallidas = resultado?.validaciones.filter((v) => !v.cumple) ?? [];

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold mb-3">Portafolio</h2>

      {/* --- Selectores: ninguno tiene valor por defecto ------------------- */}
      <div className="border border-slate-200 rounded-lg px-4 py-4 space-y-4">
        <div>
          <label className="block text-sm text-slate-600 mb-1" htmlFor="universo">
            Universo de instrumentos
          </label>
          <select
            id="universo"
            value={universo}
            onChange={(e) => elegirUniverso(e.target.value)}
            disabled={cargando}
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm disabled:opacity-50"
          >
            <option value={SIN_ELEGIR}>Elegir universo…</option>
            {UNIVERSOS_LISTA.map((u) => (
              <option key={u} value={u}>
                {UNIVERSOS_UI[u].etiqueta}
              </option>
            ))}
          </select>
          {universo !== SIN_ELEGIR && (
            <p className="text-xs text-slate-500 mt-1">
              {UNIVERSOS_UI[universo as Universo].nota}
            </p>
          )}
        </div>

        {/* La ruta solo se ofrece si el universo admite más de una. Con una
            sola no hay elección: se informa y punto. */}
        {rutasDisponibles.length > 1 && (
          <div>
            <label className="block text-sm text-slate-600 mb-1" htmlFor="ruta">
              Ruta de ejecución
            </label>
            <select
              id="ruta"
              value={ruta}
              onChange={(e) => setRuta(e.target.value)}
              disabled={cargando}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm disabled:opacity-50"
            >
              <option value={SIN_ELEGIR}>Elegir ruta…</option>
              {rutasDisponibles.map((r) => (
                <option key={r} value={r}>
                  {RUTAS_UI[r].etiqueta}
                </option>
              ))}
            </select>
            {ruta !== SIN_ELEGIR && (
              <p className="text-xs text-slate-500 mt-1">{RUTAS_UI[ruta as Ruta].nota}</p>
            )}
          </div>
        )}

        {rutaUnica && (
          <div>
            <p className="block text-sm text-slate-600 mb-1">Ruta de ejecución</p>
            <p className="border border-slate-200 bg-slate-50 rounded px-3 py-2 text-sm text-slate-700">
              {RUTAS_UI[rutaUnica].etiqueta}
            </p>
            <p className="text-xs text-slate-500 mt-1">{RUTAS_UI[rutaUnica].nota}</p>
            {universo === 'EEUU' && (
              <p className="text-xs text-slate-500 mt-1">
                Este universo no se opera por el SIC. No es una limitación
                técnica: para operar por bolsa mexicana conviene el universo
                UCITS, que suma la retención del 10% del art. 129{' '}
                <em>y</em> elimina la exposición al impuesto sucesorio de EE.UU.,
                mientras que un ETF estadounidense por SIC daría solo lo primero.
              </p>
            )}
          </div>
        )}

        {rutasDisponibles.length > 1 && (
          <p className="border border-amber-300 bg-amber-50 rounded px-3 py-2 text-xs text-amber-900">
            <strong>La ruta tiene implicación fiscal.</strong> Por SIC la
            ganancia de capital paga la retención definitiva del 10% del art. 129
            LISR; por LSE es acumulable a tasa marginal, hasta 35%. No tiene
            valor por omisión: se elige a propósito.
          </p>
        )}

        <button
          onClick={generar}
          disabled={!listo || cargando}
          className="bg-slate-900 text-white px-4 py-2 rounded text-sm hover:bg-slate-700 disabled:opacity-50"
        >
          {cargando ? 'Generando…' : 'Generar portafolio'}
        </button>
        {!listo && (
          <p className="text-xs text-slate-400">
            {universo === SIN_ELEGIR
              ? 'Elige el universo para habilitar la generación.'
              : 'Elige la ruta para habilitar la generación.'}
          </p>
        )}
      </div>

      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

      {!resultado && !error && (
        <p className="text-sm text-slate-400 italic mt-3">
          Aún no se ha generado un portafolio.
        </p>
      )}

      {resultado && (
        <div className="space-y-4 mt-4">
          {/* --- Aviso de alcance (siempre arriba del resultado) ---------- */}
          <p className="border border-slate-300 bg-slate-50 rounded-lg px-4 py-3 text-sm text-slate-700">
            Portafolio de referencia según metodología. Los límites son máximos,
            no obligaciones. El asesor puede ajustar con justificación.
          </p>

          <div className="border border-slate-200 rounded-lg px-4 py-4">
            <p className="text-sm text-slate-500">Portafolio generado</p>
            <p className="text-2xl font-semibold text-slate-900 mt-1">
              {resultado.fase} · {resultado.perfil}
            </p>
            <p className="text-sm text-slate-600 mt-1">
              Universo <strong>{resultado.universo}</strong> · ruta{' '}
              <strong>{resultado.ruta}</strong> · plaza nativa{' '}
              {resultado.plazaNativa}
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Perfil tomado del{' '}
              {resultado.perfil_origen === 'ajuste_asesor'
                ? 'ajuste del asesor'
                : 'motor'}
              {resultado.fecha_generacion &&
                ` · generado el ${fechaLegible(resultado.fecha_generacion)}`}
            </p>
          </div>

          {/* --- Totales -------------------------------------------------- */}
          <dl className="border border-slate-200 rounded-lg divide-y divide-slate-100">
            <div className="flex px-4 py-3">
              <dt className="w-56 text-sm text-slate-500">Liquidez</dt>
              <dd className="text-sm text-slate-900">{pct(resultado.liquidez)}</dd>
            </div>
            <div className="flex px-4 py-3">
              <dt className="w-56 text-sm text-slate-500">Renta variable</dt>
              <dd className="text-sm text-slate-900">{pct(resultado.rentaVariable)}</dd>
            </div>
            <div className="flex px-4 py-3">
              <dt className="w-56 text-sm text-slate-500">Satélite tecnología</dt>
              <dd className="text-sm text-slate-900">
                {pct(resultado.asignacionClases['Satelite Tecnologia'])}
              </dd>
            </div>
            <div className="flex px-4 py-3">
              <dt className="w-56 text-sm text-slate-500">Renta fija</dt>
              <dd className="text-sm text-slate-900">{pct(resultado.rentaFija)}</dd>
            </div>
          </dl>

          {/* --- Posiciones ----------------------------------------------- */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              Posiciones ({resultado.posiciones.length})
            </h3>
            <div className="border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-3 py-2 font-medium">Clave</th>
                    <th className="px-3 py-2 font-medium">ISIN / conid</th>
                    <th className="px-3 py-2 font-medium">Instrumento</th>
                    <th className="px-3 py-2 font-medium">Clase</th>
                    <th className="px-3 py-2 font-medium">Plaza</th>
                    <th className="px-3 py-2 font-medium text-right">Peso</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {resultado.posiciones.map((p, i) => (
                    <tr key={`${p.ticker}-${p.clase}-${i}`}>
                      {/* La clave es lo que se teclea en la orden. */}
                      <td className="px-3 py-2 font-mono text-slate-900 whitespace-nowrap">
                        {p.ticker}
                      </td>
                      {/* Llave canónica: es contra lo que se coteja que la orden
                          fue al instrumento correcto. No cambia entre bolsas, el
                          ticker sí. Se prefiere el ISIN; si no está capturado, el
                          conid de IBKR cumple la misma función. */}
                      <td className="px-3 py-2 font-mono text-xs text-slate-500 whitespace-nowrap">
                        {p.isin ??
                          (p.conid !== undefined ? (
                            `conid ${p.conid}`
                          ) : (
                            <span className="text-slate-300">— sin cotejar</span>
                          ))}
                      </td>
                      <td className="px-3 py-2 text-slate-700">{p.nombre}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {resultado.etiquetasClases[p.clase] ?? p.clase}
                      </td>
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">
                        {p.rutaEjecucion}
                      </td>
                      <td className="px-3 py-2 text-right text-slate-900 whitespace-nowrap">
                        {pct(p.peso)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {resultado.posiciones.some((p) => p.isin === null && p.conid === undefined) && (
              <p className="text-xs text-slate-500 mt-1">
                Hay posiciones sin llave canónica capturada. La orden se verifica
                contra el ISIN o el conid, no contra el nombre ni el ticker: el
                mismo ticker apunta a instrumentos distintos según la bolsa.
                Cotéjalos antes de mandar a la mesa.
              </p>
            )}
            {resultado.ordenConsolidada.length !== resultado.posiciones.length && (
              <p className="text-xs text-slate-500 mt-1">
                La orden se consolida en {resultado.ordenConsolidada.length} líneas:
                hay un instrumento que cubre más de una clase de activo.
              </p>
            )}
          </div>

          {/* --- Aviso propio: pendiente de metodología ------------------- */}
          {resultado.perfil === 'Libre de Riesgo' && (
            <p className="border border-amber-300 bg-amber-50 rounded-lg px-4 py-3 text-sm text-amber-900">
              <strong>Pendiente de metodología.</strong> Libre de Riesgo asigna el
              100% del capital invertible a deuda gubernamental, que no es de
              plazo corto: incluye instrumentos de plazo largo o intermedio con
              riesgo de tasa relevante. Los topes del 7.5.2 no lo detectan porque
              acotan cuánta deuda gubernamental, nunca de qué plazo. Está en
              revisión con el manual.
            </p>
          )}

          {/* --- Validaciones --------------------------------------------- */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              Validaciones{' '}
              {fallidas.length > 0 ? (
                <span className="text-red-600">
                  · {fallidas.length} incumplida{fallidas.length > 1 ? 's' : ''}
                </span>
              ) : (
                <span className="text-slate-400 font-normal">· todas cumplen</span>
              )}
            </h3>
            <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100">
              {resultado.validaciones.map((v, i) => (
                <li key={i} className={`flex px-4 py-2 ${v.cumple ? '' : 'bg-red-50'}`}>
                  <span className="w-6 text-sm">
                    {v.cumple ? (
                      <span className="text-slate-300">✓</span>
                    ) : (
                      <span className="text-red-600 font-semibold">✕</span>
                    )}
                  </span>
                  <span
                    className={`flex-1 text-sm ${
                      v.cumple ? 'text-slate-700' : 'text-red-900 font-medium'
                    }`}
                  >
                    {v.regla}
                  </span>
                  <span
                    className={`text-sm tabular-nums ${
                      v.cumple ? 'text-slate-500' : 'text-red-900'
                    }`}
                  >
                    {pct(v.valor)} / {pct(v.limite)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* --- Advertencias --------------------------------------------- */}
          {resultado.advertencias.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">
                Advertencias ({resultado.advertencias.length})
              </h3>
              <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {resultado.advertencias.map((a, i) => (
                  <li key={i} className="px-4 py-2 text-sm text-slate-800">
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* --- Bitácora, colapsable ------------------------------------- */}
          {resultado.bitacora.length > 0 && (
            <details className="border border-slate-200 rounded-lg">
              <summary className="px-4 py-2 text-sm font-semibold text-slate-700 cursor-pointer">
                Bitácora del motor ({resultado.bitacora.length})
              </summary>
              <ol className="divide-y divide-slate-100 border-t border-slate-200">
                {resultado.bitacora.map((b, i) => (
                  <li key={i} className="px-4 py-2 text-sm text-slate-700">
                    {b}
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
