/**
 * Ficha del cliente · la banda de bloqueo y el formulario para levantarlo.
 *
 * No hay entorno de React en los tests: se fija, sobre la fuente, lo que no
 * puede romperse sin que nadie lo note — que la banda sale de la base y que el
 * levantamiento va a la ruta firmada con la regla del asesor.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const leer = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const sinComentarios = (s: string) =>
  s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const FICHA = sinComentarios(leer('./page.tsx'));
const LEVANTAR = sinComentarios(leer('./LevantarBloqueo.tsx'));

test('la ficha lee el bloqueo abierto de cliente_bloqueos, por cliente y sin levantar', () => {
  assert.match(FICHA, /\.from\('cliente_bloqueos'\)/);
  assert.match(FICHA, /\.eq\('codigo_cliente', codigo\)/);
  assert.match(FICHA, /\.is\('levantado_en', null\)/);
});

test('la banda muestra motivo, fecha, quién y coincidencia, y ofrece levantar', () => {
  for (const campo of ['bloqueo.motivo', 'bloqueo.bloqueado_en_cdmx', 'bloqueo.bloqueado_por', 'bloqueo.tipo_match', 'bloqueo.vence_reporte_cdmx']) {
    assert.ok(FICHA.includes(campo), campo);
  }
  assert.match(FICHA, /<LevantarBloqueo bloqueoId=\{bloqueo\.id\} \/>/);
});

test('un error al leer el bloqueo se dice en pantalla, no se pinta como «sin bloqueo»', () => {
  assert.match(FICHA, /errorBloqueo &&/);
});

test('levantar va a /api/levantar-bloqueo con firma y autorización, validada como levantamiento', () => {
  assert.match(LEVANTAR, /fetch\('\/api\/levantar-bloqueo'/);
  assert.match(LEVANTAR, /validarFirma\(firma, \{ levantamiento: true \}\)/);
  for (const llave of ['bloqueo_id:', 'motivo:', 'rol:', 'declaracion:', 'autorizacion_oficial:']) {
    assert.ok(LEVANTAR.includes(llave), llave);
  }
  assert.match(LEVANTAR, /<CamposFirma[\s\S]*levantamiento/);
  assert.doesNotMatch(LEVANTAR, /firmante/);
});

test('tras levantar no se guarda el estado: se refresca y la base manda', () => {
  assert.match(LEVANTAR, /router\.refresh\(\)/);
});
