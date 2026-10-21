// Sube al bucket privado `expediente` los PDF de un lote, con las mismas reglas
// que POST /api/documentos: sha256 calculado aquí, firma %PDF-, tope de 4 MB,
// ruta armada solo con datos del sistema y `upsert: false` (nunca sobrescribe; si
// la ruta ya existe, solo se acepta si el objeto tiene el mismo sha256).
//
// NO registra nada en la base: eso lo hace el script psql del lote con
// fn_registrar_documento (modo ensayo/real), con el usuario de Claudio.
//
// Uso (el manifiesto llega SOLO por tubería: trae rutas locales con RFC):
//   … | node --env-file=.env.local scripts/cartas/subir-lote.mjs [--ensayo]
// Manifiesto: [{ codigo, local, sha256, tamano, ruta }, …]
// Con --ensayo verifica todo sin tocar Storage.
// Imprime SOLO códigos y estados: nunca rutas locales, nombres de archivo ni la llave.
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const ENSAYO = process.argv.includes('--ensayo');
const LIMITE = 4194304;
const RUTA = /^carta_clasificacion\/CSP[FM]U\d{4}\/\d{4}-\d{2}-\d{2}_[0-9a-f]{12}\.pdf$/;
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

const manifiesto = JSON.parse(readFileSync(0, 'utf8'));
if (!Array.isArray(manifiesto) || manifiesto.length === 0) {
  console.error('✗ manifiesto vacío o inválido');
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !llave) {
  console.error('✗ falta la configuración de Storage en .env.local');
  process.exit(2);
}
const bucket = createClient(url, llave, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}).storage.from('expediente');

let errores = 0;
const conteo = {};
for (const m of manifiesto) {
  let estado;
  try {
    const bytes = readFileSync(m.local);
    if (sha256(bytes) !== m.sha256) throw new Error('el archivo cambió desde el ensayo (sha256 distinto)');
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('no es PDF');
    if (bytes.length > LIMITE || bytes.length !== m.tamano) throw new Error('tamaño fuera de regla');
    if (!RUTA.test(m.ruta) || m.ruta.split('/')[1] !== m.codigo || !m.ruta.includes(`_${m.sha256.slice(0, 12)}.pdf`)) {
      throw new Error('ruta fuera de regla');
    }
    if (ENSAYO) {
      estado = 'listo para subir';
    } else {
      const { error } = await bucket.upload(m.ruta, bytes, { contentType: 'application/pdf', upsert: false });
      if (!error) {
        estado = 'subido';
      } else if (/already exists/i.test(error.message ?? '') || String(error.statusCode ?? '') === '409') {
        const { data, error: e2 } = await bucket.download(m.ruta);
        if (e2 || !data) throw new Error('la ruta existe y no se pudo verificar');
        if (sha256(Buffer.from(await data.arrayBuffer())) !== m.sha256) throw new Error('la ruta existe con OTRO archivo');
        estado = 'ya existía (mismo sha256)';
      } else {
        throw new Error('Storage rechazó la subida');
      }
    }
  } catch (e) {
    estado = `ERROR: ${e.message}`;
    errores++;
  }
  conteo[estado.startsWith('ERROR') ? 'error' : estado] = (conteo[estado.startsWith('ERROR') ? 'error' : estado] ?? 0) + 1;
  console.log(`${m.codigo}  ${estado}`);
}
console.log(`\n${ENSAYO ? 'ENSAYO (sin tocar Storage)' : 'SUBIDA'}: ${Object.entries(conteo).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
process.exit(errores ? 1 : 0);
