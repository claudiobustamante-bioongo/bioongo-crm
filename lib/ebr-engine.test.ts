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
// se prueba aquí es que el esfuerzo real conste SIN dar por cumplida la
// obligación del apartado III.10, que solo cierra la Lista de Personas
// Bloqueadas de la SHCP.

/** La verificación 0 es la de la LPB; la 1, la de ONU/OFAC. */
const VERIF_LPB = VERIFICACIONES[0];
const VERIF_ONU_OFAC = VERIFICACIONES[1];

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

test('listas · sin ninguna lista cargada, el motivo queda exactamente como estaba', () => {
  // Requisito explícito: si no hay nada cargado, no se inventa un texto nuevo.
  const sinNada = evaluarEBR(sinOverride(), AHORA);
  assert.ok(
    sinNada.motivos_preliminar.includes(
      'No consta la búsqueda en listas de personas bloqueadas (SHCP/ONU/OFAC).'
    )
  );
  assert.equal(sinNada.override_source, 'automatic');

  // Un cotejo con cero listas vigentes es la misma situación, no una distinta.
  const vacio = evaluarEBR(sinOverride({ cotejo_listas: cotejo({ listas: [] }) }), AHORA);
  assert.ok(
    vacio.motivos_preliminar.includes(
      'No consta la búsqueda en listas de personas bloqueadas (SHCP/ONU/OFAC).'
    )
  );

  // Y las dos búsquedas siguen pendientes en ambos casos.
  for (const r of [sinNada, vacio]) {
    assert.ok(r.verificaciones_pendientes.includes(VERIF_LPB));
    assert.ok(r.verificaciones_pendientes.includes(VERIF_ONU_OFAC));
  }
});

test('listas · OFAC y SAT 69-B limpios: consta el cotejo, la LPB sigue pendiente', () => {
  const r = evaluarEBR(sinOverride({ cotejo_listas: cotejo() }), AHORA);

  // Ya no dice que no consta la búsqueda: se hizo, y se dice contra qué.
  assert.equal(
    r.motivos_preliminar.includes(
      'No consta la búsqueda en listas de personas bloqueadas (SHCP/ONU/OFAC).'
    ),
    false
  );

  const motivo = r.motivos_preliminar.find((m) => /Cotejo ejecutado/.test(m));
  assert.ok(motivo, 'debe constar el cotejo ejecutado');
  assert.match(motivo, /OFAC \(corte 2026-08-31\)/);
  assert.match(motivo, /SAT 69-B \(corte 2026-07-31\)/);
  assert.match(motivo, /2026-09-09/);
  assert.match(motivo, /NO sustituye/);
  assert.match(motivo, /Lista de Personas Bloqueadas/);

  // LO CENTRAL: OFAC cierra su verificación, la de la LPB NO. Con un solo
  // booleano para las dos, esta aserción fallaría y la obligación del III.10
  // se daría por cumplida sin haberse ejecutado.
  assert.ok(r.verificaciones_pendientes.includes(VERIF_LPB));
  assert.equal(r.verificaciones_pendientes.includes(VERIF_ONU_OFAC), false);

  assert.equal(r.en_lista_bloqueadas, false);
  assert.equal(r.alerta_critica, null);
  assert.equal(r.grado_riesgo, 'BAJO');
  assert.equal(r.override_source, 'listas_csv_manual');
});

test('listas · el SAT 69-B solo no cierra ninguna búsqueda: es materia fiscal', () => {
  const r = evaluarEBR(
    sinOverride({
      cotejo_listas: cotejo({
        listas: [{ tipo: 'SAT_69B', fecha_lista: '2026-07-31', fecha_cotejo: '2026-09-09' }],
      }),
    }),
    AHORA
  );

  const motivo = r.motivos_preliminar.find((m) => /Cotejo ejecutado/.test(m));
  assert.ok(motivo);
  assert.match(motivo, /Ninguna de ellas es lista de sanciones/);

  // Ninguna de las dos se cierra: el 69-B no es lista de sanciones.
  assert.ok(r.verificaciones_pendientes.includes(VERIF_LPB));
  assert.ok(r.verificaciones_pendientes.includes(VERIF_ONU_OFAC));
});

test('listas · la LPB limpia sí cierra su verificación y no deja motivo', () => {
  const r = evaluarEBR(
    sinOverride({
      cotejo_listas: cotejo({
        listas: [{ tipo: 'LPB', fecha_lista: '2026-09-01', fecha_cotejo: '2026-09-09' }],
      }),
    }),
    AHORA
  );

  assert.equal(r.verificaciones_pendientes.includes(VERIF_LPB), false);
  // La de ONU/OFAC sigue abierta: la LPB no la cubre, igual que al revés.
  assert.ok(r.verificaciones_pendientes.includes(VERIF_ONU_OFAC));

  // Cotejo limpio contra la lista obligatoria: no hay nada que advertir.
  assert.equal(
    r.motivos_preliminar.some((m) => /Cotejo ejecutado/.test(m)),
    false
  );
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
  assert.match(r.razon_clasificacion, /Lista de Personas Bloqueadas/);
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
  // Sin resolver el match, ninguna búsqueda puede darse por concluida.
  assert.ok(r.verificaciones_pendientes.includes(VERIF_LPB));
  assert.ok(r.verificaciones_pendientes.includes(VERIF_ONU_OFAC));
});
