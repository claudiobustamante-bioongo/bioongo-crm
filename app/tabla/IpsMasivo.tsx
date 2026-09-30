'use client';

/**
 * [core] Botón de IPS masivo con progreso en vivo y resumen.
 *
 * Lee el stream NDJSON de /api/ips-masivo. El detalle que rompe a todo el mundo
 * la primera vez: los chunks del stream NO llegan alineados a saltos de línea.
 * Un JSON puede venir partido en dos chunks. Por eso hay un buffer y solo se
 * parsean las líneas completas.
 *
 * LA PALABRA ES `CALCULAR`, distinta del `EVALUAR` del EBR a propósito: son dos
 * corridas con consecuencias distintas y una no debe dispararse creyendo que se
 * dispara la otra. El servidor la vuelve a exigir (428 sin ella).
 *
 * ESTA CORRIDA SOBRESCRIBE. El EBR agrega filas a una tabla histórica; el IPS
 * actualiza `perfil_riesgo` en sitio y lo que la vuelve reversible es el trigger
 * que archiva la versión anterior en `perfil_riesgo_historico`. Por eso el aviso
 * de confirmación no dice lo mismo que el del EBR.
 *
 * `Dato` y `Bloque` están duplicados de EbrMasivo.tsx a propósito: allá son
 * privados y extraerlos obligaba a refactorizar ese archivo en este commit.
 * Cuando se toque EbrMasivo, extraer los dos a un módulo compartido.
 */

import { useCallback, useRef, useState } from 'react';
import { PERFILES } from '@/lib/ips-catalogo';
import type {
  EventoIPS,
  ResultadoIPSDetallado,
  ResumenIPS,
} from '@/lib/ips-runner';

type Alcance = 'todos' | 'vigentes';
type Fase = 'idle' | 'confirmando' | 'corriendo' | 'terminado' | 'error';

const PALABRA = 'CALCULAR';

