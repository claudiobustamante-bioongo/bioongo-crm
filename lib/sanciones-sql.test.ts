/**
 * Paridad entre la lista de sanciones del SQL y la del código.
 *
 * Qué listas BLOQUEAN al cliente lo decide la base: fn_resolver_coincidencia
 * abre el bloqueo cuando el tipo está en fn_tipos_sanciones(). Qué listas
 * disparan la ruta reforzada, elevan el EBR a ALTO y pintan de rojo la bandeja
 * lo decide `TIPOS_SANCIONES` de lib/listas.ts. Si las dos difieren, el sistema
 * se contradice: un cliente queda bloqueado sin alerta, o alarmado sin bloqueo.
 *
 * Este test lee la migración ARCHIVADA —el registro byte a byte de lo que se
 * ejecutó en producción el 5-oct-2026— y falla si:
 *   1. el arreglo de fn_tipos_sanciones() difiere de TIPOS_SANCIONES;
 *   2. aparece en el SQL otra lista literal de tipos fuera de esa función
 *      (los comentarios no cuentan);
 *   3. el bloque entre los marcadores TIPOS_SANCIONES:INICIO/FIN falta o se
 *      repite.
 *
 * Si mañana se agrega una lista de sanciones, se cambian las dos en el mismo
 * bloque de trabajo: TIPOS_SANCIONES aquí y fn_tipos_sanciones() en una
 * migración nueva. Esa migración nueva tiene que sumarse a MIGRACIONES_SANCIONES
 * —la última manda—, o este test seguirá comparando contra la anterior.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { TIPOS_LISTA, TIPOS_SANCIONES } from './listas';

/** En orden cronológico. La última define fn_tipos_sanciones() vigente. */
const MIGRACIONES_SANCIONES = ['2026-10-05-bloqueo-y-firma.sql'];

const leerMigracion = (nombre: string) =>
  readFileSync(new URL(`../migraciones/${nombre}`, import.meta.url), 'utf8');

/** Quita los comentarios de línea de SQL; los literales no llevan `--` en este archivo. */
const sinComentarios = (sql: string) => sql.replace(/--.*$/gm, '');

function verificarParidad(sql: string, sanciones: readonly string[], tipos: readonly string[]): string[] {
  const inicio = sql.split(/^-- TIPOS_SANCIONES:INICIO.*$/m);
  if (inicio.length !== 2) {
    return [`se esperaba exactamente un bloque TIPOS_SANCIONES:INICIO, hay ${inicio.length - 1}`];
  }
  const [antes, resto] = inicio;
  const fin = resto.split(/^-- TIPOS_SANCIONES:FIN.*$/m);
  if (fin.length !== 2) return ['el bloque TIPOS_SANCIONES no cierra, o cierra dos veces'];
  const [bloque, despues] = fin;

  const arreglo = sinComentarios(bloque).match(/array\s*\[([^\]]*)\]/i);
  if (!arreglo) return ['el bloque no contiene array[...]'];

  const errores: string[] = [];
  const delSql = [...arreglo[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  const delCodigo = [...sanciones].sort();
  if (delSql.join(',') !== delCodigo.join(',')) {
    errores.push(`fn_tipos_sanciones() = {${delSql}} pero TIPOS_SANCIONES = {${delCodigo}}`);
  }

  const fuera = sinComentarios(antes + despues);
  for (const tipo of tipos) {
    if (fuera.includes(`'${tipo}'`)) errores.push(`literal '${tipo}' fuera de fn_tipos_sanciones()`);
  }
  return errores;
}

const VIGENTE = leerMigracion(MIGRACIONES_SANCIONES[MIGRACIONES_SANCIONES.length - 1]);

test('fn_tipos_sanciones() de la migración archivada = TIPOS_SANCIONES de lib/listas.ts', () => {
  assert.deepEqual(verificarParidad(VIGENTE, TIPOS_SANCIONES, TIPOS_LISTA), []);
});

test('el bloque que se compara es el que se ejecutó: queda entre begin y commit', () => {
  const ejecutado = VIGENTE.slice(VIGENTE.search(/^begin;$/m), VIGENTE.search(/^commit;$/m));
  assert.match(ejecutado, /^-- TIPOS_SANCIONES:INICIO/m);
  assert.match(ejecutado, /create function public\.fn_tipos_sanciones\(\)/);
});

// ---------------------------------------------------------------------------
// El test sabe fallar: tres alteraciones de la migración, tres errores
// ---------------------------------------------------------------------------

test('control: si a la función le falta una lista, falla', () => {
  // La línea de la función, no la cabecera: la cabecera cita el mismo arreglo
  // en un comentario y alterarla no debe cambiar nada.
  const alterado = VIGENTE.replace(
    "select array['LPB','OFAC','ONU']::text[]",
    "select array['LPB','OFAC']::text[]",
  );
  assert.notEqual(alterado, VIGENTE, 'el reemplazo tiene que haber ocurrido');
  const e = verificarParidad(alterado, TIPOS_SANCIONES, TIPOS_LISTA);
  assert.equal(e.length, 1);
  assert.match(e[0], /TIPOS_SANCIONES/);
});

test('control: alterar solo la cita de la cabecera no cambia el resultado', () => {
  const alterado = VIGENTE.replace("array['LPB','OFAC','ONU']  ✓", "array['LPB']  ✓");
  assert.notEqual(alterado, VIGENTE);
  assert.deepEqual(verificarParidad(alterado, TIPOS_SANCIONES, TIPOS_LISTA), []);
});

test('control: si TIPOS_SANCIONES gana una lista que la base no conoce, falla', () => {
  const e = verificarParidad(VIGENTE, [...TIPOS_SANCIONES, 'SAT_69B'], TIPOS_LISTA);
  assert.equal(e.length, 1);
});

test('control: una lista literal fuera de la función, falla', () => {
  const alterado = VIGENTE.replace(
    'v_tipo = any (fn_tipos_sanciones())',
    "v_tipo in ('LPB','OFAC','ONU')",
  );
  assert.notEqual(alterado, VIGENTE);
  const e = verificarParidad(alterado, TIPOS_SANCIONES, TIPOS_LISTA);
  assert.deepEqual(
    e.map((x) => x.replace(/ fuera.*/, '')),
    ["literal 'LPB'", "literal 'OFAC'", "literal 'ONU'"],
  );
});

test('control: sin marcador de cierre, falla', () => {
  const alterado = VIGENTE.replace(/^-- TIPOS_SANCIONES:FIN$/m, '');
  assert.notEqual(alterado, VIGENTE);
  assert.match(verificarParidad(alterado, TIPOS_SANCIONES, TIPOS_LISTA)[0], /no cierra/);
});
