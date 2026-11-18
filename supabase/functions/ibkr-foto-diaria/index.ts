// Edge Function ibkr-foto-diaria (M2 fase 2): foto diaria automática de IBKR,
// FIX de Banxico y semáforo. Capa delgada de Deno: toda la lógica está en
// lib/foto-diaria-sistema.ts (probada en Vitest).
//
// - La invoca pg_cron (pg_net) cada 20 min de 06:00 a 07:40 CDMX, lunes a viernes,
//   con la llave propia en el encabezado x-foto-cron-llave (FOTO_CRON_LLAVE, en
//   los secretos de Supabase y en Vault). verify_jwt = false: la llave la sustituye.
// - POST ?modo=seco: consulta y responde lo que haría, sin escribir nada.
// - Secretos (los captura Claudio; nunca en el repo): IBKR_FLEX_TOKEN,
//   IBKR_FLEX_QUERY_ID, BANXICO_TOKEN, FOTO_CRON_LLAVE. SUPABASE_URL y
//   SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
import { createClient } from '@supabase/supabase-js';
import { avanzar, depsDesdeRpc, ErrorRpc, llaveValida, sanear } from '../../../lib/foto-diaria-sistema.ts';
import {
  consultarReporte, Limitador, relojReal, solicitarReporte, validarCredencialesFlex,
} from '../../../lib/ibkr-flex-lectura.ts';
import { pedirSerie, SERIE_FIX } from '../../../lib/banxico.ts';

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'Solo POST.' }, 405);
  const llave = Deno.env.get('FOTO_CRON_LLAVE') ?? '';
  if (!llaveValida(req.headers.get('x-foto-cron-llave') ?? '', llave)) return json({ error: 'No autorizado.' }, 401);

  const secretos: string[] = [llave];
  try {
    const flexCred = validarCredencialesFlex(Deno.env.get('IBKR_FLEX_TOKEN'), Deno.env.get('IBKR_FLEX_QUERY_ID'));
    const banxicoToken = Deno.env.get('BANXICO_TOKEN')?.trim() ?? '';
    const servicio = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    secretos.push(flexCred.token, banxicoToken, servicio);
    if (!banxicoToken) throw new Error('Falta BANXICO_TOKEN en los secretos de la función.');

    const db = createClient(Deno.env.get('SUPABASE_URL') ?? '', servicio, { auth: { persistSession: false } });
    const rpc = async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await db.rpc(fn, args);
      if (error) throw new ErrorRpc(error.code ?? null, error.message);
      return data;
    };
    const depsFlex = { ...flexCred, limitador: new Limitador(relojReal) };
    const deps = depsDesdeRpc(rpc, {
      flex: {
        pedir: (td) => solicitarReporte(td, td, depsFlex),
        consultar: (referencia) => consultarReporte(referencia, depsFlex),
      },
      banxico: { serie: (desde, hasta) => pedirSerie(SERIE_FIX, desde, hasta, { token: banxicoToken }) },
      dormir: (ms) => new Promise((r) => setTimeout(r, ms)),
      secretos,
    });
    const seco = new URL(req.url).searchParams.get('modo') === 'seco';
    return json(await avanzar(new Date(), deps, { seco }));
  } catch (e) {
    // Solo errores de configuración llegan aquí (avanzar registra los suyos como evento).
    return json({ error: sanear(String((e as Error)?.message ?? e), secretos) }, 500);
  }
});
