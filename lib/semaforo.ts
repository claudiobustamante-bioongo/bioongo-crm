/**
 * [semaforo] Semáforo de cumplimiento por cuenta (M5). Puro: sin base ni red.
 * ---------------------------------------------------------------------------
 * docs/SPEC_Build_Bioongo_v1_2026-11-10.md §M5, con las decisiones de Claudio del
 * 16-nov-2026. Diagnostica; no opera.
 *
 * Compuertas, en este orden (la primera que aplica fija el estado):
 *   1. Cuenta propia del Asesor → EXENTO. Se evalúa igual y los hallazgos se
 *      guardan como informativos (ESPEC_IBKR_Flex §3.2.15).
 *   2. Sin perfil, faltante o vencido (lib/perfil-cuenta.ts) → SIN_PERFIL.
 *   3. Sin foto de la fecha → SIN_DATOS.
 *   4. NAV en pesos ≤ nav_residual_mxn → INACTIVA. Una cuenta en USD sin FIX NO
 *      se evalúa como INACTIVA: sigue, con aviso (nunca se supone un tipo de cambio).
 *   5. 100 % efectivo → ÁMBAR «sin invertir».
 * Pruebas:
 *   P1 elegibilidad: no elegible (COMMODITY, CRIPTO, APALANCADO, DERIVADO) o
 *      NO_CATALOGADO → crítico; fuera de catálogo con regla → aviso.
 *   P2 techo por clase (limites_perfil), sobre las clases elegibles. El exceso
 *      → incumple, salvo en deuda gubernamental (GOB_MX, GOB_EXT) desde 1.1.0:
 *      si el exceso está cubierto por equivalentes de efectivo o fracciones con
 *      duración < 3 (la parte larga, duración ≥ 3 o nula y no equivalente, cabe
 *      en el techo) → aviso «más conservadora que su perfil (desalineada con el
 *      mandato)»; si no → incumple «exceso de deuda gubernamental de larga
 *      duración». Decisión del Asesor del 16-nov-2026, pendiente de confirmar con
 *      el Oficial de Cumplimiento.
 *   P3 duración: si el perfil tiene duracion_gob_menor_a, cada fracción GOB_MX y
 *      GOB_EXT con duración ≥ límite, o nula, incumple.
 *   P4 fase, con P5 (el límite más restrictivo de TODAS las fuentes, con
 *      origenes[]): RV ≤ min(rv_max de cada fase, rv_total_max del perfil);
 *      RF ≥ max(rf_min de cada fase), con el efectivo si el perfil lo permite;
 *      liquidez ≥ max(liquidez_min de cada fase y del perfil).
 *   Saldo deudor: % de la suma de saldos positivos; ≤ tolerancia aviso, > incumple.
 * Estado: ROJO si hay algo crítico o que incumple; ÁMBAR si solo avisos; VERDE.
 * Porcentajes sobre la suma de saldos POSITIVOS (ESPEC_IBKR_Flex §3.2.14); el
 * efectivo es el liquidado (el renglón EFECTIVO de la foto).
 * Cada evaluación guarda los límites que aplicó, con su origen: una incidencia
 * no debe depender de la tabla viva de M4.
 */

import { clasificarRenglon, type Catalogo, type RenglonPosicion } from './clasificacion-activos';
import type { PerfilCuenta } from './perfil-cuenta';

export const VERSION_MOTOR = 'semaforo-1.1.0';

/** P2 en GOB_MX/GOB_EXT: duración bajo la cual el exceso es «más conservador», no incumplimiento (1.1.0). */
export const GOB_EXCESO_CORTO = {
  duracion_menor_a: 3,
  decision: 'Decisión del Asesor (16-nov-2026): el exceso sobre el techo de deuda gubernamental cubierto por '
    + 'equivalentes de efectivo o duración < 3 es aviso; pendiente de confirmar con el Oficial de Cumplimiento.',
} as const;

export const ESTADOS = ['VERDE', 'AMBAR', 'ROJO', 'EXENTO', 'SIN_PERFIL', 'SIN_DATOS', 'INACTIVA'] as const;
export type Estado = (typeof ESTADOS)[number];
export type Severidad = 'critico' | 'incumple' | 'aviso';

export interface Hallazgo {
  prueba: 'P1' | 'P2' | 'P3' | 'P4' | 'SALDO_DEUDOR' | 'SIN_INVERTIR' | 'TIPO_CAMBIO';
  severidad: Severidad;
  mensaje: string;
  clase?: string;
  ticker?: string;
  valor_pct?: number;
  limite_pct?: number;
  /** P2 en deuda gubernamental: % de la parte de duración ≥ 3 o nula (no equivalente). */
  larga_duracion_pct?: number;
  origenes?: string[];
}

