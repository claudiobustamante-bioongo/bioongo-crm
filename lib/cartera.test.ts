/**
 * La partición de la cartera para las corridas masivas: las bajas salen del
 * lote y quedan listadas, el resto conserva su orden.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { partirCartera } from './cartera';

test('las bajas salen del lote y quedan listadas; el resto conserva su orden', () => {
  const r = partirCartera([
    { codigo_cliente: 'PRUEBA-A', status: 'vigente' },
    { codigo_cliente: 'PRUEBA-B', status: 'baja' },
    { codigo_cliente: 'PRUEBA-C', status: 'inactivo' },
    { codigo_cliente: 'PRUEBA-D', status: 'lead_nuevo' },
    { codigo_cliente: 'PRUEBA-E', status: 'baja' },
  ]);
  assert.deepEqual(r.codigos, ['PRUEBA-A', 'PRUEBA-C', 'PRUEBA-D']);
  assert.deepEqual(r.excluidos_baja, ['PRUEBA-B', 'PRUEBA-E']);
});

test('un inactivo NO es una baja: sigue entrando al lote', () => {
  const r = partirCartera([{ codigo_cliente: 'PRUEBA-A', status: 'inactivo' }]);
  assert.deepEqual(r.codigos, ['PRUEBA-A']);
  assert.deepEqual(r.excluidos_baja, []);
});

test('status null no se toma por baja', () => {
  const r = partirCartera([{ codigo_cliente: 'PRUEBA-A', status: null }]);
  assert.deepEqual(r.codigos, ['PRUEBA-A']);
  assert.deepEqual(r.excluidos_baja, []);
});

test('sin bajas, la lista de excluidos existe y va vacía', () => {
  const r = partirCartera([]);
  assert.deepEqual(r, { codigos: [], excluidos_baja: [] });
});
