/**
 * /api/ips-masivo · la puerta, la selección y el stream.
 *
 * Lo que se prueba es la decisión de la ruta: que sin la palabra escrita no
 * toque nada, que el orden de los eventos NDJSON sea el que la UI espera, y que
 * el enriquecimiento del resumen —ajuste_manual, por_codigo_error— aguante el
 * caso en que el orquestador entrega un resultado mínimo.
 *
 * Supabase y el runner se sustituyen. El ORQUESTADOR NO: `correrLote` corre de
 * verdad, porque el orden de los eventos y el resumen son suyos y sustituirlo
 * dejaría el test probando el mock.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { NextRequest } from 'next/server';

import { PERFILES } from '@/lib/ips-catalogo';
import type { ResultadoIPSDetallado } from '@/lib/ips-runner';

type Fila = Record<string, unknown>;

const registro = vi.hoisted(() => ({
  /** Se pone en true en cuanto la ruta pide un cliente de Supabase. */
  createClientLlamado: false,
  authLlamado: false,
  tablas: [] as string[],
  filtroVigente: false,
  usuario: null as { id: string; email?: string } | null,
  codigos: [] as string[],
  errorClientes: false,
  runner: (codigo: string): Promise<unknown> =>
    Promise.resolve({ codigo_cliente: codigo, ok: true, grado: 'Alto' }),
}));

vi.mock('@/lib/supabase-server', () => ({
  createClient: async () => {
    registro.createClientLlamado = true;
    return {
      auth: {
        getUser: async () => {
          registro.authLlamado = true;
          return { data: { user: registro.usuario }, error: null };
        },
      },
      from: (tabla: string) => {
        registro.tablas.push(tabla);
        const q = {
          select: () => q,
          eq: () => {
            registro.filtroVigente = true;
            return q;
          },
          order: async () => ({
            data: registro.errorClientes
              ? null
              : registro.codigos.map((c) => ({ codigo_cliente: c })),
            error: registro.errorClientes ? { message: 'fallo simulado' } : null,
          }),
        };
        return q;
      },
    };
  },
}));

vi.mock('@/lib/ips-runner', () => ({
  calcularYGuardarIPS: (codigo: string) => registro.runner(codigo),
}));

import { POST } from './route';

/** Resultado ok del runner, con lo que el resumen necesita. */
const ok = (
  codigo: string,
  grado: string,
  anterior: string | null = grado,
  ajuste_manual = false,
): ResultadoIPSDetallado =>
  ({
    codigo_cliente: codigo,
    ok: true,
    grado,
    grado_anterior: anterior,
    puntaje: 2.4,
    campos_faltantes: [],
    evaluacion_id: `perfil-${codigo}`,
    ajuste_manual,
    payload: { codigo_cliente: codigo },
  }) as ResultadoIPSDetallado;

const falla = (codigo: string, codigo_error: string): ResultadoIPSDetallado =>
  ({
    codigo_cliente: codigo,
    ok: false,
    codigo_error,
    error: 'no se pudo',
  }) as ResultadoIPSDetallado;

beforeEach(() => {
  registro.createClientLlamado = false;
  registro.authLlamado = false;
  registro.tablas = [];
  registro.filtroVigente = false;
  registro.usuario = { id: 'u-1', email: 'asesor@prueba.test' };
  registro.codigos = ['PRUEBA-A', 'PRUEBA-B', 'PRUEBA-C'];
  registro.errorClientes = false;
  registro.runner = async (codigo) => ok(codigo, 'Alto');
});

async function correr(body: unknown) {
  const res = await POST(
    new Request('http://localhost/api/ips-masivo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // `NextRequest` extiende `Request`: la ruta solo usa .json() y .signal.
    }) as unknown as NextRequest,
  );
  return res;
}

/** Lee el NDJSON completo y devuelve los eventos ya parseados. */
async function eventosDe(res: Response) {
  const texto = await res.text();
  return texto
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Fila);
}

// ---------------------------------------------------------------------------
// 1 · La puerta
// ---------------------------------------------------------------------------

test('sin confirmación: 428 y la ruta no pide sesión ni toca la base', async () => {
  const res = await correr({});

  assert.equal(res.status, 428);
  const cuerpo = (await res.json()) as Fila;
  assert.match(cuerpo.error as string, /CALCULAR/);

  assert.equal(registro.createClientLlamado, false, 'no debe crear cliente de Supabase');
  assert.equal(registro.authLlamado, false, 'no debe consultar la sesión');
  assert.deepEqual(registro.tablas, [], 'no debe leer ninguna tabla');
});

