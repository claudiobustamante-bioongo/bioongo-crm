/**
 * Casos de prueba del motor EBR · spec §16, más los bordes que la spec señala
 * como fuente de bugs reales.
 *
 * Se corre con vitest:
 *   npm test
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
  ErrorEBR,
  VERIFICACIONES,
  VERIF_SANCIONES,
  evaluarEBR,
  type CotejoListas,
  type EBRInputs,
} from './ebr-engine';

/** Fecha fija para que la edad y `fecha_evaluacion` no dependan del día. */
const AHORA = new Date('2026-09-07T12:00:00Z');

/** Expediente completo y limpio. Cada caso cambia solo lo que le importa. */
function base(sobre: Partial<EBRInputs> = {}): EBRInputs {
  return {
    nombre_completo: 'Cliente De Prueba',
    rfc: 'XAXX010101000',
    curp: 'XAXX010101HDFXXX01',
    fecha_nacimiento: '1970-05-10',
    genero: 'MUJER',
    nacionalidad: 'MEXICANA',
    pais_nacimiento: 'MÉXICO',
    domicilio: 'Calle 1, Colonia Centro',
    entidad_federativa: 'Ciudad de México',
    ocupacion_libre: 'jubilada',
    ocupacion_pb: 'JUBILADO',
    realiza_actividad_vulnerable: false,
    actividades_vulnerables: [],
    // El valor y su procedencia van apareados, igual que en la base.
    actividad_vulnerable_fuente: 'cliente',
    es_pep_nacional_declarado: false,
    es_pep_extranjero_declarado: false,
    familiar_pep_nacional: false,
    familiar_pep_extranjero: false,
    monto_inicial: 50_000,
    operaciones_esperadas_ano: 2,
    fecha_cuestionario: '2026-01-15',
    documentos_completos: true,
    override_lista_bloqueadas: false,
    ...sobre,
  };
}

const activos = (r: ReturnType<typeof evaluarEBR>) =>
  r.supuestos_evaluados.filter((s) => s.activo).length;

// ---------------------------------------------------------------------------
// §16 · los ocho casos de la especificación
// ---------------------------------------------------------------------------

test('1 · Jubilada CDMX → BAJO con cero supuestos', () => {
  const r = evaluarEBR(base(), AHORA);
  assert.equal(r.grado_riesgo, 'BAJO');
  assert.equal(activos(r), 0);
  assert.equal(r.regimen, 'Ordinario');
});

test('2 · Comerciante Jalisco → BAJO con cero supuestos', () => {
  const r = evaluarEBR(
    base({ ocupacion_pb: 'COMERCIANTE O PROFESIONISTA INDEPENDIENTE', entidad_federativa: 'Jalisco' }),
    AHORA,
  );
  assert.equal(r.grado_riesgo, 'BAJO');
  assert.equal(activos(r), 0);
});

test('3 · Arrendadora → BAJO con un supuesto: uno solo no eleva', () => {
  const r = evaluarEBR(
    base({
      ocupacion_pb: 'ARRENDAMIENTO DE INMUEBLES',
      realiza_actividad_vulnerable: true,
      actividades_vulnerables: ['Arrendamiento de inmuebles'],
    }),
    AHORA,
  );
  assert.equal(r.grado_riesgo, 'BAJO');
  assert.equal(activos(r), 1);
  assert.match(r.razon_clasificacion, /Un solo supuesto/);
});

test('4 · Notario PEP → ALTO por concurrencia y requiere aprobación', () => {
  const r = evaluarEBR(
    base({
      ocupacion_pb: 'FE PÚBLICA',
      realiza_actividad_vulnerable: true,
      actividades_vulnerables: ['Fe pública (notarios, corredores)'],
      es_pep_nacional_declarado: true,
    }),
    AHORA,
  );
  assert.equal(r.grado_riesgo, 'ALTO');
  assert.equal(activos(r), 2);
  assert.equal(r.regimen, 'Reforzado');
  assert.equal(r.requiere_aprobacion_oficial, true);
  assert.match(r.razon_clasificacion, /Concurrencia/);
});

test('5 · PEP extranjero → ALTO por regla automática, sin concurrencia', () => {
  const r = evaluarEBR(base({ es_pep_extranjero_declarado: true }), AHORA);
  assert.equal(r.grado_riesgo, 'ALTO');
  assert.equal(r.pep_extranjero, true);
  assert.equal(activos(r), 1); // solo el supuesto 3
  assert.match(r.razon_clasificacion, /Regla automática: PEP extranjero/);
});

