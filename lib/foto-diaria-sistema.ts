/**
 * [foto-diaria] Foto diaria automática (M2 fase 2): la lógica de la Edge Function
 * ibkr-foto-diaria, pura y con todo lo externo inyectado (IBKR, Banxico, base).
 * Sin dependencias de Node; la prueban los tests de Vitest y la corre Deno.
 * ---------------------------------------------------------------------------
 * Diseño aprobado por Claudio (Día 62; ajustes del 18-nov-2026):
 * - pg_cron llama a la MISMA función cada 20 min de 06:00 a 07:40 CDMX, de lunes
 *   a viernes. Cada ejecución mira el estado del td y da UN paso; repetirla no
 *   hace daño (idempotente):
 *     sin foto y sin pedido vivo → pedir (guarda la referencia de la Flex);
 *     pedido vivo → recoger una vez: «no listo» (1019) espera a la siguiente;
 *       sin NAV → la siguiente vuelve a pedir; con datos → carga.
 *   Con la foto: FIX del td (Banxico SF43718, reglas de fix.mjs); con foto Y FIX:
 *   el semáforo, registrado con el usuario de sistema, sin supuestos.
 * - td feriado de NYSE → «omitido», sin pedir nada a IBKR.
 * - Todo paso deja un evento en ibkr_cron_eventos (solo agregar), saneado: sin
 *   secretos ni números de cuenta. El control de las 08:00 (SQL) registra «error»
 *   si el td del día no quedó cargado ni omitido.
 * - Las mismas reglas que a mano: lib/ibkr-carga-reglas.ts (qué se carga),
 *   lib/banxico.ts (FIX), lib/semaforo-corrida.ts (semáforo).
 * - modo seco: hace las consultas (pide y espera el XML en la misma ejecución) y
 *   devuelve lo que haría, sin escribir NADA, ni eventos.
 */

import { cubierto, fechaCdmx, feriadoNyse, tdFotoDiaria } from './calendario-nyse.ts';
import {
  armarCargaFoto, calcularDescuadres, leerFlex, sha256Hex, type CargaFoto,
} from './ibkr-flex-lectura.ts';
import { crmParaDescuadres, cuentasCargables, ErrorCarga, validarRespuesta, type CuentaReferencia } from './ibkr-carga-reglas.ts';
import { elegirFix, restarDias, SERIE_FIX, VENTANA_DIAS, type DatoFix, type RegistroFix } from './banxico.ts';
import { correrSemaforo, type DatosSemaforo } from './semaforo-corrida.ts';
import { armarLote, type LoteSemaforo } from './semaforo-registro.ts';
import { VERSION_MOTOR } from './semaforo.ts';

export const USUARIO_SISTEMA = 'sistema:ibkr-cron';
export const ESPERA_SECO_MS = 5_000;
export const INTENTOS_SECO = 18;

export type Paso = 'foto' | 'fix' | 'semaforo';
export type Resultado = 'pedido' | 'no_listo' | 'sin_nav' | 'cargado' | 'ya_cargado' | 'omitido' | 'error';
const TERMINALES: readonly Resultado[] = ['cargado', 'ya_cargado', 'omitido'];

export interface Evento {
  td: string;
  paso: Paso;
  resultado: Resultado;
  referencia_flex: string | null;
  sync_id: string | null;
  detalle: Record<string, unknown>;
}

export interface UltimoEvento {
  resultado: Resultado;
  referencia_flex: string | null;
  detalle: Record<string, unknown>;
}

export interface EstadoTd {
  /** La foto_diaria del td, si ya está cargada (a mano o automática). */
  sync_id: string | null;
  ultimo: Partial<Record<Paso, UltimoEvento>>;
  /** ¿Ya hay semáforo de ese sync con VERSION_MOTOR? */
  semaforo_registrado: boolean;
}

/** Error de una llamada a la base (código de Postgres, p. ej. IB409). */
export class ErrorRpc extends Error {
  readonly codigo: string | null;
  constructor(codigo: string | null, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorRpc';
    this.codigo = codigo;
  }
}

