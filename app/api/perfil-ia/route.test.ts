/**
 * /api/perfil-ia · un cliente bloqueado no recibe narrativa de IA.
 *
 * Decisión de Claudio, 5-oct-2026: con un bloqueo abierto en
 * `cliente_bloqueos` la ruta responde 423 y no escribe nada. La consulta va
 * antes de leer el cuestionario y antes de llamar a la API: para un bloqueado
 * no se gasta la llamada ni se manda su cuestionario fuera. Si el bloqueo no
 * se puede leer, 500: nunca se toma como «no bloqueado».
 *
 * Supabase y el SDK de Anthropic se sustituyen: lo que se prueba es la
 * decisión de la ruta. Ninguna llamada real sale de este test.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

type Fila = Record<string, unknown>;

const registro = vi.hoisted(() => ({
  bloqueo: null as Record<string, unknown> | null,
  errorBloqueo: false,
  tablas: [] as string[],
  updates: [] as { tabla: string; valores: Record<string, unknown> }[],
  llamadasIA: 0,
}));

vi.mock('@/lib/supabase-server', () => {
  function consulta(tabla: string) {
    const q = {
      select: () => q,
      eq: () => q,
      is: () => q,
      update: (valores: Record<string, unknown>) => {
        registro.updates.push({ tabla, valores });
        return q;
      },
      maybeSingle: async () => {
        if (tabla === 'cliente_bloqueos') {
          return registro.errorBloqueo
            ? { data: null, error: { message: 'fallo simulado' } }
            : { data: registro.bloqueo, error: null };
        }
        return { data: { respuestas_completas: { horizonte: 'Entre 5 y 10 años' } }, error: null };
      },
      // El UPDATE se espera sin maybeSingle; siempre sale bien.
      then: (resolver: (v: { error: null }) => unknown) =>
        Promise.resolve({ error: null }).then(resolver),
    };
    return q;
  }

  return {
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: 'u-1', email: 'asesor@prueba.test' } } }) },
      from: (tabla: string) => {
        registro.tablas.push(tabla);
        return consulta(tabla);
      },
    }),
  };
});

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async () => {
        registro.llamadasIA++;
        return { content: [{ type: 'text', text: 'Narrativa sintética del perfil.' }] };
      },
    };
  },
}));

import { POST } from './route';

const LLAVE_ORIGINAL = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = 'llave-de-prueba';
  registro.bloqueo = null;
  registro.errorBloqueo = false;
  registro.tablas = [];
  registro.updates = [];
  registro.llamadasIA = 0;
});

afterEach(() => {
  if (LLAVE_ORIGINAL === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = LLAVE_ORIGINAL;
});

async function generar() {
  const res = await POST(
    new Request('http://localhost/api/perfil-ia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo_cliente: 'PRUEBA-001' }),
    }),
  );
  return { status: res.status, cuerpo: (await res.json()) as Fila };
}

test('cliente bloqueado: 423, sin leer el cuestionario, sin llamar a la IA y sin escribir', async () => {
  registro.bloqueo = {
    id: 'bloqueo-1',
    codigo_cliente: 'PRUEBA-001',
    motivo: 'Coincidencia confirmada en lista OFAC.',
    bloqueado_en: '2026-10-05T16:30:00Z',
    bloqueado_por: 'oficial@prueba.test',
    coincidencia_id: 'c-1',
  };
  const { status, cuerpo } = await generar();
  assert.equal(status, 423);
  assert.equal(cuerpo.codigo_error, 'cliente_bloqueado');
  assert.match(String(cuerpo.error), /BLOQUEADO/);
  assert.equal(registro.llamadasIA, 0, 'no se llama a la API para un bloqueado');
  assert.equal(registro.updates.length, 0);
  assert.equal(registro.tablas.includes('perfil_riesgo'), false);
});

test('si no se puede leer el bloqueo: 500, sin IA y sin escribir', async () => {
  registro.errorBloqueo = true;
  const { status } = await generar();
  assert.equal(status, 500);
  assert.equal(registro.llamadasIA, 0);
  assert.equal(registro.updates.length, 0);
});

test('sin bloqueo: genera y guarda la narrativa como siempre', async () => {
  const { status, cuerpo } = await generar();
  assert.equal(status, 200);
  assert.equal(cuerpo.perfil_ia, 'Narrativa sintética del perfil.');
  assert.equal(registro.llamadasIA, 1);
  assert.deepEqual(registro.updates, [
    { tabla: 'perfil_riesgo', valores: { perfil_ia: 'Narrativa sintética del perfil.' } },
  ]);
});
