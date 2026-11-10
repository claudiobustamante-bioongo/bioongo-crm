/**
 * Conector IBKR Flex: lectura del XML (trampas de la §1.5 de
 * docs/ESPEC_IBKR_Flex.md), descuadres, payload de fn_cargar_ibkr, llamadas con
 * reintento ante 1019 y el limitador de 1/s y 10/min.
 *
 * Datos SINTÉTICOS (lib/__fixtures__/flex-sintetico.xml): este archivo se
 * commitea. Nunca un XML real de IBKR. Sin red: fetch y reloj son falsos.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('server-only', () => ({}));

const {
  ErrorFlex,
  Limitador,
  URL_FLEX,
  armarCargaFoto,
  armarCargaRendimiento,
  calcularDescuadres,
  credencialesFlex,
  descargarFlex,
  escaparAmpersands,
  parsearFlex,
  validarRango,
} = await import('./ibkr-flex');
type Reloj = import('./ibkr-flex').Reloj;
type CuentaCRM = import('./ibkr-flex').CuentaCRM;

const XML = readFileSync(new URL('./__fixtures__/flex-sintetico.xml', import.meta.url), 'utf8');
const TD = '20261109';
const CRM: CuentaCRM[] = [
  { cuenta_ibkr: 'U0000001', codigo_cliente: 'CSPFU9001', fecha_baja: null },
  { cuenta_ibkr: 'U0000002', codigo_cliente: 'CSPFU9002', fecha_baja: '2026-10-22' },
  { cuenta_ibkr: 'U0000004', codigo_cliente: 'CSPFU9004', fecha_baja: null },
  { cuenta_ibkr: 'U0000006', codigo_cliente: 'CSPFU9006', fecha_baja: null },
];
const CATALOGO = new Set(['VOO', 'NAFTRAC', 'BND']);

const cuenta = (id: string) => {
  const c = parsearFlex(XML, TD).cuentas.find((x) => x.cuenta_ibkr === id);
  assert.ok(c, id);
  return c;
};

// --- Lectura del XML ----------------------------------------------------------------

test('conserva 3 cuentas y descarta la del toDate distinto y la que no trae BASE_SUMMARY', () => {
  const rep = parsearFlex(XML, TD);
  assert.equal(rep.total_statements, 5);
  assert.deepEqual(rep.cuentas.map((c) => c.cuenta_ibkr), ['U0000001', 'U0000002', 'U0000003']);
  assert.deepEqual(rep.descartadas, [
    { cuenta_ibkr: 'U0000004', motivo: 'toDate 20261108 distinto del td pedido 20261109' },
    {
      cuenta_ibkr: 'U0000005',
      motivo: 'Cash Report sin BASE_SUMMARY (sumar las divisas duplicaría el efectivo)',
    },
  ]);
  assert.equal(rep.sha256, createHash('sha256').update(XML, 'utf8').digest('hex'));
});

test('valor en base = positionValue × fxRateToBase; el renglón LOT no duplica la posición', () => {
  const c = cuenta('U0000001');
  const posiciones = c.renglones.filter((r) => r.tipo_renglon === 'posicion');
  assert.deepEqual(posiciones.map((r) => [r.ticker, r.conid, r.valor_base]), [
    ['VOO', 1001, 92500],
    ['NAFTRAC', 1002, 6000],
    ['AAPL  261218C00200000', 1003, 9250],
  ]);
  assert.equal(c.moneda_base, 'MXN');
  assert.equal(c.fecha_fondeo, '2020-01-15');
});

test('«&» sin escapar se lee: la descripción llega como «S&P 500»', () => {
  assert.equal(cuenta('U0000001').renglones[0].descripcion, 'VANGUARD S&P 500 ETF');
  assert.equal(escaparAmpersands('a & b &amp; &#38; &#x26; &lt;'), 'a &amp; b &amp; &#38; &#x26; &lt;');
});

test('efectivo = endingSettledCash de BASE_SUMMARY, sin sumar las divisas', () => {
  const c = cuenta('U0000001');
  const efectivo = c.renglones.filter((r) => r.tipo_renglon === 'efectivo');
  assert.equal(efectivo.length, 1);
  assert.equal(efectivo[0].ticker, 'EFECTIVO');
  assert.equal(efectivo[0].valor_base, 1000);
});

test('NAV de IBKR = total de la ÚLTIMA fecha, aunque no venga al final', () => {
  const c = cuenta('U0000001');
  assert.equal(c.nav_ibkr, 108800);
  const nav = c.renglones.filter((r) => r.tipo_renglon === 'nav_ibkr');
  assert.deepEqual(nav.map((r) => [r.ticker, r.valor_base]), [['NAV_IBKR', 108800]]);
  assert.equal(c.valor_calculado, 108750);
});

test('TWR y el resto de ChangeInNAV; sin ChangeInNAV, rendimiento null', () => {
  assert.deepEqual(cuenta('U0000001').rendimiento, {
    valor_inicial: 100000,
    valor_final: 108800,
    depositos_retiros: 5000,
    mtm: 3800,
    intereses: 0,
    dividendos: 0,
    twr: 3.8,
  });
  assert.equal(cuenta('U0000002').rendimiento, null);
});

test('sin datos personales: ni name ni acctAlias llegan a la salida', () => {
  const salida = JSON.stringify(parsearFlex(XML, TD));
  for (const prohibido of ['Relleno', 'ALIAS', 'acctAlias', '"name"']) {
    assert.equal(salida.includes(prohibido), false, prohibido);
  }
});

test('XML con DOCTYPE o mal formado: error, no lectura parcial', () => {
  assert.throws(() => parsearFlex('<!DOCTYPE x [<!ENTITY a "b">]><FlexQueryResponse/>', TD), ErrorFlex);
  assert.throws(() => parsearFlex('<FlexQueryResponse><FlexStatements>', TD), /mal formado/);
});

test('un FlexStatementResponse con error en lugar del reporte: ErrorFlex con su código', () => {
  // El «&» suelto en un TEXTO (no en un atributo) lo rechaza el validador si no se re-escapa.
  const xml =
    '<FlexStatementResponse><Status>Fail</Status><ErrorCode>1021</ErrorCode>' +
    '<ErrorMessage>No data for S&P accounts</ErrorMessage></FlexStatementResponse>';
  assert.throws(() => parsearFlex(xml, TD), (e: unknown) => e instanceof ErrorFlex && e.codigo === '1021');
});

// --- Descuadres y payload -------------------------------------------------------------

test('descuadres: sin contrato, baja abierta, ausente, fuera de catálogo, NAV y descartadas', () => {
  const d = calcularDescuadres(parsearFlex(XML, TD), CRM, CATALOGO);
  assert.deepEqual(d.map((x) => [x.tipo, x.cuenta_ibkr]), [
    ['descartada', 'U0000004'],
    ['descartada', 'U0000005'],
    ['baja_abierta', 'U0000002'],
    ['sin_contrato', 'U0000003'],
    ['sin_contrato', 'U0000005'],
    ['ausente_en_ibkr', 'U0000006'],
    ['fuera_de_catalogo', 'U0000002'],
    ['nav_descuadrado', 'U0000002'],
  ]);
  const fuera = d.find((x) => x.tipo === 'fuera_de_catalogo');
  assert.ok(fuera && fuera.tipo === 'fuera_de_catalogo' && fuera.ticker === 'ZZUNK');
  const nav = d.find((x) => x.tipo === 'nav_descuadrado');
  assert.ok(nav && nav.tipo === 'nav_descuadrado' && nav.diferencia === 0.025);
});

test('las opciones no son «fuera de catálogo» y 0.05% de diferencia de NAV no se avisa', () => {
  const d = calcularDescuadres(parsearFlex(XML, TD), CRM, CATALOGO);
  assert.equal(d.some((x) => x.cuenta_ibkr === 'U0000001'), false);
});

test('payload de la foto: solo cuentas con contrato, con la forma que espera fn_cargar_ibkr', () => {
  const rep = parsearFlex(XML, TD);
  const d = calcularDescuadres(rep, CRM, CATALOGO);
  const carga = armarCargaFoto(rep, d, CRM);
  assert.equal(carga.uso, 'foto_diaria');
  assert.equal(carga.fd, '2026-11-09');
  assert.equal(carga.td, '2026-11-09');
  assert.equal(carga.to_date_ibkr, '2026-11-09');
  assert.equal(carga.cuentas_xml, 5);
  assert.equal(carga.ignoradas, 3);
  assert.deepEqual([...new Set(carga.posiciones.map((p) => p.cuenta_ibkr))], ['U0000001', 'U0000002']);
  for (const c of ['U0000001', 'U0000002']) {
    assert.equal(carga.posiciones.filter((p) => p.cuenta_ibkr === c && p.tipo_renglon === 'nav_ibkr').length, 1, c);
  }
  assert.throws(() => armarCargaFoto(rep, d, []), /Ninguna cuenta/);
});

test('payload de rendimiento: solo cuentas con contrato y ChangeInNAV', () => {
  const rep = parsearFlex(XML, TD);
  const carga = armarCargaRendimiento(rep, '20260101', 'YTD', [], CRM);
  assert.equal(carga.fd, '2026-01-01');
  assert.deepEqual(carga.rendimientos.map((r) => [r.cuenta_ibkr, r.twr, r.fecha_fondeo]), [['U0000001', 3.8, '2020-01-15']]);
  assert.equal(carga.ignoradas, 4);
});

// --- Rango y credenciales ------------------------------------------------------------

test('validarRango: fd ≤ td ≤ hoy, como mucho 365 días, fechas reales', () => {
  assert.deepEqual(validarRango('20251110', '20261110', '20261110'), { ok: true, dias: 365 });
  for (const [fd, td] of [
    ['20251109', '20261110'],
    ['20261110', '20261109'],
    ['20261111', '20261111'],
    ['20260230', '20260301'],
    ['2026-11-01', '20261101'],
  ]) {
    assert.equal(validarRango(fd, td, '20261110').ok, false, `${fd}–${td}`);
  }
});

test('credenciales: se exigen ambas, el Query ID numérico, y el error no las repite', () => {
  assert.deepEqual(credencialesFlex({ IBKR_FLEX_TOKEN: ' tok ', IBKR_FLEX_QUERY_ID: '123' }), { token: 'tok', queryId: '123' });
  assert.throws(() => credencialesFlex({ IBKR_FLEX_TOKEN: 'tok' }), /Faltan/);
  assert.throws(
    () => credencialesFlex({ IBKR_FLEX_TOKEN: 'TOKENSECRETO', IBKR_FLEX_QUERY_ID: 'abc' }),
    (e: unknown) => e instanceof ErrorFlex && !e.message.includes('TOKENSECRETO') && !e.message.includes('abc'),
  );
});

// --- Llamadas y limitador --------------------------------------------------------------

function relojFalso(): Reloj & { t: number; dormidas: number[] } {
  const r = {
    t: 0,
    dormidas: [] as number[],
    ahora: () => r.t,
    dormir: async (ms: number) => {
      r.dormidas.push(ms);
      r.t += ms;
    },
  };
  return r;
}

const ENVIADO = '<FlexStatementResponse><Status>Success</Status><ReferenceCode>987</ReferenceCode></FlexStatementResponse>';
const GENERANDO = '<FlexStatementResponse><Status>Warn</Status><ErrorCode>1019</ErrorCode><ErrorMessage>in progress</ErrorMessage></FlexStatementResponse>';
const EXPIRADO = '<FlexStatementResponse><Status>Fail</Status><ErrorCode>1012</ErrorCode><ErrorMessage>expired</ErrorMessage></FlexStatementResponse>';

function fetchFalso(respuestas: string[], reloj: { t: number }) {
  const llamadas: { url: string; t: number }[] = [];
  const f = (async (url: string) => {
    llamadas.push({ url: String(url), t: reloj.t });
    const cuerpo = respuestas.shift();
    if (cuerpo === undefined) throw new Error('sin respuesta preparada');
    return new Response(cuerpo, { status: 200 });
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

test('SendRequest con fd/td y GetStatement con la referencia; ante 1019 reintenta cada 5 s', async () => {
  const reloj = relojFalso();
  const { f, llamadas } = fetchFalso([ENVIADO, GENERANDO, GENERANDO, XML], reloj);
  const xml = await descargarFlex('20261109', TD, '20261110', {
    token: 'TOKENSECRETO',
    queryId: '1649340',
    fetch: f,
    reloj,
    limitador: new Limitador(reloj),
  });
  assert.equal(xml, XML);
  assert.equal(llamadas.length, 4);
  const envio = new URL(llamadas[0].url);
  assert.equal(`${envio.origin}${envio.pathname}`, `${URL_FLEX}/SendRequest`);
  assert.deepEqual(Object.fromEntries(envio.searchParams), {
    t: 'TOKENSECRETO',
    q: '1649340',
    v: '3',
    fd: '20261109',
    td: TD,
  });
  for (const l of llamadas.slice(1)) {
    const u = new URL(l.url);
    assert.equal(u.pathname.endsWith('/GetStatement'), true);
    assert.equal(u.searchParams.get('q'), '987');
  }
  assert.deepEqual(llamadas.map((l) => l.t), [0, 5000, 10000, 15000]);
});

test('código 1012: ErrorFlex con el código y sin el token en el mensaje', async () => {
  const reloj = relojFalso();
  const { f } = fetchFalso([EXPIRADO], reloj);
  await assert.rejects(
    descargarFlex('20261109', TD, '20261110', { token: 'TOKENSECRETO', queryId: '1', fetch: f, reloj, limitador: new Limitador(reloj) }),
    (e: unknown) => e instanceof ErrorFlex && e.codigo === '1012' && /Token expirado/.test(e.message) && !e.message.includes('TOKENSECRETO'),
  );
});

test('1019 sin fin: se rinde pasados 2.5 minutos, y los sondeos respetan 10 por minuto', async () => {
  const reloj = relojFalso();
  const { f, llamadas } = fetchFalso([ENVIADO, ...Array(40).fill(GENERANDO)], reloj);
  await assert.rejects(
    descargarFlex('20261109', TD, '20261110', { token: 't', queryId: '1', fetch: f, reloj, limitador: new Limitador(reloj) }),
    (e: unknown) => e instanceof ErrorFlex && e.codigo === '1019',
  );
  assert.ok(reloj.t >= 150_000 && reloj.t < 170_000, `se rindió en ${reloj.t} ms`);
  const t = llamadas.map((l) => l.t);
  for (const ti of t) assert.ok(t.filter((x) => x > ti - 60_000 && x <= ti).length <= 10, `ventana en ${ti}`);
});

test('un fetch que falla: error genérico, sin la URL (que lleva el token)', async () => {
  const reloj = relojFalso();
  const f = (async () => {
    throw new Error('connect ECONNREFUSED https://x/SendRequest?t=TOKENSECRETO');
  }) as unknown as typeof fetch;
  await assert.rejects(
    descargarFlex('20261109', TD, '20261110', { token: 'TOKENSECRETO', queryId: '1', fetch: f, reloj, limitador: new Limitador(reloj) }),
    (e: unknown) => e instanceof ErrorFlex && !e.message.includes('TOKENSECRETO'),
  );
});

test('rango inválido: no se llama a IBKR', async () => {
  const reloj = relojFalso();
  const { f, llamadas } = fetchFalso([], reloj);
  await assert.rejects(
    descargarFlex('20240101', TD, '20261110', { token: 't', queryId: '1', fetch: f, reloj, limitador: new Limitador(reloj) }),
    /365/,
  );
  assert.equal(llamadas.length, 0);
});

test('limitador: al menos 1 s entre peticiones y como mucho 10 por minuto', async () => {
  const reloj = relojFalso();
  const lim = new Limitador(reloj);
  const marcas: number[] = [];
  for (let i = 0; i < 12; i++) {
    await lim.turno();
    marcas.push(reloj.t);
  }
  assert.deepEqual(marcas.slice(0, 10), [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000]);
  assert.equal(marcas[10], 60_000);
  assert.equal(marcas[11], 61_000);
  for (let i = 0; i < marcas.length; i++) {
    assert.ok(marcas.filter((m) => m > marcas[i] - 60_000 && m <= marcas[i]).length <= 10, `ventana en ${marcas[i]}`);
  }
});
