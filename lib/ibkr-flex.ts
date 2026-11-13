/**
 * [ibkr-flex] Conector con el Flex Web Service de IBKR.
 * ---------------------------------------------------------------------------
 * Especificación: docs/ESPEC_IBKR_Flex.md §1. Este módulo descarga y lee el XML;
 * no escribe en la base. La escritura es de fn_cargar_ibkr (migraciones/
 * 2026-11-10-01-ibkr-flex.sql), con la sesión del usuario y solo después de que
 * confirme la vista previa de descuadres.
 *
 * - `import 'server-only'`: el token da lectura de TODAS las cuentas de clientes.
 *   Las credenciales se leen al llamar (credencialesFlex), nunca al importar, y
 *   ningún mensaje de error las incluye.
 * - Límites de IBKR: 1 petición por segundo y 10 por minuto por token, contando
 *   los sondeos de «¿ya está listo?». El limitador vale dentro de UN proceso: no
 *   es global. Alcanza porque la carga la dispara una persona, de una en una.
 * - Trampas de la §1.5: moneda base de AccountInformation; valor en base =
 *   positionValue × fxRateToBase; efectivo SOLO del renglón BASE_SUMMARY, porque
 *   sumar las divisas lo duplica. De ahí salen dos cifras (decisión de Claudio,
 *   13-nov-2026, tras la vista previa del 12-nov): la LIQUIDEZ (el renglón
 *   EFECTIVO de la foto) es endingSettledCash; la CONCILIACIÓN contra el NAV usa
 *   endingCash, porque el NAV de IBKR ya incluye compras y ventas sin liquidar.
 *   Con endingSettledCash, una venta del día dejaba la cuenta 15 % «abajo» del
 *   NAV y una compra 9 % «arriba» (CSPFU8085, CSPFU2092). NAV de IBKR = total
 *   de la ÚLTIMA fecha de EquitySummaryByReportDateInBase; TWR en ChangeInNAV;
 *   «&» sin escapar re-escapado antes de leer.
 * - Un FlexStatement cuyo toDate no sea el td pedido se descarta y se reporta.
 * - Sin datos personales: name y acctAlias de AccountInformation no se leen.
 */

import 'server-only';
import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

export const URL_FLEX = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';
export const ESPERA_REINTENTO_MS = 5_000;
export const TOPE_ESPERA_MS = 150_000;
export const MAX_DIAS = 365;
/** Diferencia relativa entre posiciones + efectivo total y el NAV de IBKR que se avisa. */
export const UMBRAL_NAV = 0.005;

export const SIGNIFICADO_CODIGO: Readonly<Record<string, string>> = {
  '1012': 'Token expirado: se regenera en el portal de IBKR (vence al año sin avisar)',
  '1013': 'Restricción de IP en el token',
  '1016': 'Cuenta inválida',
  '1019': 'El reporte se está generando',
  '1021': 'Sin datos en el rango pedido',
};

export class ErrorFlex extends Error {
  readonly codigo: string | null;
  constructor(codigo: string | null, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorFlex';
    this.codigo = codigo;
  }
}

// ---------------------------------------------------------------------------
// Credenciales
// ---------------------------------------------------------------------------

export function credencialesFlex(env: Record<string, string | undefined> = process.env): {
  token: string;
  queryId: string;
} {
  const token = env.IBKR_FLEX_TOKEN?.trim();
  const queryId = env.IBKR_FLEX_QUERY_ID?.trim();
  if (!token || !queryId) {
    throw new ErrorFlex(null, 'Faltan IBKR_FLEX_TOKEN o IBKR_FLEX_QUERY_ID en el entorno del servidor.');
  }
  if (!/^\d+$/.test(queryId)) throw new ErrorFlex(null, 'IBKR_FLEX_QUERY_ID debe ser numérico.');
  return { token, queryId };
}

// ---------------------------------------------------------------------------
// Fechas (IBKR usa AAAAMMDD; la base, AAAA-MM-DD)
// ---------------------------------------------------------------------------

