/**
 * /api/resolver-coincidencia · qué dispara la ruta reforzada y qué no.
 *
 * Fija las tres reglas del 11 de septiembre de 2026:
 *   1. LPB, OFAC y ONU disparan la ruta reforzada: son listas de sanciones.
 *   2. El SAT 69-B no la dispara: es materia fiscal.
 *   3. El sistema nunca presenta el reporte por su cuenta: la ruta no llama a
 *      la red ni escribe fuera de la coincidencia y la bitácora.
 *
 * Supabase y la bitácora se sustituyen: lo que se prueba es la decisión de la
 * ruta, no la base.
 *
 * Se corre con vitest:
 *   npm test
 */

import { afterEach, beforeEach, test, vi, type MockInstance } from 'vitest';
import assert from 'node:assert/strict';

import type { EventoBitacora } from '@/lib/bitacora';

type Fila = Record<string, unknown>;

/** Lo que la ruta hizo, para poder afirmarlo después. Se reinicia en cada caso. */
const registro = vi.hoisted(() => ({
  tipoLista: 'OFAC',
  tablas: [] as string[],
  updates: [] as { tabla: string; valores: Record<string, unknown> }[],
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

  return {
    createClient: async () => ({
      auth: {
        getUser: async () => ({ data: { user: { id: 'u-1', email: 'revisor@prueba.test' } } }),
      },
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

let fetchEspia: MockInstance<typeof fetch>;

beforeEach(() => {
  registro.tablas = [];
  registro.updates = [];
  registro.eventos = [];
  // Si la ruta intentara presentar algo, lo haría por la red.
  fetchEspia = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('resolver-coincidencia no debe llamar a la red');
  });
});

afterEach(() => {
  fetchEspia.mockRestore();
});

async function resolver(tipoLista: string, estado: 'confirmada' | 'descartada') {
  registro.tipoLista = tipoLista;
  const res = await POST(
    new Request('http://localhost/api/resolver-coincidencia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'coinc-1',
        estado,
        motivo: 'Mismo RFC y misma CURP que el expediente.',
      }),
    })
  );
  const cuerpo = (await res.json()) as Fila & {
    advertencia?: { titulo: string; obligaciones: string[]; fundamento: string };
    pendiente?: string;
  };
  assert.equal(registro.eventos.length, 1, 'un asiento por resolución');
  return { status: res.status, cuerpo, evento: registro.eventos[0] };
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

test('nunca presenta el reporte: ni red, ni escrituras fuera de la coincidencia', async () => {
  // Quién presenta y cuándo lo deciden Claudio Bustamante y el Oficial de
  // Cumplimiento. Si alguien agrega aquí una llamada a SITI, un correo o una
  // escritura a otra tabla, este caso falla.
  for (const tipo of ['LPB', 'OFAC', 'ONU']) {
    registro.tablas = [];
    registro.updates = [];
    registro.eventos = [];

    const { cuerpo } = await resolver(tipo, 'confirmada');
    assert.ok(cuerpo.advertencia, 'el caso tiene que ser uno que dispara la ruta reforzada');

    assert.equal(fetchEspia.mock.calls.length, 0, `${tipo}: la ruta llamó a la red`);

    // Solo lee la coincidencia y su lista, y solo escribe la coincidencia.
    assert.deepEqual([...new Set(registro.tablas)].sort(), ['listas_coincidencias', 'listas_control']);
    assert.equal(registro.updates.length, 1);
    assert.equal(registro.updates[0].tabla, 'listas_coincidencias');
    assert.deepEqual(Object.keys(registro.updates[0].valores).sort(), [
      'estado',
      'fecha_revision',
      'motivo_resolucion',
      'revisada_por',
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
