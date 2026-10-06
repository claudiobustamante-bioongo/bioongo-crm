/**
 * /api/determinar-clasificacion · validación, sesión, la carta que no se
 * sobrescribe, la escritura y su asiento de bitácora.
 *
 * Supabase y la bitácora se sustituyen: lo que se prueba es la decisión de la
 * ruta. Los CHECK que la respaldan se probaron contra Postgres: ver
 * migraciones/2026-10-06-clasificacion-inversionista.sql.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

import type { EventoBitacora } from '@/lib/bitacora';

type Fila = Record<string, unknown>;

const registro = vi.hoisted(() => ({
  usuario: null as { id: string; email?: string } | null,
  cliente: null as Record<string, unknown> | null,
  /** undefined = el UPDATE devuelve la fila; null = la carrera (no tocó nada). */
  guardado: undefined as Record<string, unknown> | null | undefined,
  errorGuardado: null as { code: string; message: string } | null,
  tablas: [] as string[],
  updates: [] as { datos: Record<string, unknown>; filtros: Array<[string, ...unknown[]]> }[],
  eventos: [] as EventoBitacora[],
}));

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: registro.usuario } }) },
    from: (tabla: string) => {
      registro.tablas.push(tabla);
      const filtros: Array<[string, ...unknown[]]> = [];
      let datos: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        update: (d: Record<string, unknown>) => {
          datos = d;
          return q;
        },
        eq: (c: string, v: unknown) => (filtros.push(['eq', c, v]), q),
        or: (f: string) => (filtros.push(['or', f]), q),
        maybeSingle: async () => {
          if (!datos) return { data: registro.cliente, error: null };
          registro.updates.push({ datos, filtros });
          if (registro.errorGuardado) return { data: null, error: registro.errorGuardado };
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

vi.mock('@/lib/bitacora', () => ({
  registrarEvento: async (_supabase: unknown, evento: EventoBitacora) => {
    registro.eventos.push(evento);
    return true;
  },
}));

import { POST } from './route';

beforeEach(() => {
  registro.usuario = { id: 'u-1', email: 'asesor@prueba.test' };
  registro.cliente = { codigo_cliente: 'PRUEBA-001', clasificacion_inversionista: null, clasificacion_fuente: null };
  registro.guardado = undefined;
  registro.errorGuardado = null;
  registro.tablas = [];
  registro.updates = [];
  registro.eventos = [];
});

async function pedir(body: unknown) {
  const res = await POST(
    new Request('http://localhost/api/determinar-clasificacion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
  return { status: res.status, cuerpo: (await res.json()) as Fila & { error?: string } };
}

const VALIDO = { codigo_cliente: 'PRUEBA-001', clasificacion: '204', nota: 'No cumple los supuestos de 201 ni 202.' };

const sinEfectos = () => {
  assert.equal(registro.updates.length, 0, 'no escribió');
  assert.equal(registro.eventos.length, 0, 'no asentó bitácora');
};

test('flujo feliz: escribe las cuatro columnas con fuente determinacion_asesor y deja asiento', async () => {
  const r = await pedir(VALIDO);
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.ok, true);

  assert.equal(registro.updates.length, 1);
  const { datos, filtros } = registro.updates[0];
  assert.deepEqual(Object.keys(datos).sort(), [
    'clasificacion_fecha',
    'clasificacion_fuente',
    'clasificacion_inversionista',
    'clasificacion_nota',
  ]);
  assert.equal(datos.clasificacion_inversionista, '204');
  assert.equal(datos.clasificacion_fuente, 'determinacion_asesor');
  assert.match(String(datos.clasificacion_fecha), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(datos.clasificacion_nota, VALIDO.nota);
  assert.deepEqual(filtros, [
    ['eq', 'codigo_cliente', 'PRUEBA-001'],
    ['or', 'clasificacion_fuente.is.null,clasificacion_fuente.eq.determinacion_asesor'],
  ]);

  assert.equal(registro.eventos.length, 1);
  const e = registro.eventos[0];
  assert.equal(e.accion, 'determinacion_clasificacion');
  assert.equal(e.entidad, 'clientes');
  assert.equal(e.entidadId, 'PRUEBA-001');
  assert.equal(e.campo, 'clasificacion_inversionista');
  assert.equal(e.valorAnterior, null);
  assert.equal(e.valorNuevo, '204');
  assert.equal(e.motivo, VALIDO.nota);
  assert.equal(e.usuario, 'asesor@prueba.test', 'el usuario sale de la sesión');
});

test('203 se rechaza con 400 y no toca nada: solo viene de carta', async () => {
  const r = await pedir({ ...VALIDO, clasificacion: '203' });
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.error ?? '', /carta/);
  sinEfectos();
  assert.equal(registro.tablas.length, 0, 'ni siquiera lee');
});

for (const [caso, cambio] of [
  ['sin código', { codigo_cliente: '' }],
  ['clasificación fuera del catálogo', { clasificacion: '205' }],
  ['sin nota', { nota: '  ' }],
] as const) {
  test(`${caso}: 400 y no toca nada`, async () => {
    const r = await pedir({ ...VALIDO, ...cambio });
    assert.equal(r.status, 400);
    sinEfectos();
  });
}

test('cuerpo que no es JSON: 400', async () => {
  const r = await pedir('{no json');
  assert.equal(r.status, 400);
  sinEfectos();
});

test('sin sesión: 401 y ni una lectura', async () => {
  registro.usuario = null;
  const r = await pedir(VALIDO);
  assert.equal(r.status, 401);
  assert.equal(registro.tablas.length, 0);
});

test('el cliente no existe: 404', async () => {
  registro.cliente = null;
  const r = await pedir(VALIDO);
  assert.equal(r.status, 404);
  sinEfectos();
});

test('un 203 por carta no se sobrescribe: 409', async () => {
  registro.cliente = { codigo_cliente: 'PRUEBA-001', clasificacion_inversionista: '203', clasificacion_fuente: 'carta_firmada' };
  const r = await pedir(VALIDO);
  assert.equal(r.status, 409);
  assert.match(r.cuerpo.error ?? '', /carta/);
  sinEfectos();
});

test('cambiar una determinación previa sí se permite, y la bitácora guarda el valor anterior', async () => {
  registro.cliente = { codigo_cliente: 'PRUEBA-001', clasificacion_inversionista: '202', clasificacion_fuente: 'determinacion_asesor' };
  const r = await pedir(VALIDO);
  assert.equal(r.status, 200);
  assert.equal(registro.eventos[0].valorAnterior, '202');
  assert.equal(registro.eventos[0].metadata?.fuente_anterior, 'determinacion_asesor');
});

test('la carrera: si la carta llegó entre la lectura y el UPDATE, 409 y sin bitácora', async () => {
  registro.guardado = null;
  const r = await pedir(VALIDO);
  assert.equal(r.status, 409);
  assert.equal(registro.eventos.length, 0);
});

test('la base rechaza por CHECK (23514): 400, no 500', async () => {
  registro.errorGuardado = { code: '23514', message: 'violates check constraint' };
  const r = await pedir(VALIDO);
  assert.equal(r.status, 400);
  assert.equal(registro.eventos.length, 0);
});

test('cualquier otro error al guardar: 500 genérico', async () => {
  registro.errorGuardado = { code: '57014', message: 'detalle interno' };
  const r = await pedir(VALIDO);
  assert.equal(r.status, 500);
  assert.doesNotMatch(r.cuerpo.error ?? '', /detalle interno/);
});
