/**
 * lib/bloqueo.ts · lectura del bloqueo abierto, plazo de 24 horas y hora CDMX.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  aBloqueoEnBandeja,
  fechaHoraCDMX,
  leerBloqueoAbierto,
  mensajeClienteBloqueado,
  venceReporte24h,
} from './bloqueo';

test('fechaHoraCDMX: UTC-6, formato fijo AAAA-MM-DD HH:MM', () => {
  assert.equal(fechaHoraCDMX('2026-10-05T16:30:00Z'), '2026-10-05 10:30');
  // Medianoche UTC todavía es el día anterior en CDMX.
  assert.equal(fechaHoraCDMX('2026-10-01T03:05:00Z'), '2026-09-30 21:05');
  assert.equal(fechaHoraCDMX('2026-10-05T06:00:00Z'), '2026-10-05 00:00');
});

test('el plazo del reporte vence 24 horas después del bloqueo', () => {
  assert.equal(venceReporte24h('2026-10-05T16:30:00.000Z'), '2026-10-06T16:30:00.000Z');
});

test('el mensaje de negativa dice desde cuándo y cómo se levanta', () => {
  const m = mensajeClienteBloqueado({ bloqueado_en: '2026-10-05T16:30:00Z' });
  assert.match(m, /BLOQUEADO desde 2026-10-05 10:30/);
  assert.match(m, /levante con firma/);
});

function fake(resultado: { data: unknown; error: unknown }) {
  const filtros: Array<[string, string, unknown]> = [];
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => (filtros.push(['eq', c, v]), q),
    is: (c: string, v: unknown) => (filtros.push(['is', c, v]), q),
    maybeSingle: async () => resultado,
  };
  const tablas: string[] = [];
  const supabase = { from: (t: string) => (tablas.push(t), q) } as unknown as SupabaseClient;
  return { supabase, filtros, tablas };
}

test('leerBloqueoAbierto: filtra por cliente y por levantado_en nulo', async () => {
  const fila = { id: 'b-1', codigo_cliente: 'PRUEBA-001', motivo: 'x', bloqueado_en: 'x', bloqueado_por: 'x', coincidencia_id: 'c-1' };
  const { supabase, filtros, tablas } = fake({ data: fila, error: null });
  const r = await leerBloqueoAbierto(supabase, 'PRUEBA-001');
  assert.deepEqual(r, { bloqueo: fila, error: false });
  assert.deepEqual(tablas, ['cliente_bloqueos']);
  assert.deepEqual(filtros, [
    ['eq', 'codigo_cliente', 'PRUEBA-001'],
    ['is', 'levantado_en', null],
  ]);
});

test('leerBloqueoAbierto: sin bloqueo → null; error de lectura → error, nunca «no bloqueado»', async () => {
  assert.deepEqual(await leerBloqueoAbierto(fake({ data: null, error: null }).supabase, 'X'), {
    bloqueo: null,
    error: false,
  });
  assert.deepEqual(
    await leerBloqueoAbierto(fake({ data: null, error: { message: 'fallo' } }).supabase, 'X'),
    { bloqueo: null, error: true },
  );
});

test('aBloqueoEnBandeja: aplana coincidencia y lista, y deja las fechas en CDMX', () => {
  const b = aBloqueoEnBandeja({
    id: 'b-1',
    codigo_cliente: 'PRUEBA-001',
    motivo: 'Coincidencia confirmada en lista OFAC. Mismo RFC.',
    bloqueado_en: '2026-10-05T16:30:00+00:00',
    bloqueado_por: 'oficial@prueba.test',
    coincidencia_id: 'c-1',
    coincidencia: {
      tipo_match: 'rfc_exacto',
      valor_cliente: 'XAXX010101000',
      valor_lista: 'XAXX010101000',
      lista: { tipo: 'OFAC', fecha_lista: '2026-09-30', fuente: 'prueba' },
    },
  });
  assert.equal(b.bloqueado_en_cdmx, '2026-10-05 10:30');
  assert.equal(b.vence_reporte_cdmx, '2026-10-06 10:30');
  assert.equal(b.lista_tipo, 'OFAC');
  assert.equal(b.tipo_match, 'rfc_exacto');
  assert.equal(b.bloqueado_por, 'oficial@prueba.test');
});

test('aBloqueoEnBandeja: sin coincidencia embebida no revienta', () => {
  const b = aBloqueoEnBandeja({ id: 'b', codigo_cliente: 'X', motivo: 'm', bloqueado_en: '2026-10-05T16:30:00Z', bloqueado_por: 'p', coincidencia: null });
  assert.equal(b.lista_tipo, null);
  assert.equal(b.tipo_match, null);
});

// ---------------------------------------------------------------------------
// La bandeja: firma en lugar de window.confirm, y bloqueos leídos de la base
// ---------------------------------------------------------------------------

const BANDEJA = readFileSync(new URL('../app/admin/listas/BandejaCoincidencias.tsx', import.meta.url), 'utf8');
const PAGINA = readFileSync(new URL('../app/admin/listas/page.tsx', import.meta.url), 'utf8');
/** El código sin comentarios: los comentarios pueden mencionar lo que ya no se usa. */
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

test('la bandeja ya no usa window.confirm', () => {
  assert.doesNotMatch(sinComentarios(BANDEJA), /window\.confirm|confirm\(/);
});

test('la bandeja manda rol y declaración en el cuerpo de la resolución', () => {
  const codigo = sinComentarios(BANDEJA);
  assert.match(codigo, /rol: firma\.firma\.rol/);
  assert.match(codigo, /declaracion: firma\.firma\.declaracion/);
  assert.match(codigo, /<CamposFirma/);
});

test('los bloqueos no viven en el estado de React: llegan por props desde la base', () => {
  const codigo = sinComentarios(BANDEJA);
  assert.doesNotMatch(codigo, /useState<[^>]*Bloqueo/);
  assert.doesNotMatch(codigo, /advertencias/);
  assert.match(codigo, /bloqueos: BloqueoEnBandeja\[\]/);
  assert.match(PAGINA, /\.from\('cliente_bloqueos'\)/);
  assert.match(PAGINA, /\.is\('levantado_en', null\)/);
});
