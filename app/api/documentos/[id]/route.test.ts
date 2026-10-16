/**
 * GET /api/documentos/[id] · sesión primero, asiento de consulta ANTES de firmar,
 * enlace firmado de 60 s y redirección sin caché.
 *
 * Supabase y el bucket se sustituyen. Que fn_registrar_consulta_documento
 * asienta con el usuario de la sesión se probó contra Postgres: ver
 * migraciones/2026-10-14-documentos-expediente.sql.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { afterEach, beforeEach, test, vi, type MockInstance } from 'vitest';
import assert from 'node:assert/strict';

type Llamada = { op: string; args: unknown[] };

const registro = vi.hoisted(() => ({
  usuario: null as { id: string; email?: string } | null,
  llamadas: [] as Llamada[],
  errorRpc: null as { code: string; message: string } | null,
  errorFirma: null as { message: string } | null,
}));

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => {
        registro.llamadas.push({ op: 'getUser', args: [] });
        return { data: { user: registro.usuario } };
      },
    },
    from: (tabla: string) => {
      throw new Error(`documentos no debe tocar ${tabla} directamente`);
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      registro.llamadas.push({ op: 'rpc', args: [fn, args] });
      if (registro.errorRpc) return { data: null, error: registro.errorRpc };
      return {
        data: {
          documento_id: args.p_documento_id,
          codigo_cliente: 'CSPFU9001',
          tipo: 'carta_clasificacion',
          ruta_storage: 'carta_clasificacion/CSPFU9001/2026-10-13_0123456789ab.pdf',
        },
        error: null,
      };
    },
  }),
}));

vi.mock('@/lib/supabase-admin', () => ({
  bucketExpediente: () => {
    registro.llamadas.push({ op: 'bucket', args: [] });
    return {
      createSignedUrl: async (...args: unknown[]) => {
        registro.llamadas.push({ op: 'createSignedUrl', args });
        return registro.errorFirma
          ? { data: null, error: registro.errorFirma }
          : { data: { signedUrl: 'https://almacen.prueba.test/firmado?token=t' }, error: null };
      },
    };
  },
}));

import { GET } from './route';

let errorEspia: MockInstance<typeof console.error>;

beforeEach(() => {
  registro.usuario = { id: 'u-1', email: 'asesor@prueba.test' };
  registro.llamadas = [];
  registro.errorRpc = null;
  registro.errorFirma = null;
  errorEspia = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorEspia.mockRestore();
});

const ID = '0b7c6a52-6f43-4f2c-9a3e-1d2c3b4a5f60';

async function pedir(id: string) {
  return GET(new Request(`http://localhost/api/documentos/${id}`), {
    params: Promise.resolve({ id }),
  });
}

const ops = () => registro.llamadas.map((l) => l.op);

test('id que no es uuid: 400 sin tocar nada', async () => {
  const res = await pedir('../../etc');
  assert.equal(res.status, 400);
  assert.deepEqual(ops(), []);
});

test('sin sesión: 401, sin asiento y sin tocar el cliente admin', async () => {
  registro.usuario = null;
  const res = await pedir(ID);
  assert.equal(res.status, 401);
  assert.deepEqual(ops(), ['getUser']);
});

test('flujo feliz: asiento ANTES de firmar, enlace de 60 s y 302 sin caché', async () => {
  const res = await pedir(ID);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://almacen.prueba.test/firmado?token=t');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');

  assert.deepEqual(ops(), ['getUser', 'rpc', 'bucket', 'createSignedUrl']);
  const rpc = registro.llamadas.find((l) => l.op === 'rpc')!;
  assert.deepEqual(rpc.args, ['fn_registrar_consulta_documento', { p_documento_id: ID }]);
  const firma = registro.llamadas.find((l) => l.op === 'createSignedUrl')!;
  assert.deepEqual(firma.args, ['carta_clasificacion/CSPFU9001/2026-10-13_0123456789ab.pdf', 60]);
});

for (const [code, status] of [
  ['DX401', 401],
  ['DX404', 404],
] as const) {
  test(`la consulta responde ${code}: ${status} y no se emite enlace`, async () => {
    registro.errorRpc = { code, message: 'mensaje de la base' };
    const res = await pedir(ID);
    assert.equal(res.status, status);
    assert.equal(ops().includes('createSignedUrl'), false);
    assert.equal(ops().includes('bucket'), false);
  });
}

test('un error ajeno en la consulta es 500 con mensaje genérico', async () => {
  registro.errorRpc = { code: '57014', message: 'detalle interno' };
  const res = await pedir(ID);
  assert.equal(res.status, 500);
  const cuerpo = (await res.json()) as { error: string };
  assert.doesNotMatch(cuerpo.error, /detalle interno/);
  assert.equal(ops().includes('createSignedUrl'), false);
});

test('si Storage no firma: 502 (la consulta ya quedó asentada)', async () => {
  registro.errorFirma = { message: 'Object not found' };
  const res = await pedir(ID);
  assert.equal(res.status, 502);
  assert.deepEqual(ops(), ['getUser', 'rpc', 'bucket', 'createSignedUrl']);
  const logs = errorEspia.mock.calls.map((c) => c.join(' ')).join('\n');
  assert.doesNotMatch(logs, /CSPFU9001/);
});
