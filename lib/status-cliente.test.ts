/**
 * Los status de cliente: el espejo del CHECK, el selector de /editar y el
 * payload que esa pantalla envía.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STATUS_CLIENTE, STATUS_EDITABLES, datosParaGuardar } from './status-cliente';

const leer = (ruta: string) =>
  readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');

test('STATUS_CLIENTE es el espejo exacto del CHECK clientes_status_valido', () => {
  const sql = leer('../migraciones/2026-09-30-conciliacion-codigos-r03.sql');
  const m = sql.match(/clientes_status_valido\s+check \(status in \(([^)]*)\)\)/);
  assert.ok(m, 'el CHECK debe estar en la migración archivada');
  const delCheck = m[1].split(',').map((v) => v.trim().replace(/'/g, ''));
  assert.deepEqual([...STATUS_CLIENTE].sort(), delCheck.sort());
});

test('el selector de /editar ofrece todo el CHECK menos baja', () => {
  assert.deepEqual([...STATUS_EDITABLES], ['lead_nuevo', 'vigente', 'inactivo']);
});

test('payload: vacío se guarda como null', () => {
  assert.deepEqual(datosParaGuardar({ ocupacion: '', status: 'vigente' }, 'vigente'), {
    ocupacion: null,
    status: 'vigente',
  });
});

test('payload: con el cliente de baja, status no se envía', () => {
  const datos = datosParaGuardar({ ocupacion: 'x', status: 'vigente' }, 'baja');
  assert.deepEqual(datos, { ocupacion: 'x' });
  assert.equal('status' in datos, false);
});

test('/editar ya no borra clientes y usa el selector', () => {
  const src = leer('../app/cliente/[codigo]/editar/page.tsx');
  assert.equal(/\.delete\(/.test(src), false, 'no debe haber .delete() sobre clientes');
  assert.equal(src.includes('Eliminar cliente'), false, 'no debe quedar el botón');
  assert.ok(src.includes('STATUS_EDITABLES'), 'el status sale de STATUS_EDITABLES');
  assert.ok(src.includes('datosParaGuardar'), 'el payload sale de datosParaGuardar');
});
