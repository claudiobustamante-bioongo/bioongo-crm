/**
 * Motor de cálculo del perfil de riesgo — metodología IPS de Bioongo.
 *
 * Implementa los pasos 1-4: fase por edad, tolerancia, capacidad y perfil.
 * Las tablas de puntaje viven en `./ips-catalogo`; aquí solo hay lógica.
 *
 * Toda imputación por dato faltante o no reconocido queda registrada en la
 * bitácora: el resultado nunca oculta que se calculó con un valor supuesto.
 */

import {
  BANDAS_CAPACIDAD,
  BANDAS_PERFIL,
  BANDAS_TOLERANCIA,
  CAPACIDAD_COLCHON,
  CAPACIDAD_EMPLEO,
  CAPACIDAD_FASE,
  CAPACIDAD_HABITACIONAL,
  LIKERT,
  OCUPACIONES_REVISION_PEP,
  PESO_CAPACIDAD,
  PESO_TOLERANCIA,
  TOLERANCIA_ESCENARIO,
  TOLERANCIA_NEGOCIO_PROPIO,
  TOLERANCIA_PERCEPCION_EMPLEO,
  TOLERANCIA_REACCION_CAIDA,
  normalizar,
  type Banda,
  type Fase,
  type PerfilRiesgo,
} from './ips-catalogo';

// ---------------------------------------------------------------------------
// Entrada y salida
// ---------------------------------------------------------------------------

export interface IPSInputs {
  // Bloqueantes: sin estos no se puede calcular
  nombreCompleto: string;
  fechaNacimiento: string; // ISO
  ocupacion: string;
  ingresoMensual: number;

  // Tolerancia (6 reactivos, todos opcionales -> neutro si faltan)
  escenarioGananciaPerdida?: string;
  reaccionCaida10?: string;
  negocioPropio?: string;
  percepcionRiesgoEmpleo?: string;
  prefiereIngresoSeguro?: string;
  noPuedePerder?: string;

  // Capacidad (además de fase y empleo)
  colchonLiquidez?: string;
  dependientes?: number;
  situacionHabitacional?: string;
  ahorros?: number;
  hipoteca?: number;
  otrasDeudas?: number;

  // Contexto (no afectan el puntaje, van a bitácora)
  objetivoInversion?: string;
  gananciaEsperada?: string;
  horizonteDeclarado?: string;

  // El cliente puede pedir otro perfil que el calculado
  perfilSolicitadoPorCliente?: PerfilRiesgo;
}

export interface EntradaBitacora {
  paso: string;
  detalle: string;
}

export interface CapacidadDesglose {
  fase: number;
  empleo: number;
  colchon: number;
  habitacional: number;
  dependientes: number;
  coberturaDeuda: number;
}

