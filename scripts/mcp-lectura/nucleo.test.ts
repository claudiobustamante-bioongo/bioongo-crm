/**
 * Núcleo del MCP local de solo lectura: servicio, enmascarado, la secuencia
 * BEGIN READ ONLY → SELECT 1 → consulta → ROLLBACK, y en la réplica PGlite COMO
 * mcp_lectura (con base.sql: sus grants por columna y sus políticas) que lo que
 * debe fallar falla. Datos SINTÉTICOS.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { consultar, enmascarar, leerServicio, MAX_LARGO_SQL } from './nucleo.mjs';

const CONF = `
[bioongo]
host=pooler.ejemplo.test
user=postgres.x

# lectura
[bioongo_lectura]
host = pooler.ejemplo.test
port=6543
dbname=postgres
user=mcp_lectura.x
sslmode=require
`;

test('servicio: lee su sección y rechaza una con password o incompleta', () => {
  assert.deepEqual(leerServicio(CONF, 'bioongo_lectura'),
    { host: 'pooler.ejemplo.test', port: 6543, database: 'postgres', user: 'mcp_lectura.x', sslmode: 'require' });
  assert.throws(() => leerServicio(`${CONF}\n[otro]\nhost=h\nuser=u\ndbname=d\npassword=nunca\n`, 'otro'), /password/);
  assert.throws(() => leerServicio(CONF, 'no_existe'), /No existe/);
  assert.throws(() => leerServicio('[a]\nhost=h\n', 'a'), /falta user/);
});

test('enmascara cuentas U… y la parte local de los correos, en cualquier nivel', () => {
  assert.deepEqual(enmascarar({ a: 'U1234567 y U12', b: ['sistema:ibkr-cron', 'claudio.x@bioongo.com'], c: 5, d: null }),
    { a: 'U•••• y U12', b: ['sistema:ibkr-cron', '«…»@bioongo.com'], c: 5, d: null });
});

function clienteFalso(resultado: unknown, falla = false) {
  const vistos: string[] = [];
  return {
    vistos,
    query: async (q: string | { text: string; queryMode?: string }) => {
      const t = typeof q === 'string' ? q : `${q.text} [${q.queryMode}]`;
      vistos.push(t);
      if (typeof q !== 'string' && falla) throw new Error('permission denied for table clientes');
      return resultado;
    },
  };
}

test('secuencia: BEGIN READ ONLY → SELECT 1 → la consulta en protocolo extendido → ROLLBACK; trunca y enmascara', async () => {
  const filas = Array.from({ length: 3 }, (_, i) => ({ cuenta: `U900000${i}1`, n: i }));
  const c = clienteFalso({ rows: filas, fields: [{ name: 'cuenta' }, { name: 'n' }] });
  const r = await consultar(c, 'select cuenta, n from x', { maxFilas: 2 });
  assert.deepEqual(c.vistos, ['BEGIN TRANSACTION READ ONLY', 'SELECT 1', 'select cuenta, n from x [extended]', 'ROLLBACK']);
  assert.deepEqual(r, { columnas: ['cuenta', 'n'], filas: [{ cuenta: 'U••••', n: 0 }, { cuenta: 'U••••', n: 1 }],
    filas_total: 3, truncado: true });
});

test('ROLLBACK aun cuando la consulta falla; vacía o enorme ni se envía', async () => {
  const c = clienteFalso({}, true);
  await assert.rejects(consultar(c, 'select nombre from clientes'), /permission denied/);
  assert.equal(c.vistos.at(-1), 'ROLLBACK');
  const v = clienteFalso({});
  await assert.rejects(consultar(v, '   '), /vacía/);
  await assert.rejects(consultar(v, 'x'.repeat(MAX_LARGO_SQL + 1)), /caracteres/);
  assert.deepEqual(v.vistos, []);
});

test('réplica COMO mcp_lectura: lee lo permitido; nombre, escrituras, funciones y escapes de la transacción fallan', async () => {
  const leer = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const db = new PGlite();
  await db.exec(leer('../replica/preludio.sql'));
  await db.exec(leer('../replica/base.sql'));
  await db.exec(`insert into public.clientes (codigo_cliente, status, cuenta_ibkr, nombre)
                 values ('CSPFU9001', 'vigente', 'U90000001', 'Sintético')`);
  await db.exec('set role mcp_lectura');
  // Adaptador: PGlite.query usa el protocolo extendido (una sentencia), como queryMode 'extended' de pg.
  const cliente = { query: async (q: string | { text: string }) => db.query(typeof q === 'string' ? q : q.text) };

  const ok = await consultar(cliente, 'select codigo_cliente, status, cuenta_ibkr from public.clientes');
  assert.deepEqual(ok.filas, [{ codigo_cliente: 'CSPFU9001', status: 'vigente', cuenta_ibkr: 'U••••' }]);

  await assert.rejects(consultar(cliente, 'select nombre from public.clientes'), /permission denied/);
  await assert.rejects(consultar(cliente, 'commit; select 1'), /multiple commands/);
  await assert.rejects(consultar(cliente, 'set transaction read write'), /before any query/);
  await assert.rejects(consultar(cliente, `insert into public.tipo_cambio (serie, fecha, valor, fecha_solicitada, fuente, capturado_por)
    values ('SF43718', date '2000-01-03', 1, date '2000-01-03', 'x', 'x')`), /permission denied|read-only/);
  await assert.rejects(consultar(cliente, `select public.fn_cargar_ibkr_sistema('{}'::jsonb)`), /permission denied/);
  await assert.rejects(consultar(cliente, 'do $$ begin commit; end $$'), /invalid transaction termination|cannot commit/i);
  await assert.rejects(consultar(cliente, 'create table public.intruso (x int)'), /permission denied|read-only/);

  await db.exec('reset role');
  const r = await db.query<{ n: number }>(`select (select count(*) from public.tipo_cambio)::int
    + (select count(*) from pg_class where relname = 'intruso')::int as n`);
  assert.equal(r.rows[0].n, 0);
  await db.close();
}, 180_000);
