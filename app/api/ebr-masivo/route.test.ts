/**
 * /api/ebr-masivo · la exclusión de bajas en el alcance «todos».
 *
 * Mismo andamiaje que el test de /api/ips-masivo: Supabase y el runner se
 * sustituyen, el ORQUESTADOR corre de verdad porque el total y el resumen son
 * suyos. Aquí solo se prueba lo que la ruta agrega: qué clientes entran al lote
 * y que el resumen diga cuáles se dejaron fuera por baja.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { NextRequest } from 'next/server';

type Fila = Record<string, unknown>;

const registro = vi.hoisted(() => ({
  filtroVigente: false,
  codigos: [] as string[],
  bajas: [] as string[],
  corridos: [] as string[],
}));

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'u-1', email: 'asesor@prueba.test' } }, error: null }),
    },
    from: () => {
      const q = {
        select: () => q,
        eq: () => {
          registro.filtroVigente = true;
          return q;
        },
        order: async () => ({
          data: registro.codigos
            .map((c) => ({
              codigo_cliente: c,
              status: registro.bajas.includes(c) ? 'baja' : 'vigente',
            }))
            .filter((f) => !registro.filtroVigente || f.status === 'vigente'),
          error: null,
        }),
      };
      return q;
    },
  }),
}));

vi.mock('@/lib/ebr-runner', () => ({
  evaluarYGuardarEBR: async (codigo: string) => {
    registro.corridos.push(codigo);
    return {
      codigo_cliente: codigo,
      ok: true,
      grado: 'BAJO',
      grado_anterior: 'BAJO',
      puntaje: 60,
      motivos: [],
      campos_faltantes: [],
      evaluacion_id: `ebr-${codigo}`,
      payload: {},
    };
  },
}));

import { POST } from './route';

beforeEach(() => {
  registro.filtroVigente = false;
  registro.codigos = ['PRUEBA-A', 'PRUEBA-B', 'PRUEBA-C'];
  registro.bajas = [];
  registro.corridos = [];
});

async function eventos(body: unknown) {
  const res = await POST(
    new Request('http://localhost/api/ebr-masivo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as NextRequest,
  );
  assert.equal(res.status, 200);
  return (await res.text())
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Fila);
}

test('alcance "todos": las bajas no se evalúan y el resumen las lista', async () => {
  registro.bajas = ['PRUEBA-B'];
  const ev = await eventos({ confirmacion: 'EVALUAR' });

  assert.deepEqual(registro.corridos, ['PRUEBA-A', 'PRUEBA-C'], 'la baja no llega al runner');
  assert.equal(ev[0].total, 2, 'el total del lote no cuenta la baja');
  assert.deepEqual(ev.map((e) => e.tipo), ['inicio', 'avance', 'avance', 'resumen']);

  const resumen = ev.at(-1)!.resumen as Fila;
  assert.deepEqual(resumen.excluidos_baja, ['PRUEBA-B']);
  assert.equal(resumen.ok, 2);
});

test('sin bajas, el resumen trae excluidos_baja vacío (0, no ausente)', async () => {
  const ev = await eventos({ confirmacion: 'EVALUAR' });
  assert.deepEqual((ev.at(-1)!.resumen as Fila).excluidos_baja, []);
  assert.deepEqual(registro.corridos, ['PRUEBA-A', 'PRUEBA-B', 'PRUEBA-C']);
});

test('alcance "vigentes" sigue filtrando por status', async () => {
  registro.bajas = ['PRUEBA-B'];
  await eventos({ confirmacion: 'EVALUAR', alcance: 'vigentes' });
  assert.equal(registro.filtroVigente, true);
  assert.deepEqual(registro.corridos, ['PRUEBA-A', 'PRUEBA-C']);
});

test('alcance "seleccion" respeta los códigos escritos a mano, aunque sean baja', async () => {
  registro.bajas = ['PRUEBA-B'];
  await eventos({ confirmacion: 'EVALUAR', alcance: 'seleccion', codigos: ['PRUEBA-B'] });
  assert.deepEqual(registro.corridos, ['PRUEBA-B']);
});
