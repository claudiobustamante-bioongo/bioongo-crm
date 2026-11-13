// Vista previa de una descarga del Flex Web Service de IBKR. SOLO LECTURA: no
// escribe en la base ni guarda el XML (trae nombres).
//
//   node scripts/ibkr/vista-previa.mjs --referencia <ref.json> [--td AAAAMMDD]
//        [--altas docs/catalogo_alta_2026-11-12b.csv] [--env .env.local] [--xml <archivo>]
//
// --referencia  JSON con cuentas (cuentas_ibkr con es_propia y fecha_cierre, más
//               status/fecha_baja de clientes), catálogo y prorrateo, sacado con
//               psql en una transacción read only. Una cuenta con fecha_cierre
//               cuenta como baja (desde 2026-11-13-02). El
//               script no se conecta a la base.
// --td          Fecha del corte (fd = td). Por omisión, el último día hábil
//               (lunes a viernes) antes de hoy en CDMX.
// --altas       CSV (uno o varios, separados por coma) de altas aprobadas que aún
//               no corren: se suman al catálogo en memoria.
// --verificar   CSV de altas (uno o varios, por coma) a cotejar contra el XML:
//               ISIN del XML vs el «ISIN …» de la nota del CSV, y description del
//               XML junto a la descripcion del CSV. Un ISIN distinto termina con
//               código 2: no se arma la migración.
// --efectivo    Códigos (por coma): endingCash y endingSettledCash de
//               BASE_SUMMARY, su diferencia y cuánto de la diferencia de NAV explica.
// --env         Archivo con IBKR_FLEX_TOKEN e IBKR_FLEX_QUERY_ID (por omisión
//               .env.local). Las credenciales nunca se imprimen.
// --xml         Lee un XML local en vez de llamar a IBKR (pruebas con XML
//               sintético).
//
// Alcance: solo la Flex Query 1649340 de Bioongo; con otro Query ID se detiene
// antes de llamar a IBKR. Salida sin nombres ni acctAlias: cuentas por su código
// del CRM, y las que no tienen contrato como U••••1234.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { XMLParser } from 'fast-xml-parser';

// lib/ibkr-flex.ts lleva `import 'server-only'`, que resuelve Next al compilar.
// Fuera de Next, aquí, se resuelve como un módulo vacío.
registerHooks({
  resolve(especificador, contexto, siguiente) {
    if (especificador === 'server-only') return { url: 'data:text/javascript,', shortCircuit: true };
    return siguiente(especificador, contexto);
  },
});
const flex = await import('../../lib/ibkr-flex.ts');
const { armarCatalogo, clasificarRenglon } = await import('../../lib/clasificacion-activos.ts');

const QUERY_BIOONGO = '1649340';

// --- Argumentos -----------------------------------------------------------------
const args = {};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) {
  if (!argv[i].startsWith('--') || argv[i + 1] === undefined) salir(`Argumento inválido: ${argv[i]}`);
  args[argv[i].slice(2)] = argv[i + 1];
}
if (!args.referencia) salir('Falta --referencia <ref.json>.');
const altasCsv = args.altas ?? 'docs/catalogo_alta_2026-11-12b.csv';

function salir(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// --- Fechas -----------------------------------------------------------------------
function hoyCdmx() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).replace(/-/g, '');
}
function ultimoHabil(hoy) {
  const d = new Date(Date.UTC(+hoy.slice(0, 4), +hoy.slice(4, 6) - 1, +hoy.slice(6, 8)));
  do d.setUTCDate(d.getUTCDate() - 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}
const hoy = hoyCdmx();
const td = args.td ?? ultimoHabil(hoy);

// --- Referencia del CRM y altas ---------------------------------------------------
const ref = JSON.parse(readFileSync(args.referencia, 'utf8'));
const cuentasRef = ref.cuentas ?? [];
const porCuenta = new Map(cuentasRef.map((c) => [c.cuenta_ibkr, c]));

function leerCsv(ruta) {
  const t = readFileSync(ruta, 'utf8');
  const filas = [];
  let fila = [], campo = '', comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else comillas = false; } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  const [cab, ...datos] = filas;
  return datos.map((f) => Object.fromEntries(cab.map((h, k) => [h, (f[k] ?? '').trim()])));
}
const altas = altasCsv.split(',').flatMap((ruta) => leerCsv(ruta.trim())).map((r) => ({
  ticker: r.ticker,
  clase_activo: r.clase_activo,
  elegible: r.elegible === 'true',
  es_equivalente_efectivo: r.es_equivalente_efectivo === 'true',
  duracion_efectiva: r.duracion_efectiva === '' ? null : Number(r.duracion_efectiva),
}));
const instrumentos = [...(ref.catalogo ?? []), ...altas.filter((a) => !(ref.catalogo ?? []).some((c) => c.ticker === a.ticker))];
const catalogo = armarCatalogo(
  instrumentos.map((i) => ({ ...i, duracion_efectiva: i.duracion_efectiva === null ? null : Number(i.duracion_efectiva) })),
  (ref.prorrateo ?? []).map((p) => ({ ...p, factor: Number(p.factor) })),
);
const tickersCatalogo = new Set(catalogo.instrumentos.keys());

