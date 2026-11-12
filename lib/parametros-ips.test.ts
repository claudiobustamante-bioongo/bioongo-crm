/**
 * Espejo entre las constantes del motor de portafolios y lo sembrado en M4
 * (migraciones/2026-11-12-01-parametros-ips.sql), mientras el motor no lea de
 * la base. Solo compara lo que DEBE coincidir hoy: límites por fase, liquidez
 * por perfil y los techos de deuda gubernamental, corporativa y high yield.
 *
 * Diferencias conocidas y aceptadas hasta la sesión de alineación del motor
 * (decisión de Claudio, 12-nov-2026): el tope `rv` del motor (0/30/60/85) frente
 * a ACC_SIC + ACC_BMV y rv_total_max_pct; el tope `tech` (sale del cumplimiento);
 * la duración < 3 de Libre de Riesgo, que el motor no aplica.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { LIMITES_FASE, LIQUIDEZ_PERFIL, TOPES } from './ips-portafolios';

const sql = readFileSync(
  fileURLToPath(new URL('../migraciones/2026-11-12-01-parametros-ips.sql', import.meta.url)),
  'utf8',
);
const PERFILES = ['Libre de Riesgo', 'Bajo', 'Moderado', 'Alto'] as const;

test('LIMITES_FASE del motor = limites_fase sembrado', () => {
  const sembrado = Object.fromEntries(
    [...sql.matchAll(/^\s+\('(\w+)',\s+(\d+), (\d+),\s+(\d+), 'Guía v04 §7\.5\.1'\)/gm)].map((m) => [
      m[1],
      { rvMax: Number(m[2]) / 100, rfMin: Number(m[3]) / 100, liquidezMin: Number(m[4]) / 100 },
    ]),
  );
  assert.equal(Object.keys(sembrado).length, 5);
  assert.deepEqual(sembrado, LIMITES_FASE);
});

test('LIQUIDEZ_PERFIL del motor = reglas_perfil.liquidez_min_pct sembrado', () => {
  const sembrado = Object.fromEntries(
    [...sql.matchAll(/^\s+\('(Libre de Riesgo|Bajo|Moderado|Alto)',\s+(?:\d+|null),\s+(\d+), (?:true|false),/gm)].map(
      (m) => [m[1], Number(m[2]) / 100],
    ),
  );
  assert.deepEqual(sembrado, LIQUIDEZ_PERFIL);
});

test('techos gob, corp y hy del motor = limites_perfil sembrado', () => {
  const fila = (clase: string) => {
    const m = sql.match(new RegExp(`^\\s+\\('${clase}',\\s+(\\d+),\\s+(\\d+),\\s+(\\d+),\\s+(\\d+)\\)`, 'm'));
    assert.ok(m, clase);
    return m.slice(1, 5).map((v) => Number(v) / 100);
  };
  for (const [clave, clase] of [['gob', 'GOB_EXT'], ['gob', 'GOB_MX'], ['corp', 'CORP_IG'], ['hy', 'HIGH_YIELD']] as const) {
    assert.deepEqual(PERFILES.map((p) => TOPES[p][clave]), fila(clase), `${clave} vs ${clase}`);
  }
});
