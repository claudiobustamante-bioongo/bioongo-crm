/**
 * Validación de la baja: los dos campos obligatorios, fecha real y no futura.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { hoyCDMX, validarBaja } from './baja';

const HOY = '2026-09-30';

test('con fecha y motivo válidos, pasa y recorta espacios', () => {
  assert.deepEqual(validarBaja({ fecha_baja: ' 2026-09-30 ', motivo_baja: '  cierre  ' }, HOY), {
    ok: true,
    fecha_baja: '2026-09-30',
    motivo_baja: 'cierre',
  });
});

test('sin fecha o sin motivo (o solo espacios): rechazada', () => {
  for (const entrada of [
    { motivo_baja: 'cierre' },
    { fecha_baja: '', motivo_baja: 'cierre' },
    { fecha_baja: HOY },
    { fecha_baja: HOY, motivo_baja: '   ' },
    { fecha_baja: HOY, motivo_baja: 42 },
  ]) {
    const r = validarBaja(entrada, HOY);
    assert.equal(r.ok, false, JSON.stringify(entrada));
  }
});

test('fecha con forma pero inexistente, o en otro formato: rechazada', () => {
  for (const fecha_baja of ['2026-02-30', '30/09/2026', '2026-9-30', '2026-09-30T00:00']) {
    assert.equal(validarBaja({ fecha_baja, motivo_baja: 'x' }, HOY).ok, false, fecha_baja);
  }
});

test('fecha futura: rechazada; una pasada sí se acepta', () => {
  assert.equal(validarBaja({ fecha_baja: '2026-10-01', motivo_baja: 'x' }, HOY).ok, false);
  assert.equal(validarBaja({ fecha_baja: '2025-12-31', motivo_baja: 'x' }, HOY).ok, true);
});

test('hoyCDMX usa la hora de la Ciudad de México, no la UTC', () => {
  // 1-oct 03:00 UTC es todavía 30-sep en CDMX (UTC-6).
  assert.equal(hoyCDMX(new Date('2026-10-01T03:00:00Z')), '2026-09-30');
});
