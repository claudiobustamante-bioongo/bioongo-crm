/**
 * Documentos del expediente: el espejo de los CHECK, la validación del PDF y la
 * ruta del objeto.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  TAMANO_MAXIMO_BYTES,
  TIPOS_DOCUMENTO,
  esPdf,
  estatusErrorDocumento,
  rutaStorage,
  validarDocumento,
  validarFechaDocumento,
} from './documentos';
import { prepararDocumento, sha256Hex } from './documentos-servidor';

const migracion = readFileSync(
  fileURLToPath(new URL('../migraciones/2026-10-14-documentos-expediente.sql', import.meta.url)),
  'utf8',
);

const pdf = (relleno = 'contenido') => new TextEncoder().encode(`%PDF-1.7\n${relleno}\n%%EOF`);
const HOY = '2026-10-15';
const base = { codigo: 'CSPFU9001', tipo: 'identificacion', fecha: '', reemplazaA: '', hoy: HOY };

// ---------------------------------------------------------------------------
// Espejo de la base
// ---------------------------------------------------------------------------

test('TIPOS_DOCUMENTO es el espejo exacto del CHECK documentos_tipo_valido', () => {
  const m = migracion.match(/documentos_tipo_valido check \(tipo in \(([\s\S]*?)\)\)/);
  assert.ok(m, 'el CHECK debe estar en la migración archivada');
  const delCheck = m[1].split(',').map((v) => v.trim().replace(/'/g, ''));
  assert.deepEqual([...TIPOS_DOCUMENTO].sort(), delCheck.sort());
});

test('el tope de 4 MB es el del CHECK documentos_tamano y el del bucket', () => {
  const check = migracion.match(/tamano_bytes between 1 and (\d+)/);
  const bucket = migracion.match(/values \('expediente', 'expediente', false, (\d+),/);
  assert.equal(Number(check?.[1]), TAMANO_MAXIMO_BYTES);
  assert.equal(Number(bucket?.[1]), TAMANO_MAXIMO_BYTES);
});

test('rutaStorage cumple la forma del CHECK documentos_ruta_forma', () => {
  const m = migracion.match(/ruta_storage ~ '([^']+)'/);
  assert.ok(m);
  const forma = new RegExp(m[1]);
  const h = sha256Hex(pdf());
  for (const t of TIPOS_DOCUMENTO) {
    assert.match(rutaStorage(t, 'CSPFU9001', '2026-10-13', h), forma);
    assert.match(rutaStorage(t, 'CSPMU9002', null, h), forma);
  }
  assert.equal(
    rutaStorage('carta_clasificacion', 'CSPFU9001', '2026-10-13', h),
    `carta_clasificacion/CSPFU9001/2026-10-13_${h.slice(0, 12)}.pdf`,
  );
  assert.equal(rutaStorage('contrato', 'CSPFU9001', null, h), `contrato/CSPFU9001/sin-fecha_${h.slice(0, 12)}.pdf`);
});

test('los errores DX de la base se traducen a su 4xx; los demás no', () => {
  assert.equal(estatusErrorDocumento('DX400'), 400);
  assert.equal(estatusErrorDocumento('DX401'), 401);
  assert.equal(estatusErrorDocumento('DX404'), 404);
  assert.equal(estatusErrorDocumento('DX409'), 409);
  assert.equal(estatusErrorDocumento('BL409'), null);
  assert.equal(estatusErrorDocumento('57014'), null);
  assert.equal(estatusErrorDocumento(undefined), null);
});

// ---------------------------------------------------------------------------
// PDF, tamaño, sha256
// ---------------------------------------------------------------------------

test('esPdf mira la firma %PDF-, no el nombre ni el MIME', () => {
  assert.equal(esPdf(pdf()), true);
  assert.equal(esPdf(new TextEncoder().encode('%PDF')), false);
  assert.equal(esPdf(new TextEncoder().encode('<html>%PDF-')), false);
  assert.equal(esPdf(new Uint8Array()), false);
});

test('sha256 contra un vector conocido', () => {
  assert.equal(
    sha256Hex(new TextEncoder().encode('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('4 MB exactos pasan; 4 MB + 1 byte no; vacío no', () => {
  const justo = new Uint8Array(TAMANO_MAXIMO_BYTES);
  justo.set(pdf());
  assert.equal(validarDocumento({ ...base, bytes: justo }).ok, true);
  const demas = new Uint8Array(TAMANO_MAXIMO_BYTES + 1);
  demas.set(pdf());
  assert.equal(validarDocumento({ ...base, bytes: demas }).ok, false);
  assert.equal(validarDocumento({ ...base, bytes: new Uint8Array() }).ok, false);
});

test('un archivo que no es PDF se rechaza aunque diga .pdf', () => {
  const r = validarDocumento({ ...base, bytes: new TextEncoder().encode('no soy un pdf') });
  assert.deepEqual(r, { ok: false, error: 'El archivo no es un PDF.' });
});

// ---------------------------------------------------------------------------
// Fecha
// ---------------------------------------------------------------------------

test('la carta exige fecha; los demás tipos aceptan vacío como «no consta»', () => {
  assert.equal(validarFechaDocumento('', 'carta_clasificacion', HOY).ok, false);
  assert.deepEqual(validarFechaDocumento('', 'identificacion', HOY), { ok: true, fecha: null });
  assert.deepEqual(validarFechaDocumento(null, 'contrato', HOY), { ok: true, fecha: null });
});

for (const [valor, motivo] of [
  ['2026-02-30', 'no existe'],
  ['13/10/2026', 'forma'],
  ['2026-10-16', 'futura'],
] as const) {
  test(`fecha inválida (${motivo}): ${valor}`, () => {
    assert.equal(validarFechaDocumento(valor, 'carta_clasificacion', HOY).ok, false);
  });
}

test('hoy sí es válida, y se recorta', () => {
  assert.deepEqual(validarFechaDocumento(' 2026-10-15 ', 'carta_clasificacion', HOY), {
    ok: true,
    fecha: '2026-10-15',
  });
});

// ---------------------------------------------------------------------------
// Entrada completa
// ---------------------------------------------------------------------------

test('código con forma inválida, tipo inválido o reemplazo que no es uuid: rechazados', () => {
  assert.equal(validarDocumento({ ...base, codigo: 'LEAD-35554', bytes: pdf() }).ok, false);
  assert.equal(validarDocumento({ ...base, tipo: 'pasaporte', bytes: pdf() }).ok, false);
  assert.equal(validarDocumento({ ...base, reemplazaA: 'x', bytes: pdf() }).ok, false);
});

test('el código se normaliza a mayúsculas y sin espacios', () => {
  const r = validarDocumento({ ...base, codigo: ' cspfu9001 ', bytes: pdf() });
  assert.ok(r.ok);
  assert.equal(r.doc.codigo, 'CSPFU9001');
});

test('prepararDocumento: el sha256 lo calcula el servidor y la ruta sale de él', () => {
  const bytes = pdf('carta');
  const r = prepararDocumento({
    ...base,
    tipo: 'carta_clasificacion',
    fecha: '2026-10-13',
    reemplazaA: '0b7c6a52-6f43-4f2c-9a3e-1d2c3b4a5f60',
    bytes,
  });
  assert.ok(r.ok);
  assert.equal(r.doc.sha256, sha256Hex(bytes));
  assert.equal(r.doc.ruta, `carta_clasificacion/CSPFU9001/2026-10-13_${sha256Hex(bytes).slice(0, 12)}.pdf`);
  assert.equal(r.doc.reemplazaA, '0b7c6a52-6f43-4f2c-9a3e-1d2c3b4a5f60');
  assert.equal(r.doc.tamano, bytes.length);
});