export interface ParametrosM4 {
  limitesFase: Readonly<Record<string, { rv_max_pct: number; rf_min_pct: number; liquidez_min_pct: number }>>;
  limitesPerfil: Readonly<Record<string, Readonly<Record<string, number>>>>;
  reglasPerfil: Readonly<Record<string, {
    duracion_gob_menor_a: number | null;
    liquidez_min_pct: number;
    efectivo_cuenta_rf: boolean;
    rv_total_max_pct: number;
  }>>;
  navResidualMxn: number;
  saldoDeudorToleranciaPct: number;
}

export interface FotoCuenta {
  moneda_base: string;
  nav_ibkr: number;
  /** Renglones posicion y efectivo (el NAV_IBKR va aparte). */
  renglones: readonly RenglonPosicion[];
}

export interface EntradaEvaluacion {
  cuenta_ibkr: string;
  es_propia: boolean;
  perfil: PerfilCuenta;
  foto: FotoCuenta | null;
  /** MXN por USD del día de la foto; null si no hay FIX capturado. */
  tipo_cambio: number | null;
  catalogo: Catalogo;
  parametros: ParametrosM4;
}

export interface LimiteAplicado {
  valor: number;
  origenes: string[];
}

export interface Evaluacion {
  cuenta_ibkr: string;
  estado: Estado;
  hallazgos: (Hallazgo & { informativo?: true })[];
  metricas: Record<string, unknown>;
  limites_aplicados: Record<string, unknown>;
  perfil_aplicado: Record<string, unknown> | null;
  version_motor: string;
}

const RV = ['ACC_BMV', 'ACC_SIC'];
const RF = ['GOB_MX', 'GOB_EXT', 'GOB_EMERGENTE', 'CORP_IG', 'HIGH_YIELD'];
const GOB_DURACION = ['GOB_MX', 'GOB_EXT'];
const EPS = 1e-9;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Mínimo (o máximo) de varias fuentes, con TODAS las que lo imponen. */
function masRestrictivo(fuentes: { valor: number; origen: string }[], tipo: 'min' | 'max'): LimiteAplicado {
  const valor = tipo === 'min' ? Math.min(...fuentes.map((f) => f.valor)) : Math.max(...fuentes.map((f) => f.valor));
  return { valor, origenes: fuentes.filter((f) => Math.abs(f.valor - valor) < EPS).map((f) => f.origen) };
}

function estadoDe(hallazgos: Hallazgo[]): Estado {
  if (hallazgos.some((h) => h.severidad !== 'aviso')) return 'ROJO';
  return hallazgos.length ? 'AMBAR' : 'VERDE';
}