function fechaUTC(aaaammdd: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(aaaammdd);
  if (!m) return null;
  const [a, mes, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, mes - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === mes - 1 && f.getUTCDate() === d ? f : null;
}

/** AAAAMMDD o AAAA-MM-DD → AAAAMMDD, o null si no es una fecha real. */
export function normalizarFecha(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1$2$3');
  return fechaUTC(s) ? s : null;
}

export function aIso(aaaammdd: string): string {
  return `${aaaammdd.slice(0, 4)}-${aaaammdd.slice(4, 6)}-${aaaammdd.slice(6, 8)}`;
}

export type ResultadoRango = { ok: true; dias: number } | { ok: false; error: string };

/** fd ≤ td ≤ hoy, como mucho 365 días (todas AAAAMMDD). */
export function validarRango(fd: string, td: string, hoy: string): ResultadoRango {
  const [f, t, h] = [fechaUTC(fd), fechaUTC(td), fechaUTC(hoy)];
  if (!f || !t || !h) return { ok: false, error: 'Las fechas deben ser AAAAMMDD reales.' };
  if (f > t) return { ok: false, error: 'fd no puede ser posterior a td.' };
  if (t > h) return { ok: false, error: 'td no puede ser futuro.' };
  const dias = Math.round((t.getTime() - f.getTime()) / 86_400_000);
  if (dias > MAX_DIAS) return { ok: false, error: `IBKR acepta como mucho ${MAX_DIAS} días por petición.` };
  return { ok: true, dias };
}

// ---------------------------------------------------------------------------
// Limitador: 1 por segundo y 10 por minuto
// ---------------------------------------------------------------------------

export interface Reloj {
  ahora(): number;
  dormir(ms: number): Promise<void>;
}

export const relojReal: Reloj = {
  ahora: () => Date.now(),
  dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export class Limitador {
  private marcas: number[] = [];
  private readonly reloj: Reloj;
  constructor(reloj: Reloj) {
    this.reloj = reloj;
  }

  /** Espera hasta que una petición más quepa en los dos límites, y la registra. */
  async turno(): Promise<void> {
    for (;;) {
      const ahora = this.reloj.ahora();
      this.marcas = this.marcas.filter((t) => ahora - t < 60_000);
      let espera = 0;
      if (this.marcas.length >= 10) espera = this.marcas[0] + 60_000 - ahora;
      const ultima = this.marcas[this.marcas.length - 1];
      if (ultima !== undefined) espera = Math.max(espera, ultima + 1_000 - ahora);
      if (espera <= 0) {
        this.marcas.push(ahora);
        return;
      }
      await this.reloj.dormir(espera);
    }
  }
}

/** Uno por proceso del servidor (ver la cabecera: no es un límite global). */
export const limitadorProceso = new Limitador(relojReal);

// ---------------------------------------------------------------------------
// Llamadas: SendRequest y GetStatement
// ---------------------------------------------------------------------------

export interface DepsFlex {
  token: string;
  queryId: string;
  fetch?: typeof fetch;
  reloj?: Reloj;
  limitador?: Limitador;
}

type Nodo = Record<string, unknown>;

const lista = (v: unknown): Nodo[] =>
  Array.isArray(v) ? (v as Nodo[]) : v !== null && typeof v === 'object' ? [v as Nodo] : [];

const texto = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' ? String(v) : null;

const COMO_LISTA = new Set([
  'FlexStatement',
  'AccountInformation',
  'ChangeInNAV',
  'EquitySummaryByReportDateInBase',
  'OpenPosition',
  'CashReportCurrency',
]);

function lector(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
    processEntities: true,
    htmlEntities: false,
    isArray: (nombre: string) => COMO_LISTA.has(nombre),
  });
}

/**
 * Re-escapa los «&» que no forman parte de una entidad válida (p. ej. «S&P 500»).
 * fast-xml-parser 5.11 tolera el «&» suelto en un ATRIBUTO, pero su validador lo
 * rechaza en un TEXTO (InvalidChar); verificado el 10-nov-2026. No depender de esa
 * tolerancia: se re-escapa siempre.
 */
export function escaparAmpersands(xml: string): string {
  return xml.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');
}