test('6 · Match en listas → ALTO automático con alerta crítica', () => {
  const r = evaluarEBR(base({ override_lista_bloqueadas: true }), AHORA);
  assert.equal(r.grado_riesgo, 'ALTO');
  assert.equal(r.en_lista_bloqueadas, true);
  assert.match(r.alerta_critica ?? '', /24 horas/);
  // La coincidencia también sube el factor 6 de la matriz a 16 puntos.
  const factor = r.matriz_factores.find((f) => f.factor.startsWith('LISTA DE PERSONAS'));
  assert.equal(factor?.puntaje, 16);
});

test('7 · Sin documentos → BAJO, cero supuestos, solo preliminar', () => {
  const r = evaluarEBR(base({ ocupacion_pb: 'EMPLEADO PRIVADO', documentos_completos: false }), AHORA);
  assert.equal(r.grado_riesgo, 'BAJO');
  assert.equal(activos(r), 0);
  assert.equal(r.evaluacion_preliminar, true);
  assert.ok(r.motivos_preliminar.includes('Documentación del expediente incompleta.'));
  // El expediente incompleto NO es supuesto y no aparece como tal.
  assert.equal(r.supuestos_evaluados.length, 3);
});

test('8 · Ocupación faltante → error explícito, no default', () => {
  assert.throws(() => evaluarEBR(base({ ocupacion_pb: null }), AHORA), (e: unknown) => {
    assert.ok(e instanceof ErrorEBR);
    assert.match(e.message, /no ha seleccionado su ocupación del catálogo PB/);
    return true;
  });
});

// ---------------------------------------------------------------------------
// Bordes que la spec §3 señala como bugs reales
// ---------------------------------------------------------------------------

test('NULL en actividad vulnerable no es false: marca preliminar y no activa el supuesto', () => {
  const r = evaluarEBR(base({ realiza_actividad_vulnerable: null }), AHORA);
  assert.equal(r.grado_riesgo, 'BAJO');
  assert.equal(activos(r), 0);
  assert.equal(r.evaluacion_preliminar, true);
  assert.ok(r.motivos_preliminar.some((m) => m.includes('actividad vulnerable')));
  const s1 = r.supuestos_evaluados[0];
  assert.equal(s1.activo, false);
  assert.match(s1.detalle, /no formulada/);
});

test('Respondió Sí con arreglo vacío → error explícito', () => {
  assert.throws(
    () => evaluarEBR(base({ realiza_actividad_vulnerable: true, actividades_vulnerables: [] }), AHORA),
    /al menos una actividad vulnerable/,
  );
});

test('Ocupación fuera del catálogo → error, nunca cae a SERVICIOS PROFESIONALES', () => {
  assert.throws(
    () => evaluarEBR(base({ ocupacion_pb: 'ABOGADO LITIGANTE' }), AHORA),
    /Ocupación no reconocida/,
  );
});

test('PEP nacional solo no reclasifica de oficio', () => {
  const r = evaluarEBR(base({ es_pep_nacional_declarado: true }), AHORA);
  assert.equal(r.grado_riesgo, 'BAJO');
  assert.equal(r.es_pep, true);
  assert.equal(r.pep_extranjero, false);
  assert.equal(activos(r), 1);
  // Las medidas del 4.7 aplican con independencia del grado.
  assert.equal(r.aplica_medidas_pep, true);
  assert.equal(r.requiere_aprobacion_oficial, false);
});

test('Familiar de PEP extranjero dispara la regla automática (criterio de la firma)', () => {
  const r = evaluarEBR(base({ familiar_pep_extranjero: true }), AHORA);
  assert.equal(r.grado_riesgo, 'ALTO');
  assert.equal(r.pep_extranjero, true);
});

test('Declaración PEP no capturada no equivale a "no es PEP"', () => {
  const r = evaluarEBR(
    base({
      es_pep_nacional_declarado: null,
      es_pep_extranjero_declarado: null,
      familiar_pep_nacional: null,
      familiar_pep_extranjero: null,
    }),
    AHORA,
  );
  assert.equal(r.grado_riesgo, 'BAJO');
  assert.equal(activos(r), 0);
  assert.ok(r.motivos_preliminar.some((m) => m.includes('declaración PEP')));
  assert.match(r.supuestos_evaluados[2].detalle, /no capturada/);
});

