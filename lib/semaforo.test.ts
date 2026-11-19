/**
 * Semáforo (M5): perfil por cuenta y cada compuerta y prueba del motor.
 * Datos SINTÉTICOS: tickers ZZ…, cuentas U9…, códigos CSPFU90xx. Los límites son
 * los de M4 (migraciones/2026-11-12-01-parametros-ips.sql) para los perfiles y
 * fases que se usan aquí.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { armarCatalogo, type EntradaCatalogo, type RenglonPosicion } from './clasificacion-activos';
import { resolverPerfilCuenta, type CuentaParaPerfil, type PerfilPersona } from './perfil-cuenta';
import { evaluarCuenta, type EntradaEvaluacion, type ParametrosM4 } from './semaforo';

// --- Datos sintéticos -------------------------------------------------------------------

const e = (ticker: string, clase_activo: EntradaCatalogo['clase_activo'], extra: Partial<EntradaCatalogo> = {}): EntradaCatalogo =>
  ({ ticker, clase_activo, elegible: true, es_equivalente_efectivo: false, duracion_efectiva: null, ...extra });
const CATALOGO = armarCatalogo([
  e('ZZACC', 'ACC_SIC'), e('ZZMX', 'ACC_BMV'),
  e('ZZGOBL', 'GOB_EXT', { duracion_efectiva: 7 }), e('ZZGOBC', 'GOB_EXT', { duracion_efectiva: 1.85 }),
  e('ZZGOBN', 'GOB_EXT'), e('ZZBIL', 'GOB_EXT', { es_equivalente_efectivo: true, duracion_efectiva: 0.15 }),
  e('ZZBILN', 'GOB_EXT', { es_equivalente_efectivo: true }), e('ZZGOB3', 'GOB_EXT', { duracion_efectiva: 3 }),
  e('ZZORO', 'COMMODITY', { elegible: false }), e('ZZCORP', 'CORP_IG'), e('ZZCORPC', 'CORP_IG', { duracion_efectiva: 1.5 }),
], []);

const M4: ParametrosM4 = {
  limitesFase: {
    Acumulacion: { rv_max_pct: 75, rf_min_pct: 20, liquidez_min_pct: 5 },
    Consolidacion: { rv_max_pct: 60, rf_min_pct: 30, liquidez_min_pct: 10 },
    Retiro: { rv_max_pct: 40, rf_min_pct: 50, liquidez_min_pct: 10 },
  },
  limitesPerfil: {
    'Libre de Riesgo': { GOB_EXT: 100, CORP_IG: 0, ACC_SIC: 0, ACC_BMV: 0, COMMODITY: 0 },
    Bajo: { GOB_EXT: 100, CORP_IG: 60, ACC_SIC: 20, ACC_BMV: 10, COMMODITY: 0 },
    Moderado: { GOB_EXT: 70, CORP_IG: 50, ACC_SIC: 60, ACC_BMV: 30, COMMODITY: 0 },
  },
  reglasPerfil: {
    'Libre de Riesgo': { duracion_gob_menor_a: 3, liquidez_min_pct: 5, efectivo_cuenta_rf: true, rv_total_max_pct: 0 },
    Bajo: { duracion_gob_menor_a: null, liquidez_min_pct: 5, efectivo_cuenta_rf: false, rv_total_max_pct: 20 },
    Moderado: { duracion_gob_menor_a: null, liquidez_min_pct: 5, efectivo_cuenta_rf: false, rv_total_max_pct: 60 },
  },
  navResidualMxn: 1000,
  saldoDeudorToleranciaPct: 1,
};

const pos = (ticker: string, valor: number): RenglonPosicion =>
  ({ tipo_renglon: 'posicion', ticker, asset_category: 'STK', sub_category: 'ETF', valor_base: valor });
const caja = (valor: number): RenglonPosicion =>
  ({ tipo_renglon: 'efectivo', ticker: 'EFECTIVO', asset_category: null, sub_category: null, valor_base: valor });

type PerfilOk = Extract<ReturnType<typeof resolverPerfilCuenta>, { ok: true }>;
const perfilOk = (perfil: PerfilOk['perfil'], fases: string[] = ['Acumulacion']): PerfilOk => ({
  ok: true, perfil, fases: fases.map((f, i) => ({ fase: f, origen: `CSPFU900${i}` })), fecha_ips: '2026-09-29',
  origen: fases.length > 1 ? 'conjunta' : 'individual', fuentes: [], ips_pendiente: [],
});

const entrada = (x: Partial<EntradaEvaluacion> & { renglones?: RenglonPosicion[] }): EntradaEvaluacion => ({
  cuenta_ibkr: 'U9000001', es_propia: false, perfil: perfilOk('Moderado'), tipo_cambio: null, catalogo: CATALOGO, parametros: M4,
  foto: { moneda_base: 'MXN', nav_ibkr: 100_000, renglones: x.renglones ?? [pos('ZZACC', 50_000), pos('ZZGOBC', 40_000), caja(10_000)] },
  ...x,
});
const pruebas = (ev: ReturnType<typeof evaluarCuenta>) => ev.hallazgos.map((h) => `${h.prueba}:${h.severidad}`).sort();

// --- Perfil por cuenta -------------------------------------------------------------------

const pp = (codigo: string, perfil: string | null, fase: string | null, extra: Partial<PerfilPersona> = {}): PerfilPersona =>
  ({ codigo, perfil, fase, fecha_calculo: '2026-09-29', fecha_cuestionario: '2026-08-10', ips_firmado: true, ...extra });
const PERFILES = new Map<string, PerfilPersona>([
  ['CSPFU9001', pp('CSPFU9001', 'Alto', 'Aceleracion')],
  ['CSPFU9002', pp('CSPFU9002', 'Bajo', 'Retiro')],
  ['CSPFU9003', pp('CSPFU9003', null, null)],
  ['CSPFU9004', pp('CSPFU9004', 'Moderado', 'Consolidacion', { fecha_cuestionario: '2023-01-01', ips_firmado: false })],
  ['CSPFU9005', pp('CSPFU9005', 'Moderado', 'Acumulacion', { fecha_calculo: '2024-01-10' })],
]);
const cuenta = (tipo: 'individual' | 'conjunta', ips: (string | null)[], fijado: string | null = null): CuentaParaPerfil => ({
  cuenta_ibkr: 'U9000001', tipo, codigo_ips_fijado: fijado,
  titulares: ips.map((c, i) => ({ rol: i === 0 ? 'titular' : 'cotitular', codigo_ips: c, codigo_ficha: c ?? `SINIPS${i}` })),
});
const resolver = (c: CuentaParaPerfil) => resolverPerfilCuenta(c, PERFILES, '2026-11-13', 2);

test('perfil individual: el del titular, con su fase', () => {
  const p = resolver(cuenta('individual', ['CSPFU9001']));
  assert.ok(p.ok);
  assert.deepEqual([p.perfil, p.origen, p.fases], ['Alto', 'individual', [{ fase: 'Aceleracion', origen: 'CSPFU9001' }]]);
});

test('perfil conjunto: el más conservador, con la fase de cada titular', () => {
  const p = resolver(cuenta('conjunta', ['CSPFU9001', 'CSPFU9002']));
  assert.ok(p.ok);
  assert.equal(p.perfil, 'Bajo');
  assert.deepEqual(p.fases.map((f) => f.fase), ['Aceleracion', 'Retiro']);
});

test('conjunta con un titular sin perfil: SIN_PERFIL con el faltante', () => {
  const p = resolver(cuenta('conjunta', ['CSPFU9003', 'CSPFU9001']));
  assert.ok(!p.ok);
  assert.deepEqual(p.faltantes, ['CSPFU9003']);
  const sinIps = resolver(cuenta('conjunta', [null, 'CSPFU9001']));
  assert.ok(!sinIps.ok);
});

test('IPS fijado: la cuenta usa ese perfil y no combina a sus titulares', () => {
  const p = resolver(cuenta('conjunta', ['CSPFU9003', 'CSPFU9004'], 'CSPFU9004'));
  assert.ok(p.ok);
  assert.deepEqual([p.perfil, p.origen], ['Moderado', 'fijado']);
});

test('IPS vencido (fecha de cálculo de más de 2 años): SIN_PERFIL', () => {
  const p = resolver(cuenta('individual', ['CSPFU9005']));
  assert.ok(!p.ok);
  assert.match(p.motivo, /vencido/);
});

test('«actualización de IPS pendiente»: cuestionario viejo o sin IPS firmado, sin cambiar el perfil', () => {
  const p = resolver(cuenta('individual', ['CSPFU9004']));
  assert.ok(p.ok);
  assert.equal(p.ips_pendiente.length, 2);
  const limpio = resolver(cuenta('individual', ['CSPFU9001']));
  assert.ok(limpio.ok);
  assert.deepEqual(limpio.ips_pendiente, []);
});

// --- Compuertas ----------------------------------------------------------------------------

test('cuenta propia: EXENTO, con los hallazgos como informativos', () => {
  const ev = evaluarCuenta(entrada({ es_propia: true, renglones: [pos('ZZORO', 50_000), pos('ZZGOBC', 50_000)] }));
  assert.equal(ev.estado, 'EXENTO');
  assert.ok(ev.hallazgos.length > 0 && ev.hallazgos.every((h) => h.informativo));
});

test('sin perfil: SIN_PERFIL; sin foto: SIN_DATOS', () => {
  assert.equal(evaluarCuenta(entrada({ perfil: { ok: false, motivo: 'x', faltantes: [] } })).estado, 'SIN_PERFIL');
  assert.equal(evaluarCuenta(entrada({ foto: null })).estado, 'SIN_DATOS');
});

test('INACTIVA: NAV ≤ 1 000 MXN; en USD con FIX se convierte', () => {
  assert.equal(evaluarCuenta(entrada({ foto: { moneda_base: 'MXN', nav_ibkr: 900, renglones: [caja(900)] } })).estado, 'INACTIVA');
  const usd = evaluarCuenta(entrada({ tipo_cambio: 18, foto: { moneda_base: 'USD', nav_ibkr: 50, renglones: [caja(50)] } }));
  assert.equal(usd.estado, 'INACTIVA');
});

test('cuenta en USD sin FIX: NO se evalúa INACTIVA, sigue con aviso', () => {
  const ev = evaluarCuenta(entrada({ foto: { moneda_base: 'USD', nav_ibkr: 10, renglones: [pos('ZZACC', 5), pos('ZZGOBC', 4), caja(1)] } }));
  assert.notEqual(ev.estado, 'INACTIVA');
  assert.ok(ev.hallazgos.some((h) => h.prueba === 'TIPO_CAMBIO' && h.severidad === 'aviso'));
});

test('100 % efectivo: ÁMBAR «sin invertir»', () => {
  const ev = evaluarCuenta(entrada({ renglones: [caja(100_000)] }));
  assert.deepEqual([ev.estado, pruebas(ev)], ['AMBAR', ['SIN_INVERTIR:aviso']]);
});

// --- Pruebas ------------------------------------------------------------------------------

test('cartera dentro de todos los límites: VERDE', () => {
  const ev = evaluarCuenta(entrada({}));
  assert.deepEqual([ev.estado, ev.hallazgos], ['VERDE', []]);
});

test('P1: un no elegible es crítico (ROJO) y no se repite en P2', () => {
  const ev = evaluarCuenta(entrada({ renglones: [pos('ZZORO', 5_000), pos('ZZACC', 45_000), pos('ZZGOBC', 40_000), caja(10_000)] }));
  assert.equal(ev.estado, 'ROJO');
  assert.deepEqual(pruebas(ev), ['P1:critico']);
});

test('P1: fuera de catálogo con regla es aviso; desconocido es crítico', () => {
  const aviso = evaluarCuenta(entrada({ renglones: [pos('ZZNUEVO', 50_000), pos('ZZGOBC', 40_000), caja(10_000)] }));
  assert.deepEqual([aviso.estado, pruebas(aviso)], ['AMBAR', ['P1:aviso']]);
  const raro = evaluarCuenta(entrada({ renglones: [{ ...pos('ZZRARO', 10_000), asset_category: 'BOND', sub_category: null }, pos('ZZGOBC', 80_000), caja(10_000)] }));
  assert.ok(pruebas(raro).includes('P1:critico'));
});

test('P2: techo por clase del perfil (Bajo, ACC_SIC 30 % > 20 %) con su origen', () => {
  const ev = evaluarCuenta(entrada({ perfil: perfilOk('Bajo'), renglones: [pos('ZZACC', 30_000), pos('ZZGOBC', 60_000), caja(10_000)] }));
  const p2 = ev.hallazgos.find((h) => h.prueba === 'P2');
  assert.deepEqual([p2?.clase, p2?.valor_pct, p2?.limite_pct, p2?.origenes], ['ACC_SIC', 30, 20, ['perfil:Bajo']]);
});

// P2 en deuda gubernamental (1.1.0): Moderado, techo GOB_EXT 70 %. Cartera: 10 % ZZACC, 80 % gobierno, 10 % caja.
const gob = (...g: RenglonPosicion[]) => evaluarCuenta(entrada({ renglones: [pos('ZZACC', 10_000), ...g, caja(10_000)] }));
const p2De = (ev: ReturnType<typeof evaluarCuenta>) => ev.hallazgos.filter((h) => h.prueba === 'P2');

test('P2 gobierno: exceso en duración < 3 o en equivalentes → aviso «más conservadora» (ÁMBAR)', () => {
  for (const ev of [gob(pos('ZZGOBC', 80_000)), gob(pos('ZZBIL', 80_000)), gob(pos('ZZBILN', 80_000))]) {
    assert.deepEqual([ev.estado, pruebas(ev)], ['AMBAR', ['P2:aviso']]);
    assert.match(p2De(ev)[0].mensaje, /más conservadora que su perfil \(desalineada con el mandato\)/);
    assert.equal(p2De(ev)[0].larga_duracion_pct, 0);
  }
});

test('P2 gobierno: la parte larga cabe en el techo y el exceso es corto → aviso', () => {
  const ev = gob(pos('ZZGOBL', 70_000), pos('ZZGOBC', 10_000)); // larga 70 = techo; exceso 10 en 1.85
  assert.deepEqual([ev.estado, pruebas(ev), p2De(ev)[0].larga_duracion_pct], ['AMBAR', ['P2:aviso'], 70]);
});

test('P2 gobierno: exceso con duración ≥ 3 (incluida exactamente 3) o nula → incumple «larga duración» (ROJO)', () => {
  for (const [ev, larga] of [[gob(pos('ZZGOBL', 75_000), pos('ZZGOBC', 5_000)), 75], [gob(pos('ZZGOBN', 80_000)), 80],
    [gob(pos('ZZGOB3', 80_000)), 80]] as const) {
    assert.deepEqual([ev.estado, pruebas(ev), p2De(ev)[0].larga_duracion_pct], ['ROJO', ['P2:incumple'], larga]);
    assert.match(p2De(ev)[0].mensaje, /exceso de deuda gubernamental de larga duración/);
  }
});

test('P2 fuera de gobierno: todo exceso sigue incumpliendo (CORP_IG corto no se dispensa)', () => {
  const ev = evaluarCuenta(entrada({ renglones: [pos('ZZACC', 10_000), pos('ZZCORPC', 60_000), pos('ZZGOBC', 20_000), caja(10_000)] }));
  assert.deepEqual(pruebas(ev), ['P2:incumple']);
});

test('P2/P5: RV total, con el más restrictivo entre la fase y rv_total_max del perfil', () => {
  // Bajo en Acumulación: fase permite 75, el perfil 20 → manda el perfil. ACC_BMV 10 + ACC_SIC 15 = 25.
  const ev = evaluarCuenta(entrada({ perfil: perfilOk('Bajo'), renglones: [pos('ZZMX', 10_000), pos('ZZACC', 15_000), pos('ZZGOBC', 65_000), caja(10_000)] }));
  const rv = ev.hallazgos.find((h) => h.prueba === 'P4' && /Renta variable/.test(h.mensaje));
  assert.deepEqual([rv?.valor_pct, rv?.limite_pct, rv?.origenes], [25, 20, ['perfil:Bajo']]);
});

test('P3: Libre de Riesgo exige gobierno con duración < 3; nula incumple; 1.85 pasa', () => {
  const ev = evaluarCuenta(entrada({ perfil: perfilOk('Libre de Riesgo'), renglones: [pos('ZZGOBL', 40_000), pos('ZZGOBN', 20_000), pos('ZZGOBC', 30_000), caja(10_000)] }));
  assert.deepEqual(ev.hallazgos.filter((h) => h.prueba === 'P3').map((h) => h.ticker).sort(), ['ZZGOBL', 'ZZGOBN']);
});

test('P4: RF mínimo; en Libre de Riesgo el efectivo cuenta, en Bajo no', () => {
  const renglones = [pos('ZZGOBC', 40_000), caja(60_000)];
  const lr = evaluarCuenta(entrada({ perfil: perfilOk('Libre de Riesgo', ['Retiro']), renglones }));
  assert.equal(lr.hallazgos.some((h) => /Renta fija/.test(h.mensaje)), false);
  const bajo = evaluarCuenta(entrada({ perfil: perfilOk('Bajo', ['Retiro']), renglones }));
  const rf = bajo.hallazgos.find((h) => /Renta fija/.test(h.mensaje));
  assert.deepEqual([rf?.valor_pct, rf?.limite_pct], [40, 50]);
});

test('P4: liquidez con equivalentes de efectivo; bajo el mínimo incumple', () => {
  const conEquiv = evaluarCuenta(entrada({ renglones: [pos('ZZACC', 50_000), pos('ZZGOBC', 40_000), pos('ZZBIL', 9_000), caja(1_000)] }));
  assert.equal(conEquiv.hallazgos.some((h) => /Liquidez/.test(h.mensaje)), false);
  const sin = evaluarCuenta(entrada({ renglones: [pos('ZZACC', 50_000), pos('ZZGOBC', 49_000), caja(1_000)] }));
  assert.ok(sin.hallazgos.some((h) => /Liquidez/.test(h.mensaje) && h.severidad === 'incumple'));
});

test('P5: en una conjunta, el límite más restrictivo con TODOS sus orígenes', () => {
  const ev = evaluarCuenta(entrada({ perfil: perfilOk('Moderado', ['Consolidacion', 'Retiro']), renglones: [pos('ZZACC', 50_000), pos('ZZGOBC', 45_000), caja(5_000)] }));
  const lim = ev.limites_aplicados as Record<string, { valor: number; origenes: string[] }>;
  assert.deepEqual(lim.rv_max, { valor: 40, origenes: ['fase:Retiro(CSPFU9001)'] });
  assert.deepEqual(lim.rf_min, { valor: 50, origenes: ['fase:Retiro(CSPFU9001)'] });
  assert.deepEqual(lim.liquidez_min, { valor: 10, origenes: ['fase:Consolidacion(CSPFU9000)', 'fase:Retiro(CSPFU9001)'] });
  assert.equal(ev.estado, 'ROJO');
});

test('saldo deudor (1.2.0, con el efectivo TOTAL = NAV − posiciones): ≤ 1 % aviso; > 1 % incumple', () => {
  // Posiciones 100 500 y NAV 100 000 → efectivo total −500 (0.5 % de los positivos). El liquidado, igual.
  const foto = (posiciones: number, nav: number) =>
    ({ moneda_base: 'MXN', nav_ibkr: nav, renglones: [pos('ZZACC', 50_000), pos('ZZGOBC', 40_000), pos('ZZBIL', posiciones - 90_000), caja(nav - posiciones)] });
  const poco = evaluarCuenta(entrada({ foto: foto(100_500, 100_000) }));
  assert.deepEqual([poco.estado, pruebas(poco)], ['AMBAR', ['SALDO_DEUDOR:aviso']]);
  const mucho = evaluarCuenta(entrada({ foto: foto(102_000, 100_000) }));
  assert.deepEqual([mucho.estado, pruebas(mucho)], ['ROJO', ['SALDO_DEUDOR:incumple']]);
});

test('saldo deudor: un liquidado negativo por una compra por liquidar NO es deudor si el total es positivo', () => {
  // Total 5 000 (NAV − posiciones) pero liquidado −20 000: la compra aún no liquida; no hay préstamo.
  const ev = evaluarCuenta(entrada({ foto: { moneda_base: 'MXN', nav_ibkr: 100_000,
    renglones: [pos('ZZACC', 50_000), pos('ZZGOBC', 35_000), pos('ZZBIL', 10_000), caja(-20_000)] } }));
  assert.equal((ev.metricas as { saldo_deudor_pct: number }).saldo_deudor_pct, 0);
  assert.deepEqual(pruebas(ev), ['LIQUIDEZ_DESFASADA:informativo']);
  assert.equal(ev.estado, 'VERDE');
});

// Caso CSPFU1390 (18-nov), sintético: compra por liquidar → el liquidado (40 000) es MAYOR que el total (5 000).
const COMPRA = { moneda_base: 'MXN', nav_ibkr: 100_000, renglones: [pos('ZZACC', 20_000), pos('ZZGOBC', 75_000), caja(40_000)] };
// Venta por liquidar → el liquidado (2 000) es MENOR que el total (20 000).
const VENTA = { moneda_base: 'MXN', nav_ibkr: 100_000,
  renglones: [pos('ZZACC', 18_000), pos('ZZGOBC', 52_000), pos('ZZBIL', 10_000), caja(2_000)] };

test('compra por liquidar (caso CSPFU1390): la composición va sobre el NAV, no sobre el liquidado inflado', () => {
  const ev = evaluarCuenta(entrada({ foto: COMPRA }));
  const m = ev.metricas as Record<string, number>;
  // Con el liquidado, GOB_EXT habría sido 75/135 = 55.6 % (bajo el techo de 70: VERDE). Con el total, 75 %.
  assert.deepEqual([m.efectivo_total, m.efectivo_liquidado, (m.pct_por_clase as unknown as Record<string, number>).GOB_EXT],
    [5_000, 40_000, 75]);
  assert.equal(m.liquidez_pct, 40); // la liquidez sigue con el liquidado
  assert.deepEqual(pruebas(ev), ['LIQUIDEZ_DESFASADA:informativo', 'P2:aviso']);
  assert.equal(ev.estado, 'AMBAR'); // por el P2 (gobierno corto sobre el techo), no por el desfase
});

test('venta por liquidar: el liquidado achicaba el denominador y fabricaba un ROJO; con el total, VERDE', () => {
  const ev = evaluarCuenta(entrada({ perfil: perfilOk('Bajo'), foto: VENTA }));
  const m = ev.metricas as Record<string, number>;
  // Con el liquidado, la base era 82 000 y ACC_SIC 21.95 % > 20 (ROJO). Con el total (20 000), 18 %.
  assert.deepEqual([m.efectivo_total, m.rv_pct, m.liquidez_pct], [20_000, 18, 12]);
  assert.deepEqual(pruebas(ev), ['LIQUIDEZ_DESFASADA:informativo']);
  assert.equal(ev.estado, 'VERDE');
  const d = ev.hallazgos[0];
  assert.deepEqual([d.valor_pct, d.limite_pct], [18, 0.5]);
});

test('liquidez desfasada: solo sobre el umbral (0.5 % del NAV), e informativa también en las propias', () => {
  const justo = evaluarCuenta(entrada({ foto: { moneda_base: 'MXN', nav_ibkr: 100_000,
    renglones: [pos('ZZACC', 50_000), pos('ZZGOBC', 40_000), caja(10_500)] } })); // 0.5 % exacto: no
  assert.deepEqual([justo.estado, justo.hallazgos], ['VERDE', []]);
  // El umbral es sobre el NAV, no sobre la base positiva: posiciones 101 000, NAV 100 000 (total −1 000),
  // liquidado −1 505 → desfase 505 = 0.505 % del NAV (sí) pero 0.49999 % de la base (no).
  const sobreNav = evaluarCuenta(entrada({ foto: { moneda_base: 'MXN', nav_ibkr: 100_000,
    renglones: [pos('ZZACC', 50_000), pos('ZZGOBC', 41_000), pos('ZZBIL', 10_000), caja(-1_505)] } }));
  assert.deepEqual(pruebas(sobreNav), ['LIQUIDEZ_DESFASADA:informativo', 'SALDO_DEUDOR:aviso']);
  const propia = evaluarCuenta(entrada({ es_propia: true, foto: COMPRA }));
  assert.equal(propia.estado, 'EXENTO');
  assert.ok(propia.hallazgos.some((h) => h.prueba === 'LIQUIDEZ_DESFASADA' && h.informativo));
});

test('la evaluación guarda la versión del motor, el perfil y los límites aplicados', () => {
  const ev = evaluarCuenta(entrada({}));
  assert.equal(ev.version_motor, 'semaforo-1.2.0');
  assert.equal((ev.limites_aplicados as { liquidez_desfasada_umbral_pct: number }).liquidez_desfasada_umbral_pct, 0.5);
  assert.equal((ev.perfil_aplicado as { perfil: string }).perfil, 'Moderado');
  assert.ok('rv_max' in ev.limites_aplicados && 'techos' in ev.limites_aplicados);
  const regla = (ev.limites_aplicados as { gob_exceso_corto: { duracion_menor_a: number; decision: string } }).gob_exceso_corto;
  assert.equal(regla.duracion_menor_a, 3);
  assert.match(regla.decision, /Asesor \(16-nov-2026\).*Oficial de Cumplimiento/);
});
