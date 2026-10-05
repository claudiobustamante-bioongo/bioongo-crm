/**
 * lib/firma.ts · la parte declarada de una firma y la traducción de errores.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';

import { estatusErrorFirma, validarFirma } from './firma';

test('sin rol, o con un rol inventado: no hay firma', () => {
  for (const rol of [undefined, '', 'admin', 'Oficial', 1]) {
    const r = validarFirma({ rol, declaracion: 'Declaro.' });
    assert.equal(r.ok, false, String(rol));
  }
});

test('sin declaración, o solo espacios: no hay firma', () => {
  for (const declaracion of [undefined, '', '   ', 7]) {
    const r = validarFirma({ rol: 'asesor', declaracion });
    assert.equal(r.ok, false, String(declaracion));
  }
});

test('firma válida: la declaración se recorta y no hay autorización', () => {
  const r = validarFirma({ rol: 'oficial_cumplimiento', declaracion: '  Declaro.  ' });
  assert.deepEqual(r, {
    ok: true,
    firma: { rol: 'oficial_cumplimiento', declaracion: 'Declaro.', autorizacion_oficial: null },
  });
});

test('el firmante del cuerpo nunca entra a la firma: lo pone la base desde la sesión', () => {
  // Así llega un cuerpo JSON real: con lo que el cliente quiera mandar.
  const cuerpo: Record<string, unknown> = { rol: 'asesor', declaracion: 'Declaro.', firmante: 'impostor@prueba.test' };
  const r = validarFirma(cuerpo);
  assert.ok(r.ok);
  assert.deepEqual(Object.keys(r.firma).sort(), ['autorizacion_oficial', 'declaracion', 'rol']);
});

test('fuera del levantamiento, la autorización del Oficial se rechaza', () => {
  const r = validarFirma({ rol: 'asesor', declaracion: 'Declaro.', autorizacion_oficial: 'X' });
  assert.equal(r.ok, false);
});

test('levantamiento por asesor: sin autorización no hay firma', () => {
  for (const autorizacion_oficial of [undefined, '', '   ']) {
    const r = validarFirma(
      { rol: 'asesor', declaracion: 'Declaro.', autorizacion_oficial },
      { levantamiento: true },
    );
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /autorizacion_oficial/);
  }
});

test('levantamiento por asesor con autorización: se recorta y viaja', () => {
  const r = validarFirma(
    { rol: 'asesor', declaracion: 'Declaro.', autorizacion_oficial: ' Oficial X, 05-10-2026, por correo. ' },
    { levantamiento: true },
  );
  assert.ok(r.ok);
  assert.equal(r.firma.autorizacion_oficial, 'Oficial X, 05-10-2026, por correo.');
});

test('levantamiento por el Oficial: la autorización es opcional', () => {
  const sin = validarFirma({ rol: 'oficial_cumplimiento', declaracion: 'Declaro.' }, { levantamiento: true });
  assert.ok(sin.ok);
  assert.equal(sin.firma.autorizacion_oficial, null);
});

test('errores BL4xx de la base → 4xx; cualquier otro código → null (la ruta da 500)', () => {
  assert.equal(estatusErrorFirma('BL400'), 400);
  assert.equal(estatusErrorFirma('BL401'), 401);
  assert.equal(estatusErrorFirma('BL404'), 404);
  assert.equal(estatusErrorFirma('BL409'), 409);
  for (const c of ['23505', '42501', 'BL500', undefined, null, 409]) {
    assert.equal(estatusErrorFirma(c), null, String(c));
  }
});
