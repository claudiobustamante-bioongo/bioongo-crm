/**
 * /api/dar-baja · validación, sesión, estado y los dos escritos (clientes y
 * bitácora).
 *
 * Supabase se sustituye por un doble que registra cada llamada: el test mira
 * qué se escribió, no solo el código HTTP.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

type Fila = Record<string, unknown>;

const registro = vi.hoisted(() => ({
  usuario: null as { id: string; email?: string } | null,
  /** Fila que devuelve la lectura de clientes (null = no existe). */
  cliente: null as { codigo_cliente: string; status: string } | null,
  /** Lo que devuelve el UPDATE (null = la carrera: otro lo dio de baja). */
  guardado: undefined as Fila | null | undefined,
  updates: [] as Array<{ datos: Fila; filtros: Array<[string, string, unknown]> }>,
  bitacora: [] as Fila[],
}));

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: registro.usuario } }) },
    from: (tabla: string) => {
      if (tabla === 'bitacora') {
        return {
          insert: async (fila: Fila) => {
            registro.bitacora.push(fila);
            return { error: null };
          },
        };
      }
      // clientes
      const filtros: Array<[string, string, unknown]> = [];
      let datos: Fila | null = null;
      const q = {
        select: () => q,
        update: (d: Fila) => {
          datos = d;
          return q;
        },
        eq: (c: string, v: unknown) => {
          filtros.push(['eq', c, v]);
          return q;
        },
        neq: (c: string, v: unknown) => {
          filtros.push(['neq', c, v]);
          return q;
        },
        maybeSingle: async () => {
          if (!datos) return { data: registro.cliente, error: null };
          registro.updates.push({ datos, filtros });
          const g =
            registro.guardado === undefined
              ? { codigo_cliente: registro.cliente?.codigo_cliente, ...datos }
              : registro.guardado;
          return { data: g, error: null };
        },
      };
      return q;
    },
  }),
}));

import { POST } from './route';

beforeEach(() => {
  registro.usuario = { id: 'u-1', email: 'asesor@prueba.test' };
  registro.cliente = { codigo_cliente: 'PRUEBA-A', status: 'inactivo' };
  registro.guardado = undefined;
  registro.updates = [];
  registro.bitacora = [];
});

const pedir = (body: unknown) =>
  POST(
    new Request('http://localhost/api/dar-baja', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const valido = { codigo_cliente: 'PRUEBA-A', fecha_baja: '2026-09-01', motivo_baja: 'Cierre voluntario.' };

test('flujo feliz: marca la baja con fecha y motivo, y deja asiento de bitácora', async () => {
  const res = await pedir(valido);
  assert.equal(res.status, 200);
  const cuerpo = (await res.json()) as Fila;
  assert.equal(cuerpo.ok, true);
  assert.equal(cuerpo.bitacora, true);

  assert.equal(registro.updates.length, 1);
  assert.deepEqual(registro.updates[0].datos, {
    status: 'baja',
    fecha_baja: '2026-09-01',
    motivo_baja: 'Cierre voluntario.',
  });
  assert.deepEqual(registro.updates[0].filtros, [
    ['eq', 'codigo_cliente', 'PRUEBA-A'],
    ['neq', 'status', 'baja'],
  ]);

  assert.equal(registro.bitacora.length, 1);
  const b = registro.bitacora[0];
  assert.equal(b.entidad, 'clientes');
  assert.equal(b.entidad_id, 'PRUEBA-A');
  assert.equal(b.accion, 'baja');
  assert.equal(b.origen, 'aplicacion');
  assert.equal(b.valor_anterior, 'inactivo');
  assert.equal(b.valor_nuevo, 'baja');
  assert.equal(b.motivo, 'Cierre voluntario.');
  assert.equal(b.usuario, 'asesor@prueba.test', 'el usuario sale de la sesión');
  assert.deepEqual(b.metadata, { fecha_baja: '2026-09-01' });
});

test('sin fecha o sin motivo: 400 y no toca nada', async () => {
  for (const body of [
    { ...valido, fecha_baja: '' },
    { ...valido, motivo_baja: '   ' },
    { codigo_cliente: 'PRUEBA-A' },
  ]) {
    const res = await pedir(body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal(registro.updates.length, 0);
  assert.equal(registro.bitacora.length, 0);
});

test('fecha futura: 400', async () => {
  const res = await pedir({ ...valido, fecha_baja: '2999-01-01' });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as Fila).error as string, /futura/);
  assert.equal(registro.updates.length, 0);
});

test('sin sesión: 401 y no toca nada', async () => {
  registro.usuario = null;
  const res = await pedir(valido);
  assert.equal(res.status, 401);
  assert.equal(registro.updates.length, 0);
  assert.equal(registro.bitacora.length, 0);
});

test('cliente inexistente: 404', async () => {
  registro.cliente = null;
  assert.equal((await pedir(valido)).status, 404);
  assert.equal(registro.updates.length, 0);
});

test('ya de baja: 409, no se pisa su fecha ni su motivo', async () => {
  registro.cliente = { codigo_cliente: 'PRUEBA-A', status: 'baja' };
  assert.equal((await pedir(valido)).status, 409);
  assert.equal(registro.updates.length, 0);
  assert.equal(registro.bitacora.length, 0);
});

test('carrera: si el UPDATE no toca fila, 409 y sin asiento', async () => {
  registro.guardado = null;
  assert.equal((await pedir(valido)).status, 409);
  assert.equal(registro.bitacora.length, 0);
});
