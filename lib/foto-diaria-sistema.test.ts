/**
 * Foto diaria automática (M2 fase 2): cada ejecución da un paso según el estado
 * del td. IBKR, Banxico y la base son falsos (en memoria). Datos SINTÉTICOS: el
 * XML de lib/__fixtures__ (td 2026-11-09) y cuentas U000000x / CSPFU90xx.
 */

import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  avanzar, depsDesdeRpc, ErrorRpc, llaveValida, RPC, sanear, USUARIO_SISTEMA,
  type DepsFotoDiaria, type EstadoTd, type Evento,
} from './foto-diaria-sistema';
import { ErrorFlex } from './ibkr-flex-lectura';
import type { DatosSemaforo } from './semaforo-corrida';
import type { CuentaReferencia } from './ibkr-carga-reglas';

const XML = readFileSync(new URL('./__fixtures__/flex-sintetico.xml', import.meta.url), 'utf8');
const SIN_NAV = XML.replace(/<EquitySummaryInBase>[\s\S]*?<\/EquitySummaryInBase>/g, '');
const MARTES = new Date('2026-11-10T12:00:00Z'); // 06:00 CDMX → td lunes 2026-11-09
const TD = '2026-11-09';
const TOKEN = 'TOKENFLEXSECRETO99';

const cr = (cuenta_ibkr: string, codigo_cliente: string, extra: Partial<CuentaReferencia> = {}): CuentaReferencia =>
  ({ cuenta_ibkr, codigo_cliente, tipo: 'individual', status: 'vigente', fecha_baja: null, fecha_cierre: null, es_propia: false, ...extra });
const CRM: CuentaReferencia[] = [
  cr('U0000001', 'CSPFU9001'),
  cr('U0000002', 'CSPFU9002', { status: 'baja', fecha_baja: '2026-10-22' }),
  cr('U0000004', 'CSPFU9004', { fecha_cierre: '2023-01-20' }),
];

const DATOS = (syncId: string): DatosSemaforo => ({
  sync: { id: syncId, td: TD },
  foto: [
    { cuenta_ibkr: 'U0000001', tipo_renglon: 'efectivo', ticker: 'EFECTIVO', asset_category: null, sub_category: null, valor_base: '5000', moneda_base: 'MXN' },
    { cuenta_ibkr: 'U0000001', tipo_renglon: 'nav_ibkr', ticker: 'NAV_IBKR', asset_category: null, sub_category: null, valor_base: '5000', moneda_base: 'MXN' },
  ],
  cuentas: [{ cuenta_ibkr: 'U0000001', codigo_cliente: 'CSPFU9001', tipo: 'individual', es_propia: false, fecha_cierre: null,
    status: 'vigente', codigo_ips_fijado: null }],
  titulares: [{ cuenta_ibkr: 'U0000001', rol: 'titular', codigo_ips: 'CSPFU9001', codigo_ficha: 'CSPFU9001' }],
  perfiles: [{ codigo: 'CSPFU9001', perfil: 'Moderado', fase: 'Acumulacion', fecha_calculo: '2026-09-29', fecha_cuestionario: '2026-09-01', ips_firmado: true }],
  limites_fase: { Acumulacion: { rv_max_pct: '75', rf_min_pct: '20', liquidez_min_pct: '5' } },
  limites_perfil: { Moderado: { ACC_SIC: '60' } },
  reglas_perfil: { Moderado: { duracion_gob_menor_a: null, liquidez_min_pct: '5', efectivo_cuenta_rf: false, rv_total_max_pct: '60' } },
  parametros: { nav_residual_mxn: '1000', saldo_deudor_tolerancia_pct: '1', vigencia_ips_anios: '2' },
  catalogo: [],
  prorrateo: [],
});

