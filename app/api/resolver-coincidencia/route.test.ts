/**
 * /api/resolver-coincidencia · qué dispara la ruta reforzada y qué no.
 *
 * Fija las tres reglas del 11 de septiembre de 2026:
 *   1. LPB, OFAC y ONU disparan la ruta reforzada: son listas de sanciones.
 *   2. El SAT 69-B no la dispara: es materia fiscal.
 *   3. El sistema nunca presenta el reporte por su cuenta: la ruta no llama a
 *      la red ni escribe por otra vía que la función de firma y la bitácora.
 *
 * Y las del 5 de octubre de 2026 (bloqueo y firma):
 *   4. Sin firma (rol y declaración) no se resuelve en ningún sentido: 400 y
 *      no se toca nada.
 *   5. La escritura es UNA llamada a fn_resolver_coincidencia; la ruta no hace
 *      UPDATE ni INSERT por su cuenta.
 *   6. El firmante sale de la sesión (lo pone la base); la ruta nunca lo manda,
 *      y en su fuente no hay correo ni firmante constante.
 *   7. Los errores BL4xx de la función salen como su 4xx, nunca como 500.
 *
 * Supabase y la bitácora se sustituyen: lo que se prueba es la decisión de la
 * ruta, no la base. Lo que hace la función por dentro (todo o nada, un bloqueo
 * abierto por cliente) se probó contra Postgres en la réplica PGlite y en
 * producción con rollback: ver migraciones/2026-10-05-bloqueo-y-firma.sql.
 *
 * Se corre con vitest:
 *   npm test
 */

import { afterEach, beforeEach, test, vi, type MockInstance } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { EventoBitacora } from '@/lib/bitacora';

type Fila = Record<string, unknown>;

/** Lo que la ruta hizo, para poder afirmarlo después. Se reinicia en cada caso. */
const registro = vi.hoisted(() => ({
  tipoLista: 'OFAC',
  tablas: [] as string[],
  updates: [] as { tabla: string; valores: Record<string, unknown> }[],
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  /** Error que devuelve la función, o null. */
  errorRpc: null as { code: string; message: string } | null,
  /** El cliente ya tenía un bloqueo abierto por otra coincidencia. */
  bloqueoPrevio: false,
  eventos: [] as EventoBitacora[],
}));

vi.mock('@/lib/supabase-server', () => {
  const COINCIDENCIA = {
    id: 'coinc-1',
    codigo_cliente: 'PRUEBA-001',
    lista_id: 'lista-1',
    registro_id: 'reg-1',
    tipo_match: 'rfc_exacto',
    valor_cliente: 'XAXX010101000',
    valor_lista: 'XAXX010101000',
    estado: 'pendiente',
    revisada_por: null,
    fecha_revision: null,
    motivo_resolucion: null,
    detectada_en: '2026-09-11T10:00:00Z',
  };

  /** Una cadena de PostgREST mínima: select/eq/update encadenan, maybeSingle responde. */
  function consulta(tabla: string) {
    let valores: Record<string, unknown> | null = null;
    const q = {
      select: () => q,
      eq: () => q,
      update: (v: Record<string, unknown>) => {
        valores = v;
        registro.updates.push({ tabla, valores: v });
        return q;
      },
      maybeSingle: async () => {
        if (tabla === 'listas_control') {
          return {
            data: {
              id: 'lista-1',
              tipo: registro.tipoLista,
              obligatoria: false,
              fuente: 'prueba',
              fecha_lista: '2026-09-01',
              vigente: true,
            },
            error: null,
          };
        }
        if (valores) return { data: { id: COINCIDENCIA.id, ...valores }, error: null };
        return { data: COINCIDENCIA, error: null };
      },
    };
    return q;
  }

  /**
   * Imita lo que la función decide: bloquea si confirma en sanciones (el doble
   * usa la misma lista que la base, LPB/OFAC/ONU) y firma con el usuario del
   * JWT, que aquí es el de la sesión.
   */
  async function rpc(fn: string, args: Record<string, unknown>) {
    registro.rpcs.push({ fn, args });
    if (registro.errorRpc) return { data: null, error: registro.errorRpc };
    const bloquea = args.p_estado === 'confirmada' && ['LPB', 'OFAC', 'ONU'].includes(registro.tipoLista);
    return {
      data: {
        coincidencia_id: args.p_coincidencia_id,
        codigo_cliente: COINCIDENCIA.codigo_cliente,
        estado: args.p_estado,
        tipo_lista: registro.tipoLista,
        revisada_por: 'revisor@prueba.test',
        firma_id: 'firma-1',
        bloqueo_id: bloquea ? 'bloqueo-1' : null,
        bloqueo_nuevo: bloquea && !registro.bloqueoPrevio,
      },
      error: null,
    };
  }

  return {
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: 'u-1', email: 'revisor@prueba.test' } } }),
      },
      from: (tabla: string) => {
        registro.tablas.push(tabla);
        return consulta(tabla);
      },
      rpc,
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

