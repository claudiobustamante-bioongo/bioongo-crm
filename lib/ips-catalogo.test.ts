/**
 * Bandas del ponderado IPS → perfil, fijadas en sus fronteras.
 *
 * Por qué existe: los cortes de `BANDAS_PERFIL` son la última operación del
 * motor y la que decide qué perfil se le asigna al cliente. No había ninguna
 * prueba que los sujetara, así que un cambio de un decimal reclasificaba
 * cartera sin que nada fallara.
 *
 * Se prueba contra `resolverBanda` y la tabla reales, no contra una copia de la
 * búsqueda: si alguien cambia el `<=` por `<`, esto tiene que caerse.
 *
 * Cortes vigentes, decisión ratificada el 29/09/2026:
 *   Alto <= 2.0 · Moderado <= 2.5 · Bajo <= 3.5 · Libre de Riesgo > 3.5
 *
 * Se corre con vitest:
 *   npm test
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';

import { resolverBanda } from './ips-engine';
import {
  BANDAS_CAPACIDAD,
  BANDAS_PERFIL,
  BANDAS_TOLERANCIA,
  PERFILES,
  PESO_CAPACIDAD,
  PESO_TOLERANCIA,
  type PerfilRiesgo,
} from './ips-catalogo';

const perfil = (ponderado: number): PerfilRiesgo =>
  resolverBanda(ponderado, BANDAS_PERFIL);

// ---------------------------------------------------------------------------
// 1 · Las fronteras exactas
// ---------------------------------------------------------------------------

/**
 * Los valores con dos decimales NO son alcanzables por el motor —ver el caso de
 * abajo—, y se prueban de todos modos: lo que fijan es la semántica `<=` de cada
 * corte, que es lo que se rompería sin darse cuenta.
 */
test('los cuatro cortes, justo encima y justo debajo', () => {
  assert.equal(perfil(2.0), 'Alto', '2.0 es el último Alto');
  assert.equal(perfil(2.01), 'Moderado', 'pasado 2.0 ya es Moderado');
  assert.equal(perfil(2.5), 'Moderado', '2.5 es el último Moderado');
  assert.equal(perfil(2.51), 'Bajo', 'pasado 2.5 ya es Bajo');
  assert.equal(perfil(3.5), 'Bajo', '3.5 es el último Bajo');
  assert.equal(perfil(3.51), 'Libre de Riesgo', 'pasado 3.5 ya es Libre de Riesgo');
});

test('la tabla tiene exactamente esos cuatro cortes, en ese orden', () => {
  assert.deepEqual(BANDAS_PERFIL, [
    { max: 2.0, valor: 'Alto' },
    { max: 2.5, valor: 'Moderado' },
    { max: 3.5, valor: 'Bajo' },
    { max: Infinity, valor: 'Libre de Riesgo' },
  ]);
});

// ---------------------------------------------------------------------------
// 2 · Los ponderados que el motor puede producir de verdad
// ---------------------------------------------------------------------------

/**
 * El ponderado no es continuo: es `0.6 * toleranciaNivel + 0.4 * capacidadNivel`
 * con nivel de tolerancia 1–4 y de capacidad 1–5. Solo hay 16 valores posibles,
 * y ninguno tiene dos decimales.
 *
 * Esta tabla es la que un asesor puede reconocer: si un cambio de bandas mueve
 * un perfil, se ve aquí y no en una frontera teórica.
 */
const ALCANZABLES: Array<[number, PerfilRiesgo]> = [
  [1.0, 'Alto'],
  [1.4, 'Alto'],
  [1.6, 'Alto'],
  [1.8, 'Alto'],
  [2.0, 'Alto'],
  [2.2, 'Moderado'],
  [2.4, 'Moderado'],
  [2.6, 'Bajo'],
  [2.8, 'Bajo'],
  [3.0, 'Bajo'],
  [3.2, 'Bajo'],
  [3.4, 'Bajo'],
  [3.6, 'Libre de Riesgo'],
  [3.8, 'Libre de Riesgo'],
  [4.0, 'Libre de Riesgo'],
  [4.4, 'Libre de Riesgo'],
];

