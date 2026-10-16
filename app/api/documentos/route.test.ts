/**
 * POST /api/documentos · sesión primero, validación antes de subir, subida sin
 * sobrescribir, una sola llamada a fn_registrar_documento y borrado de
 * compensación si el registro falla.
 *
 * Supabase y el bucket se sustituyen: lo que se prueba es la decisión de la
 * ruta. Lo que la función hace por dentro (modos de la carta, CHECK, bitácora,
 * espejo) se probó contra Postgres: ver
 * migraciones/2026-10-14-documentos-expediente.sql.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { afterEach, beforeEach, test, vi, type MockInstance } from 'vitest';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

type Llamada = { op: string; args: unknown[] };

const registro = vi.hoisted(() => ({
  usuario: null as { id: string; email?: string } | null,
  llamadas: [] as Llamada[],
  errorRpc: null as { code: string; message: string } | null,
  errorSubida: null as { statusCode?: string; message: string } | null,
  existente: null as Uint8Array<ArrayBuffer> | null,
  errorBorrado: null as { message: string } | null,
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
        data: { documento_id: 'doc-1', modo: 'adjuntar', ruta_storage: args.p_ruta_storage },
        error: null,
      };
    },
  }),
}));

vi.mock('@/lib/supabase-admin', () => ({
  bucketExpediente: () => {
    registro.llamadas.push({ op: 'bucket', args: [] });
    return {
      upload: async (...args: unknown[]) => {
        registro.llamadas.push({ op: 'upload', args });
        return { data: registro.errorSubida ? null : {}, error: registro.errorSubida };
      },
      download: async (...args: unknown[]) => {
        registro.llamadas.push({ op: 'download', args });
        return { data: new Blob([registro.existente ?? new Uint8Array()]), error: null };
      },
      remove: async (...args: unknown[]) => {
        registro.llamadas.push({ op: 'remove', args });
        return { data: null, error: registro.errorBorrado };
      },
    };
  },
}));

import { POST } from './route';

let fetchEspia: MockInstance<typeof fetch>;
let errorEspia: MockInstance<typeof console.error>;

beforeEach(() => {
  registro.usuario = { id: 'u-1', email: 'asesor@prueba.test' };
  registro.llamadas = [];
  registro.errorRpc = null;
  registro.errorSubida = null;
  registro.existente = null;
  registro.errorBorrado = null;
  fetchEspia = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('documentos no debe llamar a la red');
  });
  errorEspia = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  fetchEspia.mockRestore();
  errorEspia.mockRestore();
});

const PDF = new TextEncoder().encode('%PDF-1.7\ncarta sintética\n%%EOF');
const SHA = createHash('sha256').update(PDF).digest('hex');
const RUTA = `carta_clasificacion/CSPFU9001/2026-10-13_${SHA.slice(0, 12)}.pdf`;

function formulario(campos: Record<string, string>, archivo: Uint8Array<ArrayBuffer> | null = PDF) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  if (archivo) {
    // Un nombre con persona: no debe llegar a ningún lado.
    fd.set('archivo', new File([archivo], 'Carta Nombre Apellido.pdf', { type: 'application/pdf' }));
  }
  return fd;
}

const CARTA = { codigo_cliente: 'CSPFU9001', tipo: 'carta_clasificacion', fecha_documento: '2026-10-13' };

async function pedir(body: FormData | string) {
  const res = await POST(
    new Request('http://localhost/api/documentos', {
      method: 'POST',
      ...(typeof body === 'string' ? { headers: { 'Content-Type': 'application/json' } } : {}),
      body,
    }),
  );
  return { status: res.status, cuerpo: (await res.json()) as Record<string, unknown> & { error?: string } };
}

const ops = () => registro.llamadas.map((l) => l.op);
const llamada = (op: string) => registro.llamadas.find((l) => l.op === op);
const sinStorageNiRpc = () => {
  assert.deepEqual(
    ops().filter((o) => o !== 'getUser'),
    [],
    'no tocó Storage ni la función',
  );
};

// ---------------------------------------------------------------------------
// Sesión y entrada
// ---------------------------------------------------------------------------

test('sin sesión: 401 y no toca Storage ni la función', async () => {
  registro.usuario = null;
  const r = await pedir(formulario(CARTA));
  assert.equal(r.status, 401);
  sinStorageNiRpc();
});

test('cuerpo que no es multipart: 400', async () => {
  const r = await pedir(JSON.stringify(CARTA));
  assert.equal(r.status, 400);
  sinStorageNiRpc();
});

test('sin archivo: 400', async () => {
  const r = await pedir(formulario(CARTA, null));
  assert.equal(r.status, 400);
  sinStorageNiRpc();
});

test('más de 4 MB: 413 sin subir nada', async () => {
  const grande = new Uint8Array(4194305);
  grande.set(PDF);
  const r = await pedir(formulario(CARTA, grande));
  assert.equal(r.status, 413);
  sinStorageNiRpc();
});

for (const [caso, campos, archivo] of [
  ['no es PDF', CARTA, new TextEncoder().encode('MZ ejecutable disfrazado')],
  ['tipo inventado', { ...CARTA, tipo: 'pasaporte' }, PDF],
  ['carta sin fecha', { ...CARTA, fecha_documento: '' }, PDF],
  ['fecha futura', { ...CARTA, fecha_documento: '2099-01-01' }, PDF],
  ['código con forma inválida', { ...CARTA, codigo_cliente: 'LEAD-35554' }, PDF],
  ['reemplaza_a que no es uuid', { ...CARTA, reemplaza_a: 'abc' }, PDF],
] as const) {
  test(`${caso}: 400 sin subir nada`, async () => {
    const r = await pedir(formulario({ ...campos }, archivo));
    assert.equal(r.status, 400);
    assert.equal(typeof r.cuerpo.error, 'string');
    sinStorageNiRpc();
  });
}

// ---------------------------------------------------------------------------
// Flujo feliz
// ---------------------------------------------------------------------------

test('flujo feliz: sesión, subida sin sobrescribir y UNA llamada a la función', async () => {
  const r = await pedir(formulario({ ...CARTA, subido_por: 'impostor@prueba.test' }));
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.ok, true);

  assert.deepEqual(ops(), ['getUser', 'bucket', 'upload', 'rpc']);
  assert.equal(fetchEspia.mock.calls.length, 0);

  const [ruta, bytes, opciones] = llamada('upload')!.args as [string, Uint8Array, Record<string, unknown>];
  assert.equal(ruta, RUTA);
  assert.doesNotMatch(ruta, /Nombre|Apellido/);
  assert.deepEqual([...bytes], [...PDF]);
  assert.deepEqual(opciones, { contentType: 'application/pdf', upsert: false });

  const [fn, args] = llamada('rpc')!.args as [string, Record<string, unknown>];
  assert.equal(fn, 'fn_registrar_documento');
  assert.deepEqual(args, {
    p_codigo_cliente: 'CSPFU9001',
    p_tipo: 'carta_clasificacion',
    p_ruta_storage: RUTA,
    p_sha256: SHA,
    p_tamano_bytes: PDF.length,
    p_fecha_documento: '2026-10-13',
    p_reemplaza_a: null,
  });
  assert.equal(JSON.stringify(args).includes('impostor'), false, 'quién sube no se recibe');
});

test('documento sin fecha: ruta sin-fecha y p_fecha_documento null', async () => {
  const r = await pedir(formulario({ codigo_cliente: 'CSPFU9001', tipo: 'contrato', fecha_documento: '' }));
  assert.equal(r.status, 200);
  const [, args] = llamada('rpc')!.args as [string, Record<string, unknown>];
  assert.equal(args.p_fecha_documento, null);
  assert.equal(args.p_ruta_storage, `contrato/CSPFU9001/sin-fecha_${SHA.slice(0, 12)}.pdf`);
});

test('reemplazo: reemplaza_a llega a la función', async () => {
  const id = '0b7c6a52-6f43-4f2c-9a3e-1d2c3b4a5f60';
  await pedir(formulario({ ...CARTA, reemplaza_a: id }));
  const [, args] = llamada('rpc')!.args as [string, Record<string, unknown>];
  assert.equal(args.p_reemplaza_a, id);
});

// ---------------------------------------------------------------------------
// Errores de la función: 4xx, compensación
// ---------------------------------------------------------------------------

for (const [code, status] of [
  ['DX400', 400],
  ['DX401', 401],
  ['DX404', 404],
  ['DX409', 409],
] as const) {
  test(`la función responde ${code}: ${status} y se borra el PDF recién subido`, async () => {
    registro.errorRpc = { code, message: 'mensaje de la base' };
    const r = await pedir(formulario(CARTA));
    assert.equal(r.status, status);
    assert.equal(r.cuerpo.error, 'mensaje de la base');
    assert.deepEqual(llamada('remove')?.args, [[RUTA]]);
  });
}

test('un error ajeno es 500 con mensaje genérico, y también se compensa', async () => {
  registro.errorRpc = { code: '57014', message: 'detalle interno' };
  const r = await pedir(formulario(CARTA));
  assert.equal(r.status, 500);
  assert.doesNotMatch(r.cuerpo.error ?? '', /detalle interno/);
  assert.deepEqual(llamada('remove')?.args, [[RUTA]]);
});

test('si el borrado de compensación falla, el log no lleva datos del cliente', async () => {
  registro.errorRpc = { code: 'DX409', message: 'Ese mismo archivo ya está en el expediente.' };
  registro.errorBorrado = { message: 'storage caído' };
  const r = await pedir(formulario(CARTA));
  assert.equal(r.status, 409);
  const logs = errorEspia.mock.calls.map((c) => c.join(' ')).join('\n');
  assert.match(logs, /huérfano/);
  assert.doesNotMatch(logs, /CSPFU9001|carta_clasificacion\//);
});

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

test('fallo de Storage: 502 y no llama a la función', async () => {
  registro.errorSubida = { statusCode: '500', message: 'internal' };
  const r = await pedir(formulario(CARTA));
  assert.equal(r.status, 502);
  assert.equal(llamada('rpc'), undefined);
});

test('la ruta ya existe con el MISMO archivo: se registra y no se borra si falla', async () => {
  registro.errorSubida = { statusCode: '409', message: 'The resource already exists' };
  registro.existente = PDF;
  registro.errorRpc = { code: 'DX409', message: 'Ese mismo archivo ya está en el expediente.' };
  const r = await pedir(formulario(CARTA));
  assert.equal(r.status, 409);
  assert.deepEqual(ops(), ['getUser', 'bucket', 'upload', 'download', 'rpc']);
  assert.equal(llamada('remove'), undefined, 'el objeto no lo subió esta petición');
});

test('la ruta ya existe con OTRO archivo: 409 y no se registra ni se sobrescribe', async () => {
  registro.errorSubida = { statusCode: '409', message: 'The resource already exists' };
  registro.existente = new TextEncoder().encode('%PDF-1.7\notro\n%%EOF');
  const r = await pedir(formulario(CARTA));
  assert.equal(r.status, 409);
  assert.equal(llamada('rpc'), undefined);
  assert.equal(llamada('remove'), undefined);
});

// ---------------------------------------------------------------------------
// Fuente
// ---------------------------------------------------------------------------

test('la fuente no asienta bitácora (lo hace la función), ni trae correo ni el nombre del archivo', () => {
  const fuente = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(fuente, /registrarEvento\s*\(|from '@\/lib\/bitacora'/);
  assert.doesNotMatch(fuente, /['"`][^'"`\s]+@[^'"`\s]+\.[a-z]{2,}['"`]/i);
  assert.doesNotMatch(fuente, /archivo\.name/);
});