// ---------------------------------------------------------------------------
// Las dos capas
// ---------------------------------------------------------------------------

test('La matriz no toca el grado: puntaje alto sigue siendo BAJO', () => {
  const r = evaluarEBR(
    base({
      genero: 'HOMBRE',
      fecha_nacimiento: '2000-01-01', // 18-35, 8 pts
      entidad_federativa: 'Guerrero', // 12 pts
      ocupacion_pb: 'EMPLEADO PÚBLICO', // 12 pts
      monto_inicial: 500_000, // 8 pts
      operaciones_esperadas_ano: 24, // 6 + 8 pts
    }),
    AHORA,
  );
  assert.ok(r.matriz_puntaje_total >= 75, `puntaje ${r.matriz_puntaje_total}`);
  assert.equal(r.grado_riesgo, 'BAJO');
  assert.equal(activos(r), 0);
  assert.match(r.matriz_valoracion_referencial, /no determina el grado/);
});

test('El total de la matriz se mantiene dentro del rango 43-130', () => {
  const r = evaluarEBR(base(), AHORA);
  assert.ok(r.matriz_puntaje_total >= 43 && r.matriz_puntaje_total <= 130);
  assert.equal(r.matriz_factores.length, 15);
  const suma = r.matriz_factores.reduce((s, f) => s + f.puntaje, 0);
  assert.equal(suma, r.matriz_puntaje_total);
  for (const f of r.matriz_factores) {
    assert.equal(f.probabilidad * f.impacto, f.puntaje, `${f.factor} no cuadra`);
  }
});

// ---------------------------------------------------------------------------
// Normalización de entrada · spec §4
// ---------------------------------------------------------------------------

test('MEXICO sin acento puntúa igual que MÉXICO', () => {
  const conAcento = evaluarEBR(base({ pais_nacimiento: 'MÉXICO' }), AHORA);
  const sinAcento = evaluarEBR(base({ pais_nacimiento: 'MEXICO' }), AHORA);
  assert.equal(sinAcento.matriz_puntaje_total, conAcento.matriz_puntaje_total);
});

test('GUATEMALA bien escrita encuentra la llave con errata del catálogo', () => {
  const r = evaluarEBR(base({ pais_nacimiento: 'GUATEMALA' }), AHORA);
  const factor = r.matriz_factores.find((f) => f.factor === 'PAÍS DE NACIMIENTO');
  assert.equal(factor?.puntaje, 8, 'debe dar 8, no el default de 2');
});

test('Entidad no reconocida usa el default 6 y lo deja asentado', () => {
  const r = evaluarEBR(base({ entidad_federativa: 'CDMX' }), AHORA);
  const factor = r.matriz_factores.find((f) => f.factor.startsWith('ENTIDAD'));
  assert.equal(factor?.puntaje, 6);
  assert.ok(r.observaciones.some((o) => o.factor.startsWith('ENTIDAD')));
  assert.equal(r.evaluacion_preliminar, true);
});

test('Dato ausente se imputa hacia arriba y queda registrado', () => {
  const r = evaluarEBR(base({ genero: null, monto_inicial: null }), AHORA);
  const genero = r.matriz_factores.find((f) => f.factor === 'GÉNERO');
  const monto = r.matriz_factores.find((f) => f.factor === 'VOLUMEN EN MONTO');
  assert.equal(genero?.puntaje, 9, 'HOMBRE es la opción de mayor puntaje');
  assert.equal(monto?.puntaje, 8, 'más de 100 mil es la banda de mayor puntaje');
  assert.equal(r.observaciones.filter((o) => o.factor === 'GÉNERO').length, 1);
  assert.equal(r.evaluacion_preliminar, true);
});

test('Corea del Sur activa el Supuesto 2 y asienta la discrepancia con el GAFI', () => {
  const r = evaluarEBR(base({ pais_nacimiento: 'COREA DEL SUR' }), AHORA);
  assert.equal(r.supuestos_evaluados[1].activo, true);
  assert.ok(r.observaciones.some((o) => o.factor === 'SUPUESTO 2' && /GAFI/.test(o.nota)));
  assert.equal(r.grado_riesgo, 'BAJO'); // un supuesto no basta
});

