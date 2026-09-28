/**
 * /api/calcular-ips · la FORMA de la respuesta, en éxito y en cada error.
 *
 * Este test no prueba el motor IPS —de eso vive el motor y sus propios casos—
 * sino el contrato entre la ruta y `app/cliente/[codigo]/CalcularIPS.tsx`, que
 * lee `datos.error` y `datos.perfilCalculado` de una manera concreta. El motor
 * puede quedar idéntico y la ficha romperse igual si el refactor mueve una
 * llave o un código HTTP. Esto es lo que protege el refactor a envoltura.
 *
 * Supabase y la bitácora se sustituyen: lo que se prueba es la decisión de la
 * ruta, no la base.
 *
 * DATOS SINTÉTICOS. Ningún nombre, RFC, CURP ni codigo_cliente real: este
 * archivo se commitea. Las respuestas del cuestionario sí son las cadenas
 * reales del catálogo, porque con otras el motor no clasificaría igual.
 *
 * El reloj se congela: el motor deriva la fase de la edad con `new Date()` por
 * default, y sin congelarlo el mismo expediente cambia de fase con el
 * calendario.
 *
 * Se corre con vitest:
 *   npm test
 */

import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

import type { EventoBitacora } from '@/lib/bitacora';

const HOY = new Date('2026-09-28T12:00:00.000Z');

type Fila = Record<string, unknown>;

/** Una cadena de PostgREST mínima. `then` la hace esperable, que es como la ruta espera el UPDATE. */
interface Cadena {
  select: () => Cadena;
  eq: (columna?: string, valor?: unknown) => Cadena;
  order: () => Cadena;
  limit: () => Cadena;
  update: (valores: Fila) => Cadena;
  maybeSingle: () => Promise<{ data: Fila | null; error: unknown }>;
  then: (resolver: (v: { error: unknown }) => unknown) => Promise<unknown>;
}

/** Lo que la ruta encuentra y lo que hizo. Se reconfigura en cada caso. */
const registro = vi.hoisted(() => ({
  usuario: null as { id: string; email?: string } | null,
  cliente: null as Record<string, unknown> | null,
  perfil: null as Record<string, unknown> | null,
  errorCliente: false,
  errorPerfil: false,
  errorUpdate: false,
  tablas: [] as string[],
  updates: [] as { tabla: string; valores: Record<string, unknown>; filtro: { columna?: string; valor?: unknown } | null }[],
  eventos: [] as EventoBitacora[],
}));

vi.mock('@/lib/supabase-server', () => {
  function consulta(tabla: string): Cadena {
    let entrada: (typeof registro.updates)[number] | null = null;

    const q: Cadena = {
      select: () => q,
      eq: (columna?: string, valor?: unknown) => {
        // Solo interesa el filtro del UPDATE: la ruta actualiza por `id` y no
        // por `codigo_cliente` a propósito.
        if (entrada) entrada.filtro = { columna, valor };
        return q;
      },
      order: () => q,
      limit: () => q,
      update: (valores: Record<string, unknown>) => {
        entrada = { tabla, valores, filtro: null };
        registro.updates.push(entrada);
        return q;
      },
      maybeSingle: async () => {
        if (tabla === 'clientes') {
          if (registro.errorCliente) return { data: null, error: { message: 'fallo simulado' } };
          return { data: registro.cliente, error: null };
        }
        if (registro.errorPerfil) return { data: null, error: { message: 'fallo simulado' } };
        return { data: registro.perfil, error: null };
      },
      then: (resolver) =>
        Promise.resolve(
          entrada && registro.errorUpdate
            ? { error: { message: 'fallo simulado' } }
            : { error: null },
        ).then(resolver),
    };

    return q;
  }

  return {
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: registro.usuario } }) },
      from: (tabla: string) => {
        registro.tablas.push(tabla);
        return consulta(tabla);
      },
    }),
  };
});

vi.mock('@/lib/bitacora', () => ({
  registrarEvento: async (_supabase: unknown, evento: EventoBitacora) => {
    registro.eventos.push(evento);
    return true;
  },
}));

import { POST } from './route';

// ---------------------------------------------------------------------------
// Expedientes sintéticos
// ---------------------------------------------------------------------------

/** Profesionista de 39 años con el cuestionario completo. */
const CLIENTE = {
  nombre: 'Persona',
  apellido_paterno: 'De Prueba',
  apellido_materno: 'Sintetica',
  fecha_nacimiento: '1987-03-15',
  ocupacion: 'Soy Profesionista',
  // Los `numeric` de Postgres llegan como texto: parte de lo que la ruta normaliza.
  ingreso_neto_mensual: '50000',
};

