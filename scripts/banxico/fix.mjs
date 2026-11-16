// FIX de Banxico (serie SF43718) para una fecha: lo pide a la API SIE, lo muestra
// y, con confirmación, lo escribe en tipo_cambio por fn_registrar_tipo_cambio con
// tu sesión. LO CORRE CLAUDIO con «!», nunca Claude.
//
//   node scripts/banxico/fix.mjs --usuario <correo> [--fecha AAAA-MM-DD] [--confirmar <clave>] [--env .env.local]
//   node scripts/banxico/fix.mjs --usuario <correo> --fecha AAAA-MM-DD --json <respuesta.json>   (prueba)
//
// - --fecha: por omisión, el último día hábil (lunes a viernes) antes de hoy.
// - Día sin FIX: toma el último publicado antes de la fecha (ventana de 10 días)
//   y lo anota. Nunca supone un valor.
// - BANXICO_TOKEN se carga del archivo de entorno y nunca se imprime.
// - Pasos: consulta → ENSAYO (ROLLBACK) → confirmación (CARGAR con terminal
//   interactiva; si no, una clave y una segunda corrida con --confirmar que
//   exige el mismo dato) → REAL (COMMIT).
// - Con --json no se toca la base ni la red (modo prueba).
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { ErrorScript, hoyCdmx, leerArgs, psqlGuion, ultimoHabil } from '../ibkr/comun.mjs';

const bx = await import('../../lib/banxico.ts');

try {
  const args = leerArgs(process.argv.slice(2));
  if (!args.usuario) throw new ErrorScript('Falta --usuario <correo>: es quien firma el registro en la bitácora.');
  const hoy = hoyCdmx();
  const h = ultimoHabil(hoy);
  const fecha = args.fecha ?? `${h.slice(0, 4)}-${h.slice(4, 6)}-${h.slice(6, 8)}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new ErrorScript('--fecha debe ser AAAA-MM-DD.');
  const desde = bx.restarDias(fecha, bx.VENTANA_DIAS);

  let datos;
  if (args.json) {
    datos = bx.leerRespuestaSie(JSON.parse(readFileSync(args.json, 'utf8')));
  } else {
    try {
      process.loadEnvFile(args.env ?? '.env.local');
    } catch {
      throw new ErrorScript('No se pudo leer el archivo de entorno.');
    }
    const token = process.env.BANXICO_TOKEN?.trim();
    if (!token) throw new ErrorScript('Falta BANXICO_TOKEN en el entorno.');
    console.log(`Pidiendo ${bx.SERIE_FIX} a Banxico entre ${desde} y ${fecha}…`);
    datos = await bx.pedirSerie(bx.SERIE_FIX, desde, fecha, { token });
  }

  const elegido = bx.elegirFix(datos, fecha);
  const consultado = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Mexico_City', dateStyle: 'short', timeStyle: 'short' }).format(new Date());
  const reg = {
    serie: bx.SERIE_FIX, fecha: elegido.fecha, valor: elegido.valor, fecha_solicitada: fecha,
    fuente: `Banxico SIE ${bx.SERIE_FIX} (consultado ${consultado} CDMX)`, nota: elegido.nota,
  };
  const clave = bx.claveFix(reg);

  console.log(`\n== FIX ${bx.SERIE_FIX} · pedido ${fecha}`);
  console.log(`  Datos publicados en la ventana: ${datos.map((d) => `${d.fecha} ${d.valor}`).join(' · ') || 'ninguno'}`);
  console.log(`  Se registraría: ${reg.fecha} = ${reg.valor} MXN por USD${reg.nota ? `\n  Nota: ${reg.nota}` : ''}`);
  console.log(`  Clave de confirmación: ${clave}`);

  if (args.json) {
    console.log('\nModo prueba (--json): no se tocó la base.');
    process.exit(0);
  }

  console.log('\nEnsayo (ROLLBACK)…');
  console.log(`  ${JSON.stringify(psqlGuion(bx.sqlRegistroFix(reg, 'ensayo', args.usuario)))}`);

  if (args.confirmar) {
    if (args.confirmar !== clave) throw new ErrorScript('La clave no coincide con el dato de esta consulta: no se registra.');
  } else if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const r = await rl.question(`\nEscribe CARGAR para registrar el FIX del ${reg.fecha}: `);
    rl.close();
    if (r.trim() !== 'CARGAR') { console.log('No se confirmó: no se registró nada.'); process.exit(0); }
  } else {
    console.log(`\nNada se escribió. Para registrar este FIX, repite el comando con --confirmar ${clave}`);
    process.exit(0);
  }

  console.log('\nReal (COMMIT)…');
  const real = psqlGuion(bx.sqlRegistroFix(reg, 'real', args.usuario));
  console.log(`  ${JSON.stringify(real)}`);
  console.log(`\nFIX del ${reg.fecha} registrado: ${reg.valor}.`);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(e instanceof ErrorScript ? e.codigoSalida : 1);
}