// ---------------------------------------------------------------------------
// Presentación · el expediente lo lee un supervisor
// ---------------------------------------------------------------------------

test('Las opciones se imprimen con acentos, no con la llave normalizada', () => {
  const r = evaluarEBR(base({ ocupacion_pb: 'EMPLEADO PÚBLICO', fecha_nacimiento: '1960-01-01' }), AHORA);
  const texto = r.matriz_factores.map((f) => f.opcion_seleccionada).join(' | ');

  // La normalización quita la tilde de la ñ: «ANOS» nunca debe llegar al reporte.
  assert.doesNotMatch(texto, /\bANOS\b/, `ñ perdida en: ${texto}`);
  assert.doesNotMatch(texto, /PERSONA FISICA/);
  assert.doesNotMatch(texto, /EMPLEADO PUBLICO/);

  const edad = r.matriz_factores.find((f) => f.factor === 'EDAD');
  assert.equal(edad?.opcion_seleccionada, 'MÁS DE 50 AÑOS');

  const ocupacion = r.matriz_factores.find((f) => f.factor === 'ACTIVIDAD ECONÓMICA');
  assert.equal(ocupacion?.opcion_seleccionada, 'EMPLEADO PÚBLICO');
});

test('La entidad se imprime como se capturó, con acentos', () => {
  const r = evaluarEBR(base({ entidad_federativa: 'Ciudad de México' }), AHORA);
  const entidad = r.matriz_factores.find((f) => f.factor.startsWith('ENTIDAD'));
  assert.equal(entidad?.opcion_seleccionada, 'CIUDAD DE MÉXICO');
  assert.equal(entidad?.puntaje, 9);
});

test('País de nacimiento ausente y no reconocido dan motivos preliminares distintos', () => {
  // Los dos huecos caen al mismo default de la matriz, pero se corrigen
  // distinto: uno se captura y el otro se investiga contra el catálogo. El
  // motivo preliminar es lo que el revisor lee primero, y llegó a decir
  // «no reconocido en el catálogo» cuando el campo venía vacío.
  const sinDato = evaluarEBR(base({ pais_nacimiento: null }), AHORA);
  const raro = evaluarEBR(base({ pais_nacimiento: 'Wakanda' }), AHORA);

  // El motivo que emite la matriz. El campo vacío produce además otro por el
  // Supuesto 2; ese se comprueba en el test siguiente.
  const motivoMatriz = (r: ReturnType<typeof evaluarEBR>) =>
    r.motivos_preliminar.filter((m) => /matriz/i.test(m));

  // Un motivo de matriz por cada gap, no dos textos para el mismo hecho.
  assert.equal(motivoMatriz(sinDato).length, 1);
  assert.equal(motivoMatriz(raro).length, 1);

  assert.match(motivoMatriz(sinDato)[0], /no se capturó/i);
  assert.doesNotMatch(
    motivoMatriz(sinDato)[0],
    /no reconocido/i,
    'un campo vacío no es un valor que el catálogo desconozca',
  );

  assert.match(motivoMatriz(raro)[0], /no reconocido/i);
  assert.match(motivoMatriz(raro)[0], /Wakanda/, 'el motivo nombra el valor que se rechazó');

  // La observación ya distinguía las dos ramas: no se rompe al arreglar el motivo.
  const obs = (r: ReturnType<typeof evaluarEBR>) =>
    r.observaciones.find((o) => o.factor === 'PAÍS DE NACIMIENTO')?.nota ?? '';
  assert.match(obs(sinDato), /dato ausente/);
  assert.match(obs(raro), /«Wakanda» no está en el catálogo/);

  // Y el default de la spec §10 sigue aplicándose igual en ambos casos.
  for (const r of [sinDato, raro]) {
    const f = r.matriz_factores.find((x) => x.factor === 'PAÍS DE NACIMIENTO');
    assert.equal(f?.puntaje, 2);
    assert.equal(r.evaluacion_preliminar, true);
  }
});

