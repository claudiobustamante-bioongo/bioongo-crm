/**
 * Calendario de NYSE y td de la foto diaria. La lista estática se comprueba
 * contra las reglas de NYSE (Rule 7.2), calculadas aquí de forma independiente.
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CUBIERTO_HASTA, EXTRAORDINARIOS, FERIADOS_NYSE, cubierto, fechaCdmx, feriadoNyse, tdFotoDiaria } from './calendario-nyse';

const iso = (f: Date) => f.toISOString().slice(0, 10);
const d = (a: number, m: number, dia: number) => new Date(Date.UTC(a, m - 1, dia));

/** n-ésimo día de la semana (0 = domingo) del mes; n = -1 para el último. */
function enesimo(a: number, m: number, dow: number, n: number): Date {
  if (n > 0) {
    const f = d(a, m, 1);
    while (f.getUTCDay() !== dow) f.setUTCDate(f.getUTCDate() + 1);
    f.setUTCDate(f.getUTCDate() + 7 * (n - 1));
    return f;
  }
  const f = d(a, m + 1, 0);
  while (f.getUTCDay() !== dow) f.setUTCDate(f.getUTCDate() - 1);
  return f;
}
/** Feriado de fecha fija: sábado → viernes (salvo Año Nuevo, que no se observa); domingo → lunes. */
function observado(f: Date, anoNuevo = false): Date | null {
  const g = new Date(f);
  if (g.getUTCDay() === 6) { if (anoNuevo) return null; g.setUTCDate(g.getUTCDate() - 1); }
  if (g.getUTCDay() === 0) g.setUTCDate(g.getUTCDate() + 1);
  return g;
}
/** Domingo de Pascua (algoritmo anónimo gregoriano). */
function pascua(a: number): Date {
  const A = a % 19, B = Math.floor(a / 100), C = a % 100, D = Math.floor(B / 4), E = B % 4;
  const F = Math.floor((B + 8) / 25), G = Math.floor((B - F + 1) / 3), H = (19 * A + B - D - G + 15) % 30;
  const I = Math.floor(C / 4), K = C % 4, L = (32 + 2 * E + 2 * I - H - K) % 7, M = Math.floor((A + 11 * H + 22 * L) / 451);
  const mes = Math.floor((H + L - 7 * M + 114) / 31), dia = ((H + L - 7 * M + 114) % 31) + 1;
  return d(a, mes, dia);
}
function reglas(a: number): string[] {
  const viernesSanto = pascua(a); viernesSanto.setUTCDate(viernesSanto.getUTCDate() - 2);
  return [observado(d(a, 1, 1), true), enesimo(a, 1, 1, 3), enesimo(a, 2, 1, 3), viernesSanto, enesimo(a, 5, 1, -1),
    observado(d(a, 6, 19)), observado(d(a, 7, 4)), enesimo(a, 9, 1, 1), enesimo(a, 11, 4, 4), observado(d(a, 12, 25))]
    .filter((x): x is Date => x !== null).map(iso);
}

test('la lista de 2026 y 2027 es exactamente la de las reglas de NYSE (más los extraordinarios)', () => {
  const esperado = [...reglas(2026), ...reglas(2027), ...Object.keys(EXTRAORDINARIOS)].sort();
  assert.deepEqual(Object.keys(FERIADOS_NYSE).sort(), esperado);
  for (const f of Object.keys(FERIADOS_NYSE)) assert.ok(![0, 6].includes(new Date(`${f}T00:00:00Z`).getUTCDay()), f);
});

test('26-nov-2026 (Acción de Gracias): el viernes 27 el td es el 26 y es feriado de NYSE', () => {
  assert.equal(tdFotoDiaria('2026-11-27'), '2026-11-26');
  assert.equal(feriadoNyse('2026-11-26'), 'Acción de Gracias');
  assert.equal(feriadoNyse('2026-11-27'), null); // medio día: el mercado abre
});

test('td: el último lunes-viernes antes de hoy; un feriado mexicano no lo cambia', () => {
  assert.equal(tdFotoDiaria('2026-11-23'), '2026-11-20'); // lunes → viernes
  assert.equal(tdFotoDiaria('2026-11-17'), '2026-11-16'); // martes → lunes 16 (Revolución, MX; NYSE abre)
  assert.equal(feriadoNyse('2026-11-16'), null);
  assert.equal(tdFotoDiaria('2026-11-22'), '2026-11-20'); // domingo → viernes
});

test('hoy en CDMX (UTC−6): 12:00 UTC son las 06:00; 05:30 UTC aún es el día anterior', () => {
  assert.equal(fechaCdmx(new Date('2026-11-18T12:00:00Z')), '2026-11-18');
  assert.equal(fechaCdmx(new Date('2026-11-18T05:30:00Z')), '2026-11-17');
});

test('cobertura: después de CUBIERTO_HASTA no se supone nada', () => {
  assert.equal(CUBIERTO_HASTA, '2027-12-31');
  assert.equal(cubierto('2027-12-31'), true);
  assert.equal(cubierto('2028-01-03'), false);
  assert.throws(() => feriadoNyse('26/11/2026'), /forma inválida/);
});