export interface DepsFotoDiaria {
  estado(td: string, versionMotor: string): Promise<EstadoTd>;
  referenciaCrm(): Promise<{ cuentas: CuentaReferencia[]; catalogo: string[] }>;
  cargarFoto(carga: CargaFoto): Promise<{ sync_id: string; renglones: number }>;
  tipoCambio(serie: string, fecha: string): Promise<number | null>;
  registrarFix(r: RegistroFix): Promise<void>;
  datosSemaforo(syncId: string): Promise<DatosSemaforo>;
  registrarSemaforo(lote: LoteSemaforo): Promise<{ evaluaciones: number }>;
  anotar(e: Evento): Promise<void>;
  flex: {
    pedir(tdAaaammdd: string): Promise<string>;
    consultar(referencia: string): Promise<{ listo: true; xml: string } | { listo: false }>;
  };
  banxico: { serie(desde: string, hasta: string): Promise<DatoFix[]> };
  dormir(ms: number): Promise<void>;
  /** Valores que nunca pueden salir en un evento ni en la respuesta (tokens, llaves). */
  secretos: readonly string[];
}

// ---------------------------------------------------------------------------
// Saneamiento y llave
// ---------------------------------------------------------------------------

/** Quita secretos y números de cuenta de un texto. */
export function sanear(texto: string, secretos: readonly string[]): string {
  let t = texto;
  for (const s of secretos) if (s && s.length >= 4) t = t.split(s).join('«secreto»');
  return t.replace(/\bU\d{5,}\b/g, 'U••••');
}

/** Comparación en tiempo constante de la llave de invocación. */
export function llaveValida(recibida: string, esperada: string): boolean {
  if (!esperada || esperada.length < 32) return false; // una llave corta es un error de configuración
  const a = new TextEncoder().encode(recibida);
  const b = new TextEncoder().encode(esperada);
  let dif = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) dif |= (a[i] ?? 0) ^ b[i];
  return dif === 0;
}

function errorComoDetalle(e: unknown, secretos: readonly string[]): Record<string, unknown> {
  const err = e as { name?: string; codigo?: string | null; message?: string };
  return { tipo: err?.name ?? 'Error', codigo: err?.codigo ?? null, mensaje: sanear(String(err?.message ?? e), secretos) };
}

function contarPor<T>(xs: readonly T[], llave: (x: T) => string): Record<string, number> {
  const r: Record<string, number> = {};
  for (const x of xs) r[llave(x)] = (r[llave(x)] ?? 0) + 1;
  return r;
}

// ---------------------------------------------------------------------------
// Avanzar un paso
// ---------------------------------------------------------------------------

export interface ResultadoAvance {
  td: string | null;
  seco: boolean;
  eventos: Evento[];
}

export async function avanzar(ahora: Date, deps: DepsFotoDiaria, opciones: { seco?: boolean } = {}): Promise<ResultadoAvance> {
  const seco = opciones.seco === true;
  const hoy = fechaCdmx(ahora);
  const td = tdFotoDiaria(hoy);
  const eventos: Evento[] = [];
  const anotar = async (paso: Paso, resultado: Resultado, extra: Partial<Evento> = {}) => {
    const detalle = JSON.parse(sanear(JSON.stringify({ ...(extra.detalle ?? {}), ...(seco ? { seco: true } : {}) }), deps.secretos));
    const e: Evento = { td, paso, resultado, referencia_flex: extra.referencia_flex ?? null, sync_id: extra.sync_id ?? null, detalle };
    eventos.push(e);
    if (!seco) await deps.anotar(e);
  };
  const fin = (): ResultadoAvance => ({ td, seco, eventos });
  let pasoActual: Paso = 'foto';

  try {
    if (!cubierto(td)) {
      await anotar('foto', 'error', { detalle: { motivo: `El calendario de NYSE no cubre el td ${td}: actualizar lib/calendario-nyse.ts.` } });
      return fin();
    }
    const est = await deps.estado(td, VERSION_MOTOR);
    const feriado = feriadoNyse(td);
    if (feriado) {
      if (est.ultimo.foto?.resultado !== 'omitido') await anotar('foto', 'omitido', { detalle: { motivo: `Feriado de NYSE: ${feriado}` } });
      return fin();
    }

    // --- 1 · Foto ---------------------------------------------------------------------------
    let syncId = est.sync_id;
    if (syncId) {
      if (!TERMINALES.includes(est.ultimo.foto?.resultado as Resultado)) {
        await anotar('foto', 'ya_cargado', { sync_id: syncId, detalle: { motivo: 'La foto del td ya estaba cargada.' } });
      }
    } else {
      const xml = await conseguirXml(td, est, deps, seco, anotar);
      if (xml === null) return fin();
      const cargado = await cargarXml(td, xml, deps, seco, anotar);
      if (cargado === null && !seco) return fin(); // en seco sigue: muestra también el FIX
      syncId = cargado;
    }

    // --- 2 · FIX ----------------------------------------------------------------------------
    pasoActual = 'fix';
    let fix = est.ultimo.fix && ['cargado', 'ya_cargado'].includes(est.ultimo.fix.resultado)
      ? Number(est.ultimo.fix.detalle.valor) : null;
    if (fix === null) {
      fix = await registrarFixDelTd(td, deps, seco, anotar);
      if (fix === null) return fin();
    }

    // --- 3 · Semáforo (solo con foto y FIX del td; sin supuestos) ---------------------------------
    pasoActual = 'semaforo';
    if (est.semaforo_registrado) return fin();
    if (!syncId) {
      await anotar('semaforo', 'omitido', { detalle: { motivo: 'En seco: la foto no está cargada; el semáforo correría después de cargarla.' } });
      return fin();
    }
    const datos = await deps.datosSemaforo(syncId as string);
    if (datos.sync?.id !== syncId || String(datos.sync.td).slice(0, 10) !== td) {
      throw new Error('Los datos del semáforo no son de la foto del td.');
    }
    const corrida = correrSemaforo(datos, fix);
    const lote = armarLote(syncId as string, fix, corrida.filas.map((f) => f.evaluacion));
    if (!seco) await deps.registrarSemaforo(lote);
    await anotar('semaforo', 'cargado', { sync_id: syncId, detalle: { version_motor: corrida.version_motor, tipo_cambio: fix,
      evaluaciones: lote.evaluaciones.length, conteo: corrida.conteo } });
    return fin();
  } catch (e) {
    await anotar(pasoActual, 'error', { detalle: errorComoDetalle(e, deps.secretos) }).catch(() => undefined);
    return fin();
  }
}

