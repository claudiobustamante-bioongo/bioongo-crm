/**
 * [semaforo] Una corrida del semáforo (M5) a partir de los datos de la base, sin
 * base ni red. La comparten scripts/semaforo/evaluar.mjs (Claudio, con «!») y la
 * Edge Function ibkr-foto-diaria (registro automático, M2 fase 2): las mismas
 * reglas en los dos caminos.
 * ---------------------------------------------------------------------------
 * `DatosSemaforo` es el JSON que arma la consulta de evaluar.mjs (y, en la fase
 * 2, fn_datos_semaforo_sistema): la carga, su foto, las cuentas con su status,
 * los titulares, los perfiles, M4, el catálogo y el prorrateo.
 * Universo: cuentas ni de baja ni cerradas. `ipsFijadoSeco` solo existe para la
 * corrida en seco de evaluar.mjs; la función automática nunca lo pasa.
 */

import { armarCatalogo, type Catalogo, type EntradaCatalogo } from './clasificacion-activos.ts';
import { resolverPerfilCuenta, type PerfilCuenta, type PerfilPersona } from './perfil-cuenta.ts';
import { evaluarCuenta, VERSION_MOTOR, type FotoCuenta, type ParametrosM4 } from './semaforo.ts';
import type { EvaluacionConIps } from './semaforo-registro.ts';

type Num = number | string;

export interface DatosSemaforo {
  sync: { id: string; td: string } | null;
  foto: { cuenta_ibkr: string; tipo_renglon: string; ticker: string; asset_category: string | null;
    sub_category: string | null; valor_base: Num; moneda_base: string }[];
  cuentas: { cuenta_ibkr: string; codigo_cliente: string; tipo: 'individual' | 'conjunta'; es_propia: boolean;
    fecha_cierre: string | null; status: string; codigo_ips_fijado: string | null }[];
  titulares: { cuenta_ibkr: string; rol: string; codigo_ips: string | null; codigo_ficha: string }[];
  perfiles: { codigo: string; perfil: string | null; fase: string | null; fecha_calculo: string | null;
    fecha_cuestionario: string | null; ips_firmado: boolean }[];
  limites_fase: Record<string, { rv_max_pct: Num; rf_min_pct: Num; liquidez_min_pct: Num }>;
  limites_perfil: Record<string, Record<string, Num>>;
  reglas_perfil: Record<string, { duracion_gob_menor_a: Num | null; liquidez_min_pct: Num; efectivo_cuenta_rf: boolean;
    rv_total_max_pct: Num }>;
  parametros: Record<string, string>;
  catalogo: (Omit<EntradaCatalogo, 'duracion_efectiva'> & { duracion_efectiva: Num | null })[];
  prorrateo: { ticker: string; clase_activo: string; factor: Num }[];
}

export interface FilaCorrida {
  cuenta: DatosSemaforo['cuentas'][number];
  perfil: PerfilCuenta;
  foto: FotoCuenta | null;
  evaluacion: EvaluacionConIps;
}

export interface CorridaSemaforo {
  sync_id: string;
  td: string;
  version_motor: string;
  filas: FilaCorrida[];
  conteo: Record<string, number>;
}

export class ErrorCorrida extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorCorrida';
  }
}

export function parametrosM4(d: DatosSemaforo): ParametrosM4 {
  const p = d.parametros;
  return {
    limitesFase: Object.fromEntries(Object.entries(d.limites_fase).map(([k, v]) => [k, {
      rv_max_pct: Number(v.rv_max_pct), rf_min_pct: Number(v.rf_min_pct), liquidez_min_pct: Number(v.liquidez_min_pct) }])),
    limitesPerfil: Object.fromEntries(Object.entries(d.limites_perfil).map(([k, v]) =>
      [k, Object.fromEntries(Object.entries(v).map(([c, x]) => [c, Number(x)]))])),
    reglasPerfil: Object.fromEntries(Object.entries(d.reglas_perfil).map(([k, v]) => [k, {
      duracion_gob_menor_a: v.duracion_gob_menor_a === null ? null : Number(v.duracion_gob_menor_a),
      liquidez_min_pct: Number(v.liquidez_min_pct), efectivo_cuenta_rf: v.efectivo_cuenta_rf,
      rv_total_max_pct: Number(v.rv_total_max_pct) }])),
    navResidualMxn: Number(p.nav_residual_mxn),
    saldoDeudorToleranciaPct: Number(p.saldo_deudor_tolerancia_pct),
  };
}

export function catalogoDe(d: Pick<DatosSemaforo, 'catalogo' | 'prorrateo'>): Catalogo {
  return armarCatalogo(
    d.catalogo.map((i) => ({ ...i, duracion_efectiva: i.duracion_efectiva === null ? null : Number(i.duracion_efectiva) })),
    d.prorrateo.map((x) => ({ ...x, factor: Number(x.factor) })) as Parameters<typeof armarCatalogo>[1],
  );
}

const dia = (v: string | null) => (v ? String(v).slice(0, 10) : null);

/** Una evaluación ya registrada (otra versión del motor), como la lee evaluar.mjs --comparar. */
export interface EvaluacionPrevia {
  cuenta_ibkr: string;
  estado: string;
  version_motor: string;
  pruebas: string[]; // «PRUEBA:severidad»
}