test('El país ausente no se confunde con el motivo que emite el Supuesto 2', () => {
  // Un solo campo vacío produce dos consecuencias distintas —la matriz imputa,
  // el Supuesto 2 queda sin evaluar— y cada una asienta su propio motivo. Que
  // sean dos es correcto; que digan lo mismo, no.
  const r = evaluarEBR(base({ pais_nacimiento: null }), AHORA);
  const motivos = r.motivos_preliminar.filter((m) => /país de nacimiento/i.test(m));

  assert.equal(motivos.length, 2);
  assert.equal(new Set(motivos).size, 2, 'los dos motivos no pueden ser el mismo texto');
  assert.ok(motivos.some((m) => /matriz/i.test(m)));
  assert.ok(motivos.some((m) => /Anexo 2/.test(m)));

  // El supuesto queda inactivo por no evaluable, no por descartado.
  assert.equal(r.supuestos_evaluados[1].activo, false);
  assert.match(r.supuestos_evaluados[1].detalle, /no evaluable/i);
});

// ---------------------------------------------------------------------------
// Cotejo contra listas de control
// ---------------------------------------------------------------------------
//
// El motor no consulta la base: recibe el estado del cotejo ya armado. Lo que
// se prueba aquí es que el esfuerzo real conste, que la búsqueda de sanciones
// solo la cierre una lista de sanciones, y que la Lista de Personas Bloqueadas
// haya dejado de bloquear la evaluación sin haber dejado de ser cotejable.

/** La única verificación de listas que queda. Se toma por nombre, no por índice. */
const VERIF_ONU_OFAC = VERIF_SANCIONES;

test('listas · la LPB ya no figura entre las verificaciones exigibles', () => {
  // Regresión del 9 de septiembre de 2026: las Disposiciones del art. 226 Bis
  // LMV no contemplan el capítulo de Lista de Personas Bloqueadas para los
  // asesores en inversiones. Mientras figuró aquí, TODA evaluación salía
  // preliminar por una verificación que no se podía completar nunca.
  assert.equal(
    VERIFICACIONES.some((v) => /Personas Bloqueadas/.test(v)),
    false
  );
  assert.equal(VERIFICACIONES.length, 6);
  assert.ok(VERIFICACIONES.includes(VERIF_SANCIONES));
});

function cotejo(sobre: Partial<CotejoListas> = {}): CotejoListas {
  return {
    listas: [
      { tipo: 'OFAC', fecha_lista: '2026-08-31', fecha_cotejo: '2026-09-09' },
      { tipo: 'SAT_69B', fecha_lista: '2026-07-31', fecha_cotejo: '2026-09-09' },
    ],
    coincidencias_pendientes: 0,
    coincidencias_confirmadas: 0,
    ...sobre,
  };
}

/** Sin override manual: es lo que obliga al motor a mirar el cotejo. */
function sinOverride(sobre: Partial<EBRInputs> = {}): EBRInputs {
  return base({ override_lista_bloqueadas: undefined, ...sobre });
}

test('listas · sin ninguna lista cargada, no consta la búsqueda en sanciones', () => {
  const MOTIVO =
    'No consta la búsqueda en las listas del Consejo de Seguridad de la ONU ni en las de ' +
    'sanciones internacionales (OFAC).';

  const sinNada = evaluarEBR(sinOverride(), AHORA);
  assert.ok(sinNada.motivos_preliminar.includes(MOTIVO));
  assert.equal(sinNada.override_source, 'automatic');

  // Un cotejo con cero listas vigentes es la misma situación, no una distinta.
  const vacio = evaluarEBR(sinOverride({ cotejo_listas: cotejo({ listas: [] }) }), AHORA);
  assert.ok(vacio.motivos_preliminar.includes(MOTIVO));

  for (const r of [sinNada, vacio]) {
    assert.ok(r.verificaciones_pendientes.includes(VERIF_ONU_OFAC));
    // Ya no se reclama una búsqueda en la LPB que nadie tiene que hacer.
    assert.equal(
      r.motivos_preliminar.some((m) => /Personas Bloqueadas/.test(m)),
      false
    );
  }
});

