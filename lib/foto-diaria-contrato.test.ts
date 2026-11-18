/**
 * CONTRATO de punta a punta de la foto diaria automática (M2 fase 2): avanzar()
 * con el adaptador RPC real (depsDesdeRpc) contra las funciones SQL de la
 * migración 2026-11-18-01, en la réplica PGlite, con el rol service_role y SIN
 * sesión (como la Edge Function). Solo IBKR y Banxico son falsos.
 * Si base.sql aún no trae la migración, se le aplica su cuerpo. Datos SINTÉTICOS.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { avanzar, depsDesdeRpc, type DepsFotoDiaria } from './foto-diaria-sistema';

const leer = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const XML = leer('./__fixtures__/flex-sintetico.xml');
const MIGRACION = '../migraciones/2026-11-18-01-foto-diaria-sistema.sql';

async function base(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(leer('../scripts/replica/preludio.sql'));
  await db.exec(leer('../scripts/replica/base.sql'));
  await db.exec(`
    insert into public.clientes (codigo_cliente, status, cuenta_ibkr) values
      ('CSPFU9001', 'vigente', 'U0000001'), ('CSPFU9004', 'vigente', 'U0000004');
    insert into public.cuentas_ibkr (cuenta_ibkr, codigo_cliente, tipo) values
      ('U0000001', 'CSPFU9001', 'individual'), ('U0000004', 'CSPFU9004', 'individual');
    update public.cuentas_ibkr set fecha_cierre = date '2023-01-20', motivo_cierre = 'sintético' where cuenta_ibkr = 'U0000004';`);
  const ya = await db.query<{ ok: boolean }>(`select to_regprocedure('public.fn_cargar_ibkr_sistema(jsonb)') is not null as ok`);
  if (!ya.rows[0].ok) {
    const texto = leer(MIGRACION);
    const cuerpo = texto.slice(texto.indexOf('-- <<CUERPO'), texto.indexOf('-- CUERPO>>'));
    await db.exec(`begin;
      select set_config('request.jwt.claims', '{"email":"operador@replica.test","canal":"psql"}', true);
      ${cuerpo}
      commit;`);
  }
  return db;
}

/** Como supabase-js: select fn(p_x => $1, …), con objetos como JSON. */
function rpcPglite(db: PGlite) {
  return async (fn: string, args: Record<string, unknown>) => {
    const llaves = Object.keys(args);
    const sql = `select public.${fn}(${llaves.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
    const valores = llaves.map((k) => {
      const v = args[k];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    const r = await db.query<{ r: unknown }>(sql, valores);
    return r.rows[0]?.r ?? null;
  };
}

test('avanzar() contra las funciones SQL reales: pedir → recoger y cargar → FIX → semáforo, todo firmado por sistema', async () => {
  const db = await base();
  await db.exec('set role service_role');
  const pedidas: string[] = [];
  const deps: DepsFotoDiaria = depsDesdeRpc(rpcPglite(db), {
    flex: {
      pedir: async (td) => { pedidas.push(td); return '987654321'; },
      consultar: async () => ({ listo: true, xml: XML }),
    },
    banxico: { serie: async () => [{ fecha: '2026-11-09', valor: 18.5983 }] },
    dormir: async () => undefined,
    secretos: [],
  });
  const martes = new Date('2026-11-10T12:00:00Z'); // td 2026-11-09, el del XML sintético

  const r1 = await avanzar(martes, deps);
  assert.deepEqual(r1.eventos.map((e) => `${e.paso}:${e.resultado}`), ['foto:pedido']);
  assert.deepEqual(pedidas, ['20261109']);

  const r2 = await avanzar(martes, deps);
  assert.deepEqual(r2.eventos.map((e) => `${e.paso}:${e.resultado}${e.resultado === 'error' ? ` ${JSON.stringify(e.detalle)}` : ''}`),
    ['foto:cargado', 'fix:cargado', 'semaforo:cargado']);

  const r3 = await avanzar(martes, deps);
  assert.deepEqual(r3.eventos, []); // todo hecho: silencio
  assert.equal(pedidas.length, 1);

  await db.exec('reset role');
  const sync = await db.query<{ confirmado_por: string; cuentas_cargadas: number }>(
    `select confirmado_por, cuentas_cargadas from public.sync_ibkr where td = '2026-11-09'`);
  assert.deepEqual(sync.rows, [{ confirmado_por: 'sistema:ibkr-cron', cuentas_cargadas: 1 }]); // la cerrada no entra
  const firmas = await db.query<{ f: string }>(`
    select entidad || ':' || coalesce(usuario, '') || ':' || origen as f from public.bitacora
     where entidad in ('sync_ibkr', 'tipo_cambio', 'semaforo') order by 1`);
  assert.deepEqual(firmas.rows.map((x) => x.f), [
    'semaforo:sistema:ibkr-cron:sistema', 'sync_ibkr:sistema:ibkr-cron:sistema', 'tipo_cambio:sistema:ibkr-cron:trigger']);
  const fix = await db.query<{ capturado_por: string; fecha_solicitada: string }>(
    `select capturado_por, fecha_solicitada::text from public.tipo_cambio`);
  assert.deepEqual(fix.rows, [{ capturado_por: 'sistema:ibkr-cron', fecha_solicitada: '2026-11-09' }]);
  const sem = await db.query<{ n: number; por: string; version: string }>(
    `select count(*)::int n, min(evaluado_por) por, min(version_motor) version from public.semaforo_evaluaciones`);
  assert.deepEqual(sem.rows, [{ n: 1, por: 'sistema:ibkr-cron', version: 'semaforo-1.1.0' }]);
  const hoy = await db.query<{ td: string; foto: string; fix: string; semaforo: string; alerta_control: boolean }>(
    `select td::text, foto, fix, semaforo, alerta_control from public.v_foto_diaria_estado
      where dia = (now() at time zone 'America/Mexico_City')::date`);
  assert.deepEqual(hoy.rows, [{ td: '2026-11-09', foto: 'cargado', fix: 'cargado', semaforo: 'cargado', alerta_control: false }]);
  const control = await db.query<{ c: string }>(`select public.fn_control_foto_diaria() as c`);
  assert.equal(control.rows[0].c, 'ok');
  const ref = await db.query<{ n: number }>(`select count(*)::int n from public.ibkr_cron_eventos where referencia_flex = '987654321'`);
  assert.equal(ref.rows[0].n, 1);
  await db.close();
}, 180_000);

test('privilegios: authenticated no ejecuta las funciones de sistema ni lee la referencia de la Flex', async () => {
  const db = await base();
  await db.exec('set role authenticated');
  await assert.rejects(db.query(`select public.fn_foto_diaria_referencia()`), /permission denied/);
  await assert.rejects(db.query(`select public.fn_cargar_ibkr_sistema('{}'::jsonb)`), /permission denied/);
  await assert.rejects(db.query(`select referencia_flex from public.ibkr_cron_eventos`), /permission denied/);
  await db.query(`select td, paso, resultado from public.ibkr_cron_eventos`);
  await db.query(`select * from public.v_foto_diaria_estado`);
  await db.close();
}, 180_000);
