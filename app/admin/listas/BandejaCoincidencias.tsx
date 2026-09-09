'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

/**
 * Bandeja de coincidencias pendientes.
 *
 * Cada renglón trae el careo completo —qué valor del expediente coincidió con
 * qué valor de la lista— porque esa es la decisión: si es la persona o un
 * homónimo. Mandar al revisor a abrir la ficha en otra pestaña para poder
 * juzgar es la manera de que deje de juzgar.
 */

export interface CoincidenciaPendiente {
  id: string;
  codigo_cliente: string;
  tipo_match: 'rfc_exacto' | 'curp_exacto' | 'nombre_exacto';
  valor_cliente: string;
  valor_lista: string;
  detectada_en: string;
  lista: {
    id: string;
    tipo: string;
    obligatoria: boolean;
    fuente: string;
    fecha_lista: string;
    vigente: boolean;
  } | null;
  registro: {
    nombre: string;
    alias: string | null;
    programa: string | null;
    pais: string | null;
    observaciones: string | null;
  } | null;
  cliente: {
    nombre: string | null;
    apellido_paterno: string | null;
    apellido_materno: string | null;
    status: string | null;
  } | null;
}

interface Advertencia {
  titulo: string;
  obligaciones: string[];
  plazo: string;
  fundamento: string;
}

/**
 * Situaciones del 69-B que sí pesan en contra, en minúsculas.
 *
 * «Presunto» y «Definitivo» son los dos estados en los que el contribuyente
 * está señalado; «Desvirtuado» y «Sentencia Favorable» son los dos en los que
 * se defendió y ganó. La lista se guarda entera —un presunto puede pasar a
 * definitivo, y hay que poder ver desde cuándo aparece—, pero quien revisa
 * necesita distinguirlos de un golpe de vista.
 *
 * Lo que NO está aquí se pinta en verde. Es deliberado: si el SAT publicara
 * mañana un quinto estado, saldría en verde y con su nombre a la vista, no
 * escondido tras un rojo que nadie pidió. El texto siempre se muestra.
 */
const ESTADO_69B_GRAVE = new Set(['presunto', 'definitivo']);

const ETIQUETA_MATCH: Record<CoincidenciaPendiente['tipo_match'], string> = {
  rfc_exacto: 'RFC exacto',
  curp_exacto: 'CURP exacta',
  nombre_exacto: 'Nombre exacto',
};