function leerXml(xml: string): Nodo {
  if (/<!DOCTYPE/i.test(xml)) throw new ErrorFlex(null, 'El XML trae DOCTYPE: no se lee.');
  const limpio = escaparAmpersands(xml);
  const valido = XMLValidator.validate(limpio);
  if (valido !== true) throw new ErrorFlex(null, `XML mal formado (línea ${valido.err.line}).`);
  return lector().parse(limpio) as Nodo;
}

interface RespuestaServicio {
  status: string | null;
  codigo: string | null;
  referencia: string | null;
}

/** Lee un FlexStatementResponse (la respuesta de servicio); null si el XML es otra cosa. */
function leerRespuestaServicio(xml: string): RespuestaServicio | null {
  const r = leerXml(xml).FlexStatementResponse as Nodo | undefined;
  if (!r || typeof r !== 'object') return null;
  return { status: texto(r.Status), codigo: texto(r.ErrorCode), referencia: texto(r.ReferenceCode) };
}

function errorDeServicio(r: RespuestaServicio | null): ErrorFlex {
  const codigo = r?.codigo ?? null;
  const significado = (codigo && SIGNIFICADO_CODIGO[codigo]) || 'El Flex Web Service devolvió un error';
  return new ErrorFlex(codigo, codigo ? `${significado} (código ${codigo}).` : `${significado}.`);
}

async function pedir(url: string, deps: DepsFlex): Promise<string> {
  await (deps.limitador ?? limitadorProceso).turno();
  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(url, { headers: { 'User-Agent': 'bioongo-crm' }, cache: 'no-store' });
  } catch {
    // Sin el error original: su mensaje podría traer la URL, y la URL lleva el token.
    throw new ErrorFlex(null, 'No se pudo contactar el Flex Web Service.');
  }
  if (!res.ok) throw new ErrorFlex(null, `El Flex Web Service respondió HTTP ${res.status}.`);
  return res.text();
}

export async function solicitarReporte(fd: string, td: string, deps: DepsFlex): Promise<string> {
  const q = new URLSearchParams({ t: deps.token, q: deps.queryId, v: '3', fd, td });
  const r = leerRespuestaServicio(await pedir(`${URL_FLEX}/SendRequest?${q}`, deps));
  if (r?.status !== 'Success' || !r.referencia) throw errorDeServicio(r);
  return r.referencia;
}

/** Pide el XML hasta que esté listo: ante 1019 reintenta cada 5 s, con tope de 2.5 min. */
export async function obtenerReporte(referencia: string, deps: DepsFlex): Promise<string> {
  const reloj = deps.reloj ?? relojReal;
  const inicio = reloj.ahora();
  const q = new URLSearchParams({ t: deps.token, q: referencia, v: '3' });
  for (;;) {
    await reloj.dormir(ESPERA_REINTENTO_MS);
    const xml = await pedir(`${URL_FLEX}/GetStatement?${q}`, deps);
    const r = leerRespuestaServicio(xml);
    if (!r) return xml;
    if (r.codigo !== '1019') throw errorDeServicio(r);
    if (reloj.ahora() - inicio >= TOPE_ESPERA_MS) {
      throw new ErrorFlex('1019', 'IBKR no terminó de generar el reporte en 2.5 minutos; reintentar más tarde.');
    }
  }
}

/** Valida el rango, pide el reporte y devuelve el XML crudo. `hoy` en AAAAMMDD. */
export async function descargarFlex(fd: string, td: string, hoy: string, deps: DepsFlex): Promise<string> {
  const rango = validarRango(fd, td, hoy);
  if (!rango.ok) throw new ErrorFlex(null, rango.error);
  return obtenerReporte(await solicitarReporte(fd, td, deps), deps);
}

// ---------------------------------------------------------------------------
// Lectura del XML
// ---------------------------------------------------------------------------

export type TipoRenglon = 'posicion' | 'efectivo' | 'nav_ibkr';

/** Un renglón de posiciones_detalle, con los nombres de columna de la tabla. */
export interface RenglonFoto {
  cuenta_ibkr: string;
  tipo_renglon: TipoRenglon;
  ticker: string;
  conid: number | null;
  asset_category: string | null;
  sub_category: string | null;
  descripcion: string | null;
  cantidad: number | null;
  mark_price: number | null;
  position_value: number | null;
  moneda: string | null;
  fx_rate_to_base: number | null;
  valor_base: number;
  moneda_base: string;
}

