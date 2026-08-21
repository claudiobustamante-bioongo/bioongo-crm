'use client';

import { useState } from 'react';
import type { EntradaBitacora, IPSResultado } from '@/lib/ips-engine';

// `import type` se borra al compilar: el motor no se empaqueta al cliente.

/** Respuesta completa del endpoint. */
type Respuesta = IPSResultado & {
  codigo_cliente: string;
  nombreCompleto: string;
};

/**
 * Lo que quedó guardado en `perfil_riesgo` de un cálculo anterior.
 * Es un subconjunto: la base no persiste el desglose de capacidad, la edad,
 * ni la alerta PEP, así que la vista precargada muestra menos que la recién
 * calculada.
 */
export type IPSGuardado = {
  fase: string | null;
  toleranciaPuntos: number | null;
  toleranciaNivel: number | null;
  capacidadPuntos: number | null;
  capacidadNivel: number | null;
  puntuacionPonderada: number | null;
  resultadoPerfil: string | null;
  bitacora: EntradaBitacora[] | null;
  fechaCalculo: string | null;
};

const ETIQUETAS_DESGLOSE: Array<[keyof IPSResultado['capacidadDesglose'], string]> = [
  ['fase', 'Fase'],
  ['empleo', 'Ocupación'],
  ['colchon', 'Colchón de liquidez'],
  ['habitacional', 'Situación habitacional'],
  ['dependientes', 'Dependientes'],
  ['coberturaDeuda', 'Cobertura de deuda'],
];

