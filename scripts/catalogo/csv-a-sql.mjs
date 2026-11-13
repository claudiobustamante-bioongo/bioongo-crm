// Genera el bloque de carga del catálogo (INSERT … VALUES) desde los CSV de docs/.
//
//   node scripts/catalogo/csv-a-sql.mjs [instrumentos.csv[,otro.csv…]] [prorrateo.csv | -]
//
// Varios CSV de instrumentos separados por coma se cargan en un solo INSERT, con
// una sola huella; la cabecera lleva el md5 de cada archivo. Un ticker repetido
// entre archivos es error.
//
// Con «-» en lugar del CSV de prorrateo (una alta sin MIXTO), no se emite el
// INSERT del prorrateo y _esperado lleva prorrateo = 0 y huella_prorrateo NULL.
//
// Imprime SQL a la salida estándar: los dos INSERT y una tabla temporal _esperado
// con los conteos y la HUELLA del contenido (md5 de un texto canónico por
// renglón). La migración compara esa huella con la que calcula la base sobre lo
// que quedó escrito: si un valor se pierde o cambia en el camino, se detiene.
//
// Campos vacíos → NULL. Sin dependencias: el CSV se lee con un parser mínimo que
// respeta comillas dobles (hay notas con comas).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const [argI = 'docs/catalogo_instrumentos.csv', argP = 'docs/catalogo_prorrateo.csv'] = process.argv.slice(2);

function leerCsv(ruta) {
  const t = readFileSync(ruta, 'utf8');
  const filas = [];
  let fila = [], campo = '', comillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (comillas) {
      if (c === '"') {
        if (t[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
      } else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(campo); campo = ''; }
    else if (c === '\n') { fila.push(campo); filas.push(fila); fila = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  const [cabecera, ...datos] = filas;
  return datos.map((f, n) => {
    if (f.length !== cabecera.length) throw new Error(`${ruta}: renglón ${n + 2} con ${f.length} campos, se esperaban ${cabecera.length}`);
    return Object.fromEntries(cabecera.map((h, k) => [h, f[k].trim()]));
  });
}

const md5 = (s) => createHash('md5').update(s, 'utf8').digest('hex');
const lit = (v) => (v === '' ? 'null' : `'${v.replace(/'/g, "''")}'`);
const num = (v, dec) => {
  if (v === '') return 'null';
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`número inválido: ${v}`);
  return n.toFixed(dec);
};
const bool = (v) => {
  if (v !== 'true' && v !== 'false') throw new Error(`booleano inválido: ${v}`);
  return v;
};
const fecha = (v) => {
  if (v === '') return 'null';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`fecha inválida: ${v}`);
  return `date '${v}'`;
};
// Orden byte a byte, igual que `collate "C"` en la base.
const porBytes = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const archivosI = argI.split(',').map((x) => x.trim());
const ins = archivosI.flatMap((a) => leerCsv(resolve(a))).sort((a, b) => porBytes(a.ticker, b.ticker));
const sinProrrateo = argP === '-';
const pro = sinProrrateo
  ? []
  : leerCsv(resolve(argP)).sort((a, b) => porBytes(a.ticker, b.ticker) || porBytes(a.clase_activo, b.clase_activo));
if (!sinProrrateo && pro.length === 0) throw new Error(`${argP}: sin renglones; para una alta sin prorrateo usar «-»`);
if (new Set(ins.map((r) => r.ticker)).size !== ins.length) throw new Error('ticker repetido en instrumentos');

// Texto canónico: el mismo que arma la migración con concat_ws('|', coalesce(...)).
const canonI = ins.map((r) => [
  r.ticker, r.descripcion, r.asset_category, r.sub_category, r.clasificacion_cnbv, r.clase_activo,
  r.es_equivalente_efectivo, r.elegible, r.duracion_efectiva === '' ? '' : Number(r.duracion_efectiva).toFixed(2),
  r.nota, r.verificado_en,
].join('|')).join('\n');
const canonP = pro.map((r) => [r.ticker, r.clase_activo, Number(r.factor).toFixed(5)].join('|')).join('\n');

const salida = [];
salida.push(`-- Generado por scripts/catalogo/csv-a-sql.mjs desde ${archivosI.map((a) => `${a} (md5 ${md5(readFileSync(a, 'utf8'))})`).join(', ')}`);
salida.push(sinProrrateo
  ? '-- sin prorrateo. No se edita a mano: se regenera.'
  : `-- y ${argP} (md5 ${md5(readFileSync(argP, 'utf8'))}). No se edita a mano: se regenera.`);
salida.push('insert into public.catalogo_instrumentos (ticker, descripcion, asset_category, sub_category, clasificacion_cnbv,');
salida.push('  clase_activo, es_equivalente_efectivo, elegible, duracion_efectiva, nota, verificado_en) values');
salida.push(ins.map((r) => `  (${[
  lit(r.ticker), lit(r.descripcion), lit(r.asset_category), lit(r.sub_category), num(r.clasificacion_cnbv, 0),
  lit(r.clase_activo), bool(r.es_equivalente_efectivo), bool(r.elegible), num(r.duracion_efectiva, 2),
  lit(r.nota), fecha(r.verificado_en),
].join(', ')})`).join(',\n') + ';');
if (!sinProrrateo) {
  salida.push('insert into public.catalogo_prorrateo (ticker, clase_activo, factor) values');
  salida.push(pro.map((r) => `  (${lit(r.ticker)}, ${lit(r.clase_activo)}, ${num(r.factor, 5)})`).join(',\n') + ';');
}
salida.push('create temporary table _esperado on commit drop as');
salida.push(`select ${ins.length} as instrumentos, ${pro.length} as prorrateo,`);
salida.push(`       '${md5(canonI)}'::text as huella_instrumentos, ${sinProrrateo ? 'null' : `'${md5(canonP)}'`}::text as huella_prorrateo;`);
process.stdout.write(salida.join('\n') + '\n');