/** Base, IBKR y Banxico falsos; registra cada llamada. */
function falsos(inicial: Partial<EstadoTd> = {}, ajustes: Partial<DepsFotoDiaria> = {}) {
  const llamadas: string[] = [];
  const anotados: Evento[] = [];
  const cargas: unknown[] = [];
  const fixes: unknown[] = [];
  const lotes: unknown[] = [];
  const est: EstadoTd = { sync_id: null, ultimo: {}, semaforo_registrado: false, ...inicial };
  let xmlListo: string | null = XML;
  const deps: DepsFotoDiaria = {
    estado: async () => { llamadas.push('estado'); return est; },
    referenciaCrm: async () => { llamadas.push('referencia'); return { cuentas: CRM, catalogo: ['VOO', 'NAFTRAC', 'BND'] }; },
    cargarFoto: async (c) => { llamadas.push('cargar'); cargas.push(c); return { sync_id: '00000000-0000-0000-0000-0000000000a1', renglones: c.posiciones.length }; },
    tipoCambio: async () => { llamadas.push('tipoCambio'); return null; },
    registrarFix: async (r) => { llamadas.push('registrarFix'); fixes.push(r); },
    datosSemaforo: async (s) => { llamadas.push('datosSemaforo'); return DATOS(s); },
    registrarSemaforo: async (l) => { llamadas.push('registrarSemaforo'); lotes.push(l); return { evaluaciones: l.evaluaciones.length }; },
    anotar: async (e) => { anotados.push(e); },
    flex: {
      pedir: async () => { llamadas.push('pedir'); return 'REF-NUEVA'; },
      consultar: async () => { llamadas.push('consultar'); return xmlListo === null ? { listo: false } : { listo: true, xml: xmlListo }; },
    },
    banxico: { serie: async () => { llamadas.push('banxico'); return [{ fecha: '2026-11-06', valor: 18.6 }, { fecha: TD, valor: 18.5983 }]; } },
    dormir: async () => undefined,
    secretos: [TOKEN],
    ...ajustes,
  };
  return { deps, llamadas, anotados, cargas, fixes, lotes, est, ponerXml: (x: string | null) => { xmlListo = x; } };
}
const resumen = (es: Evento[]) =>
  es.map((e) => `${e.paso}:${e.resultado}${e.resultado === 'error' && e.detalle.mensaje ? ` (${e.detalle.mensaje})` : ''}`);

test('td feriado de NYSE (viernes 27-nov → td 26-nov): «omitido», sin pedir nada a IBKR; no se repite', async () => {
  const f = falsos();
  const r = await avanzar(new Date('2026-11-27T12:00:00Z'), f.deps);
  assert.equal(r.td, '2026-11-26');
  assert.deepEqual(resumen(f.anotados), ['foto:omitido']);
  assert.match(String(f.anotados[0].detalle.motivo), /Acción de Gracias/);
  assert.deepEqual(f.llamadas, ['estado']);
  const g = falsos({ ultimo: { foto: { resultado: 'omitido', referencia_flex: null, detalle: {} } } });
  await avanzar(new Date('2026-11-27T12:20:00Z'), g.deps);
  assert.deepEqual(g.anotados, []);
});

test('sin foto ni pedido: pide y guarda la referencia; no espera en esta ejecución', async () => {
  const f = falsos();
  await avanzar(MARTES, f.deps);
  assert.deepEqual(resumen(f.anotados), ['foto:pedido']);
  assert.equal(f.anotados[0].referencia_flex, 'REF-NUEVA');
  assert.ok(!f.llamadas.includes('consultar'));
});

test('pedido vivo y IBKR aún generando (1019): «no_listo» con la misma referencia, sin volver a pedir', async () => {
  const f = falsos({ ultimo: { foto: { resultado: 'pedido', referencia_flex: 'REF-1', detalle: {} } } });
  f.ponerXml(null);
  await avanzar(MARTES, f.deps);
  assert.deepEqual(resumen(f.anotados), ['foto:no_listo']);
  assert.equal(f.anotados[0].referencia_flex, 'REF-1');
  assert.ok(!f.llamadas.includes('pedir'));
});

test('pedido listo: carga solo las cuentas cargables; luego FIX del td y semáforo con usuario de sistema, sin supuestos', async () => {
  const f = falsos({ ultimo: { foto: { resultado: 'no_listo', referencia_flex: 'REF-1', detalle: {} } } });
  await avanzar(MARTES, f.deps);
  assert.deepEqual(resumen(f.anotados), ['foto:cargado', 'fix:cargado', 'semaforo:cargado']);
  const carga = f.cargas[0] as { td: string; posiciones: { cuenta_ibkr: string }[]; descuadres: { tipo: string }[] };
  assert.equal(carga.td, TD);
  assert.deepEqual([...new Set(carga.posiciones.map((p) => p.cuenta_ibkr))], ['U0000001']); // ni la baja ni la cerrada
  assert.ok(carga.descuadres.some((d) => d.tipo === 'baja_abierta'));
  assert.deepEqual(f.fixes, [{ serie: 'SF43718', fecha: TD, valor: 18.5983, fecha_solicitada: TD,
    fuente: `Banxico SIE SF43718 (consulta automática, ${USUARIO_SISTEMA})`, nota: null }]);
  const lote = f.lotes[0] as { sync_id: string; tipo_cambio: number; evaluaciones: unknown[] };
  assert.deepEqual([lote.sync_id, lote.tipo_cambio, lote.evaluaciones.length], ['00000000-0000-0000-0000-0000000000a1', 18.5983, 1]);
  assert.equal(f.anotados[2].detalle.version_motor, 'semaforo-1.1.0');
});

