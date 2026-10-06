/**
 * lib/codigo-cliente.ts · formato de la regla de códigos nuevos y choques.
 *
 * Datos sintéticos: este archivo se commitea. Los códigos de ejemplo siguen la
 * forma de la regla y no corresponden a ningún cliente.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';

import { buscarChoques, validarCodigoNuevo } from './codigo-cliente';

test('CSPFU + 4 dígitos pasa', () => {
  assert.deepEqual(validarCodigoNuevo('CSPFU2985'), { ok: true, codigo: 'CSPFU2985' });
});

test('se normaliza: espacios y minúsculas (el «CSPfU1270» del R03 202606)', () => {
  assert.deepEqual(validarCodigoNuevo('  cspfu2985 '), { ok: true, codigo: 'CSPFU2985' });
  assert.deepEqual(validarCodigoNuevo('CSPfU2985'), { ok: true, codigo: 'CSPFU2985' });
});

test('CSPM nuevo se rechaza con su razón', () => {
  const r = validarCodigoNuevo('CSPMU2985');
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /siempre CSPF/);
});

test('todo lo que no es CSPFU + 4 dígitos se rechaza', () => {
  for (const c of ['', undefined, 'CSPFU298', 'CSPFU29851', 'CSPF2985', 'CSPFX2985', 'LEAD-35554', 'CSPFU29A5', 'CSPFU_985']) {
    assert.equal(validarCodigoNuevo(c).ok, false, String(c));
  }
});

function fake(opciones: { enClientes?: boolean; enAlias?: boolean; error?: boolean }) {
  const llamadas: Array<{ tabla: string; metodo: string; args: unknown[] }> = [];
  const supabase = {
    from: (tabla: string) => {
      const q = {
        select: () => q,
        ilike: (...args: unknown[]) => (llamadas.push({ tabla, metodo: 'ilike', args }), q),
        or: (...args: unknown[]) => (llamadas.push({ tabla, metodo: 'or', args }), q),
        limit: async () => {
          if (opciones.error) return { data: null, error: { message: 'fallo' } };
          const hay = tabla === 'clientes' ? opciones.enClientes : opciones.enAlias;
          return { data: hay ? [{}] : [], error: null };
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { supabase, llamadas };
}

test('choques: busca en clientes y en las dos columnas de codigos_alias, sin distinguir caja', async () => {
  const { supabase, llamadas } = fake({});
  assert.deepEqual(await buscarChoques(supabase, 'CSPFU2985'), { choques: [], error: false });
  assert.deepEqual(llamadas, [
    { tabla: 'clientes', metodo: 'ilike', args: ['codigo_cliente', 'CSPFU2985'] },
    { tabla: 'codigos_alias', metodo: 'or', args: ['codigo_anterior.ilike.CSPFU2985,codigo_actual.ilike.CSPFU2985'] },
  ]);
});

test('choques: reporta dónde existe', async () => {
  assert.deepEqual((await buscarChoques(fake({ enClientes: true }).supabase, 'X')).choques, ['clientes']);
  assert.deepEqual((await buscarChoques(fake({ enAlias: true }).supabase, 'X')).choques, ['codigos_alias']);
  assert.deepEqual((await buscarChoques(fake({ enClientes: true, enAlias: true }).supabase, 'X')).choques, [
    'clientes',
    'codigos_alias',
  ]);
});

test('choques: si la consulta falla, error, nunca «no choca»', async () => {
  assert.deepEqual(await buscarChoques(fake({ error: true }).supabase, 'X'), { choques: [], error: true });
});

// ---------------------------------------------------------------------------
// /nuevo-cliente usa las dos piezas antes de insertar
// ---------------------------------------------------------------------------

const PAGINA = readFileSync(new URL('../app/nuevo-cliente/page.tsx', import.meta.url), 'utf8');

test('/nuevo-cliente valida el formato, busca choques y guarda el código normalizado', () => {
  const iValida = PAGINA.indexOf('validarCodigoNuevo(');
  const iChoques = PAGINA.indexOf('buscarChoques(');
  const iInsert = PAGINA.search(/\.from\('clientes'\)\s*\.insert\(/);
  assert.ok(iValida > 0 && iChoques > iValida && iInsert > iChoques, 'validar → choques → insertar');
  assert.match(PAGINA, /codigo_cliente: validacion\.codigo/);
});