// --- Descarga (o XML local) ---------------------------------------------------------
let xml;
if (args.xml) {
  xml = readFileSync(args.xml, 'utf8');
} else {
  try {
    process.loadEnvFile(args.env ?? '.env.local');
  } catch {
    salir(`No se pudo leer el archivo de entorno.`);
  }
  let cred;
  try {
    cred = flex.credencialesFlex(process.env);
  } catch (e) {
    salir(e.message);
  }
  if (cred.queryId !== QUERY_BIOONGO) {
    salir(`El Query ID del entorno no es el de Bioongo (${QUERY_BIOONGO}): no se llama a IBKR.`);
  }
  console.log(`Pidiendo la Flex ${QUERY_BIOONGO} con fd = td = ${td} (puede tardar hasta 2.5 min)…`);
  try {
    xml = await flex.descargarFlex(td, td, hoy, {
      ...cred,
      // fetch de Node sin opciones de caché de Next.
      fetch: (url, init) => fetch(url, { headers: init?.headers }),
    });
  } catch (e) {
    salir(`${e.message}${e.codigo === '1021' || e.codigo === '1019' ? ' Probar con otro --td.' : ''}`);
  }
}

// --estructura sí: solo NOMBRES de elementos y de atributos (con cuántos hay), y
// los valores de atributos de fecha. Ningún otro valor: sirve para diagnosticar
// la forma del XML sin sacar nombres ni montos.
if (args.estructura === 'sí' || args.estructura === 'si') {
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseAttributeValue: false, parseTagValue: false })
    .parse(flex.escaparAmpersands(xml));
  const ruta = new Map();
  const visitar = (nodo, camino) => {
    for (const n of Array.isArray(nodo) ? nodo : [nodo]) {
      if (n === null || typeof n !== 'object') continue;
      const r = ruta.get(camino) ?? { n: 0, attrs: new Set(), fechas: new Map() };
      r.n += 1;
      for (const [k, v] of Object.entries(n)) {
        if (k.startsWith('@_')) {
          const a = k.slice(2);
          r.attrs.add(a);
          if (/date$|Date$|^date/i.test(a) && typeof v === 'string') {
            const s = r.fechas.get(a) ?? new Set();
            if (s.size < 4) s.add(v);
            r.fechas.set(a, s);
          }
        } else if (k !== '#text') {
          visitar(v, `${camino}/${k}`);
        }
      }
      ruta.set(camino, r);
    }
  };
  for (const [k, v] of Object.entries(doc)) if (!k.startsWith('?')) visitar(v, k);
  console.log(`\n== Estructura del XML (td ${td}): elementos, atributos y fechas; ningún otro valor`);
  for (const [camino, r] of ruta) {
    const fechas = [...r.fechas].map(([a, s]) => `${a}=${[...s].join('|')}`).join(' ');
    console.log(`${camino} ×${r.n}\n    atributos: ${[...r.attrs].join(', ') || '(ninguno)'}${fechas ? `\n    fechas: ${fechas}` : ''}`);
  }
  process.exit(0);
}

let rep;
try {
  rep = flex.parsearFlex(xml, td);
} catch (e) {
  salir(`${e.message}${e.codigo === '1021' ? ' Probar con otro --td.' : ''}`);
}
const crm = cuentasRef.map((c) => ({
  cuenta_ibkr: c.cuenta_ibkr,
  codigo_cliente: c.codigo_cliente,
  // Cuenta cerrada en IBKR (cuentas_ibkr.fecha_cierre) o contrato de baja en el CRM.
  fecha_baja: c.fecha_cierre ?? c.fecha_baja ?? (c.status === 'baja' ? 'sin fecha' : null),
}));
const descuadres = flex.calcularDescuadres(rep, crm, tickersCatalogo);

