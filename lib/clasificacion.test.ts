/**
 * lib/clasificacion.ts · catálogo atado a los CHECK de la migración archivada,
 * cómo se describe en la ficha, cuándo alerta y qué puede determinar el asesor.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CODIGOS_CLASIFICACION,
  DETERMINABLES_POR_ASESOR,
  FUENTES_CLASIFICACION,
  describirClasificacion,
  requiereAlertaClasificacion,
  validarDeterminacion,
} from './clasificacion';

const MIGRACION = readFileSync(
  new URL('../migraciones/2026-10-06-clasificacion-inversionista.sql', import.meta.url),
  'utf8',
);
/** Solo lo que se ejecutó, y sin comentarios. */
const EJECUTADO = MIGRACION.slice(MIGRACION.search(/^begin;$/m), MIGRACION.search(/^commit;$/m)).replace(/--.*$/gm, '');

function constraint(nombre: string): string {
  const i = EJECUTADO.indexOf(`add constraint ${nombre}`);
  assert.ok(i >= 0, `falta ${nombre} en la migración`);
  const resto = EJECUTADO.slice(i + 1);
  const fin = resto.search(/add constraint|;/);
  return resto.slice(0, fin);
}
const literales = (s: string) => [...s.matchAll(/'([^']+)'/g)].map((m) => m[1]);

// ---------------------------------------------------------------------------
// Espejo de los CHECK
// ---------------------------------------------------------------------------

test('los cuatro códigos son los del CHECK clientes_clasificacion_valida', () => {
  assert.deepEqual(literales(constraint('clientes_clasificacion_valida')).sort(), [...CODIGOS_CLASIFICACION].sort());
});

test('las dos fuentes son las del CHECK clientes_clasificacion_procedencia', () => {
  assert.deepEqual(literales(constraint('clientes_clasificacion_procedencia')).sort(), [...FUENTES_CLASIFICACION].sort());
});

test('203 no es determinable: el CHECK lo reserva a carta_firmada', () => {
  const check = constraint('clientes_clasificacion_203_solo_por_carta');
  assert.match(check, /'203'/);
  assert.match(check, /'carta_firmada'/);
  assert.equal((DETERMINABLES_POR_ASESOR as readonly string[]).includes('203'), false);
  assert.deepEqual(
    [...DETERMINABLES_POR_ASESOR].sort(),
    CODIGOS_CLASIFICACION.filter((c) => c !== '203').sort(),
  );
});

// ---------------------------------------------------------------------------
// La ficha
// ---------------------------------------------------------------------------

test('sin clasificación: «No determinada», nunca 204', () => {
  const d = describirClasificacion({ clasificacion_inversionista: null });
  assert.equal(d.determinada, false);
  assert.equal(d.etiqueta, 'No determinada');
  assert.doesNotMatch(d.etiqueta, /204/);
});

test('203 por carta: código y nombre, fuente legible, fecha y nota', () => {
  const d = describirClasificacion({
    clasificacion_inversionista: '203',
    clasificacion_fuente: 'carta_firmada',
    clasificacion_fecha: '2026-10-06',
    clasificacion_nota: 'Carta en expediente.',
  });
  assert.deepEqual(d, {
    determinada: true,
    etiqueta: '203 · Sofisticado',
    fuente: 'Carta firmada (Anexo 1 Apartado A)',
    fecha: '2026-10-06',
    nota: 'Carta en expediente.',
  });
});

test('un código fuera del catálogo se pinta tal cual, no se disfraza', () => {
  assert.equal(describirClasificacion({ clasificacion_inversionista: '299' }).etiqueta, '299');
});

// ---------------------------------------------------------------------------
// La alerta
// ---------------------------------------------------------------------------

test('alerta: vigente o inactivo sin clasificación; bajas, leads y clasificados no', () => {
  assert.equal(requiereAlertaClasificacion({ status: 'vigente', clasificacion_inversionista: null }), true);
  assert.equal(requiereAlertaClasificacion({ status: 'inactivo', clasificacion_inversionista: null }), true);
  assert.equal(requiereAlertaClasificacion({ status: 'baja', clasificacion_inversionista: null }), false);
  assert.equal(requiereAlertaClasificacion({ status: 'lead_nuevo', clasificacion_inversionista: null }), false);
  assert.equal(requiereAlertaClasificacion({ status: 'vigente', clasificacion_inversionista: '203' }), false);
  assert.equal(requiereAlertaClasificacion({ status: null, clasificacion_inversionista: null }), false);
});

// ---------------------------------------------------------------------------
// La determinación del asesor
// ---------------------------------------------------------------------------

test('203 se rechaza con su razón: solo viene de carta', () => {
  const r = validarDeterminacion({ clasificacion: '203', nota: 'x' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /carta/);
});

test('fuera de 201/202/204 se rechaza', () => {
  for (const clasificacion of [undefined, '', '205', 204, 'Ninguno']) {
    assert.equal(validarDeterminacion({ clasificacion, nota: 'x' }).ok, false, String(clasificacion));
  }
});

test('sin nota, o nota en blanco, se rechaza', () => {
  for (const nota of [undefined, '', '   ']) {
    assert.equal(validarDeterminacion({ clasificacion: '204', nota }).ok, false);
  }
});

test('201, 202 y 204 con nota pasan, y la nota se recorta', () => {
  for (const c of DETERMINABLES_POR_ASESOR) {
    assert.deepEqual(validarDeterminacion({ clasificacion: c, nota: '  Evidencia.  ' }), {
      ok: true,
      clasificacion: c,
      nota: 'Evidencia.',
    });
  }
});
