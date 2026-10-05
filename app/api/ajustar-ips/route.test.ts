/**
 * /api/ajustar-ips · un cliente bloqueado no recibe ajuste de perfil.
 *
 * Decisión de Claudio, 5-oct-2026: con un bloqueo abierto en
 * `cliente_bloqueos` la ruta responde 423 y no escribe nada, igual que
 * /api/calcular-ips y /api/generar-portafolio. Si el bloqueo no se puede leer,
 * 500: nunca se toma como «no bloqueado». Sin bloqueo, el flujo de siempre.
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
  updates: [] as { tabla: string; valores: Record<string, unknown> }[],
  eventos: [] as EventoBitacora[],
}));

vi.mock('@/lib/supabase-server', () => {
  function consulta(tabla: string) {
    let actualizado: Record<string, unknown> | null = null;
    const q = {
      select: () => q,
      eq: () => q,
      is: () => q,
      order: () => q,
      limit: () => q,
      update: (valores: Record<string, unknown>) => {
        actualizado = valores;
        registro.updates.push({ tabla, valores });
        return q;
      },
      maybeSingle: async () => {
        if (tabla === 'cliente_bloqueos') {
          return registro.errorBloqueo
            ? { data: null, error: { message: 'fallo simulado' } }
            : { data: registro.bloqueo, error: null };
        }
        if (actualizado) return { data: { resultado_perfil: 'Moderado', ...actualizado }, error: null };
        return { data: { id: 'perfil-1', resultado_perfil: 'Moderado', perfil_ajustado: null }, error: null };
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
  registro.updates = [];
  registro.eventos = [];
});

async function ajustar() {
  const res = await POST(
    new Request('http://localhost/api/ajustar-ips', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        codigo_cliente: 'PRUEBA-001',
        perfil_ajustado: 'Bajo',
        comentario_asesor: 'Prefiere menos volatilidad de la que sugiere el motor.',
      }),
    }),
  );
  return { status: res.status, cuerpo: (await res.json()) as Fila };
}

test('cliente bloqueado: 423, cliente_bloqueado, sin escribir ni asentar bitácora', async () => {
  registro.bloqueo = {
    id: 'bloqueo-1',
    codigo_cliente: 'PRUEBA-001',
    motivo: 'Coincidencia confirmada en lista OFAC.',
    bloqueado_en: '2026-10-05T16:30:00Z',
    bloqueado_por: 'oficial@prueba.test',
    coincidencia_id: 'c-1',
  };
  const { status, cuerpo } = await ajustar();
  assert.equal(status, 423);
  assert.equal(cuerpo.codigo_error, 'cliente_bloqueado');
  assert.match(String(cuerpo.error), /BLOQUEADO desde 2026-10-05 10:30/);
  assert.equal(registro.updates.length, 0);
  assert.equal(registro.eventos.length, 0);
  assert.equal(registro.tablas.includes('perfil_riesgo'), false, 'ni siquiera lee el perfil');
});

test('si no se puede leer el bloqueo: 500 y no escribe', async () => {
  registro.errorBloqueo = true;
  const { status } = await ajustar();
  assert.equal(status, 500);
  assert.equal(registro.updates.length, 0);
  assert.equal(registro.eventos.length, 0);
});

test('sin bloqueo: guarda el ajuste como siempre', async () => {
  const { status, cuerpo } = await ajustar();
  assert.equal(status, 200);
  assert.equal(cuerpo.perfil_ajustado, 'Bajo');
  assert.deepEqual(registro.updates.map((u) => u.tabla), ['perfil_riesgo']);
  assert.equal(registro.eventos.length, 1);
  assert.ok(registro.tablas.indexOf('cliente_bloqueos') < registro.tablas.indexOf('perfil_riesgo'));
});