export interface RendimientoFlex {
  valor_inicial: number;
  valor_final: number;
  depositos_retiros: number | null;
  mtm: number | null;
  intereses: number | null;
  dividendos: number | null;
  twr: number;
}

export interface CuentaFlex {
  cuenta_ibkr: string;
  moneda_base: string;
  /** Date Funded en AAAA-MM-DD: inicio real de la cuenta para «desde apertura». */
  fecha_fondeo: string | null;
  /** Posiciones, efectivo (si hay Cash Report) y el renglón de control NAV_IBKR. */
  renglones: RenglonFoto[];
  nav_ibkr: number;
  /** Efectivo liquidado (BASE_SUMMARY.endingSettledCash): el del renglón EFECTIVO, para liquidez. */
  efectivo_liquidado: number | null;
  /** Efectivo total, con lo pendiente de liquidar (BASE_SUMMARY.endingCash): solo para conciliar. */
  efectivo_total: number | null;
  /** Posiciones + efectivo TOTAL, en moneda base: lo que se concilia contra NAV_IBKR. */
  valor_calculado: number;
  rendimiento: RendimientoFlex | null;
}

export interface Descartada {
  cuenta_ibkr: string | null;
  motivo: string;
}

export interface ReporteFlex {
  /** El td pedido, AAAAMMDD; todo FlexStatement conservado trae ese toDate. */
  td: string;
  sha256: string;
  total_statements: number;
  cuentas: CuentaFlex[];
  descartadas: Descartada[];
}

class Descarte extends Error {}

const redondear = (x: number): number => Math.round(x * 1e6) / 1e6;