test('la palabra del EBR no sirve aquí: EVALUAR da 428', async () => {
  const res = await correr({ confirmacion: 'EVALUAR' });
  assert.equal(res.status, 428);
  assert.equal(registro.createClientLlamado, false);
});

test('minúsculas o espacios no pasan la puerta', async () => {
  for (const palabra of ['calcular', ' CALCULAR', 'CALCULAR ', 'CALCULAR!']) {
    const res = await correr({ confirmacion: palabra });
    assert.equal(res.status, 428, `«${palabra}» no debe autorizar`);
  }
});

// ---------------------------------------------------------------------------
// 2 · Sesión y selección
// ---------------------------------------------------------------------------

test('sin usuario: 401', async () => {
  registro.usuario = null;
  const res = await correr({ confirmacion: 'CALCULAR' });

  assert.equal(res.status, 401);
  assert.equal((((await res.json()) as Fila).error as string), 'No autenticado');
  assert.deepEqual(registro.tablas, [], 'no llega a leer clientes');
});

test('alcance "seleccion" sin códigos: 400', async () => {
  const res = await correr({ confirmacion: 'CALCULAR', alcance: 'seleccion', codigos: [] });

  assert.equal(res.status, 400);
  assert.match(((await res.json()) as Fila).error as string, /seleccion/);
  assert.deepEqual(registro.tablas, [], 'con selección explícita no lee la cartera');
});

test('alcance "vigentes" filtra por status; "todos" no', async () => {
  await correr({ confirmacion: 'CALCULAR', alcance: 'vigentes' });
  assert.equal(registro.filtroVigente, true);

  registro.filtroVigente = false;
  registro.tablas = [];
  await correr({ confirmacion: 'CALCULAR', alcance: 'todos' });
  assert.equal(registro.filtroVigente, false);
  assert.deepEqual(registro.tablas, ['clientes']);
});

test('cartera vacía: 400 y no arranca lote', async () => {
  registro.codigos = [];
  const res = await correr({ confirmacion: 'CALCULAR' });
  assert.equal(res.status, 400);
});

test('si falla la lectura de clientes: 500', async () => {
  registro.errorClientes = true;
  const res = await correr({ confirmacion: 'CALCULAR' });
  assert.equal(res.status, 500);
});

// ---------------------------------------------------------------------------
// 3 · El stream
// ---------------------------------------------------------------------------

test('flujo feliz: inicio → un avance por cliente → resumen, en ese orden', async () => {
  const res = await correr({ confirmacion: 'CALCULAR' });

  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/x-ndjson/);
  assert.equal(res.headers.get('cache-control'), 'no-store, no-transform');
  assert.equal(res.headers.get('x-accel-buffering'), 'no');

  const eventos = await eventosDe(res);
  assert.deepEqual(
    eventos.map((e) => e.tipo),
    ['inicio', 'avance', 'avance', 'avance', 'resumen'],
  );

  // El lote se identifica con el prefijo del IPS, no con el del EBR.
  for (const e of eventos) {
    assert.match(e.lote_id as string, /^ips-/, 'lote_id debe llevar prefijo ips-');
  }

  assert.equal(eventos[0].total, 3);
  assert.deepEqual(
    eventos.slice(1, 4).map((e) => e.indice),
    [1, 2, 3],
  );
});

test('el resumen trae ajuste_manual, por_codigo_error, cambios y los 4 perfiles', async () => {
  registro.runner = async (codigo) => {
    if (codigo === 'PRUEBA-A') return ok(codigo, 'Bajo', 'Moderado', true); // cambió y trae ajuste
    if (codigo === 'PRUEBA-B') return falla(codigo, 'sin_cuestionario');
    return ok(codigo, 'Alto', 'Alto'); // sin cambio
  };

  const eventos = await eventosDe(await correr({ confirmacion: 'CALCULAR' }));
  const resumen = eventos.at(-1)!.resumen as Fila;

  assert.equal(resumen.ok, 2);
  assert.equal(resumen.fallidos, 1);

  assert.deepEqual(resumen.ajuste_manual, ['PRUEBA-A']);
  assert.deepEqual(resumen.por_codigo_error, { sin_cuestionario: ['PRUEBA-B'] });
  assert.deepEqual(resumen.cambios, [
    { codigo_cliente: 'PRUEBA-A', de: 'Moderado', a: 'Bajo' },
  ]);

  // Distribución sembrada con los cuatro perfiles: un perfil sin ocurrencias
  // aparece en 0 y no falta.
  assert.deepEqual(Object.keys(resumen.por_grado as Fila).sort(), [...PERFILES].sort());
  assert.deepEqual(resumen.por_grado, { Alto: 1, Moderado: 0, Bajo: 1, 'Libre de Riesgo': 0 });
});