const PERFIL = {
  id: 'perfil-1',
  resultado_perfil: 'Bajo',
  tolerancia_perdida: 'Posibilidad de Ganar +7% y Perder -3%',
  reaccion_caida_10: 'Mantengo mi Posición',
  negocio_propio: 'No',
  percepcion_riesgo_empleo: 'Tal Vez Trabajar para alguien más',
  prefiere_ingreso_seguro: 'De acuerdo',
  no_puede_perder: 'De acuerdo',
  colchon_liquidez: 'Entre 6 meses y 1 año',
  dependientes: 1,
  situacion_habitacional: 'Casa Propia',
  tiene_ahorros: 'Sí',
  ahorros: '100000',
  hipoteca: '0',
  otras_deudas: '0',
  objetivo_inversion: 'Quiero aprovechar las oportunidades de inversión',
  ganancia_deseada: 'de 5.5% a 7.0% anual',
  horizonte: 'Entre 5 y 10 años',
};

/**
 * Jubilada con tres respuestas en null y la contradicción de ahorros que existe
 * en la cartera real: declara no tener ahorros y trae saldo. Se prueba porque
 * un null aquí NO debe leerse como un "no" declarado.
 */
const PERFIL_JUBILADO = {
  ...PERFIL,
  id: 'perfil-2',
  resultado_perfil: null,
  tolerancia_perdida: 'Posibilidad de Ganar +4% y Perder -0%',
  prefiere_ingreso_seguro: null,
  no_puede_perder: null,
  colchon_liquidez: null,
  dependientes: 0,
  tiene_ahorros: 'No',
  ahorros: '25000',
  horizonte: 'Entre 1 y 5 años',
  ganancia_deseada: 'de 4.5% a 5.5% anual',
};

const LLAVES_EXITO = [
  'bitacora',
  'capacidadDesglose',
  'capacidadNivel',
  'capacidadPuntos',
  'codigo_cliente',
  'edad',
  'fase',
  'faseForzadaPorJubilacion',
  'nombreCompleto',
  'perfilCalculado',
  'perfilFinal',
  'puntuacionPonderada',
  'requiereRevisionPEP',
  'toleranciaNivel',
  'toleranciaPuntos',
];

const LLAVES_UPDATE = [
  'bitacora_calculo',
  'capacidad_nivel',
  'capacidad_puntos',
  'fase',
  'fecha_calculo',
  'puntuacion_ponderada',
  'resultado_perfil',
  'tolerancia_nivel',
  'tolerancia_puntos',
];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: HOY });
  registro.usuario = { id: 'u-1', email: 'asesor@prueba.test' };
  registro.cliente = { ...CLIENTE };
  registro.perfil = { ...PERFIL };
  registro.errorCliente = false;
  registro.errorPerfil = false;
  registro.errorUpdate = false;
  registro.tablas = [];
  registro.updates = [];
  registro.eventos = [];
});

afterEach(() => {
  vi.useRealTimers();
});

async function calcular(cuerpo?: unknown) {
  const res = await POST(
    new Request('http://localhost/api/calcular-ips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo ?? { codigo_cliente: 'PRUEBA-001' }),
    }),
  );
  return { status: res.status, cuerpo: (await res.json()) as Fila };
}

// ---------------------------------------------------------------------------
// 1 · Éxito
// ---------------------------------------------------------------------------

test('éxito: 200 con las 15 llaves que la ficha consume, ni una más', async () => {
  const { status, cuerpo } = await calcular();

  assert.equal(status, 200);
  assert.deepEqual(Object.keys(cuerpo).sort(), LLAVES_EXITO);

  assert.equal(cuerpo.codigo_cliente, 'PRUEBA-001');
  assert.equal(cuerpo.nombreCompleto, 'Persona De Prueba Sintetica');
  assert.equal(cuerpo.edad, 39);
  assert.equal(typeof cuerpo.fase, 'string');
  assert.equal(typeof cuerpo.puntuacionPonderada, 'number');
  assert.ok(['Alto', 'Moderado', 'Bajo', 'Libre de Riesgo'].includes(cuerpo.perfilCalculado as string));
  assert.equal(cuerpo.perfilFinal, cuerpo.perfilCalculado);
  assert.equal(typeof cuerpo.requiereRevisionPEP, 'boolean');
  assert.ok(Array.isArray(cuerpo.bitacora) && (cuerpo.bitacora as unknown[]).length > 0);

  // El desglose de capacidad viaja completo: la ficha lo despliega.
  assert.deepEqual(Object.keys(cuerpo.capacidadDesglose as Fila).sort(), [
    'coberturaDeuda',
    'colchon',
    'dependientes',
    'empleo',
    'fase',
    'habitacional',
  ]);
});

