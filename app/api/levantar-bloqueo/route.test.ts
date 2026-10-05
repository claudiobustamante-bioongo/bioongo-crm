/**
 * /api/levantar-bloqueo · firma obligatoria, autorización del Oficial cuando
 * firma el asesor, firmante de sesión y errores de la función.
 *
 * Supabase y la bitácora se sustituyen: lo que se prueba es la decisión de la
 * ruta. Lo que la función hace por dentro (firma y levantamiento todo o nada,
 * espejo, CHECK del asesor) se probó contra Postgres: ver
 * migraciones/2026-10-05-bloqueo-y-firma.sql.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { afterEach, beforeEach, test, vi, type MockInstance } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { EventoBitacora } from '@/lib/bitacora';

type Fila = Record<string, unknown>;

const registro = vi.hoisted(() => ({
  usuario: null as { id: string; email?: string } | null,
  tablas: [] as string[],
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  errorRpc: null as { code: string; message: string } | null,
  eventos: [] as EventoBitacora[],
}));

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: registro.usuario } }) },
    from: (tabla: string) => {
      registro.tablas.push(tabla);
      throw new Error(`levantar-bloqueo no debe tocar ${tabla} directamente`);
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      registro.rpcs.push({ fn, args });
      if (registro.errorRpc) return { data: null, error: registro.errorRpc };
      return {
        data: {
          bloqueo_id: args.p_bloqueo_id,
          codigo_cliente: 'PRUEBA-001',
          levantado_por: 'oficial@prueba.test',
          rol: args.p_rol,
          firma_id: 'firma-9',
          autorizacion_oficial: args.p_autorizacion_oficial,
        },
        error: null,
      };
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

let fetchEspia: MockInstance<typeof fetch>;

beforeEach(() => {
  registro.usuario = { id: 'u-1', email: 'oficial@prueba.test' };
  registro.tablas = [];
  registro.rpcs = [];
  registro.errorRpc = null;
  registro.eventos = [];
  fetchEspia = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('levantar-bloqueo no debe llamar a la red');
  });
});

afterEach(() => {
  fetchEspia.mockRestore();
});

const OFICIAL = {
  bloqueo_id: 'bloqueo-1',
  motivo: 'Homonimia acreditada con CURP y fecha de nacimiento.',
  rol: 'oficial_cumplimiento',
  declaracion: 'Revisé la evidencia y asumo el levantamiento.',
};

async function pedir(body: unknown) {
  const res = await POST(
    new Request('http://localhost/api/levantar-bloqueo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
  return { status: res.status, cuerpo: (await res.json()) as Fila & { error?: string } };
}

const sinEfectos = () => {
  assert.equal(registro.rpcs.length, 0, 'no llamó a la función');
  assert.equal(registro.eventos.length, 0, 'no asentó bitácora');
};

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

test('cuerpo que no es JSON: 400', async () => {
  const r = await pedir('{no json');
  assert.equal(r.status, 400);
  sinEfectos();
});

test('sin bloqueo_id: 400', async () => {
  const r = await pedir({ ...OFICIAL, bloqueo_id: '' });
  assert.equal(r.status, 400);
  sinEfectos();
});

test('sin motivo: 400', async () => {
  const r = await pedir({ ...OFICIAL, motivo: '   ' });
  assert.equal(r.status, 400);
  sinEfectos();
});

for (const [caso, cambio] of [
  ['sin rol', { rol: undefined }],
  ['rol inventado', { rol: 'director' }],
  ['sin declaración', { declaracion: '' }],
] as const) {
  test(`${caso}: 400 y no toca nada`, async () => {
    const r = await pedir({ ...OFICIAL, ...cambio });
    assert.equal(r.status, 400);
    assert.match(r.cuerpo.error ?? '', /firma/i);
    sinEfectos();
  });
}

// ---------------------------------------------------------------------------
// La regla del asesor (5-oct-2026)
// ---------------------------------------------------------------------------

for (const autorizacion_oficial of [undefined, '', '   ']) {
  test(`asesor sin autorización del Oficial (${JSON.stringify(autorizacion_oficial)}): 400`, async () => {
    const r = await pedir({ ...OFICIAL, rol: 'asesor', autorizacion_oficial });
    assert.equal(r.status, 400);
    assert.match(r.cuerpo.error ?? '', /autorizacion_oficial/);
    sinEfectos();
  });
}

test('asesor con autorización: llega a la función recortada y queda en la bitácora', async () => {
  const r = await pedir({
    ...OFICIAL,
    rol: 'asesor',
    autorizacion_oficial: '  Oficial X, 05-10-2026, por correo.  ',
  });
  assert.equal(r.status, 200);
  assert.equal(registro.rpcs[0].args.p_rol, 'asesor');
  assert.equal(registro.rpcs[0].args.p_autorizacion_oficial, 'Oficial X, 05-10-2026, por correo.');
  assert.match(registro.eventos[0].motivo, /Autorización del Oficial: Oficial X/);
});

test('Oficial sin autorización: se acepta y la función recibe null', async () => {
  const r = await pedir(OFICIAL);
  assert.equal(r.status, 200);
  assert.equal(registro.rpcs[0].args.p_autorizacion_oficial, null);
});

// ---------------------------------------------------------------------------
// Sesión, firmante y escritura
// ---------------------------------------------------------------------------

test('sin sesión: 401 y no llama a la función', async () => {
  registro.usuario = null;
  const r = await pedir(OFICIAL);
  assert.equal(r.status, 401);
  sinEfectos();
});

test('flujo feliz: una sola llamada a fn_levantar_bloqueo, sin tocar tablas ni la red', async () => {
  const r = await pedir({ ...OFICIAL, firmante: 'impostor@prueba.test' });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.ok, true);

  assert.equal(registro.tablas.length, 0);
  assert.equal(fetchEspia.mock.calls.length, 0);
  assert.equal(registro.rpcs.length, 1);
  assert.equal(registro.rpcs[0].fn, 'fn_levantar_bloqueo');
  assert.deepEqual(Object.keys(registro.rpcs[0].args).sort(), [
    'p_autorizacion_oficial',
    'p_bloqueo_id',
    'p_declaracion',
    'p_motivo',
    'p_rol',
  ]);
  assert.equal(JSON.stringify(registro.rpcs[0].args).includes('impostor'), false);

  assert.deepEqual(r.cuerpo.bloqueo, {
    id: 'bloqueo-1',
    codigo_cliente: 'PRUEBA-001',
    levantado_por: 'oficial@prueba.test',
  });

  assert.equal(registro.eventos.length, 1);
  const e = registro.eventos[0];
  assert.equal(e.accion, 'levantamiento_bloqueo');
  assert.equal(e.entidad, 'cliente_bloqueos');
  assert.equal(e.entidadId, 'PRUEBA-001', 'mismo entidad_id que trg_bitacora');
  assert.equal(e.usuario, 'oficial@prueba.test');
  assert.match(e.motivo, /Firmó oficial@prueba\.test como oficial_cumplimiento/);
});

test('la fuente de la ruta no trae firmante constante ni correo escrito a mano', () => {
  const fuente = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(fuente, /p_firmante|firmante\s*:\s*['"`]/);
  assert.doesNotMatch(fuente, /['"`][^'"`\s]+@[^'"`\s]+\.[a-z]{2,}['"`]/i);
});

// ---------------------------------------------------------------------------
// Errores de la función: 4xx, nunca 500
// ---------------------------------------------------------------------------

for (const [code, status] of [
  ['BL400', 400],
  ['BL401', 401],
  ['BL404', 404],
  ['BL409', 409],
] as const) {
  test(`la función responde ${code}: la ruta da ${status} y no asienta bitácora`, async () => {
    registro.errorRpc = { code, message: 'mensaje de la base' };
    const r = await pedir(OFICIAL);
    assert.equal(r.status, status);
    assert.equal(typeof r.cuerpo.error, 'string');
    assert.equal(registro.eventos.length, 0);
  });
}

test('un error ajeno a la firma sí es 500, con mensaje genérico', async () => {
  registro.errorRpc = { code: '57014', message: 'detalle interno' };
  const r = await pedir(OFICIAL);
  assert.equal(r.status, 500);
  assert.doesNotMatch(r.cuerpo.error ?? '', /detalle interno/);
});