test('los 16 ponderados alcanzables caen donde deben', () => {
  for (const [ponderado, esperado] of ALCANZABLES) {
    assert.equal(perfil(ponderado), esperado, `ponderado ${ponderado}`);
  }
});

test('el recorrido de niveles produce exactamente esos 16 valores y ninguno más', () => {
  // Se recorre como lo hace el motor, incluido su redondeo a 2 decimales.
  const vistos = new Set<number>();
  const maxTolerancia = BANDAS_TOLERANCIA.at(-1)!.valor;
  const maxCapacidad = BANDAS_CAPACIDAD.at(-1)!.valor;

  assert.equal(maxTolerancia, 4, 'la tolerancia llega a nivel 4');
  assert.equal(maxCapacidad, 5, 'la capacidad llega a nivel 5');

  for (let t = 1; t <= maxTolerancia; t++) {
    for (let c = 1; c <= maxCapacidad; c++) {
      const bruta = t * PESO_TOLERANCIA + c * PESO_CAPACIDAD;
      vistos.add(Math.round(bruta * 100) / 100);
    }
  }

  assert.deepEqual(
    [...vistos].sort((a, b) => a - b),
    ALCANZABLES.map(([p]) => p),
  );
});

// ---------------------------------------------------------------------------
// 3 · Dirección y pesos
// ---------------------------------------------------------------------------

test('ponderado más bajo = perfil más agresivo, sin excepciones', () => {
  // PERFILES está documentado «de más a menos riesgo»: el índice nunca puede
  // retroceder cuando el ponderado sube.
  assert.deepEqual([...PERFILES], ['Alto', 'Moderado', 'Bajo', 'Libre de Riesgo']);

  let anterior = -1;
  for (const [ponderado] of ALCANZABLES) {
    const indice = PERFILES.indexOf(perfil(ponderado));
    assert.ok(
      indice >= anterior,
      `ponderado ${ponderado} dio un perfil más agresivo que el anterior`,
    );
    anterior = indice;
  }

  // Y los extremos, explícitos.
  assert.equal(perfil(1.0), 'Alto');
  assert.equal(perfil(4.4), 'Libre de Riesgo');
});

test('la ponderación es 60/40 y suma 1', () => {
  assert.equal(PESO_TOLERANCIA, 0.6);
  assert.equal(PESO_CAPACIDAD, 0.4);
  assert.equal(Math.round((PESO_TOLERANCIA + PESO_CAPACIDAD) * 100) / 100, 1);
});

// ---------------------------------------------------------------------------
// 4 · El redondeo es defensivo, no correctivo
// ---------------------------------------------------------------------------

/**
 * Fija la afirmación del comentario del motor: cuatro de las 20 combinaciones
 * arrastran error de punto flotante, y con las bandas vigentes ninguna cambia de
 * banda por eso. Si un corte futuro cae sobre uno de esos valores, este caso
 * falla y avisa de que quitar el redondeo reclasificaría clientes.
 */
test('las combinaciones con error de punto flotante no cambian de banda', () => {
  const desviadas: Array<{ t: number; c: number; bruta: number }> = [];

  for (let t = 1; t <= 4; t++) {
    for (let c = 1; c <= 5; c++) {
      const bruta = t * PESO_TOLERANCIA + c * PESO_CAPACIDAD;
      if (bruta !== Math.round(bruta * 100) / 100) desviadas.push({ t, c, bruta });
    }
  }

  assert.equal(desviadas.length, 4, 'son cuatro las combinaciones desviadas');

  for (const { t, c, bruta } of desviadas) {
    const redondeado = Math.round(bruta * 100) / 100;
    assert.equal(
      perfil(bruta),
      perfil(redondeado),
      `tolerancia ${t} con capacidad ${c}: el error de punto flotante cambia la banda`,
    );
  }
});
