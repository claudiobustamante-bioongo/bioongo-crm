#!/usr/bin/env node
// Prueba EN VIVO del MCP local bioongo-lectura contra producción: levanta el
// servidor real (stdio) con el cliente oficial del SDK y recorre los escenarios
// que deben pasar y los que deben fallar. No escribe nada: todo corre como
// mcp_lectura, en transacción de solo lectura con ROLLBACK.
//   node scripts/mcp-lectura/probar-en-vivo.mjs
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const ESCENARIOS = [
  { que: 'quién soy', sql: 'select current_user as rol', espera: 'ok', revisa: (r) => r.filas[0]?.rol === 'mcp_lectura' },
  { que: 'columnas permitidas (cuenta enmascarada)', espera: 'ok',
    sql: 'select codigo_cliente, status, cuenta_ibkr from public.clientes order by codigo_cliente limit 2',
    revisa: (r) => r.filas.length === 2 && r.filas.every((f) => f.cuenta_ibkr === null || f.cuenta_ibkr === 'U••••') },
  { que: 'clientes.nombre', sql: 'select nombre from public.clientes limit 1', espera: /permission denied/ },
  { que: 'set transaction read write', sql: 'set transaction read write', espera: /before any query/ },
  { que: 'commit; y otra sentencia', sql: 'commit; select 1', espera: /multiple commands/ },
  { que: 'DO con COMMIT', sql: 'do $$ begin commit; end $$', espera: /invalid transaction termination|cannot commit/i },
  { que: 'escribir con claims falsificados',
    sql: "select set_config('request.jwt.claims', '{\"email\":\"impostor@x.test\"}', true), "
      + "public.fn_registrar_tipo_cambio('SF43718', date '2000-01-03', 1, date '2000-01-03', 'x', null)",
    espera: /permission denied/ },
  { que: 'petición HTTP por pg_net', espera: /read-only/,
    sql: "select net.http_post(url := 'https://invalid.invalid/mcp-prueba', body := '{}'::jsonb)" },
  { que: 'nada encolado en net', espera: 'ok',
    sql: "select count(*)::int as n from net.http_request_queue where url like '%invalid.invalid%'",
    revisa: (r) => r.filas[0]?.n === 0 },
  { que: 'crear una tabla', sql: 'create table public.mcp_intruso (x int)', espera: /permission denied|read-only/ },
];

const cliente = new Client({ name: 'probar-en-vivo', version: '1.0.0' });
await cliente.connect(new StdioClientTransport({
  command: process.execPath,
  args: [new URL('./servidor.mjs', import.meta.url).pathname],
  stderr: 'inherit',
}));

let fallas = 0;
for (const e of ESCENARIOS) {
  const r = await cliente.callTool({ name: 'consultar_sql', arguments: { sql: e.sql } });
  const texto = r.content?.[0]?.text ?? '';
  let bien;
  if (e.espera === 'ok') bien = !r.isError && e.revisa(JSON.parse(texto));
  else bien = Boolean(r.isError) && e.espera.test(texto);
  if (!bien) fallas++;
  console.log(`${bien ? '✓' : '✗'} ${e.que.padEnd(42)} ${r.isError ? 'error: ' : ''}${texto.slice(0, 110)}`);
}
await cliente.close();
console.log(fallas ? `\n${fallas} escenario(s) NO se comportaron como se esperaba.` : '\nTodos los escenarios se comportaron como se esperaba.');
process.exit(fallas ? 1 : 0);