let fetchEspia: MockInstance<typeof fetch>;

beforeEach(() => {
  registro.tablas = [];
  registro.updates = [];
  registro.rpcs = [];
  registro.errorRpc = null;
  registro.bloqueoPrevio = false;
  registro.eventos = [];
  // Si la ruta intentara presentar algo, lo haría por la red.
  fetchEspia = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('resolver-coincidencia no debe llamar a la red');
  });
});

afterEach(() => {
  fetchEspia.mockRestore();
});

const FIRMA = { rol: 'oficial_cumplimiento', declaracion: 'Revisé el careo y asumo la decisión.' };

type Cuerpo = Fila & {
  advertencia?: { titulo: string; obligaciones: string[]; fundamento: string };
  pendiente?: string;
  error?: string;
  bloqueo?: { id: string; nuevo: boolean } | null;
  firma?: { id: string; rol: string; firmante: string };
};

async function pedir(body: Record<string, unknown>) {
  const res = await POST(
    new Request('http://localhost/api/resolver-coincidencia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
  return { status: res.status, cuerpo: (await res.json()) as Cuerpo };
}

async function resolver(tipoLista: string, estado: 'confirmada' | 'descartada', extra: Fila = {}) {
  registro.tipoLista = tipoLista;
  const { status, cuerpo } = await pedir({
    id: 'coinc-1',
    estado,
    motivo: 'Mismo RFC y misma CURP que el expediente.',
    ...FIRMA,
    ...extra,
  });
  assert.equal(registro.eventos.length, 1, 'un asiento por resolución');
  return { status, cuerpo, evento: registro.eventos[0] };
}

// ---------------------------------------------------------------------------
// 1 · Las tres listas de sanciones disparan la ruta reforzada
// ---------------------------------------------------------------------------

for (const [tipo, nombre] of [
  ['LPB', 'Lista de Personas Bloqueadas'],
  ['OFAC', 'OFAC'],
  ['ONU', 'ONU'],
] as const) {
  test(`${tipo} confirmada: mismo aviso, mismas obligaciones, mismo asiento`, async () => {
    const { status, cuerpo, evento } = await resolver(tipo, 'confirmada');

    assert.equal(status, 200);
    assert.ok(cuerpo.advertencia, `${tipo} tiene que devolver el aviso`);
    assert.match(cuerpo.advertencia.titulo, new RegExp(nombre));
    assert.equal(cuerpo.advertencia.obligaciones.length, 2);
    assert.match(cuerpo.advertencia.obligaciones[1], /24 horas/);
    // El fundamento es el del motor: nombra las tres listas.
    assert.match(cuerpo.advertencia.fundamento, /10\.10/);
    assert.match(cuerpo.advertencia.fundamento, /OFAC/);

    // El texto que queda como evidencia, idéntico para las tres.
    assert.match(evento.motivo, /OBLIGACIONES INMEDIATAS \(apartado 10\.10\)/);
    assert.match(evento.motivo, /Reporte de 24 horas/);
    assert.equal(evento.metadata?.dispara_ruta_reforzada, true);
  });
}

// ---------------------------------------------------------------------------
// 2 · Lo que NO dispara
// ---------------------------------------------------------------------------

test('SAT 69-B confirmada: materia fiscal, sin ruta reforzada', async () => {
  const { status, cuerpo, evento } = await resolver('SAT_69B', 'confirmada');

  assert.equal(status, 200);
  assert.equal(cuerpo.advertencia, undefined);
  assert.doesNotMatch(evento.motivo, /OBLIGACIONES INMEDIATAS/);
  assert.equal(evento.metadata?.dispara_ruta_reforzada, false);

  assert.ok(cuerpo.pendiente);
  assert.match(cuerpo.pendiente, /No eleva el grado/);
  assert.match(cuerpo.pendiente, /materia fiscal/);
});

test('PEP nacional confirmada: sin ruta reforzada, pero avisa que queda preliminar', async () => {
  const { cuerpo, evento } = await resolver('PEP_NACIONAL', 'confirmada');

  assert.equal(cuerpo.advertencia, undefined);
  assert.equal(evento.metadata?.dispara_ruta_reforzada, false);
  assert.ok(cuerpo.pendiente);
  assert.match(cuerpo.pendiente, /no reclasifica de oficio/);
  assert.match(cuerpo.pendiente, /preliminar/);
});

test('OFAC DESCARTADA: un homónimo no dispara nada', async () => {
  const { cuerpo, evento } = await resolver('OFAC', 'descartada');

  assert.equal(cuerpo.advertencia, undefined);
  assert.equal(cuerpo.pendiente, undefined);
  assert.doesNotMatch(evento.motivo, /OBLIGACIONES INMEDIATAS/);
  assert.equal(evento.metadata?.dispara_ruta_reforzada, false);
});

// ---------------------------------------------------------------------------
// 3 · El sistema nunca presenta el reporte solo
// ---------------------------------------------------------------------------

test('nunca presenta el reporte: ni red, ni escrituras fuera de la función de firma', async () => {
  // Quién presenta y cuándo lo deciden Claudio Bustamante y el Oficial de
  // Cumplimiento. Si alguien agrega aquí una llamada a SITI, un correo o una
  // escritura a otra tabla, este caso falla.
  for (const tipo of ['LPB', 'OFAC', 'ONU']) {
    registro.tablas = [];
    registro.updates = [];
    registro.rpcs = [];
    registro.eventos = [];

    const { cuerpo } = await resolver(tipo, 'confirmada');
    assert.ok(cuerpo.advertencia, 'el caso tiene que ser uno que dispara la ruta reforzada');

    assert.equal(fetchEspia.mock.calls.length, 0, `${tipo}: la ruta llamó a la red`);

    // Solo lee la coincidencia y su lista. No escribe por su cuenta: toda la
    // escritura es UNA llamada a la función de firma, con estos parámetros y
    // ninguno más.
    assert.deepEqual([...new Set(registro.tablas)].sort(), ['listas_coincidencias', 'listas_control']);
    assert.equal(registro.updates.length, 0, `${tipo}: la ruta escribió por fuera de la función`);
    assert.equal(registro.rpcs.length, 1);
    assert.equal(registro.rpcs[0].fn, 'fn_resolver_coincidencia');
    assert.deepEqual(Object.keys(registro.rpcs[0].args).sort(), [
      'p_coincidencia_id',
      'p_declaracion',
      'p_estado',
      'p_motivo',
      'p_rol',
    ]);
  }
});

// ---------------------------------------------------------------------------
// El aviso posterior dice lo que de verdad pasa
// ---------------------------------------------------------------------------

test('el aviso ya no dice que la EBR ignora las coincidencias: es falso desde a7c0190', async () => {
  const { cuerpo } = await resolver('OFAC', 'confirmada');

  assert.ok(cuerpo.pendiente);
  assert.doesNotMatch(cuerpo.pendiente, /no consume/);
  assert.match(cuerpo.pendiente, /PRUEBA-001/);
  assert.match(cuerpo.pendiente, /próxima evaluación/);
  assert.match(cuerpo.pendiente, /ALTO/);
});

// ---------------------------------------------------------------------------
// 4 · Sin firma no se resuelve, en ningún sentido (5-oct-2026)
// ---------------------------------------------------------------------------

for (const estado of ['confirmada', 'descartada'] as const) {
  for (const [caso, firma] of [
    ['sin rol', { declaracion: 'Declaro.' }],
    ['rol inventado', { rol: 'director', declaracion: 'Declaro.' }],
    ['sin declaración', { rol: 'asesor' }],
    ['declaración en blanco', { rol: 'asesor', declaracion: '   ' }],
  ] as const) {
    test(`${estado} ${caso}: 400 y no toca nada`, async () => {
      registro.tipoLista = 'OFAC';
      const { status, cuerpo } = await pedir({ id: 'coinc-1', estado, motivo: 'Homónimo.', ...firma });
      assert.equal(status, 400);
      assert.match(cuerpo.error ?? '', /firma/i);
      assert.equal(registro.tablas.length, 0, 'ni siquiera lee');
      assert.equal(registro.rpcs.length, 0);
      assert.equal(registro.eventos.length, 0);
    });
  }
}

// ---------------------------------------------------------------------------
// 5 · Bloqueo: lo decide la función y la ruta lo reporta
// ---------------------------------------------------------------------------

test('OFAC confirmada: responde el bloqueo nuevo y la bitácora lo dice', async () => {
  const { cuerpo, evento } = await resolver('OFAC', 'confirmada');
  assert.deepEqual(cuerpo.bloqueo, { id: 'bloqueo-1', nuevo: true });
  assert.match(evento.motivo, /Cliente BLOQUEADO/);
  assert.match(cuerpo.pendiente ?? '', /BLOQUEADO/);
  assert.deepEqual(evento.metadata?.bloqueo, { id: 'bloqueo-1', nuevo: true });
});

test('OFAC confirmada con un bloqueo ya abierto: no abre otro y lo dice, sin error', async () => {
  registro.bloqueoPrevio = true;
  const { status, cuerpo, evento } = await resolver('OFAC', 'confirmada');
  assert.equal(status, 200);
  assert.deepEqual(cuerpo.bloqueo, { id: 'bloqueo-1', nuevo: false });
  assert.match(evento.motivo, /ya estaba bloqueado/);
});

for (const tipo of ['SAT_69B', 'PEP_NACIONAL']) {
  test(`${tipo} confirmada: firma sí, bloqueo no`, async () => {
    const { cuerpo } = await resolver(tipo, 'confirmada');
    assert.equal(cuerpo.bloqueo, null);
    assert.equal(cuerpo.firma?.id, 'firma-1');
  });
}

test('descartar también se firma: el descarte llega a la función con rol y declaración', async () => {
  const { cuerpo } = await resolver('OFAC', 'descartada');
  assert.equal(cuerpo.bloqueo, null);
  assert.equal(registro.rpcs[0].args.p_estado, 'descartada');
  assert.equal(registro.rpcs[0].args.p_rol, 'oficial_cumplimiento');
  assert.equal(registro.rpcs[0].args.p_declaracion, FIRMA.declaracion);
});

// ---------------------------------------------------------------------------
// 6 · El firmante es el de la sesión, nunca una constante
// ---------------------------------------------------------------------------

test('un firmante en el cuerpo no llega a la función; la firma lleva el de la sesión', async () => {
  const { cuerpo, evento } = await resolver('OFAC', 'confirmada', { firmante: 'impostor@prueba.test' });
  const args = registro.rpcs[0].args;
  assert.equal(JSON.stringify(args).includes('impostor'), false);
  assert.equal(cuerpo.firma?.firmante, 'revisor@prueba.test');
  assert.match(evento.motivo, /Firmó revisor@prueba\.test como oficial_cumplimiento/);
});

test('la fuente de la ruta no trae firmante constante ni correo escrito a mano', () => {
  const fuente = readFileSync(new URL('./route.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(fuente, /p_firmante|firmante\s*:\s*['"`]/, 'la ruta no debe mandar ni fijar firmante');
  assert.doesNotMatch(fuente, /['"`][^'"`\s]+@[^'"`\s]+\.[a-z]{2,}['"`]/i, 'correo literal en la ruta');
});

// ---------------------------------------------------------------------------
// 7 · Errores de la función: 4xx, nunca 500
// ---------------------------------------------------------------------------

for (const [code, status] of [
  ['BL400', 400],
  ['BL401', 401],
  ['BL404', 404],
  ['BL409', 409],
] as const) {
  test(`la función responde ${code}: la ruta da ${status} y no asienta bitácora`, async () => {
    registro.errorRpc = { code, message: 'mensaje de la base' };
    registro.tipoLista = 'OFAC';
    const r = await pedir({ id: 'coinc-1', estado: 'confirmada', motivo: 'x', ...FIRMA });
    assert.equal(r.status, status);
    assert.equal(typeof r.cuerpo.error, 'string');
    assert.equal(registro.eventos.length, 0);
  });
}

test('un error ajeno a la firma sí es 500, con mensaje genérico', async () => {
  registro.errorRpc = { code: '57014', message: 'detalle interno' };
  const r = await pedir({ id: 'coinc-1', estado: 'confirmada', motivo: 'x', ...FIRMA });
  assert.equal(r.status, 500);
  assert.doesNotMatch(r.cuerpo.error ?? '', /detalle interno/);
});