test('listas · OFAC y SAT 69-B limpios: cierran la búsqueda y constan como debida diligencia', () => {
  const r = evaluarEBR(sinOverride({ cotejo_listas: cotejo() }), AHORA);

  // LO CENTRAL DEL CAMBIO: el cotejo limpio contra OFAC ya no deja NINGÚN
  // motivo preliminar. Mientras la LPB fue obligación, aquí quedaba uno que
  // decía «NO sustituye la búsqueda en la Lista de Personas Bloqueadas», y era
  // un motivo que ningún expediente podía cerrar.
  assert.equal(
    r.motivos_preliminar.some((m) => /Cotejo ejecutado|Personas Bloqueadas/.test(m)),
    false
  );

  // Pero el esfuerzo consta: baja a observaciones con su fundamento.
  const obs = r.observaciones.find((o) => o.factor === 'LISTAS DE CONTROL');
  assert.ok(obs, 'el cotejo ejecutado tiene que constar en el expediente');
  assert.match(obs.nota, /OFAC \(corte 2026-08-31\)/);
  assert.match(obs.nota, /SAT 69-B \(corte 2026-07-31\)/);
  assert.match(obs.nota, /2026-09-09/);
  assert.match(obs.nota, /debida diligencia reforzada/);
  assert.match(obs.nota, /Capítulo II Bis/);
  assert.match(obs.nota, /226 Bis/);

  // OFAC cierra la búsqueda de sanciones. El 69-B no la habría cerrado solo.
  assert.equal(r.verificaciones_pendientes.includes(VERIF_ONU_OFAC), false);

  assert.equal(r.en_lista_bloqueadas, false);
  assert.equal(r.alerta_critica, null);
  assert.equal(r.grado_riesgo, 'BAJO');
  assert.equal(r.override_source, 'listas_csv_manual');
});

test('listas · el SAT 69-B solo no cierra la búsqueda de sanciones: es materia fiscal', () => {
  const r = evaluarEBR(
    sinOverride({
      cotejo_listas: cotejo({
        listas: [{ tipo: 'SAT_69B', fecha_lista: '2026-07-31', fecha_cotejo: '2026-09-09' }],
      }),
    }),
    AHORA
  );

  // Aquí SÍ queda motivo preliminar, y es uno que se puede cerrar cargando
  // OFAC: es la diferencia con el que se retiró.
  const motivo = r.motivos_preliminar.find((m) => /Cotejo ejecutado/.test(m));
  assert.ok(motivo);
  assert.match(motivo, /ninguna de esas listas es de sanciones/);
  assert.match(motivo, /debida diligencia reforzada/);
  assert.match(motivo, /Capítulo II Bis/);

  assert.ok(r.verificaciones_pendientes.includes(VERIF_ONU_OFAC));
});

test('listas · la LPB sigue siendo cotejable, pero ya no cierra ninguna verificación', () => {
  // La capacidad técnica se conserva a propósito: el régimen de SOFOM E.N.R. sí
  // contempla la Lista de Personas Bloqueadas y este módulo se reusa ahí.
  const r = evaluarEBR(
    sinOverride({
      cotejo_listas: cotejo({
        listas: [{ tipo: 'LPB', fecha_lista: '2026-09-01', fecha_cotejo: '2026-09-09' }],
      }),
    }),
    AHORA
  );

  // Cuenta como cotejo de sanciones —es una lista de bloqueo— y por eso consta
  // como debida diligencia y no como «no consta la búsqueda».
  const obs = r.observaciones.find((o) => o.factor === 'LISTAS DE CONTROL');
  assert.ok(obs);
  assert.match(obs.nota, /Lista de Personas Bloqueadas \(corte 2026-09-01\)/);

  // Pero NO cubre la de ONU/OFAC, que es la que quedó viva.
  assert.ok(r.verificaciones_pendientes.includes(VERIF_ONU_OFAC));
  assert.equal(r.en_lista_bloqueadas, false);
});

test('listas · coincidencia CONFIRMADA: ALTO automático y alerta del 10.10', () => {
  const r = evaluarEBR(
    sinOverride({
      cotejo_listas: cotejo({
        listas: [{ tipo: 'LPB', fecha_lista: '2026-09-01', fecha_cotejo: '2026-09-09' }],
        coincidencias_confirmadas: 1,
      }),
    }),
    AHORA
  );

  assert.equal(r.en_lista_bloqueadas, true);
  assert.equal(r.grado_riesgo, 'ALTO');
  assert.equal(r.regimen, 'Reforzado');
  // La razón no afirma DE CUÁL lista salió el match: el motor recibe conteos,
  // no tipos. Decir «Lista de Personas Bloqueadas» sobre una coincidencia de
  // OFAC sería asentar en el expediente algo que no consta.
  assert.match(r.razon_clasificacion, /coincidencia confirmada/i);
  assert.ok(r.alerta_critica);
  assert.match(r.alerta_critica, /24 horas/);
});