// ---------------------------------------------------------------------------
// Adaptador a la base: las funciones SQL del paso 2 (migración 01). Todas con
// EXECUTE solo para service_role; la Edge Function las llama con supabase-js.
// ---------------------------------------------------------------------------

export const RPC = {
  estado: 'fn_foto_diaria_estado',
  referencia: 'fn_foto_diaria_referencia',
  cargar: 'fn_cargar_ibkr_sistema',
  tipoCambio: 'fn_foto_diaria_tipo_cambio',
  fix: 'fn_registrar_tipo_cambio_sistema',
  datosSemaforo: 'fn_datos_semaforo_sistema',
  semaforo: 'fn_registrar_semaforo_sistema',
  anotar: 'fn_anotar_evento_foto',
} as const;

export type LlamadaRpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;

export function depsDesdeRpc(
  rpc: LlamadaRpc,
  externos: Pick<DepsFotoDiaria, 'flex' | 'banxico' | 'dormir' | 'secretos'>,
): DepsFotoDiaria {
  return {
    ...externos,
    estado: async (td, version) => (await rpc(RPC.estado, { p_td: td, p_version_motor: version })) as EstadoTd,
    referenciaCrm: async () => (await rpc(RPC.referencia, {})) as { cuentas: CuentaReferencia[]; catalogo: string[] },
    cargarFoto: async (carga) => (await rpc(RPC.cargar, { p_carga: carga })) as { sync_id: string; renglones: number },
    tipoCambio: async (serie, fecha) => {
      const v = await rpc(RPC.tipoCambio, { p_serie: serie, p_fecha: fecha });
      return v === null || v === undefined ? null : Number(v);
    },
    registrarFix: async (r) => {
      await rpc(RPC.fix, { p_serie: r.serie, p_fecha: r.fecha, p_valor: r.valor, p_fecha_solicitada: r.fecha_solicitada,
        p_fuente: r.fuente, p_nota: r.nota });
    },
    datosSemaforo: async (syncId) => (await rpc(RPC.datosSemaforo, { p_sync: syncId })) as DatosSemaforo,
    registrarSemaforo: async (lote) => (await rpc(RPC.semaforo, { p_lote: lote })) as { evaluaciones: number },
    anotar: async (e) => {
      await rpc(RPC.anotar, { p_evento: e });
    },
  };
}

type Anotar = (paso: Paso, resultado: Resultado, extra?: Partial<Evento>) => Promise<void>;