export interface CambioCuenta {
  codigo_cliente: string;
  antes: { estado: string; pruebas: string[] } | null;
  despues: { estado: string; pruebas: string[] };
}

const firma = (xs: readonly string[]) => [...xs].sort();

/** Cuenta por cuenta: qué cambia de estado o de hallazgos frente a lo registrado con otra versión. */
export function compararConPrevio(corrida: CorridaSemaforo, previas: readonly EvaluacionPrevia[]): {
  version_previa: string | null; cambios: CambioCuenta[]; iguales: number; conteo_previo: Record<string, number>;
} {
  const porCuenta = new Map(previas.map((p) => [p.cuenta_ibkr, p]));
  const cambios: CambioCuenta[] = [];
  let iguales = 0;
  for (const f of corrida.filas) {
    const p = porCuenta.get(f.cuenta.cuenta_ibkr);
    const despues = { estado: f.evaluacion.estado,
      pruebas: firma(f.evaluacion.hallazgos.map((h) => `${h.prueba}:${h.severidad}`)) };
    const antes = p ? { estado: p.estado, pruebas: firma(p.pruebas) } : null;
    if (antes && antes.estado === despues.estado && JSON.stringify(antes.pruebas) === JSON.stringify(despues.pruebas)) {
      iguales++;
    } else {
      cambios.push({ codigo_cliente: f.cuenta.codigo_cliente, antes, despues });
    }
  }
  const conteo_previo: Record<string, number> = {};
  for (const p of previas) conteo_previo[p.estado] = (conteo_previo[p.estado] ?? 0) + 1;
  return { version_previa: previas[0]?.version_motor ?? null, cambios, iguales, conteo_previo };
}

/** Evalúa el universo de la carga. `fix`: MXN por USD de la tabla tipo_cambio (o null). */
export function correrSemaforo(
  d: DatosSemaforo,
  fix: number | null,
  opciones: { ipsFijadoSeco?: ReadonlyMap<string, string> } = {},
): CorridaSemaforo {
  if (!d.sync) throw new ErrorCorrida('No hay ninguna foto_diaria cargada.');
  if (fix !== null && !(fix > 0)) throw new ErrorCorrida('El tipo de cambio debe ser positivo.');
  const td = String(d.sync.td).slice(0, 10);
  const M4 = parametrosM4(d);
  const vigencia = Number(d.parametros.vigencia_ips_anios);
  const catalogo = catalogoDe(d);
  const perfiles = new Map<string, PerfilPersona>(d.perfiles.map((x) => [x.codigo, { ...x,
    fecha_calculo: dia(x.fecha_calculo), fecha_cuestionario: dia(x.fecha_cuestionario) } as PerfilPersona]));
  const titularesDe = new Map<string, DatosSemaforo['titulares']>();
  for (const t of d.titulares) titularesDe.set(t.cuenta_ibkr, [...(titularesDe.get(t.cuenta_ibkr) ?? []), t]);
  const fotoDe = new Map<string, (DatosSemaforo['foto'][number] & { valor_base: number })[]>();
  for (const r of d.foto) fotoDe.set(r.cuenta_ibkr, [...(fotoDe.get(r.cuenta_ibkr) ?? []), { ...r, valor_base: Number(r.valor_base) }]);

  const universo = d.cuentas.filter((c) => c.status !== 'baja' && !c.fecha_cierre)
    .sort((a, b) => (a.codigo_cliente < b.codigo_cliente ? -1 : 1));
  const filas: FilaCorrida[] = [];
  const conteo: Record<string, number> = {};
  for (const c of universo) {
    const ips = c.codigo_ips_fijado ?? opciones.ipsFijadoSeco?.get(c.codigo_cliente) ?? null;
    const perfil = resolverPerfilCuenta({ cuenta_ibkr: c.cuenta_ibkr, tipo: c.tipo,
      titulares: (titularesDe.get(c.cuenta_ibkr) ?? []) as Parameters<typeof resolverPerfilCuenta>[0]['titulares'],
      codigo_ips_fijado: ips }, perfiles, td, vigencia);
    const renglones = fotoDe.get(c.cuenta_ibkr);
    const nav = renglones?.find((r) => r.tipo_renglon === 'nav_ibkr');
    const foto: FotoCuenta | null = renglones && nav ? { moneda_base: nav.moneda_base, nav_ibkr: nav.valor_base,
      renglones: renglones.filter((r) => r.tipo_renglon !== 'nav_ibkr') as unknown as FotoCuenta['renglones'] } : null;
    const ev = evaluarCuenta({ cuenta_ibkr: c.cuenta_ibkr, es_propia: c.es_propia, perfil, foto, tipo_cambio: fix,
      catalogo, parametros: M4 });
    conteo[ev.estado] = (conteo[ev.estado] ?? 0) + 1;
    filas.push({ cuenta: c, perfil, foto, evaluacion: { ...ev, ips_pendiente: perfil.ok ? perfil.ips_pendiente : [] } });
  }
  return { sync_id: d.sync.id, td, version_motor: VERSION_MOTOR, filas, conteo };
}
