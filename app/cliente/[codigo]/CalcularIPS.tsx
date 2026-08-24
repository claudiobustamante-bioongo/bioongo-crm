'use client';

import { useState } from 'react';
import { PERFILES } from '@/lib/ips-catalogo';
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
  // Ajuste del asesor. Convive con el del motor; no lo reemplaza en la base.
  perfilAjustado: string | null;
  comentarioAsesor: string | null;
  ajustadoPor: string | null;
  fechaAjuste: string | null;
};

/** Estado del ajuste manual, tal como está guardado. */
type Ajuste = {
  perfilAjustado: string | null;
  comentarioAsesor: string | null;
  ajustadoPor: string | null;
  fechaAjuste: string | null;
};

/** Sentinel del selector para "sin ajuste". */
const SIN_AJUSTE = '';

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

/**
 * ¿`a` es anterior a `b`? Compara por timestamp, no por texto: Postgres y
 * PostgREST no siempre devuelven el mismo formato (con 'T' o con espacio) y
 * una comparación lexicográfica se equivocaría.
 */
function esAnterior(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta < tb;
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
  /** Momento del cálculo hecho en esta sesión, para detectar ajustes viejos. */
  const [calculadoEn, setCalculadoEn] = useState<string | null>(null);

  const [ajuste, setAjuste] = useState<Ajuste>({
    perfilAjustado: inicial?.perfilAjustado ?? null,
    comentarioAsesor: inicial?.comentarioAsesor ?? null,
    ajustadoPor: inicial?.ajustadoPor ?? null,
    fechaAjuste: inicial?.fechaAjuste ?? null,
  });
  const [seleccion, setSeleccion] = useState<string>(
    inicial?.perfilAjustado ?? SIN_AJUSTE
  );
  const [comentario, setComentario] = useState<string>(
    inicial?.comentarioAsesor ?? ''
  );
  const [guardando, setGuardando] = useState(false);
  const [errorAjuste, setErrorAjuste] = useState('');
  const [avisoAjuste, setAvisoAjuste] = useState('');

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
      setCalculadoEn(new Date().toISOString());
    } catch {
      setError('No se pudo contactar al servidor. Revisa tu sesión y vuelve a intentar.');
    } finally {
      setCargando(false);
    }
  }

  async function guardarAjuste() {
    const perfilMotorActual =
      resultado?.perfilFinal ?? inicial?.resultadoPerfil ?? null;
    const difiere =
      seleccion !== SIN_AJUSTE && seleccion !== perfilMotorActual;

    // Misma regla que valida el servidor; aquí evita el viaje de ida y vuelta.
    if (difiere && !comentario.trim()) {
      setErrorAjuste(
        'El comentario es obligatorio cuando el ajuste difiere del perfil del motor.'
      );
      return;
    }

    setGuardando(true);
    setErrorAjuste('');
    setAvisoAjuste('');

    try {
      const res = await fetch('/api/ajustar-ips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          codigo_cliente: codigo,
          perfil_ajustado: seleccion === SIN_AJUSTE ? null : seleccion,
          comentario_asesor: comentario.trim() || null,
        }),
      });

      const tipo = res.headers.get('content-type') ?? '';
      if (!tipo.includes('application/json')) {
        setErrorAjuste('Tu sesión expiró. Vuelve a entrar y reintenta.');
        return;
      }

      const datos = await res.json();

      if (!res.ok) {
        setErrorAjuste(datos.error ?? 'No se pudo guardar el ajuste.');
        return;
      }

      setAjuste({
        perfilAjustado: datos.perfil_ajustado ?? null,
        comentarioAsesor: datos.comentario_asesor ?? null,
        ajustadoPor: datos.ajustado_por ?? null,
        fechaAjuste: datos.fecha_ajuste ?? null,
      });
      setComentario(datos.comentario_asesor ?? '');
      setAvisoAjuste(
        datos.perfil_ajustado ? 'Ajuste guardado.' : 'Ajuste retirado.'
      );
    } catch {
      setErrorAjuste('No se pudo contactar al servidor.');
    } finally {
      setGuardando(false);
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
            <p className="text-sm text-slate-500">
              {ajuste.perfilAjustado ? 'Perfil vigente' : 'Perfil resultante'}
            </p>
            {/* El vigente es el ajustado si existe; si no, el del motor. */}
            <p className="text-2xl font-semibold text-slate-900 mt-1">
              {ajuste.perfilAjustado ?? vista.perfil}
            </p>
            {ajuste.perfilAjustado && ajuste.perfilAjustado !== vista.perfil && (
              <p className="text-sm text-slate-600 mt-1">
                Motor: <strong>{vista.perfil}</strong> · Asesor:{' '}
                <strong>{ajuste.perfilAjustado}</strong>
              </p>
            )}
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

          {/* --- Ajuste del asesor ------------------------------------------ */}
          <div className="border border-slate-200 rounded-lg px-4 py-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">
              Ajuste del asesor
            </h3>

            {ajuste.perfilAjustado && ajuste.ajustadoPor && ajuste.fechaAjuste && (
              <p className="text-xs text-slate-500 mb-3">
                Ajustado a <strong>{ajuste.perfilAjustado}</strong> por{' '}
                {ajuste.ajustadoPor} el {fechaLegible(ajuste.fechaAjuste)}
              </p>
            )}

            {!ajuste.perfilAjustado && ajuste.fechaAjuste && (
              <p className="text-xs text-slate-500 mb-3">
                Hubo un ajuste de {ajuste.ajustadoPor} el{' '}
                {fechaLegible(ajuste.fechaAjuste)} y se retiró. Rige el perfil del
                motor.
              </p>
            )}

            {esAnterior(ajuste.fechaAjuste, calculadoEn ?? vista.fechaCalculo) && (
              <p className="border border-amber-300 bg-amber-50 rounded px-3 py-2 text-sm text-amber-900 mb-3">
                El ajuste es anterior al último cálculo del motor; conviene
                revisarlo.
              </p>
            )}

            <label className="block text-sm text-slate-600 mb-1" htmlFor="perfil-ajustado">
              Perfil
            </label>
            <select
              id="perfil-ajustado"
              value={seleccion}
              onChange={(e) => setSeleccion(e.target.value)}
              disabled={guardando}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm mb-3 disabled:opacity-50"
            >
              <option value={SIN_AJUSTE}>Sin ajuste (usar el del motor)</option>
              {PERFILES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            <label className="block text-sm text-slate-600 mb-1" htmlFor="comentario-asesor">
              Comentario
              {seleccion !== SIN_AJUSTE && seleccion !== vista.perfil && (
                <span className="text-red-600"> (obligatorio: difiere del motor)</span>
              )}
            </label>
            <textarea
              id="comentario-asesor"
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              disabled={guardando}
              rows={3}
              placeholder="Por qué se ajusta el perfil calculado."
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm mb-3 disabled:opacity-50"
            />

            <button
              onClick={guardarAjuste}
              disabled={guardando}
              className="bg-slate-900 text-white px-4 py-2 rounded text-sm hover:bg-slate-700 disabled:opacity-50"
            >
              {guardando ? 'Guardando…' : 'Guardar ajuste'}
            </button>

            {errorAjuste && <p className="text-sm text-red-600 mt-2">{errorAjuste}</p>}
            {avisoAjuste && <p className="text-sm text-slate-600 mt-2">{avisoAjuste}</p>}
          </div>

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