test('éxito: escribe una sola vez en perfil_riesgo, por id, con nueve columnas', async () => {
  const { cuerpo } = await calcular();

  assert.equal(registro.updates.length, 1);
  const [update] = registro.updates;
  assert.equal(update.tabla, 'perfil_riesgo');
  assert.deepEqual(Object.keys(update.valores).sort(), LLAVES_UPDATE);

  // Por `id`: filtrar por codigo_cliente sobrescribiría todas las filas del cliente.
  assert.deepEqual(update.filtro, { columna: 'id', valor: 'perfil-1' });

  // Lo guardado es lo devuelto. Si esto se separa, la ficha muestra una cosa y
  // la base guarda otra.
  assert.equal(update.valores.resultado_perfil, cuerpo.perfilFinal);
  assert.equal(update.valores.fase, cuerpo.fase);
  assert.equal(update.valores.puntuacion_ponderada, cuerpo.puntuacionPonderada);
  assert.equal(update.valores.fecha_calculo, HOY.toISOString());
});

test('éxito: un asiento de bitácora, después del guardado, con la transición', async () => {
  const { cuerpo } = await calcular();

  assert.equal(registro.eventos.length, 1);
  const [evento] = registro.eventos;
  assert.equal(evento.entidad, 'perfil_riesgo');
  assert.equal(evento.entidadId, 'perfil-1');
  assert.equal(evento.accion, 'calculo_ips');
  assert.equal(evento.campo, 'resultado_perfil');
  assert.equal(evento.valorAnterior, 'Bajo');
  assert.equal(evento.valorNuevo, cuerpo.perfilFinal);
  assert.equal(evento.usuario, 'asesor@prueba.test');
  assert.match(evento.motivo, /Cálculo del perfil IPS con el motor/);
});

test('éxito: solo lee clientes y perfil_riesgo; no toca ninguna otra tabla', async () => {
  await calcular();
  assert.deepEqual([...new Set(registro.tablas)].sort(), ['clientes', 'perfil_riesgo']);
});

test('jubilada con nulos y la contradicción de ahorros: 200, no revienta', async () => {
  registro.perfil = { ...PERFIL_JUBILADO };
  const { status, cuerpo } = await calcular();

  assert.equal(status, 200);
  assert.deepEqual(Object.keys(cuerpo).sort(), LLAVES_EXITO);
  // Sin resultado previo la transición arranca en null, no en una cadena vacía.
  assert.equal(registro.eventos[0].valorAnterior, null);
});

test('la ocupación jubilado fuerza la fase, y la respuesta lo declara', async () => {
  registro.cliente = { ...CLIENTE, ocupacion: 'Jubilado' };
  registro.perfil = { ...PERFIL_JUBILADO };
  const { status, cuerpo } = await calcular();

  assert.equal(status, 200);
  assert.equal(cuerpo.faseForzadaPorJubilacion, true);
  assert.equal(cuerpo.fase, 'Retiro');
});

// ---------------------------------------------------------------------------
// 2 · Cada código de error, con su forma
// ---------------------------------------------------------------------------

test('cuerpo que no es JSON: 400 y no lee ni escribe nada', async () => {
  const { status, cuerpo } = await calcular('esto no es json');

  assert.equal(status, 400);
  assert.equal(cuerpo.error, 'El cuerpo de la petición no es JSON válido.');
  assert.deepEqual(Object.keys(cuerpo), ['error']);
  assert.equal(registro.tablas.length, 0);
  assert.equal(registro.updates.length, 0);
  assert.equal(registro.eventos.length, 0);
});

for (const [nombre, cuerpoPeticion] of [
  ['sin codigo_cliente', {}],
  ['codigo_cliente vacío', { codigo_cliente: '   ' }],
  ['codigo_cliente que no es texto', { codigo_cliente: 42 }],
] as const) {
  test(`${nombre}: 400 «Falta codigo_cliente.»`, async () => {
    const { status, cuerpo } = await calcular(cuerpoPeticion);
    assert.equal(status, 400);
    assert.equal(cuerpo.error, 'Falta codigo_cliente.');
    assert.equal(registro.updates.length, 0);
  });
}

