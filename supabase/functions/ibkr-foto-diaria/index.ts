// Edge Function ibkr-foto-diaria (M2 fase 2): foto diaria automática de IBKR,
// FIX de Banxico y semáforo. La invoca pg_cron (pg_net) cada 20 min de 06:00 a
// 07:40 CDMX, lunes a viernes, con la llave propia; verify_jwt = false porque la
// llave lo sustituye. El manejador está en handler.ts; la lógica, en
// lib/foto-diaria-sistema.ts.
import { manejar } from './handler.ts';

Deno.serve((req: Request) => manejar(req));
