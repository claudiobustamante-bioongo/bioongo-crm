/**
 * [semaforo] Registro de una corrida del semáforo (M5) en semaforo_evaluaciones,
 * por fn_registrar_semaforo con la sesión de quien confirma. Puro: arma el lote,
 * el guion de psql y la clave; lo usa scripts/semaforo/evaluar.mjs --registrar.
 * ---------------------------------------------------------------------------
 * - El lote lleva la carga (sync), la versión del motor, el FIX usado y una
 *   evaluación por cuenta del universo, con el indicador de IPS pendiente.
 * - La clave de confirmación es una huella de (carga, versión, cuenta → estado y
 *   hallazgos): confirmar exige que se registre exactamente lo que se vio.
 */

import { createHash } from 'node:crypto';
import type { Evaluacion } from './semaforo.ts';

export interface EvaluacionConIps extends Evaluacion {
  ips_pendiente: string[];
}

export interface LoteSemaforo {
  sync_id: string;
  version_motor: string;
  tipo_cambio: number | null;
  evaluaciones: {
    cuenta_ibkr: string;
    estado: string;
    hallazgos: unknown[];
    metricas: Record<string, unknown>;
    perfil_aplicado: Record<string, unknown> | null;
    limites_aplicados: Record<string, unknown>;
    ips_pendiente: string[];
  }[];
}

export class ErrorRegistro extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorRegistro';
  }
}

const REGLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REGLA_CORREO = /^[^@\s'"$\\]+@[^@\s'"$\\]+\.[a-z]+$/;

export function armarLote(syncId: string, tipoCambio: number | null, evaluaciones: readonly EvaluacionConIps[]): LoteSemaforo {
  if (!REGLA_UUID.test(syncId)) throw new ErrorRegistro('sync_id no es un uuid.');
  if (evaluaciones.length === 0) throw new ErrorRegistro('No hay evaluaciones que registrar.');
  const versiones = new Set(evaluaciones.map((e) => e.version_motor));
  if (versiones.size !== 1) throw new ErrorRegistro('Todas las evaluaciones del lote deben ser de la misma versión del motor.');
  const cuentas = evaluaciones.map((e) => e.cuenta_ibkr);
  if (new Set(cuentas).size !== cuentas.length) throw new ErrorRegistro('Una cuenta aparece dos veces en el lote.');
  return {
    sync_id: syncId,
    version_motor: [...versiones][0],
    tipo_cambio: tipoCambio,
    evaluaciones: evaluaciones.map((e) => ({
      cuenta_ibkr: e.cuenta_ibkr, estado: e.estado, hallazgos: e.hallazgos, metricas: e.metricas,
      perfil_aplicado: e.perfil_aplicado, limites_aplicados: e.limites_aplicados, ips_pendiente: e.ips_pendiente,
    })),
  };
}

/** La llamada a fn_registrar_semaforo con el lote en un literal $lote$. La usan psql y el test de contrato. */
export function sqlLlamadaSemaforo(lote: LoteSemaforo): string {
  const json = JSON.stringify(lote);
  if (json.includes('$lote$')) throw new ErrorRegistro('El lote contiene «$lote$»: no se puede pasar como literal.');
  return `select json_build_object('resultado', public.fn_registrar_semaforo($lote$${json}$lote$::jsonb))::text`;
}

/** Guion para `psql service=bioongo -X -q -A -t -f -`: claims, registro y ROLLBACK (ensayo) o COMMIT (real). */
export function sqlRegistroSemaforo(lote: LoteSemaforo, modo: 'ensayo' | 'real', usuario: string): string {
  if (!REGLA_CORREO.test(usuario)) throw new ErrorRegistro('El usuario debe ser un correo.');
  const claims = JSON.stringify({ email: usuario, canal: 'psql' });
  return [
    '\\set ON_ERROR_STOP on',
    'begin;',
    `select set_config('request.jwt.claims', '${claims}', true) is null as sin_claims \\gset`,
    `${sqlLlamadaSemaforo(lote)};`,
    modo === 'real' ? 'commit;' : 'rollback;',
    '',
  ].join('\n');
}

/** Huella de lo que se registra: carga, versión y, por cuenta, estado y hallazgos. */
export function claveSemaforo(lote: LoteSemaforo): string {
  const filas = lote.evaluaciones
    .map((e) => `${e.cuenta_ibkr}|${e.estado}|${JSON.stringify(e.hallazgos)}`)
    .sort();
  return createHash('md5').update(`${lote.sync_id}|${lote.version_motor}|${lote.tipo_cambio}\n${filas.join('\n')}`, 'utf8')
    .digest('hex').slice(0, 10);
}