test('sin sesión: 401 y ni una lectura del expediente', async () => {
  registro.usuario = null;
  const { status, cuerpo } = await calcular();

  assert.equal(status, 401);
  assert.equal(cuerpo.error, 'No autorizado.');
  assert.equal(registro.tablas.length, 0);
});

test('falla la lectura de clientes: 500 genérico, sin filtrar el detalle', async () => {
  registro.errorCliente = true;
  const { status, cuerpo } = await calcular();

  assert.equal(status, 500);
  assert.equal(cuerpo.error, 'Error al leer el cliente.');
  assert.deepEqual(Object.keys(cuerpo), ['error']);
  assert.equal(registro.updates.length, 0);
});

test('el cliente no existe: 404, distinto de un error de lectura', async () => {
  registro.cliente = null;
  const { status, cuerpo } = await calcular();

  assert.equal(status, 404);
  assert.equal(cuerpo.error, 'El cliente no existe.');
  assert.equal(registro.updates.length, 0);
});

test('falla la lectura de perfil_riesgo: 500', async () => {
  registro.errorPerfil = true;
  const { status, cuerpo } = await calcular();

  assert.equal(status, 500);
  assert.equal(cuerpo.error, 'Error al leer el perfil de riesgo.');
  assert.equal(registro.updates.length, 0);
});

test('sin cuestionario capturado: 404 con su mensaje propio', async () => {
  registro.perfil = null;
  const { status, cuerpo } = await calcular();

  assert.equal(status, 404);
  assert.equal(cuerpo.error, 'Este cliente no tiene cuestionario de riesgo capturado.');
  // Sin fila no hay dónde guardar: un update afectaría 0 renglones en silencio.
  assert.equal(registro.updates.length, 0);
  assert.equal(registro.eventos.length, 0);
});

test('datos bloqueantes: 400 con el mensaje del motor y CERO escrituras', async () => {
  registro.cliente = { ...CLIENTE, ingreso_neto_mensual: null };
  const { status, cuerpo } = await calcular();

  assert.equal(status, 400);
  assert.match(cuerpo.error as string, /faltan datos bloqueantes/);
  assert.deepEqual(Object.keys(cuerpo), ['error']);
  assert.equal(registro.updates.length, 0, 'un expediente incompleto no escribe');
  assert.equal(registro.eventos.length, 0, 'ni asienta en bitácora');
});

test('falla el guardado: 500 que DEVUELVE el cálculo y no asienta bitácora', async () => {
  registro.errorUpdate = true;
  const { status, cuerpo } = await calcular();

  assert.equal(status, 500);
  assert.equal(cuerpo.error, 'El perfil se calculó pero no se pudo guardar.');

  // La ficha muestra el resultado no guardado si viene `perfilCalculado`.
  // Perder el guardado no debe perder el trabajo.
  assert.ok(cuerpo.perfilCalculado, 'el 500 de guardado tiene que traer el cálculo');
  assert.deepEqual(Object.keys(cuerpo).sort(), ['error', ...LLAVES_EXITO].sort());

  // La bitácora nunca dice que ocurrió algo que no ocurrió.
  assert.equal(registro.eventos.length, 0);
});

// ---------------------------------------------------------------------------
// 3 · Invariante de forma: todo error trae `error` como texto
// ---------------------------------------------------------------------------

test('todos los caminos de error devuelven `error` en texto', async () => {
  const casos: Array<() => void> = [
    () => { registro.usuario = null; },
    () => { registro.cliente = null; },
    () => { registro.errorCliente = true; },
    () => { registro.perfil = null; },
    () => { registro.errorPerfil = true; },
    () => { registro.errorUpdate = true; },
    () => { registro.cliente = { ...CLIENTE, ingreso_neto_mensual: null }; },
  ];

  for (const preparar of casos) {
    registro.usuario = { id: 'u-1', email: 'asesor@prueba.test' };
    registro.cliente = { ...CLIENTE };
    registro.perfil = { ...PERFIL };
    registro.errorCliente = false;
    registro.errorPerfil = false;
    registro.errorUpdate = false;
    registro.updates = [];
    registro.eventos = [];

    preparar();
    const { status, cuerpo } = await calcular();
    assert.notEqual(status, 200);
    assert.equal(typeof cuerpo.error, 'string', `status ${status} sin mensaje de error`);
    assert.ok((cuerpo.error as string).length > 0);
  }
});
