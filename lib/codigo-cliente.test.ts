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

import {
  buscarChoques,
  validarAltaCliente,
  validarCodigoNuevo,
  validarCuentaIbkr,
  validarFechaNacimiento,
} from './codigo-cliente';

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

// ---------------------------------------------------------------------------
// Cuenta, fecha y coherencia con el código (7-oct-2026)
// ---------------------------------------------------------------------------

test('cuenta: U + dígitos pasa, normalizada', () => {
  assert.deepEqual(validarCuentaIbkr('U29000085'), { ok: true, cuenta: 'U29000085' });
  assert.deepEqual(validarCuentaIbkr('  u29000085 '), { ok: true, cuenta: 'U29000085' });
});

test('cuenta: obligatoria, y remite a /captura', () => {
  for (const c of ['', '   ', undefined, null]) {
    const r = validarCuentaIbkr(c);
    assert.equal(r.ok, false, String(c));
    if (!r.ok) assert.match(r.error, /obligatoria.*LEAD-/);
  }
});

test('cuenta: todo lo que no es U + dígitos se rechaza', () => {
  for (const c of ['U', '29000085', 'DU2900008', 'U2900A085', 'U 29000085', 'X29000085']) {
    assert.equal(validarCuentaIbkr(c).ok, false, c);
  }
});

test('fecha: vacía es null (opcional); AAAA-MM-DD real pasa', () => {
  assert.deepEqual(validarFechaNacimiento(''), { ok: true, fecha: null });
  assert.deepEqual(validarFechaNacimiento(undefined), { ok: true, fecha: null });
  assert.deepEqual(validarFechaNacimiento(' 1985-02-28 '), { ok: true, fecha: '1985-02-28' });
  assert.deepEqual(validarFechaNacimiento('1984-02-29'), { ok: true, fecha: '1984-02-29' });
});

test('fecha: forma equivocada o fecha imposible se rechaza', () => {
  for (const f of ['28/02/1985', '1985-2-28', '85-02-28', '1985-02-30', '1985-02-29', '1985-13-01', '1985-00-10']) {
    assert.equal(validarFechaNacimiento(f).ok, false, f);
  }
});

test('alta: código, cuenta y fecha coherentes pasan normalizados', () => {
  assert.deepEqual(validarAltaCliente({ codigo: 'cspfu2985', cuenta: 'u29000085', fecha: '1985-02-28' }), {
    ok: true,
    codigo: 'CSPFU2985',
    cuenta: 'U29000085',
    fecha: '1985-02-28',
  });
});

test('alta: sin fecha solo se compara la cuenta', () => {
  assert.deepEqual(validarAltaCliente({ codigo: 'CSPFU2985', cuenta: 'U29000085', fecha: '' }), {
    ok: true,
    codigo: 'CSPFU2985',
    cuenta: 'U29000085',
    fecha: null,
  });
});

test('alta: los 2 primeros dígitos no salen de la cuenta → no se guarda, dice qué esperaba', () => {
  const r = validarAltaCliente({ codigo: 'CSPFU2985', cuenta: 'U31000085', fecha: '' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /código dice 29.*U31000085.*empieza con 31/);
});

test('alta: los 2 últimos no salen del año → no se guarda, dice qué esperaba', () => {
  const r = validarAltaCliente({ codigo: 'CSPFU2985', cuenta: 'U29000085', fecha: '1986-02-28' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /código dice 85.*1986 termina en 86/);
});

test('alta: cada dato inválido rechaza aunque los demás estén bien', () => {
  assert.equal(validarAltaCliente({ codigo: 'CSPMU2985', cuenta: 'U29000085', fecha: '' }).ok, false);
  assert.equal(validarAltaCliente({ codigo: 'CSPFU2985', cuenta: '', fecha: '' }).ok, false);
  assert.equal(validarAltaCliente({ codigo: 'CSPFU2985', cuenta: 'U29000085', fecha: '1985-02-30' }).ok, false);
});

// ---------------------------------------------------------------------------
// Choques
// ---------------------------------------------------------------------------

function fake(opciones: { enClientes?: boolean; enAlias?: boolean; enCuenta?: boolean; error?: boolean }) {
  const llamadas: Array<{ tabla: string; metodo: string; args: unknown[] }> = [];
  const supabase = {
    from: (tabla: string) => {
      let columna = '';
      const q = {
        select: () => q,
        ilike: (...args: unknown[]) => {
          columna = String(args[0]);
          llamadas.push({ tabla, metodo: 'ilike', args });
          return q;
        },
        or: (...args: unknown[]) => (llamadas.push({ tabla, metodo: 'or', args }), q),
        limit: async () => {
          if (opciones.error) return { data: null, error: { message: 'fallo' } };
          const hay =
            tabla === 'codigos_alias'
              ? opciones.enAlias
              : columna === 'cuenta_ibkr'
                ? opciones.enCuenta
                : opciones.enClientes;
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
  assert.deepEqual(await buscarChoques(fake({ error: true }).supabase, 'X', 'U1'), { choques: [], error: true });
});

test('choques: con cuenta, la busca en clientes.cuenta_ibkr sin distinguir caja', async () => {
  const { supabase, llamadas } = fake({});
  assert.deepEqual(await buscarChoques(supabase, 'CSPFU2985', 'U29000085'), { choques: [], error: false });
  assert.deepEqual(llamadas[2], { tabla: 'clientes', metodo: 'ilike', args: ['cuenta_ibkr', 'U29000085'] });
});

test('choques: la cuenta repetida se reporta aparte del código', async () => {
  assert.deepEqual((await buscarChoques(fake({ enCuenta: true }).supabase, 'X', 'U1')).choques, ['cuenta_ibkr']);
  assert.deepEqual((await buscarChoques(fake({ enCuenta: true }).supabase, 'X')).choques, []);
});

// ---------------------------------------------------------------------------
// /nuevo-cliente usa las dos piezas antes de insertar
// ---------------------------------------------------------------------------

const PAGINA = readFileSync(new URL('../app/nuevo-cliente/page.tsx', import.meta.url), 'utf8');

test('/nuevo-cliente valida código + cuenta + fecha, busca choques y guarda lo normalizado', () => {
  const iValida = PAGINA.indexOf('validarAltaCliente(');
  const iChoques = PAGINA.indexOf('buscarChoques(');
  const iInsert = PAGINA.search(/\.from\('clientes'\)\.insert\(/);
  assert.ok(iValida > 0 && iChoques > iValida && iInsert > iChoques, 'validar → choques → insertar');
  assert.match(PAGINA, /codigo_cliente: validacion\.codigo/);
  assert.match(PAGINA, /cuenta_ibkr: validacion\.cuenta/);
  // La fecha vacía viaja como null (validarFechaNacimiento), nunca como ''.
  assert.match(PAGINA, /fecha_nacimiento: validacion\.fecha/);
  assert.match(PAGINA, /buscarChoques\(\s*supabase,\s*validacion\.codigo,\s*validacion\.cuenta,?\s*\)/);
});