const mascara = (cuenta) => (cuenta && cuenta.length > 4 ? `U••••${cuenta.slice(-4)}` : '(sin cuenta)');
const etiqueta = (cuenta) => porCuenta.get(cuenta)?.codigo_cliente ?? mascara(cuenta);
const fmt = (n, d = 2) => n.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });

console.log(`\n== Vista previa · td ${td} · ${rep.total_statements} cuentas en el XML · sha256 ${rep.sha256.slice(0, 12)}… (no se guarda)`);

// --- 1 · Cuentas ---------------------------------------------------------------
console.log('\n1 · CUENTAS RECIBIDAS VS cuentas_ibkr');
const de = (tipo) => descuadres.filter((d) => d.tipo === tipo);
const lista = (xs) => (xs.length ? xs.join(', ') : 'ninguna');
console.log(`  Sin contrato en el CRM (${de('sin_contrato').length}): ${lista(de('sin_contrato').map((d) => mascara(d.cuenta_ibkr)))}`);
console.log(`  Con baja en el CRM y abiertas en IBKR (${de('baja_abierta').length}): ${lista(de('baja_abierta').map((d) => `${d.codigo_cliente} (baja ${d.fecha_baja})`))}`);
console.log(`  Del CRM que no llegaron (${de('ausente_en_ibkr').length}): ${lista(de('ausente_en_ibkr').map((d) => d.codigo_cliente))}`);
console.log(`  Descartadas al leer (${de('descartada').length}): ${lista(de('descartada').map((d) => `${etiqueta(d.cuenta_ibkr)}: ${d.motivo}`))}`);

// --- 2 · Tickers sin catálogo -------------------------------------------------------
// ISIN y bolsa no los guarda la lib: se leen aquí de los atributos de OpenPosition, y nada más.
const crudo = new XMLParser({
  ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false, parseTagValue: false,
  isArray: (n) => n === 'FlexStatement' || n === 'OpenPosition' || n === 'CashReportCurrency',
}).parse(flex.escaparAmpersands(xml));
const extra = new Map();
for (const st of crudo?.FlexQueryResponse?.FlexStatements?.FlexStatement ?? []) {
  for (const p of st?.OpenPositions?.OpenPosition ?? []) {
    if (p.levelOfDetail && p.levelOfDetail !== 'SUMMARY') continue;
    extra.set(`${st.accountId}|${p.symbol}`, { isin: p.isin || null, bolsa: p.listingExchange || null });
  }
}
const sinCatalogo = new Map();
const derivados = new Set();
for (const c of rep.cuentas) {
  for (const r of c.renglones) {
    if (r.tipo_renglon !== 'posicion' || tickersCatalogo.has(r.ticker)) continue;
    // Opciones y futuros nunca entran al catálogo: son DERIVADO por regla.
    if (r.asset_category === 'OPT' || r.asset_category === 'FUT') { derivados.add(`${c.cuenta_ibkr}|${r.ticker}`); continue; }
    const e = extra.get(`${c.cuenta_ibkr}|${r.ticker}`) ?? {};
    const s = sinCatalogo.get(r.ticker) ?? { asset: r.asset_category, sub: r.sub_category, isin: new Set(), bolsa: new Set(), cuentas: new Set() };
    if (e.isin) s.isin.add(e.isin);
    if (e.bolsa) s.bolsa.add(e.bolsa);
    s.cuentas.add(c.cuenta_ibkr);
    sinCatalogo.set(r.ticker, s);
  }
}
console.log(`\n2 · TICKERS SIN CATÁLOGO (${sinCatalogo.size}; ya cuentan como dadas de alta las ${altas.length} de ${altasCsv})`);
for (const [t, s] of [...sinCatalogo].sort(([a], [b]) => (a < b ? -1 : 1))) {
  console.log(`  ${t.padEnd(24)} ${`${s.asset ?? '-'}/${s.sub ?? '-'}`.padEnd(22)} ISIN ${[...s.isin].join('|') || '(no viene en la Flex)'} · bolsa ${[...s.bolsa].join('|') || '(no viene en la Flex)'} · ${s.cuentas.size} cuenta(s)`);
}
if (derivados.size) {
  const cuentasDer = new Set([...derivados].map((k) => k.split('|')[0]));
  console.log(`  Aparte: ${derivados.size} posición(es) en opciones o futuros en ${cuentasDer.size} cuenta(s) (${lista([...cuentasDer].map(etiqueta))}); no van al catálogo, son DERIVADO.`);
}