export function evaluarCuenta(e: EntradaEvaluacion): Evaluacion {
  const base: Omit<Evaluacion, 'estado' | 'hallazgos'> = {
    cuenta_ibkr: e.cuenta_ibkr,
    metricas: {},
    limites_aplicados: {},
    perfil_aplicado: e.perfil.ok
      ? { perfil: e.perfil.perfil, fases: e.perfil.fases, origen: e.perfil.origen, fecha_ips: e.perfil.fecha_ips, fuentes: e.perfil.fuentes }
      : { sin_perfil: e.perfil.motivo, faltantes: e.perfil.faltantes },
    version_motor: VERSION_MOTOR,
  };

  // Las cuentas propias se evalúan completas y se marcan EXENTO al final.
  if (!e.es_propia) {
    if (!e.perfil.ok) return { ...base, estado: 'SIN_PERFIL', hallazgos: [] };
    if (!e.foto) return { ...base, estado: 'SIN_DATOS', hallazgos: [] };
  } else if (!e.perfil.ok || !e.foto) {
    return { ...base, estado: 'EXENTO', hallazgos: [] };
  }
  const perfil = e.perfil as Extract<PerfilCuenta, { ok: true }>;
  const foto = e.foto as FotoCuenta;
  const hallazgos: Hallazgo[] = [];

  // --- NAV en pesos e INACTIVA ---
  const navMxn = foto.moneda_base === 'MXN' ? foto.nav_ibkr : e.tipo_cambio !== null ? foto.nav_ibkr * e.tipo_cambio : null;
  if (navMxn === null) {
    hallazgos.push({ prueba: 'TIPO_CAMBIO', severidad: 'aviso',
      mensaje: `Cuenta en ${foto.moneda_base} sin FIX capturado para la fecha: no se evalúa como INACTIVA.` });
  }
  const metricas: Record<string, unknown> = { moneda_base: foto.moneda_base, nav_base: foto.nav_ibkr, nav_mxn: navMxn,
    tipo_cambio: foto.moneda_base === 'MXN' ? null : e.tipo_cambio };
  if (!e.es_propia && navMxn !== null && navMxn <= e.parametros.navResidualMxn) {
    return { ...base, metricas, estado: 'INACTIVA', hallazgos };
  }

  // --- Clasificación ---
  const porClase = new Map<string, number>();
  let positiva = 0, negativa = 0, liquidez = 0;
  const fracciones: { clase: string; valor: number; elegible: boolean; equivalente: boolean; duracion: number | null; ticker: string }[] = [];
  for (const r of foto.renglones) {
    const k = clasificarRenglon(r, e.catalogo);
    for (const a of k.avisos) {
      hallazgos.push({ prueba: 'P1', severidad: a.nivel === 'critico' ? 'critico' : 'aviso', mensaje: a.mensaje, ticker: a.ticker });
    }
    for (const f of k.fracciones) {
      if (f.valor_base < 0) { negativa += -f.valor_base; continue; }
      positiva += f.valor_base;
      porClase.set(f.clase, (porClase.get(f.clase) ?? 0) + f.valor_base);
      if (f.liquidez) liquidez += f.valor_base;
      fracciones.push({ clase: f.clase, valor: f.valor_base, elegible: f.elegible, equivalente: f.equivalente_efectivo,
        duracion: f.duracion_efectiva, ticker: r.ticker });
    }
  }
  const pct = (v: number) => (positiva > 0 ? (v / positiva) * 100 : 0);
  const pctClase = Object.fromEntries([...porClase].map(([c, v]) => [c, r2(pct(v))]));
  const suma = (clases: string[]) => clases.reduce((s, c) => s + (porClase.get(c) ?? 0), 0);
  const rv = pct(suma(RV));
  const reglas = e.parametros.reglasPerfil[perfil.perfil];
  const rf = pct(suma(RF) + (reglas.efectivo_cuenta_rf ? (porClase.get('EFECTIVO') ?? 0) : 0));
  const liq = pct(liquidez);
  const saldoDeudor = pct(negativa);
  Object.assign(metricas, { base_positiva: positiva, pct_por_clase: pctClase, rv_pct: r2(rv), rf_pct: r2(rf),
    liquidez_pct: r2(liq), saldo_deudor_pct: r2(saldoDeudor) });

  // --- Sin invertir ---
  if (!e.es_propia && positiva > 0 && [...porClase.keys()].every((c) => c === 'EFECTIVO')) {
    hallazgos.push({ prueba: 'SIN_INVERTIR', severidad: 'aviso', mensaje: 'Cuenta 100 % en efectivo: sin invertir.' });
    return { ...base, metricas, estado: 'AMBAR', hallazgos };
  }

  // --- P1: elegibilidad ---
  const noElegibles = new Set<string>();
  for (const f of fracciones) {
    if (!f.elegible && f.clase !== 'NO_CATALOGADO') {
      noElegibles.add(f.clase);
      hallazgos.push({ prueba: 'P1', severidad: 'critico', clase: f.clase, ticker: f.ticker, valor_pct: r2(pct(f.valor)),
        mensaje: `${f.ticker}: ${f.clase} no es elegible (${r2(pct(f.valor))} %).` });
    }
  }

  // --- P2: techo por clase ---
  const techos = e.parametros.limitesPerfil[perfil.perfil] ?? {};
  for (const [clase, max] of Object.entries(techos)) {
    if (noElegibles.has(clase)) continue;
    const v = pct(porClase.get(clase) ?? 0);
    if (v <= max + EPS) continue;
    const comun = { prueba: 'P2' as const, clase, valor_pct: r2(v), limite_pct: max, origenes: [`perfil:${perfil.perfil}`] };
    const texto = `${clase} ${r2(v)} % sobre el techo de ${max} % del perfil ${perfil.perfil}`;
    if (!GOB_DURACION.includes(clase)) {
      hallazgos.push({ ...comun, severidad: 'incumple', mensaje: `${texto}.` });
      continue;
    }
    // Deuda gubernamental: ¿la parte larga (no equivalente, duración ≥ 3 o nula) cabe en el techo?
    const larga = pct(fracciones
      .filter((f) => f.clase === clase && !f.equivalente && (f.duracion === null || f.duracion >= GOB_EXCESO_CORTO.duracion_menor_a))
      .reduce((s, f) => s + f.valor, 0));
    if (larga <= max + EPS) {
      hallazgos.push({ ...comun, severidad: 'aviso', larga_duracion_pct: r2(larga),
        mensaje: `${texto}: más conservadora que su perfil (desalineada con el mandato); el exceso está en equivalentes `
          + `de efectivo o duración < ${GOB_EXCESO_CORTO.duracion_menor_a}.` });
    } else {
      hallazgos.push({ ...comun, severidad: 'incumple', larga_duracion_pct: r2(larga),
        mensaje: `${texto}: exceso de deuda gubernamental de larga duración (duración ≥ ${GOB_EXCESO_CORTO.duracion_menor_a} `
          + `o nula: ${r2(larga)} %).` });
    }
  }

  // --- P3: duración ---
  if (reglas.duracion_gob_menor_a !== null) {
    for (const f of fracciones.filter((x) => GOB_DURACION.includes(x.clase))) {
      if (f.duracion === null || f.duracion >= reglas.duracion_gob_menor_a) {
        hallazgos.push({ prueba: 'P3', severidad: 'incumple', clase: f.clase, ticker: f.ticker, origenes: [`perfil:${perfil.perfil}`],
          mensaje: `${f.ticker}: duración ${f.duracion ?? 'nula'} no es menor a ${reglas.duracion_gob_menor_a} años (${perfil.perfil}).` });
      }
    }
  }

  // --- P4 + P5: fase, con el límite más restrictivo de todas las fuentes ---
  const fases = perfil.fases.map((f) => ({ ...f, l: e.parametros.limitesFase[f.fase] }));
  const rvMax = masRestrictivo([
    ...fases.map((f) => ({ valor: f.l.rv_max_pct, origen: `fase:${f.fase}(${f.origen})` })),
    { valor: reglas.rv_total_max_pct, origen: `perfil:${perfil.perfil}` },
  ], 'min');
  const rfMin = masRestrictivo(fases.map((f) => ({ valor: f.l.rf_min_pct, origen: `fase:${f.fase}(${f.origen})` })), 'max');
  const liqMin = masRestrictivo([
    ...fases.map((f) => ({ valor: f.l.liquidez_min_pct, origen: `fase:${f.fase}(${f.origen})` })),
    { valor: reglas.liquidez_min_pct, origen: `perfil:${perfil.perfil}` },
  ], 'max');
  if (rv > rvMax.valor + EPS) {
    hallazgos.push({ prueba: 'P4', severidad: 'incumple', valor_pct: r2(rv), limite_pct: rvMax.valor, origenes: rvMax.origenes,
      mensaje: `Renta variable ${r2(rv)} % sobre el máximo de ${rvMax.valor} %.` });
  }
  if (rf < rfMin.valor - EPS) {
    hallazgos.push({ prueba: 'P4', severidad: 'incumple', valor_pct: r2(rf), limite_pct: rfMin.valor, origenes: rfMin.origenes,
      mensaje: `Renta fija ${r2(rf)} % bajo el mínimo de ${rfMin.valor} %.` });
  }
  if (liq < liqMin.valor - EPS) {
    hallazgos.push({ prueba: 'P4', severidad: 'incumple', valor_pct: r2(liq), limite_pct: liqMin.valor, origenes: liqMin.origenes,
      mensaje: `Liquidez ${r2(liq)} % bajo el mínimo de ${liqMin.valor} %.` });
  }

  // --- Saldo deudor ---
  if (saldoDeudor > 0) {
    const tol = e.parametros.saldoDeudorToleranciaPct;
    hallazgos.push({ prueba: 'SALDO_DEUDOR', severidad: saldoDeudor > tol + EPS ? 'incumple' : 'aviso', valor_pct: r2(saldoDeudor),
      limite_pct: tol, mensaje: `Saldo deudor de ${r2(saldoDeudor)} % de los saldos positivos (tolerancia ${tol} %).` });
  }

  const limites_aplicados = { techos, rv_max: rvMax, rf_min: rfMin, liquidez_min: liqMin,
    duracion_gob_menor_a: reglas.duracion_gob_menor_a, efectivo_cuenta_rf: reglas.efectivo_cuenta_rf,
    gob_exceso_corto: GOB_EXCESO_CORTO,
    saldo_deudor_tolerancia_pct: e.parametros.saldoDeudorToleranciaPct, nav_residual_mxn: e.parametros.navResidualMxn };

  if (e.es_propia) {
    return { ...base, metricas, limites_aplicados, estado: 'EXENTO',
      hallazgos: hallazgos.map((h) => ({ ...h, informativo: true as const })) };
  }
  return { ...base, metricas, limites_aplicados, estado: estadoDe(hallazgos), hallazgos };
}