test('IBKR sin NAV: «sin_nav», no carga; la ejecución siguiente vuelve a pedir', async () => {
  const f = falsos({ ultimo: { foto: { resultado: 'pedido', referencia_flex: 'REF-1', detalle: {} } } });
  f.ponerXml(SIN_NAV);
  await avanzar(MARTES, f.deps);
  assert.deepEqual(resumen(f.anotados), ['foto:sin_nav']);
  assert.ok(!f.llamadas.includes('cargar'));
  const g = falsos({ ultimo: { foto: { resultado: 'sin_nav', referencia_flex: null, detalle: {} } } });
  await avanzar(MARTES, g.deps);
  assert.deepEqual(resumen(g.anotados), ['foto:pedido']);
});

test('foto ya cargada a mano: «ya_cargado» una vez, sin tocar IBKR; sigue con FIX y semáforo', async () => {
  const f = falsos({ sync_id: '00000000-0000-0000-0000-0000000000a2' });
  await avanzar(MARTES, f.deps);
  assert.deepEqual(resumen(f.anotados), ['foto:ya_cargado', 'fix:cargado', 'semaforo:cargado']);
  assert.ok(!f.llamadas.includes('pedir') && !f.llamadas.includes('consultar'));
  const g = falsos({ sync_id: '00000000-0000-0000-0000-0000000000a2', semaforo_registrado: true,
    ultimo: { foto: { resultado: 'cargado', referencia_flex: null, detalle: {} }, fix: { resultado: 'cargado', referencia_flex: null, detalle: { valor: 18.5983 } } } });
  await avanzar(MARTES, g.deps);
  assert.deepEqual(g.anotados, []); // todo hecho: silencio
  assert.ok(!g.llamadas.includes('banxico') && !g.llamadas.includes('datosSemaforo'));
});

test('carrera con una carga a mano (IB409): «ya_cargado»; FIX y semáforo quedan para la siguiente', async () => {
  const f = falsos({ ultimo: { foto: { resultado: 'pedido', referencia_flex: 'REF-1', detalle: {} } } },
    { cargarFoto: async () => { throw new ErrorRpc('IB409', 'Este XML ya se cargó.'); } });
  await avanzar(MARTES, f.deps);
  assert.deepEqual(resumen(f.anotados), ['foto:ya_cargado']);
  assert.ok(!f.llamadas.includes('banxico'));
});

test('FIX: día sin FIX (feriado MX) → el anterior; si ya está en la base con el mismo valor, «ya_cargado» y el semáforo lo usa', async () => {
  const f = falsos({ sync_id: '00000000-0000-0000-0000-0000000000a3', ultimo: { foto: { resultado: 'cargado', referencia_flex: null, detalle: {} } } }, {
    banxico: { serie: async () => [{ fecha: '2026-11-06', valor: 18.6 }] },
    tipoCambio: async () => 18.6,
  });
  await avanzar(MARTES, f.deps);
  assert.deepEqual(resumen(f.anotados), ['fix:ya_cargado', 'semaforo:cargado']);
  assert.match(String(f.anotados[0].detalle.nota), /Sin FIX el 2026-11-09/);
  assert.deepEqual(f.fixes, []);
  assert.equal((f.lotes[0] as { tipo_cambio: number }).tipo_cambio, 18.6);
});

test('FIX: día sin FIX y aún no registrado → registra el anterior, con la fecha pedida = td y la nota', async () => {
  const f = falsos({ sync_id: '00000000-0000-0000-0000-0000000000a3', ultimo: { foto: { resultado: 'cargado', referencia_flex: null, detalle: {} } } },
    { banxico: { serie: async () => [{ fecha: '2026-11-06', valor: 18.6 }] } });
  await avanzar(MARTES, f.deps);
  const r = f.fixes[0] as { fecha: string; fecha_solicitada: string; nota: string };
  assert.deepEqual([r.fecha, r.fecha_solicitada], ['2026-11-06', TD]);
  assert.match(r.nota, /Sin FIX el 2026-11-09; se toma el del 2026-11-06/);
});

test('FIX en la base distinto del de Banxico: «error» y el semáforo NO corre', async () => {
  const f = falsos({ sync_id: '00000000-0000-0000-0000-0000000000a3', ultimo: { foto: { resultado: 'cargado', referencia_flex: null, detalle: {} } } },
    { tipoCambio: async () => 18.1 });
  await avanzar(MARTES, f.deps);
  assert.deepEqual(resumen(f.anotados), ['fix:error']);
  assert.deepEqual(f.lotes, []);
});

