// Manejador de ibkr-foto-diaria (M2 fase 2), separado de Deno.serve para probarlo
// con `deno test` (prueba_test.ts). Toda la lógica está en lib/foto-diaria-sistema.ts.
//
// - POST con la llave propia en x-foto-cron-llave (FOTO_CRON_LLAVE); ?modo=seco
//   consulta y responde lo que haría, sin escribir nada.
// - Secretos (los captura Claudio; nunca en el repo): IBKR_FLEX_TOKEN,
//   IBKR_FLEX_QUERY_ID, BANXICO_TOKEN, FOTO_CRON_LLAVE. SUPABASE_URL y
//   SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
import { createClient } from '@supabase/supabase-js';
import { avanzar, depsDesdeRpc, ErrorRpc, llaveValida, sanear } from '../../../lib/foto-diaria-sistema.ts';
import {
  consultarReporte, Limitador, relojReal, solicitarReporte, validarCredencialesFlex,
} from '../../../lib/ibkr-flex-lectura.ts';
import { pedirSerie, SERIE_FIX } from '../../../lib/banxico.ts';

export type LeerEnv = (nombre: string) => string | undefined;

const json = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });

export async function manejar(req: Request, env: LeerEnv = (n) => Deno.env.get(n)): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Solo POST.' }, 405);
  const llave = env('FOTO_CRON_LLAVE') ?? '';
  if (!llaveValida(req.headers.get('x-foto-cron-llave') ?? '', llave)) return json({ error: 'No autorizado.' }, 401);

  const secretos: string[] = [llave];
  try {
    const flexCred = validarCredencialesFlex(env('IBKR_FLEX_TOKEN'), env('IBKR_FLEX_QUERY_ID'));
    const banxicoToken = env('BANXICO_TOKEN')?.trim() ?? '';
    const servicio = env('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    secretos.push(flexCred.token, banxicoToken, servicio);
    if (!banxicoToken) throw new Error('Falta BANXICO_TOKEN en los secretos de la función.');
    if (!servicio || !env('SUPABASE_URL')) throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');

    const db = createClient(env('SUPABASE_URL') ?? '', servicio, { auth: { persistSession: false } });
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
}
