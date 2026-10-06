/**
 * Ficha del cliente · el renglón de clasificación (R03, campo 6).
 *
 * La lógica vive en lib/clasificacion.ts y se prueba allá. Aquí se fija, sobre
 * la fuente, lo que no puede romperse sin que nadie lo note: que la ficha lee
 * la clasificación de la columna, que «no determinada» se pinta aparte, y que
 * ya no dice que sin carta el cliente es 204.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const FICHA = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const sinComentarios = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const CODIGO = sinComentarios(FICHA);

test('el renglón existe y lee la clasificación de la columna con describirClasificacion', () => {
  assert.match(CODIGO, /Clasificación \(R03, campo 6\)/);
  assert.match(CODIGO, /describirClasificacion\(cliente\)/);
  for (const campo of ['clasificacion.etiqueta', 'clasificacion.fuente', 'clasificacion.fecha', 'clasificacion.nota']) {
    assert.ok(CODIGO.includes(campo), campo);
  }
});

test('«no determinada» se pinta en ámbar y aparte de las determinadas', () => {
  assert.match(CODIGO, /clasificacion\.determinada \? 'border-slate-200' : 'border-amber-300 bg-amber-50'/);
});

test('la ficha ya no dice que sin carta el cliente es 204', () => {
  assert.doesNotMatch(CODIGO, /categoría 204/);
  assert.doesNotMatch(CODIGO, /es categoría 204|es 204, sin importar/);
});
