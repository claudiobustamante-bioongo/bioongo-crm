// Núcleo del MCP local de solo lectura (bioongo-lectura). Puro y probado:
// scripts/mcp-lectura/nucleo.test.ts (unidad y réplica PGlite como mcp_lectura).
//
// La barrera son los PRIVILEGIOS del rol mcp_lectura (migración 2026-11-20-01):
// solo SELECT por columna, sin EXECUTE ni CREATE. Este módulo agrega lo que los
// privilegios no cubren (pg_net da a PUBLIC su esquema y su cola, y no se puede
// revocar):
// - UNA sola sentencia por llamada: protocolo extendido (queryMode 'extended'),
//   que rechaza varias sentencias juntas («commit; …» no se cuela);
// - dentro de BEGIN TRANSACTION READ ONLY, con un SELECT 1 antes de la consulta
//   (así «set transaction read write» ya no puede cambiar el modo);
// - ROLLBACK SIEMPRE al final: nada se confirma, ni una petición encolada en net;
// - salida con las cuentas U… y la parte local de los correos enmascaradas.

export const MAX_FILAS = 200;
export const MAX_LARGO_SQL = 20_000;

/** Lee una sección de ~/.pg_service.conf. Rechaza la sección si trae contraseña: va solo en ~/.pgpass. */
export function leerServicio(texto, nombre) {
  let dentro = false;
  const valores = {};
  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea || linea.startsWith('#')) continue;
    const seccion = /^\[(.+)\]$/.exec(linea);
    if (seccion) { dentro = seccion[1].trim() === nombre; continue; }
    if (!dentro) continue;
    const i = linea.indexOf('=');
    if (i > 0) valores[linea.slice(0, i).trim()] = linea.slice(i + 1).trim();
  }
  if (!Object.keys(valores).length) throw new Error(`No existe el servicio [${nombre}] en el archivo de servicios.`);
  if ('password' in valores) throw new Error(`El servicio [${nombre}] trae password: debe ir solo en ~/.pgpass.`);
  for (const k of ['host', 'user', 'dbname']) if (!valores[k]) throw new Error(`Al servicio [${nombre}] le falta ${k}.`);
  return { host: valores.host, port: Number(valores.port ?? 5432), database: valores.dbname, user: valores.user,
    sslmode: valores.sslmode ?? 'require' };
}

const CUENTA = /\bU\d{5,}\b/g;
const CORREO = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** Enmascara cuentas U… y la parte local de los correos, en cualquier valor (recursivo). */
export function enmascarar(valor) {
  if (typeof valor === 'string') return valor.replace(CUENTA, 'U••••').replace(CORREO, '«…»@$1');
  if (Array.isArray(valor)) return valor.map(enmascarar);
  if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, enmascarar(v)]));
  }
  return valor;
}

/**
 * Una consulta de solo lectura. `cliente` es un node-postgres Client ya conectado
 * (o un adaptador con el mismo `query`). Devuelve { columnas, filas, filas_total, truncado }.
 */
export async function consultar(cliente, sql, { maxFilas = MAX_FILAS } = {}) {
  if (typeof sql !== 'string' || !sql.trim()) throw new Error('La consulta está vacía.');
  if (sql.length > MAX_LARGO_SQL) throw new Error(`La consulta pasa de ${MAX_LARGO_SQL} caracteres.`);
  await cliente.query('BEGIN TRANSACTION READ ONLY');
  try {
    await cliente.query('SELECT 1'); // después de esto, «set transaction read write» ya no aplica
    const r = await cliente.query({ text: sql, queryMode: 'extended' });
    const filas = r.rows ?? [];
    return {
      columnas: (r.fields ?? []).map((f) => f.name),
      filas: enmascarar(filas.slice(0, maxFilas)),
      filas_total: filas.length,
      truncado: filas.length > maxFilas,
    };
  } finally {
    await cliente.query('ROLLBACK'); // siempre: nada se confirma
  }
}