test('un fallo sin ajuste no se cuenta como ajuste manual', async () => {
  registro.runner = async (codigo) => falla(codigo, 'datos_bloqueantes');
  const eventos = await eventosDe(await correr({ confirmacion: 'CALCULAR' }));
  const resumen = eventos.at(-1)!.resumen as Fila;

  assert.deepEqual(resumen.ajuste_manual, []);
  assert.deepEqual(resumen.por_codigo_error, {
    datos_bloqueantes: ['PRUEBA-A', 'PRUEBA-B', 'PRUEBA-C'],
  });
  // Agrupados, no repetidos: tres en una llave es lo que delata un bug del motor.
  assert.equal((resumen.por_codigo_error as Record<string, string[]>).datos_bloqueantes.length, 3);
});

// ---------------------------------------------------------------------------
// 4 · El resultado mínimo del orquestador
// ---------------------------------------------------------------------------

/**
 * Cuando una evaluación revienta o se cuelga, el orquestador NO propaga el
 * resultado del runner: fabrica uno mínimo —codigo_cliente, ok:false, error—
 * SIN `codigo_error` ni bandera de ajuste. Un timeout produce exactamente esa
 * misma forma; aquí se provoca con una excepción porque esperar los 20 s reales
 * del timeout no agrega nada que este caso no cubra.
 *
 * Si el enriquecimiento del resumen asumiera que `codigo_error` siempre viene,
 * aquí aparecería una llave `undefined`.
 */
test('un resultado mínimo cae en "motor" y no rompe el resumen', async () => {
  registro.runner = async (codigo) => {
    if (codigo === 'PRUEBA-B') throw new Error('el runner reventó');
    return ok(codigo, 'Alto');
  };

  const eventos = await eventosDe(await correr({ confirmacion: 'CALCULAR' }));
  const resumen = eventos.at(-1)!.resumen as Fila;

  assert.equal(resumen.ok, 2);
  assert.equal(resumen.fallidos, 1);
  assert.deepEqual(resumen.por_codigo_error, { motor: ['PRUEBA-B'] });
  assert.ok(
    !Object.keys(resumen.por_codigo_error as Fila).includes('undefined'),
    'ninguna llave puede ser «undefined»',
  );

  // El avance del que falló llegó igual, para que la UI lo liste.
  const avanceB = eventos.find(
    (e) => e.tipo === 'avance' && (e.resultado as Fila).codigo_cliente === 'PRUEBA-B',
  );
  assert.ok(avanceB);
  assert.equal(((avanceB.resultado as Fila).ok), false);
});

// ---------------------------------------------------------------------------
// 5 · El lote entero cae
// ---------------------------------------------------------------------------

/**
 * Se provoca con un resultado que no se puede serializar: es la forma más
 * cercana a «algo se rompió a media escritura del stream». Una conexión caída
 * sale por el mismo `catch`.
 */
test('si el lote entero cae, el último evento es fatal con el lote_id', async () => {
  registro.runner = async (codigo) => {
    const r = ok(codigo, 'Alto') as Fila;
    r.circular = r; // JSON.stringify lanza al serializarlo
    return r as unknown as ResultadoIPSDetallado;
  };

  const eventos = await eventosDe(await correr({ confirmacion: 'CALCULAR' }));
  const ultimo = eventos.at(-1)!;

  assert.equal(ultimo.tipo, 'fatal');
  assert.match(ultimo.lote_id as string, /^ips-/);
  assert.equal(typeof ultimo.error, 'string');
  // No se presenta un resumen: el lote no terminó.
  assert.equal(
    eventos.some((e) => e.tipo === 'resumen'),
    false,
  );
});
