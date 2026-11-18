/**
 * El parser sin Node (lib/ibkr-flex-lectura.ts): que de verdad no dependa de Node,
 * que lea exactamente lo mismo que parsearFlex, que su sha256 (Web Crypto) sea el
 * de node:crypto y el paso «recoger» de una sola consulta. Datos SINTÉTICOS.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('server-only', () => ({}));
const lectura = await import('./ibkr-flex-lectura');
const { parsearFlex } = await import('./ibkr-flex');

const XML = readFileSync(new URL('./__fixtures__/flex-sintetico.xml', import.meta.url), 'utf8');
const TD = '20261109';

test('sin dependencias de Node: ni node:, ni server-only, ni process (fuera de comentarios)', () => {
  const codigo = readFileSync(new URL('./ibkr-flex-lectura.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(codigo, /['"]node:/);
  assert.doesNotMatch(codigo, /server-only/);
  assert.doesNotMatch(codigo, /\bprocess\b/);
  assert.doesNotMatch(codigo, /\bBuffer\b/);
});

test('sha256Hex (Web Crypto) = createHash de node:crypto, también con acentos y «&»', async () => {
  for (const t of [XML, 'Año & «niño»', '']) {
    assert.equal(await lectura.sha256Hex(t), createHash('sha256').update(t, 'utf8').digest('hex'));
  }
});

test('leerFlex con el sha256 de Web Crypto lee exactamente lo mismo que parsearFlex', async () => {
  assert.deepEqual(lectura.leerFlex(XML, TD, await lectura.sha256Hex(XML)), parsearFlex(XML, TD));
  assert.throws(() => lectura.leerFlex(XML, TD, 'no-es-un-hash'), /sha256/);
});

const respuesta = (cuerpo: string) => new Response(cuerpo, { status: 200 });
const servicio = (codigo: string) =>
  `<FlexStatementResponse><Status>Warn</Status><ErrorCode>${codigo}</ErrorCode><ErrorMessage>x</ErrorMessage></FlexStatementResponse>`;
const libre = { turno: async () => undefined } as unknown as InstanceType<typeof lectura.Limitador>;

test('consultarReporte: una sola consulta; 1019 → no listo; XML → listo; otro código → error sin el token', async () => {
  const llamadas: string[] = [];
  const deps = (cuerpo: string) => ({ token: 'TOKENSECRETO123', queryId: '1', limitador: libre,
    fetch: (async (url: string) => { llamadas.push(String(url)); return respuesta(cuerpo); }) as unknown as typeof fetch });
  assert.deepEqual(await lectura.consultarReporte('REF1', deps(servicio('1019'))), { listo: false });
  assert.equal(llamadas.length, 1);
  const r = await lectura.consultarReporte('REF1', deps(XML));
  assert.ok(r.listo && r.xml === XML);
  await assert.rejects(lectura.consultarReporte('REF1', deps(servicio('1012'))),
    (e: unknown) => e instanceof lectura.ErrorFlex && e.codigo === '1012' && !e.message.includes('TOKENSECRETO123'));
});

test('validarCredencialesFlex: faltantes o query no numérica, sin repetir el token', () => {
  assert.deepEqual(lectura.validarCredencialesFlex(' t0k3n ', ' 1649340 '), { token: 't0k3n', queryId: '1649340' });
  assert.throws(() => lectura.validarCredencialesFlex(undefined, '1'), /Faltan/);
  assert.throws(() => lectura.validarCredencialesFlex('TOKENSECRETO123', 'abc'),
    (e: unknown) => e instanceof Error && /numérico/.test(e.message) && !e.message.includes('TOKENSECRETO123'));
});