export interface IPSResultado {
  edad: number;
  fase: Fase;
  faseForzadaPorJubilacion: boolean;
  toleranciaPuntos: number;
  toleranciaNivel: number;
  capacidadPuntos: number;
  capacidadNivel: number;
  capacidadDesglose: CapacidadDesglose;
  puntuacionPonderada: number;
  perfilCalculado: PerfilRiesgo;
  perfilFinal: PerfilRiesgo;
  requiereRevisionPEP: boolean;
  bitacora: EntradaBitacora[];
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

/** Primera banda cuyo `max` no es superado por el puntaje. */
function resolverBanda<T>(puntaje: number, bandas: Banda<T>[]): T {
  const banda = bandas.find((b) => puntaje <= b.max);
  return banda ? banda.valor : bandas[bandas.length - 1].valor;
}

/** Punto medio del máximo de la tabla, redondeado. Es el valor imputado. */
function neutroDe(tabla: Record<string, number>): number {
  return Math.round(Math.max(...Object.values(tabla)) / 2);
}

/**
 * Busca la respuesta en su tabla. Si falta o no se reconoce, imputa el
 * neutro y lo anota en bitácora.
 */
function puntuarReactivo(
  respuesta: string | undefined,
  tabla: Record<string, number>,
  etiqueta: string,
  paso: string,
  bitacora: EntradaBitacora[]
): number {
  const neutro = neutroDe(tabla);

  if (!respuesta || !respuesta.trim()) {
    bitacora.push({
      paso,
      detalle: `${etiqueta}: sin respuesta. Se imputa el neutro (${neutro}).`,
    });
    return neutro;
  }

  const puntos = tabla[normalizar(respuesta)];
  if (puntos === undefined) {
    bitacora.push({
      paso,
      detalle:
        `${etiqueta}: respuesta "${respuesta}" no está en el catálogo. ` +
        `Se imputa el neutro (${neutro}).`,
    });
    return neutro;
  }

  return puntos;
}

/** Edad en años cumplidos a la fecha de referencia. */
function calcularEdad(fechaNacimiento: Date, referencia: Date): number {
  let edad = referencia.getFullYear() - fechaNacimiento.getFullYear();
  const mes = referencia.getMonth() - fechaNacimiento.getMonth();
  if (mes < 0 || (mes === 0 && referencia.getDate() < fechaNacimiento.getDate())) {
    edad--;
  }
  return edad;
}

/** Fase del ciclo patrimonial por edad. */
function fasePorEdad(edad: number): Fase {
  if (edad <= 24) return 'Desarrollo';
  if (edad <= 39) return 'Aceleracion';
  if (edad <= 54) return 'Acumulacion';
  if (edad <= 74) return 'Consolidacion';
  return 'Retiro';
}

/** Dependientes económicos: 0 -> 1, 1 o 2 -> 2, 3 o más -> 3. */
function puntuarDependientes(
  dependientes: number | undefined,
  bitacora: EntradaBitacora[]
): number {
  const NEUTRO = 2;

  if (dependientes === undefined || !Number.isFinite(dependientes) || dependientes < 0) {
    bitacora.push({
      paso: 'Paso 3 - Capacidad',
      detalle: `Dependientes: sin dato válido. Se imputa el neutro (${NEUTRO}).`,
    });
    return NEUTRO;
  }

  if (dependientes === 0) return 1;
  if (dependientes <= 2) return 2;
  return 3;
}

/**
 * Cobertura de deuda: (hipoteca + otrasDeudas) / ahorros.
 * Sin ahorros conocidos no hay ratio calculable: se imputa el neutro (3).
 */
function puntuarCoberturaDeuda(
  inputs: IPSInputs,
  bitacora: EntradaBitacora[]
): number {
  const NEUTRO = 3;
  const { ahorros, hipoteca, otrasDeudas } = inputs;

  if (!ahorros || !Number.isFinite(ahorros) || ahorros <= 0) {
    bitacora.push({
      paso: 'Paso 3 - Capacidad',
      detalle:
        `Cobertura de deuda: ahorros en 0 o sin dato, el ratio no es ` +
        `calculable. Se imputa el neutro (${NEUTRO}).`,
    });
    return NEUTRO;
  }

  const deuda = (hipoteca ?? 0) + (otrasDeudas ?? 0);
  const ratio = deuda / ahorros;

  let puntos: number;
  if (ratio === 0) puntos = 1;
  else if (ratio <= 0.25) puntos = 2;
  else if (ratio <= 0.75) puntos = 3;
  else if (ratio <= 1.5) puntos = 4;
  else puntos = 5;

  bitacora.push({
    paso: 'Paso 3 - Capacidad',
    detalle:
      `Cobertura de deuda: deuda ${deuda} / ahorros ${ahorros} = ` +
      `ratio ${ratio.toFixed(2)} -> ${puntos} puntos.`,
  });

  return puntos;
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

/** Lanza si falta algún bloqueante. No se calcula con estos cuatro incompletos. */
function validarBloqueantes(inputs: IPSInputs): Date {
  const faltantes: string[] = [];

  if (!inputs.nombreCompleto || !inputs.nombreCompleto.trim()) {
    faltantes.push('nombreCompleto');
  }
  if (!inputs.ocupacion || !inputs.ocupacion.trim()) {
    faltantes.push('ocupacion');
  }
  if (
    inputs.ingresoMensual === undefined ||
    inputs.ingresoMensual === null ||
    !Number.isFinite(inputs.ingresoMensual) ||
    inputs.ingresoMensual < 0
  ) {
    faltantes.push('ingresoMensual');
  }

  let nacimiento: Date | null = null;
  if (!inputs.fechaNacimiento || !inputs.fechaNacimiento.trim()) {
    faltantes.push('fechaNacimiento');
  } else {
    nacimiento = new Date(inputs.fechaNacimiento);
    if (Number.isNaN(nacimiento.getTime())) {
      faltantes.push('fechaNacimiento (no es una fecha ISO válida)');
      nacimiento = null;
    }
  }

  if (faltantes.length > 0) {
    throw new Error(
      `No se puede calcular el perfil IPS: faltan datos bloqueantes ` +
        `(${faltantes.join(', ')}).`
    );
  }

  return nacimiento as Date;
}

// ---------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------

export function calcularPerfilIPS(
  inputs: IPSInputs,
  referencia: Date = new Date()
): IPSResultado {
  const nacimiento = validarBloqueantes(inputs);
  const bitacora: EntradaBitacora[] = [];

  // --- Paso 1: fase por edad -----------------------------------------------

  const edad = calcularEdad(nacimiento, referencia);

  if (edad < 18) {
    throw new Error(
      `No se puede calcular el perfil IPS: la edad calculada es ${edad} años ` +
        `y la metodología arranca en 18.`
    );
  }

  const ocupacionNormalizada = normalizar(inputs.ocupacion);
  const faseForzadaPorJubilacion = ocupacionNormalizada === 'jubilado';

  let fase: Fase;
  if (faseForzadaPorJubilacion) {
    fase = 'Retiro';
    bitacora.push({
      paso: 'Paso 1 - Fase',
      detalle:
        `Ocupación "jubilado": la fase se fuerza a Retiro sin importar la ` +
        `edad (${edad} años, que correspondería a ${fasePorEdad(edad)}). ` +
        `Guía v04 7.6.4.`,
    });
  } else {
    fase = fasePorEdad(edad);
    bitacora.push({
      paso: 'Paso 1 - Fase',
      detalle: `Edad ${edad} años -> fase ${fase}.`,
    });
  }

  // --- Paso 2: tolerancia --------------------------------------------------

  const PASO_2 = 'Paso 2 - Tolerancia';

  const toleranciaPuntos =
    puntuarReactivo(
      inputs.escenarioGananciaPerdida,
      TOLERANCIA_ESCENARIO,
      'Escenario ganancia/pérdida',
      PASO_2,
      bitacora
    ) +
    puntuarReactivo(
      inputs.reaccionCaida10,
      TOLERANCIA_REACCION_CAIDA,
      'Reacción ante caída de 10%',
      PASO_2,
      bitacora
    ) +
    puntuarReactivo(
      inputs.negocioPropio,
      TOLERANCIA_NEGOCIO_PROPIO,
      'Negocio propio',
      PASO_2,
      bitacora
    ) +
    puntuarReactivo(
      inputs.percepcionRiesgoEmpleo,
      TOLERANCIA_PERCEPCION_EMPLEO,
      'Percepción de riesgo negocio/empleo',
      PASO_2,
      bitacora
    ) +
    puntuarReactivo(
      inputs.prefiereIngresoSeguro,
      LIKERT,
      'Prefiere ingreso seguro',
      PASO_2,
      bitacora
    ) +
    puntuarReactivo(
      inputs.noPuedePerder,
      LIKERT,
      'No puede perder dinero',
      PASO_2,
      bitacora
    );

  const toleranciaNivel = resolverBanda(toleranciaPuntos, BANDAS_TOLERANCIA);

  bitacora.push({
    paso: PASO_2,
    detalle: `Total ${toleranciaPuntos} puntos -> nivel ${toleranciaNivel}.`,
  });

  // --- Paso 3: capacidad ---------------------------------------------------

  const PASO_3 = 'Paso 3 - Capacidad';

  const capacidadDesglose: CapacidadDesglose = {
    fase: CAPACIDAD_FASE[normalizar(fase)],
    empleo: puntuarReactivo(
      inputs.ocupacion,
      CAPACIDAD_EMPLEO,
      'Ocupación',
      PASO_3,
      bitacora
    ),
    colchon: puntuarReactivo(
      inputs.colchonLiquidez,
      CAPACIDAD_COLCHON,
      'Colchón de liquidez',
      PASO_3,
      bitacora
    ),
    habitacional: puntuarReactivo(
      inputs.situacionHabitacional,
      CAPACIDAD_HABITACIONAL,
      'Situación habitacional',
      PASO_3,
      bitacora
    ),
    dependientes: puntuarDependientes(inputs.dependientes, bitacora),
    coberturaDeuda: puntuarCoberturaDeuda(inputs, bitacora),
  };

  const capacidadPuntos =
    capacidadDesglose.fase +
    capacidadDesglose.empleo +
    capacidadDesglose.colchon +
    capacidadDesglose.habitacional +
    capacidadDesglose.dependientes +
    capacidadDesglose.coberturaDeuda;

  const capacidadNivel = resolverBanda(capacidadPuntos, BANDAS_CAPACIDAD);

  bitacora.push({
    paso: PASO_3,
    detalle:
      `Fase ${capacidadDesglose.fase} + empleo ${capacidadDesglose.empleo} + ` +
      `colchón ${capacidadDesglose.colchon} + habitacional ` +
      `${capacidadDesglose.habitacional} + dependientes ` +
      `${capacidadDesglose.dependientes} + cobertura ` +
      `${capacidadDesglose.coberturaDeuda} = ${capacidadPuntos} puntos -> ` +
      `nivel ${capacidadNivel}.`,
  });

  // --- Paso 4: perfil ------------------------------------------------------

  const bruta =
    toleranciaNivel * PESO_TOLERANCIA + capacidadNivel * PESO_CAPACIDAD;
  // Se redondea a 2 decimales para que las bandas no dependan del error
  // de punto flotante (0.6 * 3 + 0.4 * 4 da 3.3999999999999995, no 3.4).
  const puntuacionPonderada = Math.round(bruta * 100) / 100;

  const perfilCalculado = resolverBanda(puntuacionPonderada, BANDAS_PERFIL);

  bitacora.push({
    paso: 'Paso 4 - Perfil',
    detalle:
      `(${toleranciaNivel} x ${PESO_TOLERANCIA}) + ` +
      `(${capacidadNivel} x ${PESO_CAPACIDAD}) = ${puntuacionPonderada} -> ` +
      `perfil ${perfilCalculado}.`,
  });

  // --- Perfil solicitado por el cliente ------------------------------------

  const perfilFinal = inputs.perfilSolicitadoPorCliente ?? perfilCalculado;

  if (
    inputs.perfilSolicitadoPorCliente &&
    inputs.perfilSolicitadoPorCliente !== perfilCalculado
  ) {
    bitacora.push({
      paso: 'Paso 4 - Perfil',
      detalle:
        `El cliente solicitó perfil ${inputs.perfilSolicitadoPorCliente}, ` +
        `distinto del calculado (${perfilCalculado}). Prevalece el ` +
        `solicitado; queda constancia de la diferencia.`,
    });
  }

  // --- Alerta PEP ----------------------------------------------------------

  const requiereRevisionPEP =
    OCUPACIONES_REVISION_PEP.includes(ocupacionNormalizada);

  if (requiereRevisionPEP) {
    bitacora.push({
      paso: 'Debida diligencia',
      detalle:
        `La ocupación "${inputs.ocupacion}" requiere verificación del estatus ` +
        `PEP antes de dar por válida la declaración del cliente. No bloquea ` +
        `el cálculo.`,
    });
  }

  // --- Contexto declarado --------------------------------------------------

  if (inputs.objetivoInversion) {
    bitacora.push({
      paso: 'Contexto',
      detalle: `Objetivo declarado: ${inputs.objetivoInversion}`,
    });
  }
  if (inputs.gananciaEsperada) {
    bitacora.push({
      paso: 'Contexto',
      detalle: `Ganancia esperada declarada: ${inputs.gananciaEsperada}`,
    });
  }
  if (inputs.horizonteDeclarado) {
    bitacora.push({
      paso: 'Contexto',
      detalle: `Horizonte declarado: ${inputs.horizonteDeclarado}`,
    });
  }

  return {
    edad,
    fase,
    faseForzadaPorJubilacion,
    toleranciaPuntos,
    toleranciaNivel,
    capacidadPuntos,
    capacidadNivel,
    capacidadDesglose,
    puntuacionPonderada,
    perfilCalculado,
    perfilFinal,
    requiereRevisionPEP,
    bitacora,
  };
}
