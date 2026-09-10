import { describe, it, expect, vi } from 'vitest';
import {
  correrLoteEBR,
  type ResultadoEBR,
  type EventoLote,
  type ResumenLote,
} from './ebr-lote';

const ok = (
  codigo: string,
  grado: 'ALTO' | 'BAJO',
  anterior: 'ALTO' | 'BAJO' | null = grado,
  faltantes: string[] = [],
): ResultadoEBR => ({
  codigo_cliente: codigo,
  ok: true,
  grado,
  grado_anterior: anterior,
  puntaje: 60,
  motivos: [],
  campos_faltantes: faltantes,
  evaluacion_id: `ev-${codigo}`,
});

async function drenar(gen: AsyncGenerator<EventoLote, ResumenLote, void>) {
  const eventos: EventoLote[] = [];
  let resumen: ResumenLote | undefined;
  for (;;) {
    const paso = await gen.next();
    if (paso.done) {
      resumen = paso.value;
      break;
    }
    eventos.push(paso.value);
  }
  return { eventos, resumen: resumen! };
}

describe('correrLoteEBR', () => {
  it('evalúa en secuencia y emite inicio, un avance por cliente y resumen', async () => {
    const orden: string[] = [];
    const { eventos, resumen } = await drenar(
      correrLoteEBR(
        ['A', 'B', 'C'],
        async (c) => {
          orden.push(c);
          return ok(c, 'BAJO');
        },
        { lote_id: 'L1' },
      ),
    );

    expect(orden).toEqual(['A', 'B', 'C']);
    expect(eventos[0].tipo).toBe('inicio');
    expect(eventos.filter((e) => e.tipo === 'avance')).toHaveLength(3);
    expect(eventos.at(-1)!.tipo).toBe('resumen');
    expect(resumen.ok).toBe(3);
    expect(resumen.fallidos).toBe(0);
    expect(resumen.por_grado).toEqual({ ALTO: 0, BAJO: 3 });
  });

  it('un cliente que revienta no detiene el lote', async () => {
    const { resumen } = await drenar(
      correrLoteEBR(
        ['A', 'B', 'C'],
        async (c) => {
          if (c === 'B') throw new Error('expediente incompleto');
          return ok(c, 'BAJO');
        },
        { lote_id: 'L2' },
      ),
    );

    expect(resumen.ok).toBe(2);
    expect(resumen.fallidos).toBe(1);
    expect(resumen.errores).toEqual([
      { codigo_cliente: 'B', error: 'expediente incompleto' },
    ]);
  });

  it('un resultado ok:false cuenta como fallido sin lanzar', async () => {
    const { resumen } = await drenar(
      correrLoteEBR(
        ['A'],
        async () => ({ codigo_cliente: 'A', ok: false, error: 'sin KYC' }),
        { lote_id: 'L3' },
      ),
    );
    expect(resumen.fallidos).toBe(1);
    expect(resumen.errores[0].error).toBe('sin KYC');
  });

  it('registra cambio de grado, incluyendo la primera evaluación (null → grado)', async () => {
    const { resumen } = await drenar(
      correrLoteEBR(
        ['A', 'B', 'C'],
        async (c) => {
          if (c === 'A') return ok('A', 'ALTO', 'BAJO'); // subió
          if (c === 'B') return ok('B', 'BAJO', null); // nunca evaluado
          return ok('C', 'BAJO', 'BAJO'); // sin cambio
        },
        { lote_id: 'L4' },
      ),
    );

    expect(resumen.cambios).toEqual([
      { codigo_cliente: 'A', de: 'BAJO', a: 'ALTO' },
      { codigo_cliente: 'B', de: null, a: 'BAJO' },
    ]);
    expect(resumen.por_grado).toEqual({ ALTO: 1, BAJO: 2 });
  });

  it('reporta huecos sin marcarlos como error — la evaluación sí se guardó', async () => {
    const { resumen } = await drenar(
      correrLoteEBR(
        ['A', 'B'],
        async (c) =>
          c === 'A'
            ? ok('A', 'BAJO', 'BAJO', ['realiza_actividad_vulnerable'])
            : ok('B', 'BAJO'),
        { lote_id: 'L5' },
      ),
    );

    expect(resumen.ok).toBe(2);
    expect(resumen.fallidos).toBe(0);
    expect(resumen.con_huecos).toEqual([
      { codigo_cliente: 'A', campos: ['realiza_actividad_vulnerable'] },
    ]);
  });

  it('corta una evaluación colgada por timeout y sigue con la siguiente', async () => {
    vi.useFakeTimers();
    try {
      const gen = correrLoteEBR(
        ['A', 'B'],
        async (c) => (c === 'A' ? new Promise<ResultadoEBR>(() => {}) : ok('B', 'BAJO')),
        { lote_id: 'L6', timeout_ms: 1000 },
      );

      const pInicio = gen.next();
      await vi.advanceTimersByTimeAsync(0);
      expect((await pInicio).value).toMatchObject({ tipo: 'inicio' });

      const pA = gen.next();
      await vi.advanceTimersByTimeAsync(1001);
      const evA = (await pA).value as Extract<EventoLote, { tipo: 'avance' }>;
      expect(evA.resultado.ok).toBe(false);
      expect(evA.resultado.error).toMatch(/Timeout de 1000 ms/);

      const pB = gen.next();
      await vi.advanceTimersByTimeAsync(0);
      const evB = (await pB).value as Extract<EventoLote, { tipo: 'avance' }>;
      expect(evB.resultado.ok).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('respeta AbortSignal y marca el resumen como abortado', async () => {
    const ctrl = new AbortController();
    const { resumen } = await drenar(
      correrLoteEBR(
        ['A', 'B', 'C'],
        async (c) => {
          if (c === 'B') ctrl.abort();
          return ok(c, 'BAJO');
        },
        { lote_id: 'L7', signal: ctrl.signal },
      ),
    );

    expect(resumen.abortado).toBe(true);
    expect(resumen.ok).toBe(2); // A y B corrieron; C ya no
    expect(resumen.total).toBe(3);
  });

  it('un resultado no interpretable se trata como fallo, no como crash', async () => {
    const { resumen } = await drenar(
      correrLoteEBR(
        ['A'],
        // @ts-expect-error probamos a propósito una capa de abajo rota
        async () => undefined,
        { lote_id: 'L8' },
      ),
    );
    expect(resumen.fallidos).toBe(1);
    expect(resumen.errores[0].error).toMatch(/no interpretable/);
  });

  it('lote vacío no revienta', async () => {
    const { resumen } = await drenar(
      correrLoteEBR([], async () => ok('X', 'BAJO'), { lote_id: 'L9' }),
    );
    expect(resumen.total).toBe(0);
    expect(resumen.ok).toBe(0);
  });
});
