/**
 * FIX de Banxico (SF43718): lectura de la respuesta SIE, día sin FIX, la llamada
 * (sin el token en ningún mensaje), el SQL para psql, la clave y el CONTRATO con
 * fn_registrar_tipo_cambio en la réplica PGlite. Datos SINTÉTICOS.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import {
  ErrorBanxico, URL_SIE, claveFix, elegirFix, leerRespuestaSie, pedirSerie, sqlRegistroFix, type RegistroFix,
} from './banxico';

const respuesta = (datos: { fecha: string; dato: string }[]) => ({ bmx: { series: [{ idSerie: 'SF43718', titulo: 'FIX', datos }] } });
const SIE = respuesta([
  { fecha: '11/11/2026', dato: '18.4012' },
  { fecha: '12/11/2026', dato: '18.3456' },
  { fecha: '13/11/2026', dato: '18.2999' },
  { fecha: '16/11/2026', dato: 'N/E' },
]);

test('lee la respuesta SIE: fechas a AAAA-MM-DD, valores numéricos, «N/E» se omite', () => {
  assert.deepEqual(leerRespuestaSie(SIE), [
    { fecha: '2026-11-11', valor: 18.4012 },
    { fecha: '2026-11-12', valor: 18.3456 },
    { fecha: '2026-11-13', valor: 18.2999 },
  ]);
  assert.throws(() => leerRespuestaSie({ bmx: { series: [] } }), /no trae la serie/);
  assert.throws(() => leerRespuestaSie(respuesta([{ fecha: '2026-11-13', dato: '1' }])), /forma inesperada/);
});

test('el FIX de la fecha pedida, sin nota', () => {
  assert.deepEqual(elegirFix(leerRespuestaSie(SIE), '2026-11-13'), { fecha: '2026-11-13', valor: 18.2999, nota: null });
});

test('día sin FIX: el último publicado ANTES, con nota; nunca uno posterior', () => {
  const f = elegirFix(leerRespuestaSie(SIE), '2026-11-16');
  assert.deepEqual([f.fecha, f.valor], ['2026-11-13', 18.2999]);
  assert.match(f.nota ?? '', /Sin FIX el 2026-11-16; se toma el del 2026-11-13/);
  assert.throws(() => elegirFix(leerRespuestaSie(SIE), '2026-11-10'), (e: unknown) => e instanceof ErrorBanxico);
});

function fetchFalso(status: number, cuerpo: unknown) {
  const llamadas: { url: string; headers: Record<string, string> }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    llamadas.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(JSON.stringify(cuerpo), { status });
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

test('pide la serie con el token solo en el encabezado Bmx-Token', async () => {
  const { f, llamadas } = fetchFalso(200, SIE);
  const datos = await pedirSerie('SF43718', '2026-11-03', '2026-11-13', { token: 'TOKENSECRETO', fetch: f });
  assert.equal(datos.length, 3);
  assert.equal(llamadas[0].url, `${URL_SIE}/SF43718/datos/2026-11-03/2026-11-13`);
  assert.equal(llamadas[0].headers['Bmx-Token'], 'TOKENSECRETO');
  assert.equal(llamadas[0].url.includes('TOKENSECRETO'), false);
});

test('token rechazado, error de red o rango inválido: mensaje sin el token', async () => {
  const sinToken = (e: unknown) => e instanceof ErrorBanxico && !e.message.includes('TOKENSECRETO');
  await assert.rejects(pedirSerie('SF43718', '2026-11-03', '2026-11-13', { token: 'TOKENSECRETO', fetch: fetchFalso(401, {}).f }), sinToken);
  const red = (async () => { throw new Error('getaddrinfo TOKENSECRETO'); }) as unknown as typeof fetch;
  await assert.rejects(pedirSerie('SF43718', '2026-11-03', '2026-11-13', { token: 'TOKENSECRETO', fetch: red }), sinToken);
  const { f, llamadas } = fetchFalso(200, SIE);
  await assert.rejects(pedirSerie('SF43718', '2026-11-13', '2026-11-03', { token: 't', fetch: f }), /Rango/);
  assert.equal(llamadas.length, 0);
});

const REG: RegistroFix = { serie: 'SF43718', fecha: '2026-11-13', valor: 18.2999, fecha_solicitada: '2026-11-16',
  fuente: 'Banxico SIE SF43718 (prueba)', nota: 'Sin FIX el 2026-11-16; se toma el del 2026-11-13.' };

test('sqlRegistroFix: claims con el usuario, ROLLBACK en ensayo y COMMIT en real; rechaza lo que no es correo o rompe el literal', () => {
  const ensayo = sqlRegistroFix(REG, 'ensayo', 'operador@replica.test');
  assert.match(ensayo, /"email":"operador@replica\.test"/);
  assert.match(ensayo, /\nrollback;\n$/);
  assert.match(sqlRegistroFix(REG, 'real', 'operador@replica.test'), /\ncommit;\n$/);
  assert.throws(() => sqlRegistroFix(REG, 'real', "x'--@a.b"), /correo/);
  assert.throws(() => sqlRegistroFix({ ...REG, nota: 'a $t$; drop table x' }, 'real', 'operador@replica.test'), /literal/);
  assert.throws(() => sqlRegistroFix({ ...REG, valor: 0 }, 'real', 'operador@replica.test'), /forma inválida/);
});

test('la clave depende del dato, no de la fuente ni de la nota', () => {
  assert.equal(claveFix(REG), claveFix({ ...REG, fuente: 'otra', nota: null } as RegistroFix));
  assert.notEqual(claveFix(REG), claveFix({ ...REG, valor: 18.3 }));
});

test('contrato: fn_registrar_tipo_cambio acepta el SQL que arma la lib; el repetido se rechaza', async () => {
  const leer = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const db = new PGlite();
  await db.exec(leer('../scripts/replica/preludio.sql'));
  await db.exec(leer('../scripts/replica/base.sql'));
  await db.exec(`select set_config('request.jwt.claims', '{"email":"operador@replica.test","canal":"psql"}', false)`);
  const llamada = sqlRegistroFix(REG, 'real', 'operador@replica.test').split('\n').find((l) => l.startsWith('select json_build_object'))!;
  const r = await db.query(llamada);
  const salida = JSON.parse(Object.values(r.rows[0] as object)[0] as string);
  assert.equal(salida.resultado.valor, 18.2999);
  const fila = await db.query<{ fecha: string; valor: string; nota: string; capturado_por: string }>(
    `select fecha::text, valor::text, nota, capturado_por from public.tipo_cambio`);
  assert.deepEqual(fila.rows, [{ fecha: '2026-11-13', valor: '18.299900', nota: REG.nota, capturado_por: 'operador@replica.test' }]);
  await assert.rejects(db.query(llamada), /no se reescribe/);
  await db.close();
}, 120_000);