test('listas · coincidencia PENDIENTE: preliminar, pero sin suspender a nadie', () => {
  // Una pendiente puede ser un homónimo. Elevar el grado por ella suspendería
  // las operaciones de alguien que quizá solo comparte apellido; darla por
  // limpia escondería un match sin revisar. Ni una cosa ni la otra.
  const r = evaluarEBR(
    sinOverride({ cotejo_listas: cotejo({ coincidencias_pendientes: 2 }) }),
    AHORA
  );

  assert.equal(r.en_lista_bloqueadas, false);
  assert.equal(r.grado_riesgo, 'BAJO');
  assert.equal(r.alerta_critica, null);

  const motivo = r.motivos_preliminar.find((m) => /PENDIENTE/.test(m));
  assert.ok(motivo, 'la pendiente tiene que constar');
  assert.match(motivo, /2 coincidencia/);
  assert.match(motivo, /homónimo/);

  assert.equal(r.evaluacion_preliminar, true);
  // Sin resolver el match, la búsqueda no puede darse por concluida.
  assert.ok(r.verificaciones_pendientes.includes(VERIF_ONU_OFAC));
});

test('listas · retirar la LPB no pone en verde un expediente con huecos', () => {
  // Advertencia asentada como prueba: de los motivos de preliminaridad, la LPB
  // era UNO. Quedan la declaración del Art. 17 sin formular, la documentación
  // incompleta y las cuatro verificaciones que no tienen dónde registrarse.
  const r = evaluarEBR(
    sinOverride({
      cotejo_listas: cotejo(),
      realiza_actividad_vulnerable: null,
      documentos_completos: false,
    }),
    AHORA
  );

  assert.equal(r.evaluacion_preliminar, true);
  assert.ok(
    r.motivos_preliminar.some((m) => /actividad vulnerable \(Art\. 17\)/.test(m)),
    'el hueco del Art. 17 sigue vivo'
  );
  assert.ok(r.motivos_preliminar.some((m) => /Documentación del expediente incompleta/.test(m)));
  assert.ok(r.motivos_preliminar.some((m) => /verificaciones sin ejecutar/.test(m)));
  // Y ninguno de los que quedan es por la Lista de Personas Bloqueadas.
  assert.equal(
    r.motivos_preliminar.some((m) => /Personas Bloqueadas/.test(m)),
    false
  );
});

// ---------------------------------------------------------------------------
// Art. 17 · procedencia de la respuesta (cliente / asesor / sin registrar)
// ---------------------------------------------------------------------------
//
// La cartera entera tenía `realiza_actividad_vulnerable` en null y eso mantenía
// a los 28 expedientes en preliminar. La salida NO fue fingir una declaración
// que el Cliente nunca dio: fue registrar la determinación del Asesor COMO
// determinación del Asesor. Lo que estos casos fijan es que las dos cosas no se
// puedan volver a confundir en el texto del expediente.

const MOTIVO_ART17 = 'No consta la declaración de actividad vulnerable (Art. 17).';

test('Art. 17 · la determinación del Asesor cierra el motivo preliminar', () => {
  const conHueco = evaluarEBR(
    base({ realiza_actividad_vulnerable: null, actividad_vulnerable_fuente: null }),
    AHORA
  );
  assert.ok(conHueco.motivos_preliminar.includes(MOTIVO_ART17));

  const determinado = evaluarEBR(
    base({
      realiza_actividad_vulnerable: false,
      actividad_vulnerable_fuente: 'asesor',
      actividad_vulnerable_fecha: '2026-09-10',
    }),
    AHORA
  );

  assert.equal(determinado.motivos_preliminar.includes(MOTIVO_ART17), false);
  // Cerrado el motivo, pero NO en silencio: consta que falta la ratificación.
  const obs = determinado.observaciones.find((o) => o.factor === 'SUPUESTO 1');
  assert.ok(obs, 'la determinación del Asesor tiene que dejar constancia');
  assert.match(obs.nota, /pendiente de ratificación/i);
  assert.match(obs.nota, /2026-09-10/);
});