// --- 3 · NAV ---------------------------------------------------------------------------
console.log(`\n3 · NAV CALCULADO VS NAV_IBKR (aviso > ${flex.UMBRAL_NAV * 100} %)`);
const navMal = de('nav_descuadrado');
for (const d of navMal) {
  console.log(`  ${etiqueta(d.cuenta_ibkr)}: calculado ${fmt(d.valor_calculado)} · IBKR ${fmt(d.nav_ibkr)} · diferencia ${fmt(d.diferencia * 100, 3)} %`);
}
console.log(`  ${navMal.length ? navMal.length : 'Ninguna'} con diferencia; ${rep.cuentas.filter((c) => porCuenta.has(c.cuenta_ibkr)).length - navMal.length} conciliadas.`);

// --- 4 · Por código ---------------------------------------------------------------------
console.log('\n4 · POR CÓDIGO: NAV EN MONEDA BASE Y % POR CLASE (sobre la suma de saldos positivos)');
for (const c of [...rep.cuentas].filter((x) => porCuenta.has(x.cuenta_ibkr)).sort((a, b) => (etiqueta(a.cuenta_ibkr) < etiqueta(b.cuenta_ibkr) ? -1 : 1))) {
  const porClase = new Map();
  const avisos = [];
  let liquidez = 0;
  let negativos = 0;
  for (const r of c.renglones) {
    if (r.tipo_renglon === 'nav_ibkr') continue;
    const k = clasificarRenglon(r, catalogo);
    avisos.push(...k.avisos);
    for (const f of k.fracciones) {
      if (f.valor_base < 0) { negativos += f.valor_base; continue; }
      const prev = porClase.get(f.clase) ?? { valor: 0, noElegible: false };
      prev.valor += f.valor_base;
      prev.noElegible ||= !f.elegible;
      porClase.set(f.clase, prev);
      if (f.liquidez) liquidez += f.valor_base;
    }
  }
  const base = [...porClase.values()].reduce((s, x) => s + x.valor, 0);
  const cr = porCuenta.get(c.cuenta_ibkr);
  console.log(`  ${cr.codigo_cliente}${cr.tipo === 'conjunta' ? ' (conjunta)' : ''}${cr.es_propia ? ' (propia del Asesor)' : ''} · ${c.moneda_base} · NAV_IBKR ${fmt(c.nav_ibkr)}${cr.status !== 'vigente' ? ` · status ${cr.status}` : ''}`);
  const partes = [...porClase].sort((a, b) => b[1].valor - a[1].valor)
    .map(([clase, x]) => `${clase} ${base ? fmt((x.valor / base) * 100, 1) : '0'} %${x.noElegible ? ' (no elegible)' : ''}`);
  console.log(`    ${partes.join(' · ') || 'sin posiciones'}${base ? ` · liquidez ${fmt((liquidez / base) * 100, 1)} %` : ''}`);
  if (negativos < 0) console.log(`    saldos negativos: ${fmt(negativos)} (${base ? fmt((-negativos / base) * 100, 2) : '-'} % de los positivos)`);
  for (const a of avisos) console.log(`    [${a.nivel}] ${a.mensaje}`);
}
// --- 5 · Derivados y saldos negativos ------------------------------------------------
console.log('\n5 · CUENTAS CON OPCIONES/FUTUROS O SALDOS NEGATIVOS');
const conDer = new Set(), conNeg = new Map();
for (const c of rep.cuentas.filter((x) => porCuenta.has(x.cuenta_ibkr))) {
  for (const r of c.renglones) {
    if (r.tipo_renglon === 'posicion' && (r.asset_category === 'OPT' || r.asset_category === 'FUT')) conDer.add(etiqueta(c.cuenta_ibkr));
    if (r.tipo_renglon !== 'nav_ibkr' && r.valor_base < 0) conNeg.set(etiqueta(c.cuenta_ibkr), (conNeg.get(etiqueta(c.cuenta_ibkr)) ?? 0) + r.valor_base);
  }
}
console.log(`  Con opciones o futuros (${conDer.size}): ${lista([...conDer].sort())}`);
console.log(`  Con saldos negativos (${conNeg.size}): ${lista([...conNeg].sort().map(([k, v]) => `${k} (${fmt(v)})`))}`);