export function IpsMasivo() {
  const [fase, setFase] = useState<Fase>('idle');
  const [alcance, setAlcance] = useState<Alcance>('todos');
  const [confirmacion, setConfirmacion] = useState('');
  const [progreso, setProgreso] = useState({ hechos: 0, total: 0 });
  const [resultados, setResultados] = useState<ResultadoIPSDetallado[]>([]);
  const [resumen, setResumen] = useState<ResumenIPS | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const correr = useCallback(async () => {
    setFase('corriendo');
    setError(null);
    setResultados([]);
    setResumen(null);
    setProgreso({ hechos: 0, total: 0 });

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch('/api/ips-masivo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmacion: PALABRA, alcance }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        const msg = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(msg.error ?? `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lineas = buffer.split('\n');
        buffer = lineas.pop() ?? ''; // la última puede estar incompleta

        for (const l of lineas) {
          if (!l.trim()) continue;
          let ev: EventoIPS | { tipo: 'fatal'; error: string };
          try {
            ev = JSON.parse(l);
          } catch {
            continue; // línea corrupta: no tira el lote
          }

          if (ev.tipo === 'inicio') {
            setProgreso({ hechos: 0, total: ev.total });
          } else if (ev.tipo === 'avance') {
            setProgreso({ hechos: ev.indice, total: ev.total });
            setResultados((r) => [...r, ev.resultado]);
          } else if (ev.tipo === 'resumen') {
            setResumen(ev.resumen);
          } else if (ev.tipo === 'fatal') {
            throw new Error(ev.error);
          }
        }
      }

      setFase('terminado');
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        setFase('terminado');
        return;
      }
      // Si el lote cayó, no se presenta un resumen parcial como si fuera final.
      setResumen(null);
      setError(e instanceof Error ? e.message : String(e));
      setFase('error');
    } finally {
      abortRef.current = null;
    }
  }, [alcance]);

  const pct = progreso.total ? (progreso.hechos / progreso.total) * 100 : 0;

  return (
    <section className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
      <header className="mb-3">
        <h2 className="text-base font-semibold">Cálculo IPS masivo</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Corre el motor IPS sobre la cartera y recalcula el perfil de inversión de
          cada cliente. Cada recálculo SOBRESCRIBE el perfil vigente; la versión
          anterior queda archivada en el histórico y el lote queda en bitácora.
        </p>
      </header>

      {fase === 'idle' && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm">
            Alcance{' '}
            <select
              value={alcance}
              onChange={(e) => setAlcance(e.target.value as Alcance)}
              className="rounded border px-2 py-1 text-sm"
            >
              <option value="todos">Todos los registros (sin bajas)</option>
              <option value="vigentes">Solo vigentes</option>
            </select>
          </label>
          <button
            onClick={() => setFase('confirmando')}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            Calcular cartera
          </button>
        </div>
      )}

      {fase === 'confirmando' && (
        <div className="space-y-3 rounded border border-amber-400 bg-amber-50 p-3 dark:bg-amber-950/30">
          <p className="text-sm">
            Esto <strong>sobrescribe</strong> el perfil IPS vigente de cada cliente
            alcanzado. La versión anterior queda archivada, pero el perfil que ve
            la ficha cambia. Escribe{' '}
            <code className="font-mono font-semibold">{PALABRA}</code> para
            autorizar.
          </p>
          <div className="flex gap-2">
            <input
              value={confirmacion}
              onChange={(e) => setConfirmacion(e.target.value)}
              className="rounded border px-2 py-1 font-mono text-sm"
              placeholder={PALABRA}
              autoFocus
            />
            <button
              disabled={confirmacion !== PALABRA}
              onClick={correr}
              className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
            >
              Autorizar y correr
            </button>
            <button
              onClick={() => {
                setConfirmacion('');
                setFase('idle');
              }}
              className="rounded border px-3 py-1.5 text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {fase === 'corriendo' && (
        <div className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded bg-neutral-200 dark:bg-neutral-800">
            <div
              className="h-full bg-neutral-900 transition-[width] dark:bg-white"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span>
              {progreso.hechos} / {progreso.total}
            </span>
            <button
              onClick={() => abortRef.current?.abort()}
              className="rounded border px-2 py-1 text-xs"
            >
              Detener
            </button>
          </div>
          <ul className="max-h-48 overflow-y-auto font-mono text-xs">
            {resultados.slice(-12).reverse().map((r, i) => (
              <li key={`${r.codigo_cliente}-${i}`}>
                {r.ok ? '✓' : '✗'} {r.codigo_cliente}{' '}
                {r.ok ? r.grado : (r.codigo_error ?? r.error)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="rounded border border-red-400 bg-red-50 p-2 text-sm text-red-800 dark:bg-red-950/30">
          <strong>El lote se interrumpió y no hay resumen.</strong> {error} Lo que
          se haya recalculado antes del corte quedó guardado, con su versión
          anterior en el histórico; revisa la bitácora por el id del lote antes de
          volver a correrlo.
        </p>
      )}

      {resumen && fase !== 'error' && (
        <div className="mt-4 space-y-3 text-sm">
          {resumen.abortado && (
            <p className="rounded border border-amber-400 bg-amber-50 p-2 text-amber-900 dark:bg-amber-950/30">
              <strong>Corrida PARCIAL:</strong> se detuvo antes de terminar.
              Recalculó {resumen.ok + resumen.fallidos} de {resumen.total}; el
              resto conserva su perfil anterior.
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Dato n={resumen.ok} l="Recalculados" />
            <Dato n={resumen.cambios.length} l="Cambios de perfil" />
            <Dato n={resumen.ajuste_manual.length} l="Con ajuste manual" />
            <Dato n={resumen.fallidos} l="Fallidos" />
          </div>

          <p className="text-xs text-slate-600 dark:text-slate-400">
            Excluidos por baja: {resumen.excluidos_baja?.length ?? 0}
            {(resumen.excluidos_baja?.length ?? 0) > 0 && (
              <> · <span className="font-mono">{resumen.excluidos_baja.join(', ')}</span></>
            )}
          </p>

          {/* Distribución en el orden de PERFILES: de más a menos riesgo. */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {PERFILES.map((p) => (
              <Dato key={p} n={resumen.por_grado[p] ?? 0} l={p} />
            ))}
          </div>

          {resumen.cambios.length > 0 ? (
            <Bloque titulo={`Cambios de perfil (${resumen.cambios.length}) — revisión personal obligatoria`}>
              {resumen.cambios.map((c) => (
                <li key={c.codigo_cliente} className="font-mono">
                  {c.codigo_cliente}: {c.de ?? 'sin perfil'} → {c.a}
                </li>
              ))}
            </Bloque>
          ) : (
            <p className="rounded border border-neutral-200 p-2 text-neutral-600 dark:border-neutral-800 dark:text-neutral-400">
              <strong>0 cambios de perfil.</strong> Los {resumen.ok} expedientes
              recalculados dieron el mismo perfil que tenían.
            </p>
          )}

          {resumen.ajuste_manual.length > 0 && (
            <Bloque
              titulo={`Con ajuste manual del Asesor (${resumen.ajuste_manual.length})`}
            >
              <li className="mb-1 list-none font-sans text-neutral-600 dark:text-neutral-400">
                El ajuste vigente se conserva; revisar si sigue justificado frente
                al perfil recalculado.
              </li>
              {resumen.ajuste_manual.map((codigo) => (
                <li key={codigo} className="font-mono">
                  {codigo}
                </li>
              ))}
            </Bloque>
          )}

          {Object.keys(resumen.por_codigo_error).length > 0 && (
            <Bloque titulo={`No recalculados (${resumen.fallidos})`}>
              {Object.entries(resumen.por_codigo_error).map(([codigo_error, codigos]) => (
                <li key={codigo_error} className="font-mono">
                  <span className="font-sans font-medium">
                    {codigo_error} ({codigos.length}):
                  </span>{' '}
                  {codigos.join(', ')}
                </li>
              ))}
            </Bloque>
          )}

          <p className="text-xs text-neutral-500">
            Lote <code className="font-mono">{resumen.lote_id}</code> ·{' '}
            {(resumen.duracion_ms / 1000).toFixed(1)} s · crúzalo con bitácora por
            ese id
          </p>
        </div>
      )}
    </section>
  );
}

function Dato({ n, l }: { n: number; l: string }) {
  return (
    <div className="rounded border p-2">
      <div className="text-xl font-semibold tabular-nums">{n}</div>
      <div className="text-xs text-neutral-500">{l}</div>
    </div>
  );
}

function Bloque({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <details open className="rounded border p-2">
      <summary className="cursor-pointer text-sm font-medium">{titulo}</summary>
      <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs">
        {children}
      </ul>
    </details>
  );
}
