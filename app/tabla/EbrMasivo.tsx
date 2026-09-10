'use client';

/**
 * [core] Botón de EBR masivo con progreso en vivo y resumen.
 *
 * Lee el stream NDJSON de /api/ebr-masivo. El detalle que rompe a todo el
 * mundo la primera vez: los chunks del stream NO llegan alineados a saltos
 * de línea. Un JSON puede venir partido en dos chunks. Por eso hay un buffer
 * y solo se parsean las líneas completas.
 */

import { useCallback, useRef, useState } from 'react';
import type { EventoLote, ResultadoEBR, ResumenLote } from '@/lib/ebr-lote';

type Alcance = 'todos' | 'vigentes';
type Fase = 'idle' | 'confirmando' | 'corriendo' | 'terminado' | 'error';

export function EbrMasivo() {
  const [fase, setFase] = useState<Fase>('idle');
  const [alcance, setAlcance] = useState<Alcance>('todos');
  const [confirmacion, setConfirmacion] = useState('');
  const [progreso, setProgreso] = useState({ hechos: 0, total: 0 });
  const [resultados, setResultados] = useState<ResultadoEBR[]>([]);
  const [resumen, setResumen] = useState<ResumenLote | null>(null);
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
      const res = await fetch('/api/ebr-masivo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmacion: 'EVALUAR', alcance }),
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
          let ev: EventoLote | { tipo: 'fatal'; error: string };
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
        <h2 className="text-base font-semibold">Evaluación EBR masiva</h2>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Corre la matriz de 15 factores y la regla del §4.6 sobre la cartera.
          Cada evaluación se guarda como fila nueva en el histórico y queda en
          bitácora con el id del lote.
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
              <option value="todos">Todos los registros</option>
              <option value="vigentes">Solo vigentes</option>
            </select>
          </label>
          <button
            onClick={() => setFase('confirmando')}
            className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            Evaluar cartera
          </button>
        </div>
      )}

      {fase === 'confirmando' && (
        <div className="space-y-3 rounded border border-amber-400 bg-amber-50 p-3 dark:bg-amber-950/30">
          <p className="text-sm">
            Esto reclasifica expedientes y escribe en el histórico. Escribe{' '}
            <code className="font-mono font-semibold">EVALUAR</code> para
            autorizar.
          </p>
          <div className="flex gap-2">
            <input
              value={confirmacion}
              onChange={(e) => setConfirmacion(e.target.value)}
              className="rounded border px-2 py-1 font-mono text-sm"
              placeholder="EVALUAR"
              autoFocus
            />
            <button
              disabled={confirmacion !== 'EVALUAR'}
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
                {r.ok ? r.grado : r.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p className="rounded border border-red-400 bg-red-50 p-2 text-sm text-red-800 dark:bg-red-950/30">
          {error}
        </p>
      )}

      {resumen && (
        <div className="mt-4 space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Dato n={resumen.ok} l="Evaluados" />
            <Dato n={resumen.por_grado.ALTO} l="Grado ALTO" />
            <Dato n={resumen.cambios.length} l="Cambios de grado" />
            <Dato n={resumen.fallidos} l="Fallidos" />
          </div>

          {resumen.cambios.length > 0 && (
            <Bloque titulo="Cambios de grado — revisión personal obligatoria">
              {resumen.cambios.map((c) => (
                <li key={c.codigo_cliente} className="font-mono">
                  {c.codigo_cliente}: {c.de ?? 'sin evaluación'} → {c.a}
                </li>
              ))}
            </Bloque>
          )}

          {resumen.con_huecos.length > 0 && (
            <Bloque
              titulo={`Evaluados con campos en null (${resumen.con_huecos.length}) — el grado se calculó sin estos datos`}
            >
              {resumen.con_huecos.map((h) => (
                <li key={h.codigo_cliente} className="font-mono">
                  {h.codigo_cliente}: {h.campos.join(', ')}
                </li>
              ))}
            </Bloque>
          )}

          {resumen.errores.length > 0 && (
            <Bloque titulo={`No evaluados (${resumen.errores.length})`}>
              {resumen.errores.map((e) => (
                <li key={e.codigo_cliente} className="font-mono">
                  {e.codigo_cliente}: {e.error}
                </li>
              ))}
            </Bloque>
          )}

          <p className="text-xs text-neutral-500">
            Lote {resumen.lote_id} · {(resumen.duracion_ms / 1000).toFixed(1)} s
            {resumen.abortado && ' · DETENIDO ANTES DE TERMINAR'}
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