/** Pide o recoge el XML. Devuelve null si esta ejecución termina aquí (pedido, no listo). */
async function conseguirXml(td: string, est: EstadoTd, deps: DepsFotoDiaria, seco: boolean, anotar: Anotar): Promise<string | null> {
  const tdFlex = td.replace(/-/g, '');
  if (seco) {
    const referencia = await deps.flex.pedir(tdFlex);
    for (let i = 0; i < INTENTOS_SECO; i++) {
      await deps.dormir(ESPERA_SECO_MS);
      const r = await deps.flex.consultar(referencia);
      if (r.listo) return r.xml;
    }
    await anotar('foto', 'no_listo', { detalle: { motivo: `IBKR no entregó el XML en ${(INTENTOS_SECO * ESPERA_SECO_MS) / 1000} s.` } });
    return null;
  }
  const ult = est.ultimo.foto;
  if (ult && (ult.resultado === 'pedido' || ult.resultado === 'no_listo') && ult.referencia_flex) {
    const r = await deps.flex.consultar(ult.referencia_flex);
    if (r.listo) return r.xml;
    await anotar('foto', 'no_listo', { referencia_flex: ult.referencia_flex });
    return null;
  }
  const referencia = await deps.flex.pedir(tdFlex);
  await anotar('foto', 'pedido', { referencia_flex: referencia });
  return null;
}

/** Lee el XML con las reglas de cargar-foto y lo carga. Devuelve el sync_id, o null si no se cargó. */
async function cargarXml(td: string, xml: string, deps: DepsFotoDiaria, seco: boolean, anotar: Anotar): Promise<string | null> {
  const rep = leerFlex(xml, td.replace(/-/g, ''), await sha256Hex(xml));
  try {
    validarRespuesta(rep);
  } catch (e) {
    if (e instanceof ErrorCarga && e.codigo === 'SIN_NAV') {
      await anotar('foto', 'sin_nav', { detalle: { cuentas_xml: rep.total_statements, motivo: 'IBKR respondió sin NAV: la siguiente ejecución vuelve a pedir.' } });
      return null;
    }
    throw e;
  }
  const ref = await deps.referenciaCrm();
  const descuadres = calcularDescuadres(rep, crmParaDescuadres(ref.cuentas), new Set(ref.catalogo));
  const carga = armarCargaFoto(rep, descuadres, cuentasCargables(ref.cuentas));
  const resumen = { cuentas_xml: carga.cuentas_xml, cuentas: new Set(carga.posiciones.map((p) => p.cuenta_ibkr)).size,
    renglones: carga.posiciones.length, ignoradas: carga.ignoradas, descuadres: contarPor(descuadres, (d) => d.tipo) };
  if (seco) {
    await anotar('foto', 'cargado', { detalle: { ...resumen, motivo: 'En seco: se cargaría.' } });
    return null;
  }
  try {
    const r = await deps.cargarFoto(carga);
    await anotar('foto', 'cargado', { sync_id: r.sync_id, detalle: { ...resumen, renglones: r.renglones } });
    return r.sync_id;
  } catch (e) {
    if (e instanceof ErrorRpc && e.codigo === 'IB409') {
      // Otra carga (a mano) ganó la carrera: la foto existe; la siguiente ejecución sigue con FIX y semáforo.
      await anotar('foto', 'ya_cargado', { detalle: { motivo: 'La base rechazó la carga por duplicada (IB409).' } });
      return null;
    }
    throw e;
  }
}

/** FIX del td con las reglas de fix.mjs. Devuelve el valor para el semáforo, o null si no hay. */
async function registrarFixDelTd(td: string, deps: DepsFotoDiaria, seco: boolean, anotar: Anotar): Promise<number | null> {
  const elegido = elegirFix(await deps.banxico.serie(restarDias(td, VENTANA_DIAS), td), td);
  const existente = await deps.tipoCambio(SERIE_FIX, elegido.fecha);
  const detalle = { fecha: elegido.fecha, valor: elegido.valor, nota: elegido.nota };
  if (existente !== null) {
    if (Math.abs(existente - elegido.valor) > 1e-6) {
      await anotar('fix', 'error', { detalle: { ...detalle, en_base: existente,
        motivo: 'El FIX registrado no coincide con el de Banxico: revisar a mano; el semáforo no corre.' } });
      return null;
    }
    await anotar('fix', 'ya_cargado', { detalle });
    return elegido.valor;
  }
  const reg: RegistroFix = { serie: SERIE_FIX, fecha: elegido.fecha, valor: elegido.valor, fecha_solicitada: td,
    fuente: `Banxico SIE ${SERIE_FIX} (consulta automática, ${USUARIO_SISTEMA})`, nota: elegido.nota };
  if (!seco) await deps.registrarFix(reg);
  await anotar('fix', 'cargado', { detalle });
  return elegido.valor;
}
