/**
 * Clasificación interna de activos (M3): mirada a través, prorrateo,
 * equivalentes de efectivo, renta variable por emisor y las reglas para lo que
 * no está en el catálogo.
 *
 * Datos SINTÉTICOS: el catálogo de prueba usa tickers inventados (ZZ…). Este
 * archivo se commitea.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  CLASES_ACTIVO,
  SUBCATEGORIAS_ACCION,
  armarCatalogo,
  clasificarRenglon,
  type Clasificacion,
  type EntradaCatalogo,
  type RenglonPosicion,
} from './clasificacion-activos';

const e = (
  ticker: string,
  clase_activo: EntradaCatalogo['clase_activo'],
  extra: Partial<EntradaCatalogo> = {},
): EntradaCatalogo => ({ ticker, clase_activo, elegible: true, es_equivalente_efectivo: false, duracion_efectiva: null, ...extra });

const CATALOGO = armarCatalogo(
  [
    e('ZZGOB', 'GOB_EXT', { duracion_efectiva: 7 }),
    e('ZZBIL', 'GOB_EXT', { es_equivalente_efectivo: true, duracion_efectiva: 0.15 }),
    e('ZZMMF', 'EFECTIVO', { es_equivalente_efectivo: true, duracion_efectiva: 0.1 }),
    e('ZZMIX', 'MIXTO', { duracion_efectiva: 6 }),
    e('ZZHUE', 'MIXTO', { duracion_efectiva: 5 }),
    e('ZZORO', 'COMMODITY', { elegible: false }),
    e('ZZMXADR', 'ACC_BMV'),
    e('ZZSIC', 'ACC_SIC'),
  ],
  [
    { ticker: 'ZZMIX', clase_activo: 'GOB_EXT', factor: 0.7 },
    { ticker: 'ZZMIX', clase_activo: 'CORP_IG', factor: 0.29 },
    { ticker: 'ZZMIX', clase_activo: 'EFECTIVO', factor: 0.01 },
  ],
);

const pos = (ticker: string, asset: string | null, sub: string | null, valor = 1000): RenglonPosicion => ({
  tipo_renglon: 'posicion',
  ticker,
  asset_category: asset,
  sub_category: sub,
  valor_base: valor,
});

/** Invariante: las fracciones suman el valor del renglón, sin perder ni duplicar. */
function sumaCuadra(c: Clasificacion, valor: number) {
  const s = c.fracciones.reduce((a, f) => a + f.valor_base, 0);
  assert.ok(Math.abs(s - valor) < 1e-9, `fracciones suman ${s}, no ${valor}`);
}

