// Réplica PGlite de producción para probar un script de migraciones/.
//
//   npm run replica -- <script.sql> [datos.sql]
//
// Carga preludio.sql + base.sql (solo esquema) + los datos sintéticos (por
// defecto scripts/replica/datos/<nombre del script>), y corre el CUERPO del script
// (entre «-- <<CUERPO» y «-- CUERPO>>») como lo haría psql:
//   1. ensayo (todo + ROLLBACK): la huella de la base no debe cambiar;
//   2. real (COMMIT): imprime el último resultado, para compararlo con el ensayo
//      en producción;
//   3. re-ejecución: debe fallar en una guarda sin dejar rastro.
// Antes, comprueba que base.sql incluya la última migración archivada (sin contar
// el script que se prueba); si no, hay que regenerarla.
import { PGlite } from '@electric-sql/pglite';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '../..');
const [scriptArg, datosArg] = process.argv.slice(2);
if (!scriptArg) {
  console.error('Uso: npm run replica -- <script.sql> [datos.sql]');
  process.exit(2);
}
const script = resolve(process.cwd(), scriptArg);
const datos = datosArg ? resolve(process.cwd(), datosArg) : join(aqui, 'datos', basename(script));
const USUARIO = process.env.REPLICA_USUARIO ?? 'operador@replica.test';

function fallar(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// --- base.sql al día -------------------------------------------------------------
const base = readFileSync(join(aqui, 'base.sql'), 'utf8');
const incluida = base.match(/^-- Última migración incluida: (\S+)/m)?.[1];
if (!incluida) fallar('base.sql no dice qué migración incluye: regenerarla.');
const archivadas = readdirSync(join(raiz, 'migraciones'))
  .filter((f) => /^\d{4}-\d{2}-\d{2}-.+\.sql$/.test(f) && f !== basename(script))
  .sort();
const ultima = archivadas.at(-1);
if (ultima > incluida) {
  fallar(`base.sql incluye hasta ${incluida}, pero ya está archivada ${ultima}: regenerarla desde el catálogo (generar-base.sql).`);
}
console.log(`base.sql al día (incluye hasta ${incluida}).`);

// --- El cuerpo del script ------------------------------------------------------------
const texto = readFileSync(script, 'utf8');
const ini = texto.indexOf('-- <<CUERPO');
const fin = texto.indexOf('-- CUERPO>>');
if (ini < 0 || fin < ini) fallar('el script no tiene los marcadores -- <<CUERPO / -- CUERPO>>.');
const cuerpo = texto.slice(ini, fin);
const claims = JSON.stringify({ email: USUARIO, canal: 'psql' }).replace(/'/g, "''");
const envolver = (cierre) => `begin;\nselect set_config('request.jwt.claims', '${claims}', true);\n${cuerpo}\n${cierre};`;

// --- Réplica ---------------------------------------------------------------------------
const db = new PGlite();
await db.exec(readFileSync(join(aqui, 'preludio.sql'), 'utf8'));
await db.exec(base);
const n = (await db.query(`select count(*)::int n from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`)).rows[0].n;
const filas = (await db.query(`select coalesce(sum((xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', relname), false, true, '')))[1]::text::int), 0)::int n
                                 from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'`)).rows[0].n;
if (filas !== 0) fallar(`base.sql trae ${filas} filas: debe ser solo esquema.`);
console.log(`Esquema cargado: ${n} tablas, 0 filas.`);
if (existsSync(datos)) {
  await db.exec(readFileSync(datos, 'utf8'));
  console.log(`Datos sintéticos: ${basename(datos)}`);
} else {
  console.log('Sin datos sintéticos (no hay archivo en scripts/replica/datos/).');
}

async function huella() {
  const tablas = (await db.query(`select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1`)).rows;
  const partes = [];
  for (const { relname } of tablas) {
    const r = await db.query(`select md5(coalesce(string_agg(to_jsonb(x)::text, '' order by to_jsonb(x)::text), '')) h from public."${relname}" x`);
    partes.push(`${relname}:${r.rows[0].h}`);
  }
  const cat = await db.query(`select md5(string_agg(x, ',' order by x)) h from (
      select 'rel:' || relname x from pg_class where relnamespace = 'public'::regnamespace
      union all select 'fn:' || p.oid::regprocedure::text || md5(prosrc) from pg_proc p where pronamespace = 'public'::regnamespace
      union all select 'pol:' || tablename || '.' || policyname from pg_policies where schemaname = 'public'
      union all select 'trg:' || tgname || '@' || tgrelid::regclass from pg_trigger where not tgisinternal) s`);
  return partes.join('|') + '#' + cat.rows[0].h;
}

const imprimir = (r) => {
  if (!r?.rows?.length) return;
  const cols = r.fields.map((f) => f.name);
  console.log('  ' + cols.join(' | '));
  for (const fila of r.rows) console.log('  ' + cols.map((c) => String(fila[c] ?? 'NULL')).join(' | '));
};

let ok = true;
const A = await huella();

// 1 · Ensayo
try {
  await db.exec(envolver('rollback'));
} catch (e) {
  await db.exec('rollback').catch(() => {});
  console.log(`✗ ensayo se detuvo: ${e.message}`);
  console.log(`  (base ${(await huella()) === A ? 'sin rastro' : 'CAMBIADA'}; no se sigue con el real)`);
  process.exit(1);
}
const ensayo = (await huella()) === A;
console.log(`${ensayo ? '✓' : '✗'} ensayo (todo + ROLLBACK): ${ensayo ? 'sin rastro' : 'CAMBIÓ la base'}`);
ok &&= ensayo;

// 2 · Real
let salida;
try {
  salida = await db.exec(envolver('commit'));
  console.log('✓ real (COMMIT). Último resultado:');
  imprimir(salida.filter((r) => r.fields?.length).at(-1));
} catch (e) {
  await db.exec('rollback').catch(() => {});
  console.log(`✗ real falló: ${e.message}`);
  ok = false;
}

// 3 · Re-ejecución
if (salida) {
  const B = await huella();
  let error = null;
  try {
    await db.exec(envolver('commit'));
  } catch (e) {
    error = e.message;
  }
  await db.exec('rollback').catch(() => {});
  const limpio = error !== null && (await huella()) === B;
  console.log(`${limpio ? '✓' : '✗'} re-ejecución: ${error ? `se detuvo (${error})` : 'NO se detuvo'}${limpio ? ', sin rastro' : ''}`);
  ok &&= limpio;
}

process.exit(ok ? 0 : 1);