test('Banxico caído: «error» en fix, sin semáforo; el mensaje sale sin token ni cuentas', async () => {
  const f = falsos({ sync_id: '00000000-0000-0000-0000-0000000000a3', ultimo: { foto: { resultado: 'cargado', referencia_flex: null, detalle: {} } } },
    { banxico: { serie: async () => { throw new Error(`fallo con ${TOKEN} en U1234567`); } } });
  await avanzar(MARTES, f.deps);
  assert.deepEqual(resumen(f.anotados), ['fix:error (fallo con «secreto» en U••••)']);
  const texto = JSON.stringify(f.anotados);
  assert.ok(!texto.includes(TOKEN) && !texto.includes('U1234567'));
  assert.deepEqual(f.lotes, []);
});

test('error de IBKR al pedir: «error» en foto, saneado', async () => {
  const f = falsos({}, { flex: { pedir: async () => { throw new ErrorFlex('1012', `Token expirado ${TOKEN}`); },
    consultar: async () => ({ listo: false }) } });
  await avanzar(MARTES, f.deps);
  assert.deepEqual(resumen(f.anotados), ['foto:error (Token expirado «secreto»)']);
  assert.equal(f.anotados[0].detalle.codigo, '1012');
  assert.ok(!JSON.stringify(f.anotados).includes(TOKEN));
});

test('modo seco: pide y espera el XML, muestra foto y FIX; no escribe NADA, ni eventos', async () => {
  const f = falsos();
  const r = await avanzar(MARTES, f.deps, { seco: true });
  assert.deepEqual(resumen(r.eventos), ['foto:cargado', 'fix:cargado', 'semaforo:omitido']);
  assert.ok(r.eventos.every((e) => e.detalle.seco === true));
  assert.deepEqual([f.anotados, f.cargas, f.fixes, f.lotes], [[], [], [], []]);
  const g = falsos({ sync_id: '00000000-0000-0000-0000-0000000000a3' });
  const r2 = await avanzar(MARTES, g.deps, { seco: true });
  assert.deepEqual(resumen(r2.eventos), ['foto:ya_cargado', 'fix:cargado', 'semaforo:cargado']);
  assert.deepEqual([g.anotados, g.fixes, g.lotes], [[], [], []]);
});

test('calendario sin cubrir el td: «error», sin consultar nada', async () => {
  const f = falsos();
  await avanzar(new Date('2028-01-04T12:00:00Z'), f.deps);
  assert.deepEqual(resumen(f.anotados), ['foto:error']);
  assert.deepEqual(f.llamadas, []);
});

test('llave de invocación: igual pasa; distinta, prefijo o configurada corta no', () => {
  const k = 'k'.repeat(40);
  assert.equal(llaveValida(k, k), true);
  assert.equal(llaveValida(`${k.slice(0, -1)}x`, k), false);
  assert.equal(llaveValida(k.slice(0, 20), k), false);
  assert.equal(llaveValida(`${k}x`, k), false);
  assert.equal(llaveValida('corta', 'corta'), false);
});

test('sanear: secretos y números de cuenta fuera', () => {
  assert.equal(sanear(`x ${TOKEN} U1234567 U12`, [TOKEN]), 'x «secreto» U•••• U12');
});

test('adaptador: los nombres y argumentos de las funciones SQL del paso 2', async () => {
  const vistas: [string, string[]][] = [];
  const rpc = async (fn: string, args: Record<string, unknown>) => { vistas.push([fn, Object.keys(args).sort()]); return null; };
  const d = depsDesdeRpc(rpc, falsos().deps);
  await d.estado(TD, 'semaforo-1.1.0');
  assert.equal(await d.tipoCambio('SF43718', TD), null);
  await d.registrarFix({ serie: 'SF43718', fecha: TD, valor: 1, fecha_solicitada: TD, fuente: 'x', nota: null });
  await d.anotar({ td: TD, paso: 'foto', resultado: 'pedido', referencia_flex: 'R', sync_id: null, detalle: {} });
  assert.deepEqual(vistas, [
    [RPC.estado, ['p_td', 'p_version_motor']],
    [RPC.tipoCambio, ['p_fecha', 'p_serie']],
    [RPC.fix, ['p_fecha', 'p_fecha_solicitada', 'p_fuente', 'p_nota', 'p_serie', 'p_valor']],
    [RPC.anotar, ['p_evento']],
  ]);
});