// --- 6 · Cotejo de altas contra el XML (--verificar) ------------------------------------
let isinDistinto = false;
if (args.verificar) {
  console.log('\n6 · COTEJO DE ALTAS CONTRA EL XML (ISIN automático; descripción a ojo)');
  const porTicker = new Map();
  for (const c of rep.cuentas) {
    for (const r of c.renglones) {
      if (r.tipo_renglon !== 'posicion') continue;
      const s = porTicker.get(r.ticker) ?? { desc: new Set(), isin: new Set(), bolsa: new Set() };
      if (r.descripcion) s.desc.add(r.descripcion);
      const e = extra.get(`${c.cuenta_ibkr}|${r.ticker}`) ?? {};
      if (e.isin) s.isin.add(e.isin);
      if (e.bolsa) s.bolsa.add(e.bolsa);
      porTicker.set(r.ticker, s);
    }
  }
  for (const ruta of args.verificar.split(',').map((x) => x.trim())) {
    console.log(`  ${ruta}`);
    for (const r of leerCsv(ruta)) {
      const isinCsv = r.nota.match(/\bISIN ([A-Z]{2}[A-Z0-9]{9}[0-9])\b/)?.[1] ?? null;
      const x = porTicker.get(r.ticker);
      if (!x) {
        console.log(`    ${r.ticker.padEnd(6)} no aparece en el XML · CSV: ${r.descripcion}${isinCsv ? ` · ISIN ${isinCsv}` : ''}`);
        continue;
      }
      const isinXml = [...x.isin];
      let marca = 'ISIN sin cotejar (el CSV no lo trae)';
      if (isinCsv && isinXml.length === 0) marca = 'ISIN: el XML no lo trae';
      else if (isinCsv && isinXml.length === 1 && isinXml[0] === isinCsv) marca = 'ISIN ✓';
      else if (isinCsv) { marca = `ISIN ✗ (XML ${isinXml.join('|')} ≠ CSV ${isinCsv})`; isinDistinto = true; }
      console.log(`    ${r.ticker.padEnd(6)} ${marca} · XML ${isinXml.join('|') || '-'} ${[...x.bolsa].join('|')}\n` +
                  `           XML: ${[...x.desc].join(' | ') || '(sin description)'}\n` +
                  `           CSV: ${r.descripcion}`);
    }
  }
}

// --- 7 · Efectivo liquidado vs no liquidado (--efectivo) ---------------------------------
if (args.efectivo) {
  console.log('\n7 · EFECTIVO (BASE_SUMMARY): endingCash − endingSettledCash vs diferencia de NAV');
  const cuentaDe = new Map(cuentasRef.map((c) => [c.codigo_cliente, c.cuenta_ibkr]));
  const caja = new Map();
  for (const st of crudo?.FlexQueryResponse?.FlexStatements?.FlexStatement ?? []) {
    const b = (st?.CashReport?.CashReportCurrency ?? []).find((x) => x.currency === 'BASE_SUMMARY');
    if (b) caja.set(st.accountId, { cash: Number(b.endingCash), settled: Number(b.endingSettledCash) });
  }
  for (const codigo of args.efectivo.split(',').map((x) => x.trim())) {
    const cuenta = cuentaDe.get(codigo);
    const c = rep.cuentas.find((x) => x.cuenta_ibkr === cuenta);
    const b = caja.get(cuenta);
    if (!cuenta || !c || !b) { console.log(`  ${codigo}: sin datos en el XML`); continue; }
    const difNav = c.nav_ibkr - c.valor_calculado;
    const difCaja = b.cash - b.settled;
    console.log(`  ${codigo}: NAV_IBKR − calculado ${fmt(difNav)} · endingCash − endingSettledCash ${fmt(difCaja)} · ` +
                `sin explicar ${fmt(difNav - difCaja)} (${c.nav_ibkr ? fmt(((difNav - difCaja) / c.nav_ibkr) * 100, 3) : '-'} % del NAV)`);
  }
}

console.log('\nNada se escribió en la base y el XML no se guardó.');
if (isinDistinto) {
  console.error('✗ Al menos un ISIN del XML no coincide con el del CSV: no se arma la migración.');
  process.exit(2);
}
