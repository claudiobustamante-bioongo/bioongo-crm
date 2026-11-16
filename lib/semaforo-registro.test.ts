/**
 * Registro del semáforo: lote, SQL, clave y el CONTRATO con fn_registrar_semaforo
 * y v_comite_cartera en la réplica PGlite. Datos SINTÉTICOS.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { armarLote, claveSemaforo, sqlLlamadaSemaforo, sqlRegistroSemaforo, type EvaluacionConIps } from './semaforo-registro';

const SYNC = '00000000-0000-0000-0000-0000000000a1';
const ev = (cuenta: string, estado: EvaluacionConIps['estado'], extra: Partial<EvaluacionConIps> = {}): EvaluacionConIps => ({
  cuenta_ibkr: cuenta, estado, hallazgos: [], metricas: { nav_base: 1000, moneda_base: 'MXN' },
  limites_aplicados: {}, perfil_aplicado: { perfil: 'Moderado', origen: 'individual' }, version_motor: 'semaforo-1.0.0',
  ips_pendiente: [], ...extra,
});
const EVALS = [
  ev('U90000001', 'ROJO', { hallazgos: [{ prueba: 'P1', severidad: 'critico', mensaje: 'x' }], ips_pendiente: ['CSPFU9001: sin ips_firmado archivado'] }),
  ev('U90000002', 'SIN_DATOS'),
];

test('el lote: una evaluación por cuenta, misma versión, sync válido', () => {
  const lote = armarLote(SYNC, 18.5525, EVALS);
  assert.deepEqual([lote.sync_id, lote.version_motor, lote.tipo_cambio, lote.evaluaciones.length], [SYNC, 'semaforo-1.0.0', 18.5525, 2]);
  assert.throws(() => armarLote('no-uuid', null, EVALS), /uuid/);
  assert.throws(() => armarLote(SYNC, null, [EVALS[0], EVALS[0]]), /dos veces/);
  assert.throws(() => armarLote(SYNC, null, [EVALS[0], { ...EVALS[1], version_motor: 'semaforo-2.0.0' }]), /misma versión/);
  assert.throws(() => armarLote(SYNC, null, []), /No hay/);
});

test('SQL: claims, ROLLBACK en ensayo y COMMIT en real; rechaza otro usuario o un literal roto', () => {
  const lote = armarLote(SYNC, null, EVALS);
  assert.match(sqlRegistroSemaforo(lote, 'ensayo', 'operador@replica.test'), /\nrollback;\n$/);
  assert.match(sqlRegistroSemaforo(lote, 'real', 'operador@replica.test'), /\ncommit;\n$/);
  assert.throws(() => sqlRegistroSemaforo(lote, 'real', "x';--@a.b"), /correo/);
  const roto = armarLote(SYNC, null, [ev('U90000001', 'ROJO', { hallazgos: [{ mensaje: '$lote$; drop table x' }] })]);
  assert.throws(() => sqlLlamadaSemaforo(roto), /literal/);
});

test('la clave cambia si cambia un estado o un hallazgo, no si cambian las métricas', () => {
  const base = claveSemaforo(armarLote(SYNC, 18.5, EVALS));
  assert.equal(claveSemaforo(armarLote(SYNC, 18.5, [{ ...EVALS[0], metricas: { otra: 1 } }, EVALS[1]])), base);
  assert.notEqual(claveSemaforo(armarLote(SYNC, 18.5, [{ ...EVALS[0], estado: 'AMBAR' }, EVALS[1]])), base);
  assert.notEqual(claveSemaforo(armarLote(SYNC, 18.5, [{ ...EVALS[0], hallazgos: [] }, EVALS[1]])), base);
});

test('contrato: fn_registrar_semaforo acepta el lote; la vista del comité lo muestra; el repetido se rechaza', async () => {
  const leer = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const db = new PGlite();
  await db.exec(leer('../scripts/replica/preludio.sql'));
  await db.exec(leer('../scripts/replica/base.sql'));
  await db.exec(leer('../scripts/replica/datos/2026-11-16-01-semaforo-esquema.sql'));
  await db.exec(`select set_config('request.jwt.claims', '{"email":"operador@replica.test","canal":"psql"}', false)`);
  const lote = armarLote(SYNC, 18.5525, EVALS);
  const r = await db.query(sqlLlamadaSemaforo(lote));
  assert.equal(JSON.parse(Object.values(r.rows[0] as object)[0] as string).resultado.evaluaciones, 2);

  const vista = await db.query(`select codigo_cliente, estado, criticos::int, actualizacion_ips_pendiente from public.v_comite_cartera order by 1`);
  assert.deepEqual(vista.rows, [
    { codigo_cliente: 'CSPFU9001', estado: 'ROJO', criticos: 1, actualizacion_ips_pendiente: true },
    { codigo_cliente: 'CSPFU9002', estado: 'SIN_DATOS', criticos: 0, actualizacion_ips_pendiente: false },
  ]);
  const asiento = await db.query(`select count(*)::int n from public.bitacora where accion = 'registro_semaforo' and usuario = 'operador@replica.test'`);
  assert.equal((asiento.rows[0] as { n: number }).n, 1);
  await assert.rejects(db.query(sqlLlamadaSemaforo(lote)), /duplicate key|unique/);
  await db.close();
}, 120_000);