/** Fecha ISO a texto estable: sin locale, para no romper la hidratación. */
function fechaLegible(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

export default function BandejaCoincidencias({
  pendientes,
  totalPendientes,
  totalResueltas,
  tope,
  error,
}: {
  pendientes: CoincidenciaPendiente[];
  totalPendientes: number;
  totalResueltas: number;
  tope: number;
  error: string;
}) {
  const router = useRouter();

  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  /** Se guarda por id: la advertencia sobrevive al refresh de la lista. */
  const [advertencias, setAdvertencias] = useState<Record<string, Advertencia>>({});
  const [avisos, setAvisos] = useState<Record<string, string>>({});

  async function resolver(c: CoincidenciaPendiente, estado: 'confirmada' | 'descartada') {
    const motivo = (motivos[c.id] ?? '').trim();

    // Misma regla que valida el servidor; aquí evita el viaje de ida y vuelta.
    if (!motivo) {
      setErrores((e) => ({
        ...e,
        [c.id]:
          'El motivo es obligatorio, también al descartar: una coincidencia contra una lista ' +
          'de control resuelta sin razón escrita no es defendible ante el supervisor.',
      }));
      return;
    }

    // Confirmar contra la LPB dispara la suspensión de operaciones y el reporte
    // de 24 horas. No es un clic más de la bandeja.
    if (
      estado === 'confirmada' &&
      c.lista?.tipo === 'LPB' &&
      !window.confirm(
        'Vas a CONFIRMAR una coincidencia contra la Lista de Personas Bloqueadas.\n\n' +
          'Al confirmarla nacen dos obligaciones inmediatas: suspender operaciones con el ' +
          'cliente y reportar a la CNBV dentro de las 24 horas.\n\n¿Continuar?'
      )
    ) {
      return;
    }

    setOcupada(c.id);
    setErrores((e) => ({ ...e, [c.id]: '' }));

    try {
      const res = await fetch('/api/resolver-coincidencia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: c.id, estado, motivo }),
      });

      const contentType = res.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) {
        setErrores((e) => ({ ...e, [c.id]: 'Tu sesión expiró. Vuelve a entrar y reintenta.' }));
        return;
      }

      const datos = await res.json();

      if (!res.ok) {
        setErrores((e) => ({ ...e, [c.id]: datos.error ?? 'No se pudo guardar la resolución.' }));
        return;
      }

      if (datos.advertencia) {
        setAdvertencias((a) => ({ ...a, [c.id]: datos.advertencia }));
      }
      if (datos.pendiente) {
        setAvisos((a) => ({ ...a, [c.id]: datos.pendiente }));
      }
      router.refresh();
    } catch {
      setErrores((e) => ({ ...e, [c.id]: 'No se pudo contactar al servidor.' }));
    } finally {
      setOcupada(null);
    }
  }

  const resueltas = Object.keys(advertencias).concat(Object.keys(avisos));

  return (
    <section className="mt-8">
      <div className="flex justify-between items-baseline mb-3">
        <h2 className="text-lg font-semibold">Coincidencias pendientes</h2>
        <p className="text-sm text-slate-500">
          {totalPendientes} pendiente(s) · {totalResueltas} resuelta(s)
        </p>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {/* Las advertencias de la LPB se quedan a la vista aunque el renglón ya
          haya salido de la bandeja: es lo que el revisor tiene que actuar. */}
      {resueltas.map((id) => {
        const adv = advertencias[id];
        const aviso = avisos[id];
        return (
          <div key={id} className="mb-3">
            {adv && (
              <div className="border border-red-300 bg-red-50 rounded-lg px-4 py-3">
                <p className="text-sm font-semibold text-red-900">{adv.titulo}</p>
                <ul className="list-disc ml-5 mt-2 space-y-1 text-sm text-red-900">
                  {adv.obligaciones.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
                <p className="text-sm text-red-900 mt-2">
                  <strong>Plazo:</strong> {adv.plazo}
                </p>
                <p className="text-xs text-red-800 mt-1">{adv.fundamento}</p>
              </div>
            )}
            {aviso && (
              <p className="border border-amber-300 bg-amber-50 rounded-lg px-4 py-3 text-sm text-amber-900 mt-2">
                {aviso}
              </p>
            )}
          </div>
        );
      })}

      {pendientes.length === 0 ? (
        <p className="text-sm text-slate-400 italic">
          No hay coincidencias pendientes de revisión.
        </p>
      ) : (
        <div className="space-y-3">
          {totalPendientes > tope && (
            <p className="border border-amber-300 bg-amber-50 rounded-lg px-4 py-3 text-sm text-amber-900">
              Se muestran las {tope} más recientes de {totalPendientes}. Resuelve estas para
              ver el resto.
            </p>
          )}

          {pendientes.map((c) => {
            const esLPB = c.lista?.tipo === 'LPB';
            const nombreCliente =
              [c.cliente?.nombre, c.cliente?.apellido_paterno, c.cliente?.apellido_materno]
                .filter(Boolean)
                .join(' ') || c.codigo_cliente;

            return (
              <div
                key={c.id}
                className={`border rounded-lg px-4 py-4 ${
                  esLPB ? 'border-red-300 bg-red-50' : 'border-slate-200'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                      esLPB ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {c.lista?.tipo ?? 'lista desconocida'}
                  </span>
                  <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
                    {ETIQUETA_MATCH[c.tipo_match]}
                  </span>
                  {c.cliente?.status && (
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-600">
                      {c.cliente.status}
                    </span>
                  )}
                  {/* Una coincidencia contra una lista ya retirada se sigue
                      revisando, pero quien la revise debe saberlo. */}
                  {c.lista && !c.lista.vigente && (
                    <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                      lista retirada
                    </span>
                  )}
                </div>

                <p className="mt-2 text-sm">
                  <Link
                    href={`/cliente/${c.codigo_cliente}`}
                    className="font-medium text-slate-900 underline underline-offset-2 hover:text-slate-600"
                  >
                    {nombreCliente}
                  </Link>{' '}
                  <span className="text-slate-500">({c.codigo_cliente})</span>
                </p>

                {/* --- El careo ------------------------------------------------ */}

                <div className="grid gap-3 sm:grid-cols-2 mt-3">
                  <div className="border border-slate-200 bg-white rounded px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-slate-400">
                      Valor del expediente
                    </p>
                    <p className="text-sm text-slate-900 break-words">{c.valor_cliente}</p>
                  </div>
                  <div className="border border-slate-200 bg-white rounded px-3 py-2">
                    <p className="text-xs uppercase tracking-wide text-slate-400">
                      Valor de la lista
                    </p>
                    <p className="text-sm text-slate-900 break-words">{c.valor_lista}</p>
                  </div>
                </div>

                {c.registro && (
                  <p className="text-xs text-slate-500 mt-2">
                    Registro: {c.registro.nombre}
                    {c.registro.alias && ` · alias ${c.registro.alias}`}
                    {c.registro.pais && ` · ${c.registro.pais}`}
                    {c.registro.observaciones && ` · ${c.registro.observaciones}`}
                  </p>
                )}

                {/* El 69-B guarda la situación del contribuyente en `programa`,
                    y los cuatro estados NO son equivalentes: un «Desvirtuado» o
                    una «Sentencia Favorable» son contribuyentes que se
                    defendieron y ganaron. Tratarlos como un «Definitivo» es un
                    falso positivo grave, así que el estado se muestra destacado
                    y no escondido en el renglón corrido de metadatos. */}
                {c.registro?.programa &&
                  (c.lista?.tipo === 'SAT_69B' ? (
                    <p className="mt-2 text-xs">
                      <span
                        className={`inline-block px-2 py-0.5 rounded font-medium ${
                          ESTADO_69B_GRAVE.has(c.registro.programa.trim().toLowerCase())
                            ? 'bg-red-100 text-red-700'
                            : 'bg-green-100 text-green-700'
                        }`}
                      >
                        Situación SAT: {c.registro.programa.trim()}
                      </span>
                    </p>
                  ) : (
                    <p className="text-xs text-slate-500">programa {c.registro.programa}</p>
                  ))}

                <p className="text-xs text-slate-400 mt-1">
                  Detectada el {fechaLegible(c.detectada_en)}
                  {c.lista && ` · lista con corte ${c.lista.fecha_lista}, fuente ${c.lista.fuente}`}
                </p>

                {/* --- Resolución ---------------------------------------------- */}

                <label
                  className="block text-sm text-slate-600 mt-3 mb-1"
                  htmlFor={`motivo-${c.id}`}
                >
                  Motivo <span className="text-red-600">(obligatorio)</span>
                </label>
                <textarea
                  id={`motivo-${c.id}`}
                  value={motivos[c.id] ?? ''}
                  onChange={(e) => setMotivos((m) => ({ ...m, [c.id]: e.target.value }))}
                  disabled={ocupada === c.id}
                  rows={2}
                  placeholder="Por qué es la persona, o por qué es un homónimo."
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm bg-white disabled:opacity-50"
                />

                <div className="flex flex-wrap gap-2 mt-2">
                  <button
                    onClick={() => resolver(c, 'confirmada')}
                    disabled={ocupada === c.id}
                    className="bg-red-700 text-white px-4 py-2 rounded text-sm hover:bg-red-800 disabled:opacity-50"
                  >
                    {ocupada === c.id ? 'Guardando…' : 'Confirmar coincidencia'}
                  </button>
                  <button
                    onClick={() => resolver(c, 'descartada')}
                    disabled={ocupada === c.id}
                    className="bg-slate-900 text-white px-4 py-2 rounded text-sm hover:bg-slate-700 disabled:opacity-50"
                  >
                    {ocupada === c.id ? 'Guardando…' : 'Descartar'}
                  </button>
                </div>

                {errores[c.id] && (
                  <p className="text-sm text-red-600 mt-2">{errores[c.id]}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
