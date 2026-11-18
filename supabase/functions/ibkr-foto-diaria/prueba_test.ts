// Pruebas en Deno de ibkr-foto-diaria (lo que Vitest no puede ver: el runtime).
//   cd supabase/functions/ibkr-foto-diaria && deno test --allow-net=127.0.0.1 --allow-read prueba_test.ts
// Sin red externa ni base: un servidor local hace de IBKR. Datos SINTÉTICOS.
import { manejar } from './handler.ts';
import {
  consultarReporte, leerFlex, sha256Hex, solicitarReporte, URL_FLEX, type Limitador,
} from '../../../lib/ibkr-flex-lectura.ts';
import { avanzar, type DepsFotoDiaria } from '../../../lib/foto-diaria-sistema.ts';

function igual(a: unknown, b: unknown, que: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${que}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
}
function cierto(c: boolean, que: string) {
  if (!c) throw new Error(que);
}

const libre = { turno: async () => undefined } as unknown as Limitador;
const LLAVE = 'k'.repeat(40);

Deno.test("fetch real de Deno con cache: 'no-store' (SendRequest y GetStatement contra un servidor local)", async () => {
  const vistos: { ruta: string; cache: string | undefined }[] = [];
  let respuesta = '<FlexStatementResponse><Status>Success</Status><ReferenceCode>12345</ReferenceCode></FlexStatementResponse>';
  const servidor = Deno.serve({ hostname: '127.0.0.1', port: 0, onListen: () => {} }, (req) => {
    vistos.push({ ruta: new URL(req.url).pathname, cache: undefined });
    return new Response(respuesta);
  });
  const base = `http://127.0.0.1:${servidor.addr.port}`;
  try {
    const deps = {
      token: 'TOKENSECRETO123', queryId: '1', limitador: libre,
      fetch: ((url: string, init?: RequestInit) => {
        vistos.push({ ruta: 'init', cache: init?.cache });
        return fetch(String(url).replace(URL_FLEX, base), init); // el fetch real, con el mismo init
      }) as typeof fetch,
    };
    igual(await solicitarReporte('20261109', '20261109', deps), '12345', 'referencia');
    respuesta = '<FlexStatementResponse><Status>Warn</Status><ErrorCode>1019</ErrorCode></FlexStatementResponse>';
    igual(await consultarReporte('12345', deps), { listo: false }, '1019 → no listo');
    igual(vistos.filter((v) => v.ruta === 'init').map((v) => v.cache), ['no-store', 'no-store'], 'cache del init');
    igual(vistos.filter((v) => v.ruta !== 'init').map((v) => v.ruta),
      ['/SendRequest', '/GetStatement'], 'rutas (URL_FLEX reemplazada por el servidor local)');
  } finally {
    await servidor.shutdown();
  }
});

Deno.test('sha256 con Web Crypto y lectura del XML sintético en Deno', async () => {
  igual(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256');
  const xml = await Deno.readTextFile(new URL('../../../lib/__fixtures__/flex-sintetico.xml', import.meta.url));
  const rep = leerFlex(xml, '20261109', await sha256Hex(xml));
  cierto(rep.cuentas.some((c) => c.cuenta_ibkr === 'U0000001' && c.nav_ibkr > 0), 'U0000001 con NAV');
  cierto(rep.descartadas.length > 0, 'el XML sintético trae una cuenta con otro toDate');
});

Deno.test('avanzar en Deno (banxico y semáforo cargan node:crypto): FIX ya registrado y semáforo hecho', async () => {
  const anotados: string[] = [];
  const deps = {
    estado: async () => ({ sync_id: '00000000-0000-0000-0000-0000000000a1', semaforo_registrado: true,
      ultimo: { foto: { resultado: 'cargado', referencia_flex: null, detalle: {} } } }),
    tipoCambio: async () => 18.5983,
    banxico: { serie: async () => [{ fecha: '2026-11-09', valor: 18.5983 }] },
    anotar: async (e: { paso: string; resultado: string }) => { anotados.push(`${e.paso}:${e.resultado}`); },
    secretos: [],
  } as unknown as DepsFotoDiaria;
  await avanzar(new Date('2026-11-10T12:00:00Z'), deps);
  igual(anotados, ['fix:ya_cargado'], 'eventos');
});

Deno.test('manejador: 405 sin POST, 401 sin la llave, 500 de configuración sin filtrar secretos', async () => {
  const env = (vars: Record<string, string>) => (n: string) => vars[n];
  const post = (llave?: string) => new Request('http://local/ibkr-foto-diaria', {
    method: 'POST', headers: llave ? { 'x-foto-cron-llave': llave } : {} });
  igual((await manejar(new Request('http://local/x'), env({ FOTO_CRON_LLAVE: LLAVE }))).status, 405, 'GET');
  igual((await manejar(post(), env({ FOTO_CRON_LLAVE: LLAVE }))).status, 401, 'sin llave');
  igual((await manejar(post('otra'.repeat(10)), env({ FOTO_CRON_LLAVE: LLAVE }))).status, 401, 'llave distinta');
  igual((await manejar(post(LLAVE), env({}))).status, 401, 'sin llave configurada');
  const r = await manejar(post(LLAVE), env({ FOTO_CRON_LLAVE: LLAVE, IBKR_FLEX_TOKEN: 'TOKENSECRETO123', IBKR_FLEX_QUERY_ID: '1' }));
  const cuerpo = await r.text();
  igual(r.status, 500, 'sin BANXICO_TOKEN');
  cierto(cuerpo.includes('BANXICO_TOKEN') && !cuerpo.includes('TOKENSECRETO123') && !cuerpo.includes(LLAVE), `sin secretos: ${cuerpo}`);
});
