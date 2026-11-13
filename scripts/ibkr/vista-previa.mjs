// Vista previa de una descarga del Flex Web Service de IBKR. SOLO LECTURA: no
// escribe en la base ni guarda el XML (trae nombres). La lógica vive en comun.mjs.
//
//   node scripts/ibkr/vista-previa.mjs [--referencia <ref.json>] [--td AAAAMMDD]
//        [--altas a.csv,b.csv] [--verificar a.csv,b.csv] [--efectivo COD1,COD2]
//        [--estructura sí] [--env .env.local] [--xml <archivo>]
//
// --referencia  JSON de referencia (pruebas). Sin él, se lee del CRM con psql
//               service=bioongo en una transacción READ ONLY.
// --td          Fecha del corte (fd = td). Por omisión, el último día hábil
//               (lunes a viernes) antes de hoy en CDMX.
// --altas       CSV de altas aprobadas que aún no corren: cuentan como catálogo.
// --verificar   Coteja ISIN y descripción de esas altas contra el XML; un ISIN
//               distinto termina con código 2.
// --efectivo    Códigos: endingCash − endingSettledCash y lo que queda de la
//               diferencia de NAV.
// --estructura  «sí»: solo nombres de elementos y atributos (y fechas).
// --env         Archivo con IBKR_FLEX_TOKEN e IBKR_FLEX_QUERY_ID (por omisión
//               .env.local). Las credenciales nunca se imprimen.
// --xml         Lee un XML local en vez de llamar a IBKR (pruebas con XML sintético).
import {
  ErrorScript, catalogoConAltas, descargar, hoyCdmx, imprimirEstructura, imprimirVistaPrevia, leerArgs,
  prepararVistaPrevia, referenciaDesdeArchivo, referenciaDesdePsql, ultimoHabil,
} from './comun.mjs';

try {
  const args = leerArgs(process.argv.slice(2));
  const hoy = hoyCdmx();
  const td = args.td ?? ultimoHabil(hoy);
  const ref = args.referencia ? referenciaDesdeArchivo(args.referencia) : referenciaDesdePsql();
  const { catalogo, altas } = catalogoConAltas(ref, args.altas);
  const xml = await descargar({ xml: args.xml, env: args.env, td, hoy });
  if (args.estructura === 'sí' || args.estructura === 'si') {
    imprimirEstructura(xml, td);
    process.exit(0);
  }
  const ctx = prepararVistaPrevia({ xml, td, ref, catalogo });
  const { isinDistinto } = imprimirVistaPrevia(ctx, { altas, rutasAltas: args.altas, verificar: args.verificar, efectivo: args.efectivo });
  console.log('\nNada se escribió en la base y el XML no se guardó.');
  if (isinDistinto) throw new ErrorScript('Al menos un ISIN del XML no coincide con el del CSV: no se arma la migración.', 2);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(e instanceof ErrorScript ? e.codigoSalida : 1);
}
