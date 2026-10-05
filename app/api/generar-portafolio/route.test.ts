/**
 * /api/generar-portafolio · un cliente bloqueado no recibe portafolio.
 *
 * Decisión de Claudio, 29-sep-2026: con un bloqueo abierto en
 * `cliente_bloqueos` la ruta responde 423 y no construye ni guarda nada. Si el
 * bloqueo no se puede leer, 500 y tampoco. Sin bloqueo, el flujo de siempre.
 *
 * Supabase y la bitácora se sustituyen: lo que se prueba es la decisión de la
 * ruta, no la base.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

import type { EventoBitacora } from '@/lib/bitacora';

type Fila = Record<string, unknown>;

const registro = vi.hoisted(() => ({
  bloqueo: null as Record<string, unknown> | null,
  errorBloqueo: false,
  tablas: [] as string[],
  inserts: [] as { tabla: string; fila: Record<string, unknown> }[],
  eventos: [] as EventoBitacora[],
}));

vi.mock('@/lib/supabase-server', () => {
  function consulta(tabla: string) {
    let insertado: Record<string, unknown> | null = null;
    const q = {
      select: () => q,
      eq: () => q,
      is: () => q,
      order: () => q,
      limit: () => q,
      insert: (fila: Record<string, unknown>) => {
        insertado = fila;
        registro.inserts.push({ tabla, fila });
        return q;
      },
      maybeSingle: async () => {
        if (tabla === 'clientes') return { data: { codigo_cliente: 'PRUEBA-001' }, error: null };
        if (tabla === 'cliente_bloqueos') {
          return registro.errorBloqueo
            ? { data: null, error: { message: 'fallo simulado' } }
            : { data: registro.bloqueo, error: null };
        }
        if (tabla === 'perfil_riesgo') {
          return {
            data: { fase: 'Acumulacion', resultado_perfil: 'Moderado', perfil_ajustado: null },
            error: null,
          };
        }
        if (tabla === 'portafolios' && insertado) {
          return { data: { id: 'port-1', fecha_generacion: '2026-10-05T16:30:00Z' }, error: null };
        }
        return { data: null, error: null };
      },
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

vi.mock('@/lib/bitacora', () => ({
  registrarEvento: async (_supabase: unknown, evento: EventoBitacora) => {
    registro.eventos.push(evento);
    return true;
  },
}));

import { POST } from './route';

beforeEach(() => {
  registro.bloqueo = null;
  registro.errorBloqueo = false;
  registro.tablas = [];
  registro.inserts = [];
  registro.eventos = [];
});

async function generar() {
  const res = await POST(
    new Request('http://localhost/api/generar-portafolio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo_cliente: 'PRUEBA-001', universo: 'EEUU' }),
    }),
  );
  return { status: res.status, cuerpo: (await res.json()) as Fila };
}

test('cliente bloqueado: 423, cliente_bloqueado, y no construye ni guarda nada', async () => {
  registro.bloqueo = {
    id: 'bloqueo-1',
    codigo_cliente: 'PRUEBA-001',
    motivo: 'Coincidencia confirmada en lista ONU.',
    bloqueado_en: '2026-10-05T16:30:00Z',
    bloqueado_por: 'oficial@prueba.test',
    coincidencia_id: 'c-1',
  };
  const { status, cuerpo } = await generar();
  assert.equal(status, 423);
  assert.equal(cuerpo.codigo_error, 'cliente_bloqueado');
  assert.match(String(cuerpo.error), /BLOQUEADO desde 2026-10-05 10:30/);
  assert.equal(registro.inserts.length, 0);
  assert.equal(registro.eventos.length, 0);
  assert.equal(registro.tablas.includes('perfil_riesgo'), false, 'ni siquiera lee el perfil');
});

test('si no se puede leer el bloqueo: 500 y tampoco genera', async () => {
  registro.errorBloqueo = true;
  const { status } = await generar();
  assert.equal(status, 500);
  assert.equal(registro.inserts.length, 0);
  assert.equal(registro.eventos.length, 0);
});

test('sin bloqueo: genera y guarda como siempre', async () => {
  const { status, cuerpo } = await generar();
  assert.equal(status, 200);
  assert.equal(cuerpo.id, 'port-1');
  assert.deepEqual(
    registro.inserts.map((i) => i.tabla),
    ['portafolios'],
  );
  assert.equal(registro.eventos.length, 1);
  // El bloqueo se consulta antes del perfil.
  assert.ok(registro.tablas.indexOf('cliente_bloqueos') < registro.tablas.indexOf('perfil_riesgo'));
});
