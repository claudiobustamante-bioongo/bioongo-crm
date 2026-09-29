/**
 * lib/ips-runner.ts · la bandera `ajuste_manual`.
 *
 * Existe para que el resumen del lote IPS pueda señalar como REVISIÓN PERSONAL
 * al cliente cuyo `perfil_ajustado` acaba de quedar colgando de un cálculo que
 * ya no existe. El runner la reporta; no la resuelve, porque decidir si un
 * ajuste sobrevive a un recálculo es criterio del Asesor y no del código.
 *
 * Se prueba aquí y no en el arnés de la ruta porque la bandera vive en el
 * resultado del runner y NO en el payload — que es justo lo que el arnés fija.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/bitacora', () => ({ registrarEvento: async () => true }));

import { calcularYGuardarIPS } from '@/lib/ips-runner';

type Fila = Record<string, unknown>;

const CLIENTE: Fila = {
  nombre: 'Persona',
  apellido_paterno: 'De Prueba',
  fecha_nacimiento: '1987-03-15',
  ocupacion: 'Soy Profesionista',
  ingreso_neto_mensual: '50000',
};

const PERFIL: Fila = {
  id: 'perfil-1',
  resultado_perfil: 'Moderado',
  perfil_ajustado: null,
  tolerancia_perdida: 'Posibilidad de Ganar +7% y Perder -3%',
  reaccion_caida_10: 'Mantengo mi Posición',
  negocio_propio: 'No',
  percepcion_riesgo_empleo: 'Tal Vez Trabajar para alguien más',
  prefiere_ingreso_seguro: 'De acuerdo',
  no_puede_perder: 'De acuerdo',
  colchon_liquidez: 'Entre 6 meses y 1 año',
  dependientes: 1,
  situacion_habitacional: 'Casa Propia',
  tiene_ahorros: 'Sí',
  ahorros: '100000',
  hipoteca: '0',
  otras_deudas: '0',
  objetivo_inversion: 'Quiero aprovechar las oportunidades de inversión',
  ganancia_deseada: 'de 5.5% a 7.0% anual',
  horizonte: 'Entre 5 y 10 años',
};

/** Supabase simulado: devuelve las filas dadas y falla el UPDATE si se le pide. */
function fakeSupabase(perfil: Fila, fallarUpdate = false) {
  interface Cadena {
    select: () => Cadena;
    eq: () => Cadena;
    order: () => Cadena;
    limit: () => Cadena;
    update: (v: Fila) => Cadena;
    maybeSingle: () => Promise<{ data: Fila | null; error: null }>;
    then: (r: (v: { error: unknown }) => unknown) => Promise<unknown>;
  }
  const cadena = (tabla: string): Cadena => {
    let esUpdate = false;
    const q: Cadena = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: () => q,
      update: () => {
        esUpdate = true;
        return q;
      },
      maybeSingle: async () => ({ data: tabla === 'clientes' ? CLIENTE : perfil, error: null }),
      then: (r) =>
        Promise.resolve(
          esUpdate && fallarUpdate ? { error: { message: 'fallo simulado' } } : { error: null },
        ).then(r),
    };
    return q;
  };
  return { from: (t: string) => cadena(t) } as unknown as SupabaseClient;
}

const correr = (perfil: Fila, fallarUpdate = false) =>
  calcularYGuardarIPS('PRUEBA-001', {
    supabase: fakeSupabase(perfil, fallarUpdate),
    usuario: 'asesor@prueba.test',
  });

test('sin ajuste manual la bandera es false', async () => {
  const r = await correr(PERFIL);
  assert.equal(r.ok, true);
  assert.equal(r.ajuste_manual, false);
});

test('con perfil_ajustado la bandera es true', async () => {
  const r = await correr({ ...PERFIL, perfil_ajustado: 'Bajo' });
  assert.equal(r.ok, true);
  assert.equal(r.ajuste_manual, true, 'el resumen del lote necesita esta señal');
});

test('la bandera no entra al payload: la respuesta de la ruta no cambia de forma', async () => {
  const r = await correr({ ...PERFIL, perfil_ajustado: 'Bajo' });
  assert.equal(r.ajuste_manual, true);
  assert.ok(r.payload);
  assert.equal((r.payload as Fila).ajuste_manual, undefined);
  assert.equal((r.payload as Fila).perfil_ajustado, undefined);
});

test('si el guardado falla no se señala ajuste colgando: nada se sobrescribió', async () => {
  const r = await correr({ ...PERFIL, perfil_ajustado: 'Bajo' }, true);
  assert.equal(r.ok, false);
  assert.equal(r.codigo_error, 'guardado');
  assert.equal(r.ajuste_manual, undefined);
  // El cálculo sí se devuelve: perder el guardado no debe perder el trabajo.
  assert.ok(r.payload);
});

test('el perfil anterior viaja como grado_anterior para la lista de cambios', async () => {
  const r = await correr(PERFIL);
  assert.equal(r.grado_anterior, 'Moderado');
  assert.ok(['Alto', 'Moderado', 'Bajo', 'Libre de Riesgo'].includes(r.grado as string));
  assert.equal(r.evaluacion_id, 'perfil-1');
  // El IPS no tiene evaluación preliminar: esta lista está vacía a propósito.
  assert.deepEqual(r.campos_faltantes, []);
});