test('Art. 17 · el texto distingue determinación del Asesor de declaración del Cliente', () => {
  const porAsesor = evaluarEBR(
    base({
      realiza_actividad_vulnerable: false,
      actividad_vulnerable_fuente: 'asesor',
      actividad_vulnerable_fecha: '2026-09-10',
    }),
    AHORA
  );
  const porCliente = evaluarEBR(
    base({ realiza_actividad_vulnerable: false, actividad_vulnerable_fuente: 'cliente' }),
    AHORA
  );

  // LO CENTRAL: el expediente NUNCA puede decir que el Cliente declaró algo que
  // el Cliente no declaró. Una determinación presentada como declaración es una
  // declaración inventada.
  assert.match(porAsesor.supuestos_evaluados[0].detalle, /Determinación del Asesor en Inversiones/);
  assert.equal(/declara/i.test(porAsesor.supuestos_evaluados[0].detalle), false);

  // Y al revés: con procedencia 'cliente' el texto queda exactamente como estaba.
  assert.equal(
    porCliente.supuestos_evaluados[0].detalle,
    'El cliente declara no realizar actividades vulnerables.'
  );

  // El SÍ determinado por el Asesor tampoco se disfraza de declaración.
  const siPorAsesor = evaluarEBR(
    base({
      realiza_actividad_vulnerable: true,
      actividades_vulnerables: ['Mutuo, préstamo o crédito'],
      actividad_vulnerable_fuente: 'asesor',
    }),
    AHORA
  );
  assert.match(siPorAsesor.supuestos_evaluados[0].detalle, /Determinación del Asesor/);
  assert.equal(siPorAsesor.supuestos_evaluados[0].activo, true);
});

test('Art. 17 · null sigue siendo hueco, con procedencia o sin ella', () => {
  for (const fuente of [null, 'cliente', 'asesor'] as const) {
    const r = evaluarEBR(
      base({ realiza_actividad_vulnerable: null, actividad_vulnerable_fuente: fuente }),
      AHORA
    );
    assert.ok(r.motivos_preliminar.includes(MOTIVO_ART17), `fuente ${fuente}`);
    assert.equal(r.supuestos_evaluados[0].activo, false);
    assert.match(r.supuestos_evaluados[0].detalle, /no evaluable/i);
  }
});

test('Art. 17 · un valor sin procedencia no se atribuye a nadie', () => {
  // La base lo impide con un CHECK sobre las dos columnas. Si llega igual, el
  // motor no elige un texto: ni «declara» ni «determinó».
  const negativo = evaluarEBR(
    base({ realiza_actividad_vulnerable: false, actividad_vulnerable_fuente: null }),
    AHORA
  );
  assert.equal(/declara|Determinación/i.test(negativo.supuestos_evaluados[0].detalle), false);
  assert.ok(negativo.motivos_preliminar.some((m) => /sin procedencia|no tiene procedencia/i.test(m)));
  assert.equal(negativo.supuestos_evaluados[0].activo, false);

  // Un SÍ sin procedencia SÍ activa el supuesto: en PLD un dato que agrava no
  // se descarta por venir mal documentado.
  const afirmativo = evaluarEBR(
    base({
      realiza_actividad_vulnerable: true,
      actividades_vulnerables: ['Mutuo, préstamo o crédito'],
      actividad_vulnerable_fuente: null,
    }),
    AHORA
  );
  assert.equal(afirmativo.supuestos_evaluados[0].activo, true);
});

test('Art. 17 · cerrar el motivo no mueve el grado ni el puntaje', () => {
  // El compromiso de la corrida masiva: esto cierra un motivo de preliminaridad
  // y NO toca la matriz ni la regla del §4.6. Si esta prueba falla, la próxima
  // masiva reclasificaría expedientes por un cambio que no era de metodología.
  const antes = evaluarEBR(
    base({ realiza_actividad_vulnerable: null, actividad_vulnerable_fuente: null }),
    AHORA
  );
  const despues = evaluarEBR(
    base({
      realiza_actividad_vulnerable: false,
      actividad_vulnerable_fuente: 'asesor',
      actividad_vulnerable_fecha: '2026-09-10',
    }),
    AHORA
  );

  assert.equal(despues.grado_riesgo, antes.grado_riesgo);
  assert.equal(despues.regimen, antes.regimen);
  assert.equal(despues.matriz_puntaje_total, antes.matriz_puntaje_total);
  assert.equal(despues.matriz_banda, antes.matriz_banda);
  assert.deepEqual(
    despues.matriz_factores.map((f) => f.puntaje),
    antes.matriz_factores.map((f) => f.puntaje)
  );
  // Lo único que cambia es que sobra un motivo.
  assert.equal(despues.motivos_preliminar.length, antes.motivos_preliminar.length - 1);
});