function num(v: unknown, campo: string): number | null {
  const s = texto(v);
  if (s === null || s === '--') return null;
  const n = Number(s.replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new Descarte(`${campo} no es numérico`);
  return n;
}

function numRequerido(v: unknown, campo: string): number {
  const n = num(v, campo);
  if (n === null) throw new Descarte(`falta ${campo}`);
  return n;
}

function leerCuenta(st: Nodo, cuenta: string): CuentaFlex {
  const info = lista(st.AccountInformation)[0];
  const monedaBase = texto(info?.currency);
  if (!monedaBase || !/^[A-Z]{3}$/.test(monedaBase)) throw new Descarte('sin moneda base en AccountInformation');
  const fondeo = normalizarFecha(info?.dateFunded);

  const renglones: RenglonFoto[] = [];
  const vistos = new Set<string>();
  for (const p of lista((st.OpenPositions as Nodo | undefined)?.OpenPosition)) {
    const nivel = texto(p.levelOfDetail);
    if (nivel && nivel !== 'SUMMARY') continue; // los lotes repiten la posición
    const ticker = texto(p.symbol);
    const asset = texto(p.assetCategory);
    const moneda = texto(p.currency);
    if (!ticker || !asset || !moneda) throw new Descarte('posición sin symbol, assetCategory o currency');
    if (ticker === 'EFECTIVO' || ticker === 'NAV_IBKR') throw new Descarte(`ticker reservado ${ticker}`);
    const conid = num(p.conid, 'conid');
    const llave = conid !== null ? `c:${conid}` : `t:${ticker}`;
    if (vistos.has(llave)) throw new Descarte(`instrumento repetido ${ticker}`);
    vistos.add(llave);
    const valor = numRequerido(p.positionValue, 'positionValue');
    const fx = numRequerido(p.fxRateToBase, 'fxRateToBase');
    if (fx <= 0) throw new Descarte(`fxRateToBase no positivo en ${ticker}`);
    renglones.push({
      cuenta_ibkr: cuenta,
      tipo_renglon: 'posicion',
      ticker,
      conid,
      asset_category: asset,
      sub_category: texto(p.subCategory),
      descripcion: texto(p.description),
      cantidad: numRequerido(p.position, 'position'),
      mark_price: numRequerido(p.markPrice, 'markPrice'),
      position_value: valor,
      moneda,
      fx_rate_to_base: fx,
      valor_base: redondear(valor * fx),
      moneda_base: monedaBase,
    });
  }

  const cajas = lista((st.CashReport as Nodo | undefined)?.CashReportCurrency);
  let liquidado: number | null = null;
  let total: number | null = null;
  if (cajas.length) {
    const base = cajas.find((c) => texto(c.currency) === 'BASE_SUMMARY');
    if (!base) throw new Descarte('Cash Report sin BASE_SUMMARY (sumar las divisas duplicaría el efectivo)');
    liquidado = numRequerido(base.endingSettledCash, 'endingSettledCash');
    total = numRequerido(base.endingCash, 'endingCash');
    renglones.push(renglonControl(cuenta, 'efectivo', liquidado, monedaBase));
  }

  const navs = lista((st.EquitySummaryInBase as Nodo | undefined)?.EquitySummaryByReportDateInBase)
    .map((e) => ({ fecha: normalizarFecha(e.reportDate), total: e.total }))
    .filter((e): e is { fecha: string; total: unknown } => e.fecha !== null)
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
  const ultimo = navs[navs.length - 1];
  if (!ultimo) throw new Descarte('sin NAV de IBKR (EquitySummaryByReportDateInBase)');
  const nav = numRequerido(ultimo.total, 'total del NAV');
  renglones.push(renglonControl(cuenta, 'nav_ibkr', nav, monedaBase));

  const cambio = lista(st.ChangeInNAV)[0];
  const rendimiento: RendimientoFlex | null = cambio
    ? {
        valor_inicial: numRequerido(cambio.startingValue, 'startingValue'),
        valor_final: numRequerido(cambio.endingValue, 'endingValue'),
        depositos_retiros: num(cambio.depositsWithdrawals, 'depositsWithdrawals'),
        mtm: num(cambio.mtm, 'mtm'),
        intereses: num(cambio.interest, 'interest'),
        dividendos: num(cambio.dividends, 'dividends'),
        twr: numRequerido(cambio.twr, 'twr'),
      }
    : null;

  const posiciones = renglones.filter((r) => r.tipo_renglon === 'posicion');
  return {
    cuenta_ibkr: cuenta,
    moneda_base: monedaBase,
    fecha_fondeo: fondeo ? aIso(fondeo) : null,
    renglones,
    nav_ibkr: nav,
    efectivo_liquidado: liquidado,
    efectivo_total: total,
    valor_calculado: redondear(posiciones.reduce((s, r) => s + r.valor_base, 0) + (total ?? 0)),
    rendimiento,
  };
}

function renglonControl(cuenta: string, tipo: 'efectivo' | 'nav_ibkr', valor: number, monedaBase: string): RenglonFoto {
  return {
    cuenta_ibkr: cuenta,
    tipo_renglon: tipo,
    ticker: tipo === 'efectivo' ? 'EFECTIVO' : 'NAV_IBKR',
    conid: null,
    asset_category: null,
    sub_category: null,
    descripcion: null,
    cantidad: null,
    mark_price: null,
    position_value: null,
    moneda: null,
    fx_rate_to_base: null,
    valor_base: valor,
    moneda_base: monedaBase,
  };
}

/** Lee el FlexQueryResponse. `tdPedido` en AAAAMMDD. Una cuenta con un dato inválido se descarta entera. */
export function parsearFlex(xml: string, tdPedido: string): ReporteFlex {
  if (!normalizarFecha(tdPedido)) throw new ErrorFlex(null, 'td pedido inválido.');
  const doc = leerXml(xml);
  const raiz = doc.FlexQueryResponse as Nodo | undefined;
  if (!raiz || typeof raiz !== 'object') {
    const servicio = doc.FlexStatementResponse as Nodo | undefined;
    if (servicio) throw errorDeServicio({ status: texto(servicio.Status), codigo: texto(servicio.ErrorCode), referencia: null });
    throw new ErrorFlex(null, 'El XML no es un FlexQueryResponse.');
  }
  const statements = lista((raiz.FlexStatements as Nodo | undefined)?.FlexStatement);
  const cuentas: CuentaFlex[] = [];
  const descartadas: Descartada[] = [];
  const vistas = new Set<string>();
  for (const st of statements) {
    const cuenta = texto(st.accountId);
    if (!cuenta || !/^U\d+$/.test(cuenta)) {
      descartadas.push({ cuenta_ibkr: cuenta, motivo: 'accountId ausente o con forma inválida' });
      continue;
    }
    if (vistas.has(cuenta)) {
      descartadas.push({ cuenta_ibkr: cuenta, motivo: 'cuenta repetida en el XML' });
      continue;
    }
    vistas.add(cuenta);
    const toDate = normalizarFecha(st.toDate);
    if (toDate !== tdPedido) {
      descartadas.push({ cuenta_ibkr: cuenta, motivo: `toDate ${toDate ?? '(vacío)'} distinto del td pedido ${tdPedido}` });
      continue;
    }
    try {
      cuentas.push(leerCuenta(st, cuenta));
    } catch (e) {
      if (!(e instanceof Descarte)) throw e;
      descartadas.push({ cuenta_ibkr: cuenta, motivo: e.message });
    }
  }
  return {
    td: tdPedido,
    sha256: createHash('sha256').update(xml, 'utf8').digest('hex'),
    total_statements: statements.length,
    cuentas,
    descartadas,
  };
}

// ---------------------------------------------------------------------------
// Descuadres (vista previa) y la carga para fn_cargar_ibkr
// ---------------------------------------------------------------------------

export interface CuentaCRM {
  cuenta_ibkr: string;
  codigo_cliente: string;
  /** AAAA-MM-DD si el cliente tiene baja en el CRM. */
  fecha_baja: string | null;
}

export type Descuadre =
  | { tipo: 'sin_contrato'; cuenta_ibkr: string }
  | { tipo: 'baja_abierta'; cuenta_ibkr: string; codigo_cliente: string; fecha_baja: string }
  | { tipo: 'ausente_en_ibkr'; cuenta_ibkr: string; codigo_cliente: string }
  | { tipo: 'fuera_de_catalogo'; cuenta_ibkr: string; ticker: string; asset_category: string; sub_category: string | null }
  | { tipo: 'nav_descuadrado'; cuenta_ibkr: string; nav_ibkr: number; valor_calculado: number; diferencia: number }
  | { tipo: 'descartada'; cuenta_ibkr: string | null; motivo: string };

/**
 * Todo lo que la vista previa debe mostrar antes de confirmar. Las opciones
 * (OPT) no cuentan como fuera de catálogo: nunca entran en él (son DERIVADO).
 */
export function calcularDescuadres(
  rep: ReporteFlex,
  crm: readonly CuentaCRM[],
  catalogo: ReadonlySet<string>,
): Descuadre[] {
  const enCrm = new Map(crm.map((c) => [c.cuenta_ibkr, c]));
  const enXml = new Set([
    ...rep.cuentas.map((c) => c.cuenta_ibkr),
    ...rep.descartadas.flatMap((d) => (d.cuenta_ibkr ? [d.cuenta_ibkr] : [])),
  ]);
  const salida: Descuadre[] = rep.descartadas.map((d) => ({ tipo: 'descartada', ...d }));

  for (const cuenta of [...enXml].sort()) {
    const c = enCrm.get(cuenta);
    if (!c) salida.push({ tipo: 'sin_contrato', cuenta_ibkr: cuenta });
    else if (c.fecha_baja) {
      salida.push({ tipo: 'baja_abierta', cuenta_ibkr: cuenta, codigo_cliente: c.codigo_cliente, fecha_baja: c.fecha_baja });
    }
  }
  for (const c of [...crm].sort((a, b) => a.cuenta_ibkr.localeCompare(b.cuenta_ibkr))) {
    if (!c.fecha_baja && !enXml.has(c.cuenta_ibkr)) {
      salida.push({ tipo: 'ausente_en_ibkr', cuenta_ibkr: c.cuenta_ibkr, codigo_cliente: c.codigo_cliente });
    }
  }
  for (const cuenta of rep.cuentas) {
    if (!enCrm.has(cuenta.cuenta_ibkr)) continue;
    for (const r of cuenta.renglones) {
      if (r.tipo_renglon === 'posicion' && r.asset_category !== 'OPT' && !catalogo.has(r.ticker)) {
        salida.push({
          tipo: 'fuera_de_catalogo',
          cuenta_ibkr: cuenta.cuenta_ibkr,
          ticker: r.ticker,
          asset_category: r.asset_category ?? '',
          sub_category: r.sub_category,
        });
      }
    }
    const diferencia = diferenciaRelativa(cuenta.valor_calculado, cuenta.nav_ibkr);
    if (diferencia > UMBRAL_NAV) {
      salida.push({
        tipo: 'nav_descuadrado',
        cuenta_ibkr: cuenta.cuenta_ibkr,
        nav_ibkr: cuenta.nav_ibkr,
        valor_calculado: cuenta.valor_calculado,
        diferencia: Math.round(diferencia * 1e6) / 1e6,
      });
    }
  }
  return salida;
}

function diferenciaRelativa(calculado: number, nav: number): number {
  if (nav === 0) return calculado === 0 ? 0 : 1;
  return Math.abs(calculado - nav) / Math.abs(nav);
}

export const VENTANAS = ['MTD', 'QTD', 'YTD', '12M', '12M-1', '12M-2', 'DESDE_APERTURA'] as const;
export type Ventana = (typeof VENTANAS)[number] | `A${number}`;

interface CargaBase {
  fd: string;
  td: string;
  to_date_ibkr: string;
  xml_sha256: string;
  cuentas_xml: number;
  ignoradas: number;
  descuadres: Descuadre[];
}
export interface CargaFoto extends CargaBase {
  uso: 'foto_diaria';
  posiciones: RenglonFoto[];
}
export interface CargaRendimiento extends CargaBase {
  uso: 'rendimiento';
  ventana: Ventana;
  rendimientos: (RendimientoFlex & { cuenta_ibkr: string; moneda_base: string; fecha_fondeo: string | null })[];
}

function conContrato(rep: ReporteFlex, crm: readonly CuentaCRM[]): CuentaFlex[] {
  const cuentas = new Set(crm.map((c) => c.cuenta_ibkr));
  return rep.cuentas.filter((c) => cuentas.has(c.cuenta_ibkr));
}

/**
 * El payload de fn_cargar_ibkr para la foto diaria. Solo cuentas con contrato
 * en el CRM; las demás quedan en descuadres y cuentan en `ignoradas`.
 * to_date_ibkr = td porque parsearFlex ya descartó todo statement con otro toDate.
 */
export function armarCargaFoto(rep: ReporteFlex, descuadres: Descuadre[], crm: readonly CuentaCRM[]): CargaFoto {
  const cuentas = conContrato(rep, crm);
  if (!cuentas.length) throw new ErrorFlex(null, 'Ninguna cuenta del XML tiene contrato en el CRM: no hay nada que cargar.');
  const td = aIso(rep.td);
  return {
    uso: 'foto_diaria',
    fd: td,
    td,
    to_date_ibkr: td,
    xml_sha256: rep.sha256,
    cuentas_xml: rep.total_statements,
    ignoradas: rep.total_statements - cuentas.length,
    descuadres,
    posiciones: cuentas.flatMap((c) => c.renglones),
  };
}

/** El payload de fn_cargar_ibkr para una ventana de rendimiento (`fd` en AAAAMMDD, el pedido). */
export function armarCargaRendimiento(
  rep: ReporteFlex,
  fd: string,
  ventana: Ventana,
  descuadres: Descuadre[],
  crm: readonly CuentaCRM[],
): CargaRendimiento {
  const cuentas = conContrato(rep, crm).filter((c) => c.rendimiento !== null);
  if (!cuentas.length) throw new ErrorFlex(null, 'Ninguna cuenta con contrato trae ChangeInNAV: no hay nada que cargar.');
  const td = aIso(rep.td);
  return {
    uso: 'rendimiento',
    ventana,
    fd: aIso(fd),
    td,
    to_date_ibkr: td,
    xml_sha256: rep.sha256,
    cuentas_xml: rep.total_statements,
    ignoradas: rep.total_statements - cuentas.length,
    descuadres,
    rendimientos: cuentas.map((c) => ({
      cuenta_ibkr: c.cuenta_ibkr,
      moneda_base: c.moneda_base,
      fecha_fondeo: c.fecha_fondeo,
      ...(c.rendimiento as RendimientoFlex),
    })),
  };
}
