/**
 * Alerta «Falta carta de clasificación: atender» en la ficha y en /tabla.
 *
 * Decisión de Claudio, 6-oct-2026: todo cliente debe tener carta; un vigente o
 * inactivo sin clasificación es alerta roja. Bajas y leads no alertan. La regla
 * vive en `requiereAlertaClasificacion` (lib/clasificacion.ts, con sus casos);
 * aquí se fija sobre la fuente que las dos pantallas la usan y no reinventan
 * otra.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sinComentarios = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const TABLA = sinComentarios(readFileSync(new URL('./page.tsx', import.meta.url), 'utf8'));
const FICHA = sinComentarios(readFileSync(new URL('../cliente/[codigo]/page.tsx', import.meta.url), 'utf8'));

test('/tabla trae la clasificación y alerta con la regla compartida', () => {
  assert.match(TABLA, /clasificacion_inversionista'\)/);
  assert.match(TABLA, /filas\.filter\(requiereAlertaClasificacion\)/);
  assert.match(TABLA, /requiereAlertaClasificacion\(fila\)/);
  assert.match(TABLA, /ALERTA_SIN_CLASIFICACION/);
});

test('la ficha alerta con la misma regla y el mismo texto', () => {
  assert.match(FICHA, /requiereAlertaClasificacion\(cliente\) &&/);
  assert.match(FICHA, /\{ALERTA_SIN_CLASIFICACION\}/);
});

test('ninguna de las dos decide por su cuenta qué status alertan', () => {
  for (const fuente of [TABLA, FICHA]) {
    assert.doesNotMatch(fuente, /status === 'inactivo'/);
    assert.doesNotMatch(fuente, /\['vigente', 'inactivo'\]/);
  }
});
