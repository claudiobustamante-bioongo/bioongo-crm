/**
 * Carga de la foto diaria (M2, fase 1): qué cuentas entran, la respuesta sin NAV,
 * el SQL para psql, la clave de confirmación y el CONTRATO con la base: la carga
 * que arma la lib, corrida contra fn_cargar_ibkr en la réplica PGlite con el
 * esquema real (scripts/replica/base.sql).
 *
 * Datos SINTÉTICOS (lib/__fixtures__/flex-sintetico.xml y cuentas inventadas).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

vi.mock('server-only', () => ({}));

const flex = await import('./ibkr-flex');
const {
  ErrorCarga,
  claveConfirmacion,
  cuentasCargables,
  exigirConfirmacion,
  sqlCarga,
  sqlLlamada,
  validarRespuesta,
} = await import('./ibkr-carga');
type CuentaReferencia = import('./ibkr-carga').CuentaReferencia;

const leer = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const XML = leer('./__fixtures__/flex-sintetico.xml');
const TD = '20261109';

const ref = (cuenta: string, codigo: string, extra: Partial<CuentaReferencia> = {}): CuentaReferencia => ({
  cuenta_ibkr: cuenta, codigo_cliente: codigo, tipo: 'individual', status: 'vigente',
  fecha_baja: null, fecha_cierre: null, es_propia: false, ...extra,
});
// U0000001 vigente y propia; U0000002 con baja; U0000003 cerrada en IBKR.
const REF: CuentaReferencia[] = [
  ref('U0000001', 'CSPFU9001', { es_propia: true }),
  ref('U0000002', 'CSPFU9002', { status: 'baja', fecha_baja: '2026-10-22' }),
  ref('U0000003', 'CSPFU9003', { fecha_cierre: '2023-01-20' }),
];

function armar(xml = XML) {
  const rep = flex.parsearFlex(xml, TD);
  return flex.armarCargaFoto(rep, [], cuentasCargables(REF));
}

// --- Reglas puras ----------------------------------------------------------------------

test('solo entran cuentas ni cerradas ni de baja; es_propia no cambia nada en la carga', () => {
  assert.deepEqual(cuentasCargables(REF).map((c) => c.cuenta_ibkr), ['U0000001']);
  const c = armar();
  assert.deepEqual([...new Set(c.posiciones.map((p) => p.cuenta_ibkr))], ['U0000001']);
  assert.equal(c.ignoradas, 4);
  assert.equal(JSON.stringify(c).includes('es_propia'), false);
});

const sinNav = XML.replace(/<EquitySummaryInBase>[\s\S]*?<\/EquitySummaryInBase>/g, '');

test('IBKR sin NAV en ninguna cuenta: no se carga (SIN_NAV)', () => {
  const rep = flex.parsearFlex(sinNav, TD);
  assert.throws(() => validarRespuesta(rep), (e: unknown) => e instanceof ErrorCarga && e.codigo === 'SIN_NAV');
});

test('si solo algunas cuentas se descartan, la respuesta sirve', () => {
  assert.doesNotThrow(() => validarRespuesta(flex.parsearFlex(XML, TD)));
});

test('sqlCarga: claims con el usuario, ROLLBACK en ensayo y COMMIT en real', () => {
  const c = armar();
  const ensayo = sqlCarga(c, 'ensayo', 'operador@replica.test');
  const real = sqlCarga(c, 'real', 'operador@replica.test');
  assert.match(ensayo, /"email":"operador@replica\.test","canal":"psql"/);
  assert.match(ensayo, /\nrollback;\n$/);
  assert.equal(ensayo.includes('commit;'), false);
  assert.match(real, /\ncommit;\n$/);
  assert.equal(real.includes('rollback;'), false);
  assert.throws(() => sqlCarga(c, 'real', "x'); drop table x;--@a.b"), (e: unknown) => e instanceof ErrorCarga && e.codigo === 'USUARIO');
});

test('una carga que intenta cerrar el literal $carga$ se rechaza', () => {
  const c = armar();
  c.posiciones[0].descripcion = 'x$carga$; drop table bitacora; --';
  assert.throws(() => sqlLlamada(c), (e: unknown) => e instanceof ErrorCarga && e.codigo === 'LITERAL');
});

test('la clave depende de las posiciones, no del sha del XML ni de los descuadres', () => {
  const a = armar();
  const b = { ...armar(), xml_sha256: 'f'.repeat(64), descuadres: [] };
  assert.equal(claveConfirmacion(a), claveConfirmacion(b));
  assert.doesNotThrow(() => exigirConfirmacion(b, claveConfirmacion(a)));
  const cambiada = armar(XML.replace('positionValue="5000" levelOfDetail="SUMMARY"', 'positionValue="5001" levelOfDetail="SUMMARY"'));
  assert.notEqual(claveConfirmacion(cambiada), claveConfirmacion(a));
  assert.throws(() => exigirConfirmacion(cambiada, claveConfirmacion(a)), (e: unknown) => e instanceof ErrorCarga && e.codigo === 'CONFIRMACION');
});

// --- Contrato con la base (réplica PGlite) ------------------------------------------------

test('contrato: fn_cargar_ibkr acepta la carga de la lib; escribe la foto, la carga y el asiento; una fecha repetida se rechaza', async () => {
  const db = new PGlite();
  await db.exec(leer('../scripts/replica/preludio.sql'));
  await db.exec(leer('../scripts/replica/base.sql'));
  await db.exec(`
    insert into public.clientes (codigo_cliente, status, cuenta_ibkr) values ('CSPFU9001', 'vigente', 'U0000001');
    insert into public.cuentas_ibkr (cuenta_ibkr, codigo_cliente, tipo, es_propia) values ('U0000001', 'CSPFU9001', 'individual', true);
  `);
  const c = armar();
  await db.exec(`select set_config('request.jwt.claims', '{"email":"operador@replica.test","canal":"psql"}', false)`);
  const r = await db.query<{ text: string }>(sqlLlamada(c));
  const resultado = JSON.parse(Object.values(r.rows[0])[0] as string);
  assert.equal(resultado.renglones, c.posiciones.length);

  const conteo = await db.query<{ n: number; td: string; asientos: number }>(`
    select (select count(*)::int from public.posiciones_detalle) n,
           (select td::text from public.sync_ibkr) td,
           (select count(*)::int from public.bitacora where accion = 'carga_ibkr' and usuario = 'operador@replica.test') asientos`);
  assert.deepEqual(conteo.rows[0], { n: 5, td: '2026-11-09', asientos: 1 });

  const otra = { ...c, xml_sha256: 'e'.repeat(64) };
  await assert.rejects(db.query(sqlLlamada(otra)), /ya tiene foto/);
  await db.close();
}, 120_000);
