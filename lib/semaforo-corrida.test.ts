/**
 * compararConPrevio: lo que cambia, cuenta por cuenta, frente a una evaluación ya
 * registrada con otra versión del motor (evaluar.mjs --comparar sí). SINTÉTICO.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { compararConPrevio, type CorridaSemaforo, type EvaluacionPrevia } from './semaforo-corrida';

const fila = (cuenta: string, codigo: string, estado: string, pruebas: [string, string][]) => ({
  cuenta: { cuenta_ibkr: cuenta, codigo_cliente: codigo },
  evaluacion: { estado, hallazgos: pruebas.map(([prueba, severidad]) => ({ prueba, severidad })) },
});
const CORRIDA = {
  sync_id: 's', td: '2026-11-18', version_motor: 'semaforo-1.2.0', conteo: {},
  filas: [
    fila('U90000001', 'CSPFU9001', 'AMBAR', [['P2', 'aviso'], ['LIQUIDEZ_DESFASADA', 'informativo']]),
    fila('U90000002', 'CSPFU9002', 'VERDE', []),
    fila('U90000003', 'CSPFU9003', 'AMBAR', [['SALDO_DEUDOR', 'aviso'], ['P2', 'aviso']]),
    fila('U90000004', 'CSPFU9004', 'VERDE', []),
    fila('U90000005', 'CSPFU9005', 'AMBAR', [['SALDO_DEUDOR', 'aviso']]),
  ],
} as unknown as CorridaSemaforo;
const PREVIAS: EvaluacionPrevia[] = [
  { cuenta_ibkr: 'U90000001', estado: 'VERDE', version_motor: 'semaforo-1.1.0', pruebas: [] },
  { cuenta_ibkr: 'U90000002', estado: 'VERDE', version_motor: 'semaforo-1.1.0', pruebas: [] },
  { cuenta_ibkr: 'U90000003', estado: 'AMBAR', version_motor: 'semaforo-1.1.0', pruebas: ['P2:aviso', 'SALDO_DEUDOR:aviso'] },
  { cuenta_ibkr: 'U90000005', estado: 'AMBAR', version_motor: 'semaforo-1.1.0', pruebas: ['P2:aviso'] },
];

test('compara estado y hallazgos (sin importar el orden); lo igual solo se cuenta; una cuenta sin registro previo es cambio', () => {
  const c = compararConPrevio(CORRIDA, PREVIAS);
  assert.equal(c.version_previa, 'semaforo-1.1.0');
  assert.equal(c.iguales, 2);
  assert.deepEqual(c.cambios, [
    { codigo_cliente: 'CSPFU9001', antes: { estado: 'VERDE', pruebas: [] },
      despues: { estado: 'AMBAR', pruebas: ['LIQUIDEZ_DESFASADA:informativo', 'P2:aviso'] } },
    { codigo_cliente: 'CSPFU9004', antes: null, despues: { estado: 'VERDE', pruebas: [] } },
    // mismo color, otro hallazgo: también es cambio
    { codigo_cliente: 'CSPFU9005', antes: { estado: 'AMBAR', pruebas: ['P2:aviso'] },
      despues: { estado: 'AMBAR', pruebas: ['SALDO_DEUDOR:aviso'] } },
  ]);
  assert.deepEqual(c.conteo_previo, { VERDE: 2, AMBAR: 2 });
});

test('sin evaluación previa: version_previa null', () => {
  assert.equal(compararConPrevio(CORRIDA, []).version_previa, null);
});
