// Piezas comunes de los scripts de IBKR (vista-previa.mjs y cargar-foto.mjs).
// SOLO LECTURA: nada de aquí escribe en la base ni guarda el XML (trae nombres).
//
// - lib/ibkr-flex.ts lleva `import 'server-only'`, que resuelve Next al compilar;
//   aquí se resuelve como un módulo vacío.
// - La referencia del CRM sale de psql service=bioongo en una transacción READ
//   ONLY (o de un JSON, para pruebas). Cuentas por código; sin nombres.
// - Alcance: solo la Flex Query 1649340 de Bioongo; con otro Query ID se detiene
//   antes de llamar a IBKR. Las cuentas sin contrato se muestran como U••••1234.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { XMLParser } from 'fast-xml-parser';

registerHooks({
  resolve(especificador, contexto, siguiente) {
    if (especificador === 'server-only') return { url: 'data:text/javascript,', shortCircuit: true };
    return siguiente(especificador, contexto);
  },
});
export const flex = await import('../../lib/ibkr-flex.ts');
const { armarCatalogo, clasificarRenglon } = await import('../../lib/clasificacion-activos.ts');

export const QUERY_BIOONGO = '1649340';

export class ErrorScript extends Error {
  constructor(mensaje, codigoSalida = 1) {
    super(mensaje);
    this.codigoSalida = codigoSalida;
  }
}

/** --clave valor → { clave: valor }. */
export function leerArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new ErrorScript(`Argumento inválido: ${argv[i]}`);
    args[argv[i].slice(2)] = argv[i + 1];
  }
  return args;
}