/** Fecha ISO a texto estable: sin locale, para no romper la hidratación. */
function fechaLegible(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

export default function CalcularIPS({
  codigo,
  inicial,
}: {
  codigo: string;
  inicial: IPSGuardado | null;
}) {
  const [resultado, setResultado] = useState<Respuesta | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  const hayPrevio = resultado !== null || !!inicial?.resultadoPerfil;

  async function calcular() {
    // El cálculo sobrescribe lo guardado: se confirma antes de rehacerlo.
    if (
      hayPrevio &&
      !window.confirm(
        'Ya hay un perfil IPS calculado para este cliente. ¿Recalcular y sobrescribirlo?'
      )
    ) {
      return;
    }

    setCargando(true);
    setError('');

    try {
      const res = await fetch('/api/calcular-ips', {
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
        setError(datos.error ?? 'No se pudo calcular el perfil.');
        // El 500 de guardado incluye el resultado: se muestra aunque no se guardó.
        if (datos.perfilCalculado) setResultado(datos as Respuesta);
        return;
      }

      setResultado(datos as Respuesta);
    } catch {
      setError('No se pudo contactar al servidor. Revisa tu sesión y vuelve a intentar.');
    } finally {
      setCargando(false);
    }
  }

  // Un cálculo recién hecho gana sobre el precargado.
  const vista = resultado
    ? {
        perfil: resultado.perfilFinal,
        fase: resultado.fase,
        edad: resultado.edad,
        faseForzada: resultado.faseForzadaPorJubilacion,
        toleranciaPuntos: resultado.toleranciaPuntos,
        toleranciaNivel: resultado.toleranciaNivel,
        capacidadPuntos: resultado.capacidadPuntos,
        capacidadNivel: resultado.capacidadNivel,
        ponderada: resultado.puntuacionPonderada,
        desglose: resultado.capacidadDesglose,
        bitacora: resultado.bitacora,
        pep: resultado.requiereRevisionPEP,
        identidad: `${resultado.nombreCompleto} · ${resultado.codigo_cliente}`,
        fechaCalculo: null as string | null,
      }
    : inicial?.resultadoPerfil
      ? {
          perfil: inicial.resultadoPerfil,
          fase: inicial.fase,
          edad: null,
          faseForzada: false,
          toleranciaPuntos: inicial.toleranciaPuntos,
          toleranciaNivel: inicial.toleranciaNivel,
          capacidadPuntos: inicial.capacidadPuntos,
          capacidadNivel: inicial.capacidadNivel,
          ponderada: inicial.puntuacionPonderada,
          desglose: null,
          bitacora: inicial.bitacora ?? [],
          pep: false,
          identidad: null,
          fechaCalculo: inicial.fechaCalculo,
        }
      : null;

  return (
    <section className="mt-8">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-semibold">Perfil IPS (cálculo)</h2>
        <button
          onClick={calcular}
          disabled={cargando}
          className="bg-slate-900 text-white px-4 py-2 rounded text-sm hover:bg-slate-700 disabled:opacity-50"
        >
          {cargando ? 'Calculando…' : hayPrevio ? 'Recalcular perfil IPS' : 'Calcular perfil IPS'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {!vista && !error && (
        <p className="text-sm text-slate-400 italic">Aún no se ha calculado el perfil IPS.</p>
      )}

      {vista && (
        <div className="space-y-4">
          {vista.pep && (
            <p className="border border-amber-300 bg-amber-50 rounded-lg px-4 py-3 text-sm text-amber-900">
              <strong>Requiere verificación PEP.</strong> La ocupación de este cliente
              obliga a revisar su estatus de Persona Políticamente Expuesta antes de dar
              por válida su declaración.
            </p>
          )}

          <div className="border border-slate-200 rounded-lg px-4 py-4">
            <p className="text-sm text-slate-500">Perfil resultante</p>
            <p className="text-2xl font-semibold text-slate-900 mt-1">{vista.perfil}</p>
            {vista.identidad && (
              <p className="text-xs text-slate-400 mt-1">{vista.identidad}</p>
            )}
            {vista.fechaCalculo && (
              <p className="text-xs text-slate-400 mt-1">
                Calculado el {fechaLegible(vista.fechaCalculo)}
              </p>
            )}
          </div>

          <dl className="border border-slate-200 rounded-lg divide-y divide-slate-100">
            <div className="flex px-4 py-3">
              <dt className="w-56 text-sm text-slate-500">Fase</dt>
              <dd className="text-sm text-slate-900">
                {vista.fase ?? <span className="text-slate-300">—</span>}
                {vista.faseForzada && (
                  <span className="text-slate-500"> (forzada por jubilación)</span>
                )}
              </dd>
            </div>
            {vista.edad !== null && (
              <div className="flex px-4 py-3">
                <dt className="w-56 text-sm text-slate-500">Edad</dt>
                <dd className="text-sm text-slate-900">{vista.edad} años</dd>
              </div>
            )}
            <div className="flex px-4 py-3">
              <dt className="w-56 text-sm text-slate-500">Tolerancia</dt>
              <dd className="text-sm text-slate-900">
                {vista.toleranciaPuntos} puntos · nivel {vista.toleranciaNivel}
              </dd>
            </div>
            <div className="flex px-4 py-3">
              <dt className="w-56 text-sm text-slate-500">Capacidad</dt>
              <dd className="text-sm text-slate-900">
                {vista.capacidadPuntos} puntos · nivel {vista.capacidadNivel}
              </dd>
            </div>
            <div className="flex px-4 py-3">
              <dt className="w-56 text-sm text-slate-500">Puntuación ponderada</dt>
              <dd className="text-sm text-slate-900">{vista.ponderada}</dd>
            </div>
          </dl>

          {vista.desglose ? (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">
                Desglose de capacidad
              </h3>
              <dl className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {ETIQUETAS_DESGLOSE.map(([clave, etiqueta]) => (
                  <div key={clave} className="flex px-4 py-2">
                    <dt className="w-56 text-sm text-slate-500">{etiqueta}</dt>
                    <dd className="text-sm text-slate-900">{vista.desglose![clave]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : (
            <p className="text-sm text-slate-400 italic">
              El desglose por componente y la alerta PEP no se guardan en la base:
              vuelve a calcular para verlos.
            </p>
          )}

          {vista.bitacora.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-2">
                Bitácora del cálculo
              </h3>
              <ol className="border border-slate-200 rounded-lg divide-y divide-slate-100">
                {vista.bitacora.map((entrada, i) => (
                  <li key={i} className="px-4 py-2">
                    <p className="text-xs uppercase tracking-wide text-slate-400">
                      {entrada.paso}
                    </p>
                    <p className="text-sm text-slate-800">{entrada.detalle}</p>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
