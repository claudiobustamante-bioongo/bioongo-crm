/**
 * lib/ebr-runner.ts · la EBR de un cliente bloqueado SÍ corre.
 *
 * Decisión de Claudio, 29-sep-2026: el bloqueo frena el IPS y el portafolio,
 * no la evaluación de riesgo. Un cliente con coincidencia CONFIRMADA en una
 * lista de sanciones sale ALTO con alerta crítica de 24 horas, se guarda, y el
 * runner ni siquiera consulta `cliente_bloqueos`: el grado lo decide la
 * coincidencia, que es lo que abrió el bloqueo.
 *
 * El motor ya tiene sus casos por tipo de lista (ebr-engine.test.ts); aquí se
 * fija el camino completo del runner, de las lecturas al INSERT.
 *
 * Datos sintéticos: este archivo se commitea.
 */

import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/bitacora', () => ({ registrarEvento: async () => true }));

import { evaluarYGuardarEBR } from '@/lib/ebr-runner';

type Fila = Record<string, unknown>;

/** Jubilada, expediente completo: sin la coincidencia, sale BAJO. */
const CLIENTE: Fila = {
  nombre: 'Persona',
  apellido_paterno: 'De Prueba',
  apellido_materno: 'Sintetica',
  rfc: 'XAXX010101000',
  curp: 'XAXX010101MDFXXX01',
  fecha_nacimiento: '1960-05-10',
  genero: 'MUJER',
  ocupacion: 'jubilada',
  ocupacion_pb: 'JUBILADO',
  realiza_actividad_vulnerable: false,
  actividades_vulnerables: [],
  actividad_vulnerable_detalle: null,
  actividad_vulnerable_fuente: 'cliente',
  actividad_vulnerable_fecha: '2026-01-15',
  documentos_completos: true,
};

const KYC: Fila = {
  nacionalidad: 'MEXICANA',
  pais_nacimiento: 'MÉXICO',
  entidad_federativa_pb: 'Ciudad de México',
  calle: 'Calle 1',
  numero_exterior: '10',
  colonia: 'Centro',
  municipio: 'Cuauhtémoc',
  estado: 'Ciudad de México',
  codigo_postal: '06000',
};

const PEP: Fila = {
  es_pep_nacional: false,
  es_pep_extranjero: false,
  familiar_pep_nacional: false,
  familiar_pep_extranjero: false,
};

const TRX: Fila = {
  monto_inicial_deposito: 50000,
  depositos_mensuales: 0,
  retiros_mensuales: 0,
  fecha_declaracion: '2026-01-15',
};

function fakeSupabase(coincidencias: Fila[]) {
  const tablas: string[] = [];
  const inserts: { tabla: string; fila: Fila }[] = [];

  const cadena = (tabla: string) => {
    let insertado: Fila | null = null;
    const q = {
      select: () => q,
      eq: () => q,
      in: () => q,
      is: () => q,
      order: () => q,
      limit: () => q,
      insert: (fila: Fila) => {
        insertado = fila;
        inserts.push({ tabla, fila });
        return q;
      },
      maybeSingle: async () => {
        const data: Record<string, Fila | null> = {
          clientes: CLIENTE,
          kyc_detalle: KYC,
          pep_listas: PEP,
          transaccionalidad: TRX,
        };
        if (tabla === 'ebr_evaluaciones') {
          return insertado
            ? { data: { id: 'ebr-1', fecha_evaluacion: '2026-10-05T16:30:00Z' }, error: null }
            : { data: { grado_riesgo: 'BAJO' }, error: null };
        }
        return { data: data[tabla] ?? null, error: null };
      },
      // Las consultas que se esperan sin maybeSingle: listas vigentes y coincidencias.
      then: (resolver: (v: { data: Fila[]; error: null }) => unknown) => {
        const filas: Record<string, Fila[]> = {
          listas_control: [
            { tipo: 'OFAC', fecha_lista: '2026-09-30', fecha_carga: '2026-10-01T12:00:00Z' },
            { tipo: 'PEP_NACIONAL', fecha_lista: '2026-09-30', fecha_carga: '2026-10-01T12:00:00Z' },
          ],
          listas_coincidencias: coincidencias,
        };
        return Promise.resolve({ data: filas[tabla] ?? [], error: null }).then(resolver);
      },
    };
    return q;
  };

  const supabase = {
    from: (t: string) => {
      tablas.push(t);
      return cadena(t);
    },
  } as unknown as SupabaseClient;
  return { supabase, tablas, inserts };
}

test('bloqueado por OFAC confirmada: la EBR corre, sale ALTO con alerta crítica y se guarda', async () => {
  const { supabase, tablas, inserts } = fakeSupabase([{ estado: 'confirmada', lista: { tipo: 'OFAC' } }]);
  const r = await evaluarYGuardarEBR('PRUEBA-001', { supabase, usuario: 'asesor@prueba.test' });

  assert.equal(r.ok, true, r.error);
  assert.equal(r.grado, 'ALTO');
  assert.equal(r.grado_anterior, 'BAJO');

  const guardada = inserts.find((i) => i.tabla === 'ebr_evaluaciones')?.fila;
  assert.ok(guardada, 'la evaluación se guarda aunque el cliente esté bloqueado');
  assert.equal(guardada.grado_riesgo, 'ALTO');
  assert.equal(guardada.en_lista_bloqueadas, true);
  assert.match(String(guardada.alerta_critica), /24 horas/);

  assert.equal(tablas.includes('cliente_bloqueos'), false, 'la EBR no depende de la tabla de bloqueos');
});

test('control: la misma clienta sin la coincidencia sale BAJO', async () => {
  const { supabase } = fakeSupabase([]);
  const r = await evaluarYGuardarEBR('PRUEBA-001', { supabase, usuario: 'asesor@prueba.test' });
  assert.equal(r.ok, true, r.error);
  assert.equal(r.grado, 'BAJO');
});
