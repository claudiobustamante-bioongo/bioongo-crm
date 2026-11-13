// Carga la foto del último día hábil de IBKR en posiciones_detalle, por
// fn_cargar_ibkr, con tu firma. LO CORRE CLAUDIO con «!», nunca Claude.
//
//   node scripts/ibkr/cargar-foto.mjs --usuario <correo> [--td AAAAMMDD]
//        [--confirmar <clave>] [--env .env.local]
//   node scripts/ibkr/cargar-foto.mjs --usuario <correo> --referencia <ref.json> --xml <x.xml>   (prueba)
//
// Pasos:
//   1. Referencia del CRM por psql service=bioongo en transacción READ ONLY.
//   2. Descarga de la Flex 1649340 (fd = td) y la misma vista previa que
//      vista-previa.mjs (descuadres, sin catálogo, NAV, propias, repetidos).
//   3. Si IBKR no trajo NAV en ninguna cuenta: no carga (código 3); repetir.
//   4. Arma la carga SOLO con cuentas ni cerradas ni de baja.
//   5. ENSAYO automático: fn_cargar_ibkr dentro de una transacción con ROLLBACK.
//   6. Confirmación: con terminal interactiva, escribir CARGAR; sin ella (con «!»),
//      el script termina dando una CLAVE, y la segunda corrida con
//      --confirmar <clave> vuelve a descargar y solo escribe si las posiciones
//      son exactamente las mismas.
//   7. REAL: la misma llamada con COMMIT.
// Con --xml no se toca la base (pasos 5–7 omitidos): solo para probar.
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import {
  ErrorScript, catalogoConAltas, descargar, flex, hoyCdmx, imprimirVistaPrevia, leerArgs, lista,
  prepararVistaPrevia, referenciaDesdeArchivo, referenciaDesdePsql, ultimoHabil,
} from './comun.mjs';

const carga = await import('../../lib/ibkr-carga.ts');

/** psql con el guion por stdin. Solo se muestra la primera línea del error (sin el payload). */
function psql(guion) {
  const r = spawnSync('psql', ['service=bioongo', '-X', '-q', '-A', '-t', '-f', '-'], { input: guion, encoding: 'utf8' });
  if (r.status !== 0) {
    const linea = (r.stderr ?? '').split('\n').find((l) => /ERROR|FATAL|error/.test(l)) ?? 'psql terminó con error';
    throw new ErrorScript(`psql: ${linea.trim()}`);
  }
  return JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop());
}

try {
  const args = leerArgs(process.argv.slice(2));
  if (!args.usuario) throw new ErrorScript('Falta --usuario <correo>: es quien firma la carga en la bitácora.');
  const prueba = Boolean(args.xml);
  if (prueba && !args.referencia) throw new ErrorScript('En modo prueba (--xml) va también --referencia.');

  const hoy = hoyCdmx();
  const td = args.td ?? ultimoHabil(hoy);
  const ref = args.referencia ? referenciaDesdeArchivo(args.referencia) : referenciaDesdePsql();
  const { catalogo } = catalogoConAltas(ref, '');
  const xml = await descargar({ xml: args.xml, env: args.env, td, hoy });
  const ctx = prepararVistaPrevia({ xml, td, ref, catalogo });
  imprimirVistaPrevia(ctx);

  try {
    carga.validarRespuesta(ctx.rep);
  } catch (e) {
    throw new ErrorScript(e.message, e.codigo === 'SIN_NAV' ? 3 : 1);
  }

  const cargables = carga.cuentasCargables(ref.cuentas ?? []);
  const c = flex.armarCargaFoto(ctx.rep, ctx.descuadres, cargables);
  const clave = carga.claveConfirmacion(c);
  const enCarga = new Set(c.posiciones.map((p) => p.cuenta_ibkr));
  const fuera = (ref.cuentas ?? []).filter((x) => x.fecha_cierre || x.status === 'baja').map((x) => x.codigo_cliente);
  const propias = (ref.cuentas ?? []).filter((x) => x.es_propia && enCarga.has(x.cuenta_ibkr)).map((x) => x.codigo_cliente);

  console.log(`\n== CARGA DE LA FOTO · td ${td} · sha256 ${c.xml_sha256.slice(0, 12)}…`);
  console.log(`  Cuentas a cargar (${enCarga.size}): ${lista([...enCarga].map(ctx.etiqueta).sort())}`);
  console.log(`  Renglones: ${c.posiciones.length} · ignoradas del XML: ${c.ignoradas}`);
  console.log(`  Fuera por cierre o baja en el CRM (${fuera.length}): ${lista(fuera.sort())}`);
  console.log(`  Propias del Asesor (se cargan; el semáforo las exime): ${lista(propias.sort())}`);
  console.log(`  Clave de confirmación: ${clave}`);

  if (prueba) {
    console.log('\nModo prueba (--xml): no se tocó la base.');
    process.exit(0);
  }

  console.log('\nEnsayo (ROLLBACK)…');
  const ensayo = psql(carga.sqlCarga(c, 'ensayo', args.usuario));
  console.log(`  ${JSON.stringify(ensayo)}`);
  if (ensayo.renglones_escritos !== c.posiciones.length) {
    throw new ErrorScript(`El ensayo escribió ${ensayo.renglones_escritos} renglones de ${c.posiciones.length}: no se carga.`);
  }

  if (args.confirmar) {
    try {
      carga.exigirConfirmacion(c, args.confirmar);
    } catch (e) {
      throw new ErrorScript(e.message);
    }
  } else if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const r = await rl.question(`\nEscribe CARGAR para escribir la foto del ${td}: `);
    rl.close();
    if (r.trim() !== 'CARGAR') throw new ErrorScript('No se confirmó: no se escribió nada.', 0);
  } else {
    console.log(`\nNada se escribió. Para escribir esta foto, repite el comando con --confirmar ${clave}`);
    console.log('(la segunda corrida vuelve a descargar y solo escribe si las posiciones son las mismas).');
    process.exit(0);
  }

  console.log('\nReal (COMMIT)…');
  const real = psql(carga.sqlCarga(c, 'real', args.usuario));
  console.log(`  ${JSON.stringify(real)}`);
  console.log(`\nFoto del ${td} cargada: ${real.renglones_escritos} renglones, sync ${real.resultado?.sync_id}.`);
} catch (e) {
  if (e instanceof ErrorScript && e.codigoSalida === 0) { console.log(e.message); process.exit(0); }
  console.error(`✗ ${e.message}`);
  process.exit(e instanceof ErrorScript ? e.codigoSalida : 1);
}
