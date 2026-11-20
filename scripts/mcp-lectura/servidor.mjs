#!/usr/bin/env node
// MCP local de solo lectura (bioongo-lectura) para Claude Code, conectado como el
// rol mcp_lectura (migración 2026-11-20-01). Una herramienta: consultar_sql.
//
// - Conexión: el servicio [bioongo_lectura] de ~/.pg_service.conf (host, puerto,
//   base, usuario; SIN contraseña). La contraseña la lee node-postgres de
//   ~/.pgpass por sí solo; este código nunca la toca ni la imprime.
// - Cada llamada abre su propia conexión, corre UNA sentencia en una transacción
//   de solo lectura que siempre termina en ROLLBACK (nucleo.mjs) y la cierra.
// - La salida enmascara cuentas U… y correos.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import pg from 'pg';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { consultar, enmascarar, leerServicio, MAX_FILAS } from './nucleo.mjs';

const SERVICIO = 'bioongo_lectura';

function conexion() {
  const archivo = process.env.PGSERVICEFILE ?? `${homedir()}/.pg_service.conf`;
  const s = leerServicio(readFileSync(archivo, 'utf8'), SERVICIO);
  return {
    host: s.host, port: s.port, database: s.database, user: s.user,
    // Equivale a sslmode=require de libpq: cifrado, sin verificar el certificado.
    ssl: s.sslmode === 'disable' ? false : { rejectUnauthorized: false },
    application_name: 'mcp-lectura',
    connectionTimeoutMillis: 10_000,
  };
}

const servidor = new Server({ name: 'bioongo-lectura', version: '1.0.0' }, { capabilities: { tools: {} } });

servidor.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'consultar_sql',
    description: 'Una consulta SQL de SOLO LECTURA contra la base de Bioongo CRM, como el rol mcp_lectura '
      + '(sin datos personales: SELECT por columna). Una sola sentencia; transacción read only que siempre '
      + `termina en ROLLBACK; máximo ${MAX_FILAS} filas; cuentas y correos enmascarados.`,
    inputSchema: {
      type: 'object',
      properties: { sql: { type: 'string', description: 'Una sola sentencia SQL de lectura.' } },
      required: ['sql'],
      additionalProperties: false,
    },
  }],
}));

servidor.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== 'consultar_sql') {
    return { isError: true, content: [{ type: 'text', text: `Herramienta desconocida: ${req.params.name}` }] };
  }
  const cliente = new pg.Client(conexion());
  try {
    await cliente.connect();
    const r = await consultar(cliente, req.params.arguments?.sql);
    return { content: [{ type: 'text', text: JSON.stringify(r) }] };
  } catch (e) {
    // El mensaje de Postgres (p. ej. «permission denied for table…»), enmascarado.
    return { isError: true, content: [{ type: 'text', text: enmascarar(`${e.code ? `[${e.code}] ` : ''}${e.message}`) }] };
  } finally {
    await cliente.end().catch(() => undefined);
  }
});

await servidor.connect(new StdioServerTransport());