// --- Fechas ---------------------------------------------------------------------------
export function hoyCdmx() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date()).replace(/-/g, '');
}
export function ultimoHabil(hoy) {
  const d = new Date(Date.UTC(+hoy.slice(0, 4), +hoy.slice(4, 6) - 1, +hoy.slice(6, 8)));
  do d.setUTCDate(d.getUTCDate() - 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// --- CSV --------------------------------------------------------------------------------
export function leerCsv(ruta) {
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

// --- Referencia del CRM -------------------------------------------------------------------
const SQL_REFERENCIA = `select json_build_object(
  'cuentas', (select json_agg(json_build_object('cuenta_ibkr', ci.cuenta_ibkr, 'codigo_cliente', ci.codigo_cliente,
      'tipo', ci.tipo, 'status', c.status, 'fecha_baja', c.fecha_baja, 'fecha_cierre', ci.fecha_cierre,
      'es_propia', ci.es_propia) order by ci.codigo_cliente)
    from public.cuentas_ibkr ci join public.clientes c using (codigo_cliente)),
  'catalogo', (select json_agg(json_build_object('ticker', ticker, 'clase_activo', clase_activo, 'elegible', elegible,
      'es_equivalente_efectivo', es_equivalente_efectivo, 'duracion_efectiva', duracion_efectiva) order by ticker)
    from public.catalogo_instrumentos),
  'prorrateo', (select json_agg(json_build_object('ticker', ticker, 'clase_activo', clase_activo, 'factor', factor)
      order by ticker, clase_activo) from public.catalogo_prorrateo))`;

/** Lee la referencia del CRM con psql en una transacción READ ONLY. No escribe nada. */
export function referenciaDesdePsql() {
  let salida;
  try {
    salida = execFileSync('psql', ['service=bioongo', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
      '-c', 'begin transaction read only', '-c', SQL_REFERENCIA, '-c', 'rollback'], { encoding: 'utf8' });
  } catch (e) {
    throw new ErrorScript(`No se pudo leer la referencia del CRM con psql: ${e.stderr?.toString().trim() || e.message}`);
  }
  return JSON.parse(salida.trim());
}

export function referenciaDesdeArchivo(ruta) {
  return JSON.parse(readFileSync(ruta, 'utf8'));
}

/** Catálogo (y prorrateo) de la referencia, más las altas aprobadas que aún no corren. */
export function catalogoConAltas(ref, rutasAltas) {
  const altas = (rutasAltas ? rutasAltas.split(',') : []).filter(Boolean).flatMap((r) => leerCsv(r.trim())).map((r) => ({
    ticker: r.ticker,
    clase_activo: r.clase_activo,
    elegible: r.elegible === 'true',
    es_equivalente_efectivo: r.es_equivalente_efectivo === 'true',
    duracion_efectiva: r.duracion_efectiva === '' ? null : Number(r.duracion_efectiva),
  }));
  const base = ref.catalogo ?? [];
  const instrumentos = [...base, ...altas.filter((a) => !base.some((c) => c.ticker === a.ticker))];
  const catalogo = armarCatalogo(
    instrumentos.map((i) => ({ ...i, duracion_efectiva: i.duracion_efectiva === null ? null : Number(i.duracion_efectiva) })),
    (ref.prorrateo ?? []).map((p) => ({ ...p, factor: Number(p.factor) })),
  );
  return { catalogo, altas };
}

/**
 * Cuentas del CRM para los descuadres: una cuenta cerrada en IBKR
 * (cuentas_ibkr.fecha_cierre) o un contrato de baja cuentan como baja.
 */
export function crmParaDescuadres(ref) {
  return (ref.cuentas ?? []).map((c) => ({
    cuenta_ibkr: c.cuenta_ibkr,
    codigo_cliente: c.codigo_cliente,
    fecha_baja: c.fecha_cierre ?? c.fecha_baja ?? (c.status === 'baja' ? 'sin fecha' : null),
  }));
}

// --- Descarga --------------------------------------------------------------------------------
/** El XML de IBKR (o uno local con --xml). Las credenciales se cargan del archivo de entorno y no se imprimen. */
export async function descargar({ xml, env, td, hoy }) {
  if (xml) return readFileSync(xml, 'utf8');
  try {
    process.loadEnvFile(env ?? '.env.local');
  } catch {
    throw new ErrorScript('No se pudo leer el archivo de entorno.');
  }
  let cred;
  try {
    cred = flex.credencialesFlex(process.env);
  } catch (e) {
    throw new ErrorScript(e.message);
  }
  if (cred.queryId !== QUERY_BIOONGO) {
    throw new ErrorScript(`El Query ID del entorno no es el de Bioongo (${QUERY_BIOONGO}): no se llama a IBKR.`);
  }
  console.log(`Pidiendo la Flex ${QUERY_BIOONGO} con fd = td = ${td} (puede tardar hasta 2.5 min)…`);
  try {
    return await flex.descargarFlex(td, td, hoy, { ...cred, fetch: (url, init) => fetch(url, { headers: init?.headers }) });
  } catch (e) {
    throw new ErrorScript(`${e.message}${e.codigo === '1021' || e.codigo === '1019' ? ' Probar con otro --td.' : ''}`);
  }
}

// --- --estructura: solo nombres --------------------------------------------------------------
export function imprimirEstructura(xml, td) {
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
}

// --- Vista previa ------------------------------------------------------------------------------
export const fmt = (n, d = 2) => n.toLocaleString('es-MX', { minimumFractionDigits: d, maximumFractionDigits: d });
export const lista = (xs) => (xs.length ? xs.join(', ') : 'ninguna');
const mascara = (cuenta) => (cuenta && cuenta.length > 4 ? `U••••${cuenta.slice(-4)}` : '(sin cuenta)');

/** Lee el XML y calcula descuadres. Lanza ErrorScript si IBKR devolvió un error de servicio. */
export function prepararVistaPrevia({ xml, td, ref, catalogo }) {
  let rep;
  try {
    rep = flex.parsearFlex(xml, td);
  } catch (e) {
    throw new ErrorScript(`${e.message}${e.codigo === '1021' ? ' Probar con otro --td.' : ''}`);
  }
  const porCuenta = new Map((ref.cuentas ?? []).map((c) => [c.cuenta_ibkr, c]));
  const crm = crmParaDescuadres(ref);
  const descuadres = flex.calcularDescuadres(rep, crm, new Set(catalogo.instrumentos.keys()));
  const crudo = new XMLParser({
    ignoreAttributes: false, attributeNamePrefix: '', parseAttributeValue: false, parseTagValue: false,
    isArray: (n) => n === 'FlexStatement' || n === 'OpenPosition' || n === 'CashReportCurrency',
  }).parse(flex.escaparAmpersands(xml));
  // ISIN, bolsa y conid no los guarda la lib: se leen aquí de OpenPosition, y nada más.
  const extra = new Map();
  for (const st of crudo?.FlexQueryResponse?.FlexStatements?.FlexStatement ?? []) {
    for (const p of st?.OpenPositions?.OpenPosition ?? []) {
      if (p.levelOfDetail && p.levelOfDetail !== 'SUMMARY') continue;
      extra.set(`${st.accountId}|${p.symbol}`, { isin: p.isin || null, bolsa: p.listingExchange || null });
    }
  }
  const etiqueta = (cuenta) => porCuenta.get(cuenta)?.codigo_cliente ?? mascara(cuenta);
  return { rep, crm, descuadres, crudo, extra, porCuenta, etiqueta, catalogo, ref };
}

/** Imprime los puntos 1–8. Devuelve { isinDistinto }. */
export function imprimirVistaPrevia(ctx, { altas = [], rutasAltas = '', verificar, efectivo } = {}) {
  const { rep, descuadres, crudo, extra, porCuenta, etiqueta, catalogo, ref } = ctx;
  const tickersCatalogo = new Set(catalogo.instrumentos.keys());
  console.log(`\n== Vista previa · td ${rep.td} · ${rep.total_statements} cuentas en el XML · sha256 ${rep.sha256.slice(0, 12)}… (no se guarda)`);

  // 1 · Cuentas
  console.log('\n1 · CUENTAS RECIBIDAS VS cuentas_ibkr');
  const de = (tipo) => descuadres.filter((d) => d.tipo === tipo);
  console.log(`  Sin contrato en el CRM (${de('sin_contrato').length}): ${lista(de('sin_contrato').map((d) => mascara(d.cuenta_ibkr)))}`);
  console.log(`  Con baja o cerradas en el CRM y abiertas en IBKR (${de('baja_abierta').length}): ${lista(de('baja_abierta').map((d) => `${d.codigo_cliente} (${d.fecha_baja})`))}`);
  console.log(`  Del CRM que no llegaron (${de('ausente_en_ibkr').length}): ${lista(de('ausente_en_ibkr').map((d) => d.codigo_cliente))}`);
  console.log(`  Descartadas al leer (${de('descartada').length}): ${lista(de('descartada').map((d) => `${etiqueta(d.cuenta_ibkr)}: ${d.motivo}`))}`);

  // 2 · Tickers sin catálogo
  const sinCatalogo = new Map();
  const derivados = new Set();
  for (const c of rep.cuentas) {
    for (const r of c.renglones) {
      if (r.tipo_renglon !== 'posicion' || tickersCatalogo.has(r.ticker)) continue;
      if (r.asset_category === 'OPT' || r.asset_category === 'FUT') { derivados.add(`${c.cuenta_ibkr}|${r.ticker}`); continue; }
      const e = extra.get(`${c.cuenta_ibkr}|${r.ticker}`) ?? {};
      const s = sinCatalogo.get(r.ticker) ?? { asset: r.asset_category, sub: r.sub_category, isin: new Set(), bolsa: new Set(), cuentas: new Set() };
      if (e.isin) s.isin.add(e.isin);
      if (e.bolsa) s.bolsa.add(e.bolsa);
      s.cuentas.add(c.cuenta_ibkr);
      sinCatalogo.set(r.ticker, s);
    }
  }
  console.log(`\n2 · TICKERS SIN CATÁLOGO (${sinCatalogo.size}${altas.length ? `; ya cuentan como dadas de alta las ${altas.length} de ${rutasAltas}` : ''})`);
  for (const [t, s] of [...sinCatalogo].sort(([a], [b]) => (a < b ? -1 : 1))) {
    console.log(`  ${t.padEnd(24)} ${`${s.asset ?? '-'}/${s.sub ?? '-'}`.padEnd(22)} ISIN ${[...s.isin].join('|') || '(no viene en la Flex)'} · bolsa ${[...s.bolsa].join('|') || '(no viene en la Flex)'} · ${s.cuentas.size} cuenta(s)`);
  }
  if (derivados.size) {
    const cuentasDer = new Set([...derivados].map((k) => k.split('|')[0]));
    console.log(`  Aparte: ${derivados.size} posición(es) en opciones o futuros en ${cuentasDer.size} cuenta(s) (${lista([...cuentasDer].map(etiqueta))}); no van al catálogo, son DERIVADO.`);
  }

  // 3 · NAV
  console.log(`\n3 · NAV CALCULADO (posiciones + endingCash) VS NAV_IBKR (aviso > ${flex.UMBRAL_NAV * 100} %)`);
  const navMal = de('nav_descuadrado');
  for (const d of navMal) {
    console.log(`  ${etiqueta(d.cuenta_ibkr)}: calculado ${fmt(d.valor_calculado)} · IBKR ${fmt(d.nav_ibkr)} · diferencia ${fmt(d.diferencia * 100, 3)} %`);
  }
  console.log(`  ${navMal.length ? navMal.length : 'Ninguna'} con diferencia; ${rep.cuentas.filter((c) => porCuenta.has(c.cuenta_ibkr)).length - navMal.length} conciliadas.`);

  // 4 · Por código
  console.log('\n4 · POR CÓDIGO: NAV EN MONEDA BASE Y % POR CLASE (sobre la suma de saldos positivos; efectivo liquidado)');
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
    console.log(`  ${cr.codigo_cliente}${cr.tipo === 'conjunta' ? ' (conjunta)' : ''}${cr.es_propia ? ' (propia del Asesor)' : ''} · ${c.moneda_base} · NAV_IBKR ${fmt(c.nav_ibkr)}${cr.status !== 'vigente' ? ` · status ${cr.status}` : ''}${cr.fecha_cierre ? ` · cerrada ${cr.fecha_cierre}` : ''}`);
    const partes = [...porClase].sort((a, b) => b[1].valor - a[1].valor)
      .map(([clase, x]) => `${clase} ${base ? fmt((x.valor / base) * 100, 1) : '0'} %${x.noElegible ? ' (no elegible)' : ''}`);
    console.log(`    ${partes.join(' · ') || 'sin posiciones'}${base ? ` · liquidez ${fmt((liquidez / base) * 100, 1)} %` : ''}`);
    if (negativos < 0) console.log(`    saldos negativos: ${fmt(negativos)} (${base ? fmt((-negativos / base) * 100, 2) : '-'} % de los positivos)`);
    for (const a of avisos) console.log(`    [${a.nivel}] ${a.mensaje}`);
  }

  // 5 · Derivados y saldos negativos
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

  // 6 · Cotejo de altas (--verificar)
  let isinDistinto = false;
  if (verificar) {
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
    for (const ruta of verificar.split(',').map((x) => x.trim())) {
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

  // 7 · Efectivo (--efectivo)
  if (efectivo) {
    console.log('\n7 · EFECTIVO (BASE_SUMMARY): pendiente de liquidar y diferencia de NAV que queda');
    const cuentaDe = new Map((ref.cuentas ?? []).map((c) => [c.codigo_cliente, c.cuenta_ibkr]));
    for (const codigo of efectivo.split(',').map((x) => x.trim())) {
      const c = rep.cuentas.find((x) => x.cuenta_ibkr === cuentaDe.get(codigo));
      if (!c || c.efectivo_total === null) { console.log(`  ${codigo}: sin datos en el XML`); continue; }
      console.log(`  ${codigo}: endingCash − endingSettledCash ${fmt(c.efectivo_total - c.efectivo_liquidado)} · ` +
                  `NAV_IBKR − calculado ${fmt(c.nav_ibkr - c.valor_calculado)} (${c.nav_ibkr ? fmt(((c.nav_ibkr - c.valor_calculado) / c.nav_ibkr) * 100, 3) : '-'} % del NAV)`);
    }
  }

  // 8 · Instrumentos repetidos dentro de una cuenta (p. ej. el mismo ticker en dos bolsas)
  console.log('\n8 · TICKERS EN MÁS DE UNA POSICIÓN DENTRO DE UNA CUENTA (conid y bolsa; sin montos)');
  let hay = 0;
  for (const st of crudo?.FlexQueryResponse?.FlexStatements?.FlexStatement ?? []) {
    const por = new Map();
    for (const p of st?.OpenPositions?.OpenPosition ?? []) {
      if (p.levelOfDetail && p.levelOfDetail !== 'SUMMARY') continue;
      por.set(p.symbol, [...(por.get(p.symbol) ?? []), `conid ${p.conid || '(sin conid)'} ${p.listingExchange || '?'}`]);
    }
    for (const [sym, xs] of por) if (xs.length > 1) { hay++; console.log(`  ${etiqueta(st.accountId)} · ${sym}: ${xs.join(' / ')}`); }
  }
  if (!hay) console.log('  Ninguno: cada ticker aparece una vez por cuenta.');

  return { isinDistinto };
}