test('CLASES_ACTIVO es el espejo exacto del CHECK catalogo_clase_valida', () => {
  const m = readFileSync(
    fileURLToPath(new URL('../migraciones/2026-11-11-01-catalogo-y-checks.sql', import.meta.url)),
    'utf8',
  ).match(/add constraint catalogo_clase_valida check \(clase_activo in \(([\s\S]*?)\)\);/);
  assert.ok(m);
  const delCheck = m[1].split(',').map((v) => v.trim().replace(/'/g, ''));
  assert.deepEqual([...CLASES_ACTIVO].sort(), delCheck.sort());
});

test('en el catálogo: una fracción de 100 % con la clase del subyacente y su duración', () => {
  const c = clasificarRenglon(pos('ZZGOB', 'STK', 'ETF'), CATALOGO);
  assert.deepEqual(c.avisos, []);
  assert.equal(c.fracciones.length, 1);
  assert.deepEqual(
    { ...c.fracciones[0] },
    { clase: 'GOB_EXT', factor: 1, valor_base: 1000, elegible: true, liquidez: false, equivalente_efectivo: false,
      duracion_efectiva: 7, origen: 'catalogo' },
  );
});

test('equivalente de efectivo: cuenta para liquidez Y se queda en su clase', () => {
  const [f] = clasificarRenglon(pos('ZZBIL', 'STK', 'ETF'), CATALOGO).fracciones;
  assert.equal(f.clase, 'GOB_EXT');
  assert.equal(f.liquidez, true);
  assert.equal(f.equivalente_efectivo, true);
});

test('money market regulado: EFECTIVO y equivalente de efectivo', () => {
  const [f] = clasificarRenglon(pos('ZZMMF', 'FUND', null), CATALOGO).fracciones;
  assert.equal(f.clase, 'EFECTIVO');
  assert.equal(f.liquidez, true);
  assert.equal(f.equivalente_efectivo, true);
});

test('MIXTO: se reparte por prorrateo, cada fracción con la duración del ETF', () => {
  const c = clasificarRenglon(pos('ZZMIX', 'STK', 'ETF', 2000), CATALOGO);
  assert.deepEqual(c.avisos, []);
  assert.deepEqual(
    c.fracciones.map((f) => [f.clase, f.valor_base, f.duracion_efectiva, f.liquidez, f.origen]),
    [
      ['GOB_EXT', 1400, 6, false, 'prorrateo'],
      ['CORP_IG', 580, 6, false, 'prorrateo'],
      ['EFECTIVO', 20, 6, true, 'prorrateo'],
    ],
  );
  sumaCuadra(c, 2000);
});

test('MIXTO sin prorrateo: NO_CATALOGADO crítico, no se reparte ni se adivina', () => {
  const c = clasificarRenglon(pos('ZZHUE', 'STK', 'ETF'), CATALOGO);
  assert.deepEqual(c.fracciones.map((f) => [f.clase, f.elegible]), [['NO_CATALOGADO', false]]);
  assert.deepEqual(c.avisos.map((a) => [a.nivel, a.codigo]), [['critico', 'MIXTO_SIN_PRORRATEO']]);
});

test('MIXTO con un prorrateo que no suma 1: crítico', () => {
  const cat = armarCatalogo([e('ZZMAL', 'MIXTO')], [{ ticker: 'ZZMAL', clase_activo: 'GOB_EXT', factor: 0.9 }]);
  assert.equal(clasificarRenglon(pos('ZZMAL', 'STK', 'ETF'), cat).avisos[0]?.codigo, 'MIXTO_SIN_PRORRATEO');
});

test('no elegible en el catálogo (COMMODITY): se respeta', () => {
  const [f] = clasificarRenglon(pos('ZZORO', 'STK', 'ETF'), CATALOGO).fracciones;
  assert.deepEqual([f.clase, f.elegible], ['COMMODITY', false]);
});

test('renta variable por emisor: un ADR de emisora mexicana catalogado como ACC_BMV sigue siendo ACC_BMV', () => {
  assert.equal(clasificarRenglon(pos('ZZMXADR', 'STK', 'ADR'), CATALOGO).fracciones[0].clase, 'ACC_BMV');
  assert.equal(clasificarRenglon(pos('ZZSIC', 'STK', 'COMMON'), CATALOGO).fracciones[0].clase, 'ACC_SIC');
});

test('ETF fuera del catálogo: ACC_SIC elegible, con aviso que pide verificar emisor', () => {
  const c = clasificarRenglon(pos('ZZNUEVO', 'STK', 'ETF'), CATALOGO);
  assert.deepEqual(c.fracciones.map((f) => [f.clase, f.elegible, f.origen]), [['ACC_SIC', true, 'regla']]);
  assert.deepEqual(c.avisos.map((a) => [a.nivel, a.codigo]), [['aviso', 'ETF_FUERA_DE_CATALOGO']]);
  assert.match(c.avisos[0].mensaje, /ACC_BMV/);
});

test('acción fuera del catálogo (COMMON, ADR, NY REG SHRS, GDR): ACC_SIC elegible, con aviso', () => {
  assert.deepEqual([...SUBCATEGORIAS_ACCION], ['COMMON', 'ADR', 'NY REG SHRS', 'GDR']);
  for (const sub of SUBCATEGORIAS_ACCION) {
    const c = clasificarRenglon(pos('ZZACC', 'STK', sub), CATALOGO);
    assert.deepEqual(c.fracciones.map((f) => [f.clase, f.elegible]), [['ACC_SIC', true]], sub);
    assert.deepEqual(c.avisos.map((a) => [a.nivel, a.codigo]), [['aviso', 'ACCION_FUERA_DE_CATALOGO']], sub);
  }
});

test('opción y futuro fuera del catálogo: DERIVADO no elegible, sin aviso de catálogo', () => {
  for (const asset of ['OPT', 'FUT']) {
    const c = clasificarRenglon(pos('ZZ  261218C00200000', asset, 'C'), CATALOGO);
    assert.deepEqual(c.fracciones.map((f) => [f.clase, f.elegible]), [['DERIVADO', false]], asset);
    assert.deepEqual(c.avisos, [], asset);
  }
});

test('desconocido (FUND, BOND, CLOSED-END FUND, STK sin subcategoría): NO_CATALOGADO crítico', () => {
  for (const [asset, sub] of [['FUND', null], ['BOND', null], ['STK', 'CLOSED-END FUND'], ['STK', null], [null, null]] as const) {
    const c = clasificarRenglon(pos('ZZRARO', asset, sub), CATALOGO);
    assert.deepEqual(c.fracciones.map((f) => [f.clase, f.elegible]), [['NO_CATALOGADO', false]], `${asset}/${sub}`);
    assert.deepEqual(c.avisos.map((a) => [a.nivel, a.codigo]), [['critico', 'NO_CATALOGADO']], `${asset}/${sub}`);
  }
});

test('renglón de efectivo: EFECTIVO, cuenta como liquidez', () => {
  const c = clasificarRenglon({ tipo_renglon: 'efectivo', ticker: 'EFECTIVO', asset_category: null, sub_category: null, valor_base: 500 }, CATALOGO);
  assert.deepEqual(c.fracciones.map((f) => [f.clase, f.liquidez, f.valor_base]), [['EFECTIVO', true, 500]]);
});

test('renglón NAV_IBKR: se rechaza, es de control', () => {
  assert.throws(
    () => clasificarRenglon({ tipo_renglon: 'nav_ibkr', ticker: 'NAV_IBKR', asset_category: null, sub_category: null, valor_base: 9 }, CATALOGO),
    /control/,
  );
});

test('un valor negativo conserva su signo en todas las fracciones', () => {
  const c = clasificarRenglon(pos('ZZMIX', 'STK', 'ETF', -100), CATALOGO);
  assert.ok(c.fracciones.every((f) => f.valor_base < 0));
  sumaCuadra(c, -100);
});

test('invariante: en todos los casos las fracciones suman el valor del renglón', () => {
  for (const [t, a, s] of [
    ['ZZGOB', 'STK', 'ETF'], ['ZZMIX', 'STK', 'ETF'], ['ZZHUE', 'STK', 'ETF'], ['ZZNUEVO', 'STK', 'ETF'],
    ['ZZACC', 'STK', 'GDR'], ['ZZOPC', 'OPT', 'P'], ['ZZRARO', 'BOND', null],
  ] as const) {
    sumaCuadra(clasificarRenglon(pos(t, a, s, 1234.5), CATALOGO), 1234.5);
  }
});
