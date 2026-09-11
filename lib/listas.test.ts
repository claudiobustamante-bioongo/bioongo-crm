/**
 * Casos de prueba de las listas de control PLD/FT.
 *
 * El énfasis está en los fallos SILENCIOSOS: los que no lanzan, no dan error y
 * solo producen una coincidencia de menos. Un parser que se come un renglón o
 * un índice que empareja dos campos vacíos no rompen nada visible; solo hacen
 * que una persona bloqueada no aparezca.
 *
 * Se corre con vitest:
 *   npm test
 */

import { test } from 'vitest';
import assert from 'node:assert/strict';

import {
  ErrorLista,
  MAX_FILAS_PREAMBULO,
  buscarCoincidencias,
  decodificarCSV,
  esListaDeSanciones,
  esObligatoria,
  normalizarClave,
  normalizarNombre,
  parsearCSV,
  TIPOS_LISTA,
  type ClienteCotejable,
  type RegistroCotejable,
} from './listas';

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

test('normalizarNombre: mayúsculas, sin acentos, sin signos, espacios colapsados', () => {
  assert.equal(normalizarNombre('  José   Pérez-Gómez, Jr. '), 'JOSE PEREZ GOMEZ JR');
  assert.equal(normalizarNombre('María de los Ángeles'), 'MARIA DE LOS ANGELES');
  assert.equal(normalizarNombre(''), '');
  assert.equal(normalizarNombre(null), '');
  assert.equal(normalizarNombre(undefined), '');
});

test('normalizarNombre: la Ñ colapsa a N, y es a propósito', () => {
  // Las listas oficiales escriben de las dos maneras. Que MUÑOZ y MUNOZ
  // coincidan es lo deseable aquí; lo que no se vale es que sea un accidente
  // sin documentar.
  assert.equal(normalizarNombre('Muñoz'), normalizarNombre('Munoz'));
  assert.equal(normalizarNombre('Muñoz'), 'MUNOZ');
});

test('normalizarNombre: los signos separan, no se pegan', () => {
  // 'PEREZ-GOMEZ' no debe volverse 'PEREZGOMEZ': dejaría de coincidir con
  // 'PEREZ GOMEZ', que es como lo tiene el expediente.
  assert.equal(normalizarNombre('PEREZ-GOMEZ'), 'PEREZ GOMEZ');
});

test('normalizarClave: RFC y CURP sobreviven a guiones y espacios', () => {
  assert.equal(normalizarClave('gopj-800101-ab1'), 'GOPJ800101AB1');
  assert.equal(normalizarClave(' GOPJ 800101 AB1 '), 'GOPJ800101AB1');
  assert.equal(normalizarClave(null), '');
});

test('esObligatoria: solo PEP_NACIONAL', () => {
  assert.equal(esObligatoria('PEP_NACIONAL'), true);
  assert.equal(esObligatoria('OFAC'), false);
  assert.equal(esObligatoria('SAT_69B'), false);
  assert.equal(esObligatoria('ONU'), false);
});

test('la LPB es tipo válido pero NO obligatorio', () => {
  // Los dos lados de la decisión del 9 de septiembre de 2026, juntos porque se
  // sostienen juntos: las Disposiciones del art. 226 Bis LMV no contemplan el
  // capítulo de Lista de Personas Bloqueadas para los asesores en inversiones,
  // así que deja de ser obligación —y el semáforo de /admin/listas puede
  // ponerse en verde—, pero la lista sigue siendo cargable y cotejable porque
  // el régimen de SOFOM E.N.R. sí la contempla y este módulo se reusa ahí.
  assert.equal(esObligatoria('LPB'), false);
  assert.ok(TIPOS_LISTA.includes('LPB'));
});

// ---------------------------------------------------------------------------
// Parseo
// ---------------------------------------------------------------------------

test('esListaDeSanciones: LPB, OFAC y ONU; nunca el SAT 69-B ni PEP nacionales', () => {
  // Una sola definición para el motor, la ruta, la carga y la bandeja. Cuando
  // vivía en cuatro lugares, tres decían «solo LPB» y el motor «cualquiera».
  for (const tipo of ['LPB', 'OFAC', 'ONU']) {
    assert.equal(esListaDeSanciones(tipo), true, tipo);
  }

  // El 69-B es materia fiscal: decisión tomada, no se reabre.
  assert.equal(esListaDeSanciones('SAT_69B'), false);
  // El PEP nacional no reclasifica de oficio (apartado 4.7).
  assert.equal(esListaDeSanciones('PEP_NACIONAL'), false);

  // El tipo llega de la base sin garantía: lo que no es un tipo exacto, no es.
  for (const raro of ['', 'ofac', 'OFAC ', null, undefined]) {
    assert.equal(esListaDeSanciones(raro), false, String(raro));
  }
});

test('parsearCSV: encabezados básicos y normalización del nombre', () => {
  const csv = 'nombre,rfc,curp\nJosé Pérez,GOPJ800101AB1,GOPJ800101HDFXXX01\n';
  const r = parsearCSV(csv);

  assert.equal(r.registros.length, 1);
  assert.equal(r.registros[0].nombre, 'José Pérez');
  assert.equal(r.registros[0].nombre_norm, 'JOSE PEREZ');
  assert.equal(r.registros[0].rfc, 'GOPJ800101AB1');
  assert.equal(r.delimitador, ',');
});

test('parsearCSV: BOM de Excel no rompe el primer encabezado', () => {
  // Sin quitarlo, la primera columna llega como '﻿nombre' y no se
  // reconoce: el archivo entero se rechazaría por «no tiene columna de nombre».
  const csv = '\uFEFFnombre,rfc\nAna López,LOAA900101XY2\n';
  const r = parsearCSV(csv);

  assert.equal(r.columnas.nombre, 'nombre');
  assert.equal(r.registros.length, 1);
  assert.equal(r.registros[0].nombre_norm, 'ANA LOPEZ');
});

test('parsearCSV: CRLF de Windows', () => {
  const csv = 'nombre,rfc\r\nAna López,LOAA900101XY2\r\nJuan Ruiz,RUJJ850202ZZ9\r\n';
  const r = parsearCSV(csv);

  assert.equal(r.registros.length, 2);
  // Sin manejar el \r, el último campo quedaría 'LOAA900101XY2\r'.
  assert.equal(r.registros[0].rfc, 'LOAA900101XY2');
});

test('parsearCSV: delimitador punto y coma, el que exporta Excel en México', () => {
  const csv = 'nombre;rfc;pais\nAna López;LOAA900101XY2;México\n';
  const r = parsearCSV(csv);

  assert.equal(r.delimitador, ';');
  assert.equal(r.registros.length, 1);
  assert.equal(r.registros[0].rfc, 'LOAA900101XY2');
  assert.equal(r.registros[0].pais, 'México');
});

test('parsearCSV: comillas con coma adentro y comillas escapadas', () => {
  const csv =
    'nombre,observaciones\n' +
    '"Pérez Gómez, José","Alias ""El Güero"", según el expediente"\n';
  const r = parsearCSV(csv);

  assert.equal(r.registros.length, 1);
  assert.equal(r.registros[0].nombre, 'Pérez Gómez, José');
  assert.equal(r.registros[0].observaciones, 'Alias "El Güero", según el expediente');
});

test('parsearCSV: alias de encabezado de las listas reales', () => {
  // SAT 69-B publica 'Nombre del Contribuyente'; OFAC, 'SDN_Name'.
  const sat = parsearCSV('RFC,Nombre del Contribuyente\nGOPJ800101AB1,José Pérez\n');
  assert.equal(sat.columnas.nombre, 'Nombre del Contribuyente');
  assert.equal(sat.registros[0].nombre, 'José Pérez');

  const ofac = parsearCSV(
    'SDN_Name,Program,Country\n"PEREZ GOMEZ, JOSE",SDNTK,MX\n'
  );
  assert.equal(ofac.columnas.nombre, 'SDN_Name');
  assert.equal(ofac.registros[0].programa, 'SDNTK');
});

test('parsearCSV: columna desconocida se avisa, no se traga', () => {
  const r = parsearCSV('nombre,columna_rara\nAna López,valor\n');
  assert.equal(r.registros.length, 1);
  assert.ok(r.avisos.some((a) => a.includes('columna_rara')));
});

test('parsearCSV: fila sin nombre se descarta y se cuenta', () => {
  // `nombre` es NOT NULL en la base: la fila no se puede escribir. Lo que no se
  // vale es descartarla sin dejar rastro.
  const r = parsearCSV('nombre,rfc\nAna López,LOAA900101XY2\n,RUJJ850202ZZ9\n');
  assert.equal(r.registros.length, 1);
  assert.equal(r.filasSinNombre, 1);
  assert.ok(r.avisos.some((a) => a.includes('sin nombre')));
});

test('parsearCSV: el salto de línea final no inventa un registro vacío', () => {
  const r = parsearCSV('nombre\nAna López\n');
  assert.equal(r.registros.length, 1);
  assert.equal(r.filasSinNombre, 0);
});

test('parsearCSV: sin columna de nombre lanza ErrorLista', () => {
  assert.throws(() => parsearCSV('rfc,curp\nGOPJ800101AB1,GOPJ800101HDFXXX01\n'), ErrorLista);
});

// ---------------------------------------------------------------------------
// Preámbulo y codificación · el «Listado completo 69-B» del SAT
// ---------------------------------------------------------------------------

/** Las tres primeras filas del archivo real, con su preámbulo de dos renglones. */
const SAT_69B =
  '"Información actualizada al 31 de julio de 2026; los listados a que se hace ' +
  'mención, son de carácter público.",,,\n' +
  'Listado completo de contribuyentes (Artículo 69-B del CFF),,,\n' +
  'No,RFC,Nombre del Contribuyente,Situación del contribuyente\n' +
  '1,AAA080808HL8,"ASESORES EN AVALÚOS Y ACTIVOS, S.A. DE C.V.",Sentencia Favorable\n' +
  '2,AAA091014835,"AQUAERIS ACUACULTURA, S.C.",Desvirtuado \n';

test('parsearCSV: el preámbulo del SAT no impide encontrar el encabezado', () => {
  // Sin la búsqueda del encabezado, `filas[0]` es el párrafo legal y el archivo
  // entero se rechaza por «no tiene columna de nombre» — teniéndola.
  const r = parsearCSV(SAT_69B);

  assert.equal(r.columnas.nombre, 'Nombre del Contribuyente');
  assert.equal(r.registros.length, 2);
  assert.equal(r.registros[0].nombre, 'ASESORES EN AVALÚOS Y ACTIVOS, S.A. DE C.V.');
  assert.equal(r.registros[0].rfc, 'AAA080808HL8');
});

test('parsearCSV: las filas de preámbulo saltadas se avisan, no se tragan', () => {
  // Que se hayan saltado dos renglones tiene que quedar dicho: si un archivo
  // trae más preámbulo del esperado, se cargaría torcido y una lista torcida se
  // ve igual de cargada que una buena.
  const r = parsearCSV(SAT_69B);
  assert.ok(r.avisos.some((a) => a.includes('2 fila(s) de preámbulo')));
  assert.ok(r.avisos.some((a) => a.includes('fila 3')));
});

test('parsearCSV: sin preámbulo no se inventa el aviso', () => {
  const r = parsearCSV('nombre,rfc\nAna López,LOAA900101XY2\n');
  assert.equal(r.avisos.some((a) => a.includes('preámbulo')), false);
});

test('parsearCSV: la situación del 69-B entra por programa y NO se filtra', () => {
  // Los cuatro estados no son equivalentes, pero los cuatro se cargan. Un
  // presunto que mañana pase a definitivo debe dejar rastro de que ya venía
  // listado; filtrar al cargar borra esa historia.
  const r = parsearCSV(SAT_69B);

  assert.equal(r.columnas.programa, 'Situación del contribuyente');
  assert.equal(r.registros[0].programa, 'Sentencia Favorable');
  // `celda()` recorta: el archivo real trae 'Desvirtuado ' con espacio final, y
  // sin el trim la bandeja compararía contra una cadena que nunca empata.
  assert.equal(r.registros[1].programa, 'Desvirtuado');
});

test('parsearCSV: el encabezado no se busca más allá de la ventana', () => {
  // Buscarlo indefinidamente acabaría encontrándolo dentro de los datos de un
  // archivo que de veras no lo trae.
  const relleno = 'basura,mas basura\n'.repeat(MAX_FILAS_PREAMBULO + 2);
  assert.throws(() => parsearCSV(relleno + 'nombre,rfc\nAna López,LOAA900101XY2\n'), ErrorLista);
});

test('decodificarCSV: UTF-8 válido se decodifica como UTF-8', () => {
  const r = decodificarCSV(new TextEncoder().encode('nombre\nJosé Pérez\n'));
  assert.equal(r.codificacion, 'utf-8');
  assert.equal(r.texto, 'nombre\nJosé Pérez\n');
});

test('decodificarCSV: windows-1252 del SAT, con los acentos intactos', () => {
  // 0xF3 = ó, 0xDA = Ú en windows-1252. Como UTF-8 son bytes inválidos: con
  // `File.text()` saldrían como U+FFFD y el nombre quedaría corrupto EN LA BASE,
  // sin que nada fallara.
  const bytes = Uint8Array.from([
    0x53, 0x69, 0x74, 0x75, 0x61, 0x63, 0x69, 0xf3, 0x6e, // Situación
    0x0a,
    0x41, 0x56, 0x41, 0x4c, 0xda, 0x4f, 0x53, // AVALÚOS
    0x0a,
  ]);
  const r = decodificarCSV(bytes);

  assert.equal(r.codificacion, 'windows-1252');
  assert.equal(r.texto, 'Situación\nAVALÚOS\n');
});

test('decodificarCSV: el encabezado mal decodificado perdería la situación', () => {
  // Esta es la razón de ser del fallback, escrita como prueba: si el archivo del
  // SAT se leyera como UTF-8, 'Situación del contribuyente' llegaría con U+FFFD
  // y no empataría con ningún alias. La situación se iría a los avisos como
  // columna no reconocida, que es justo el dato que la bandeja necesita.
  const roto = parsearCSV('RFC,Nombre del Contribuyente,Situaci�n del contribuyente\n' +
    'AAA080808HL8,ASESORES,Definitivo\n');
  assert.equal(roto.columnas.programa, null);
  assert.equal(roto.registros[0].programa, null);

  const bien = parsearCSV('RFC,Nombre del Contribuyente,Situación del contribuyente\n' +
    'AAA080808HL8,ASESORES,Definitivo\n');
  assert.equal(bien.registros[0].programa, 'Definitivo');
});

test('parsearCSV: archivo vacío lanza ErrorLista', () => {
  assert.throws(() => parsearCSV('   \n'), ErrorLista);
});

// ---------------------------------------------------------------------------
// Cotejo
// ---------------------------------------------------------------------------

const CLIENTES: ClienteCotejable[] = [
  {
    codigo_cliente: 'C001',
    nombre: 'José',
    apellido_paterno: 'Pérez',
    apellido_materno: 'Gómez',
    rfc: 'PEGJ800101AB1',
    curp: 'PEGJ800101HDFRMS01',
  },
  {
    codigo_cliente: 'C002',
    nombre: 'Ana',
    apellido_paterno: 'López',
    apellido_materno: null,
    rfc: null,
    curp: null,
  },
];

function registro(sobre: Partial<RegistroCotejable> & { id: string; nombre: string }): RegistroCotejable {
  return { rfc: null, curp: null, ...sobre };
}

test('buscarCoincidencias: RFC exacto, tolerando guiones', () => {
  const r = buscarCoincidencias(CLIENTES, [
    registro({ id: 'R1', nombre: 'Otro Nombre', rfc: 'pegj-800101-ab1' }),
  ]);

  assert.equal(r.length, 1);
  assert.equal(r[0].tipo_match, 'rfc_exacto');
  assert.equal(r[0].codigo_cliente, 'C001');
  // La evidencia guarda los valores en crudo, no los normalizados.
  assert.equal(r[0].valor_cliente, 'PEGJ800101AB1');
  assert.equal(r[0].valor_lista, 'pegj-800101-ab1');
});

test('buscarCoincidencias: CURP exacta', () => {
  const r = buscarCoincidencias(CLIENTES, [
    registro({ id: 'R1', nombre: 'Otro Nombre', curp: 'PEGJ800101HDFRMS01' }),
  ]);

  assert.equal(r.length, 1);
  assert.equal(r[0].tipo_match, 'curp_exacto');
});

test('buscarCoincidencias: nombre normalizado exacto, con acentos de por medio', () => {
  const r = buscarCoincidencias(CLIENTES, [registro({ id: 'R1', nombre: 'JOSE PEREZ GOMEZ' })]);

  assert.equal(r.length, 1);
  assert.equal(r[0].tipo_match, 'nombre_exacto');
  assert.equal(r[0].valor_cliente, 'José Pérez Gómez');
});

test('buscarCoincidencias: campos vacíos NUNCA emparejan entre sí', () => {
  // C002 no tiene RFC ni CURP. Un registro sin RFC ni CURP normaliza a '' por
  // los dos lados: sin la guarda de llave vacía, cada cliente sin clave
  // coincidiría con cada registro sin clave. En una lista de 10 mil renglones
  // eso son decenas de miles de falsos positivos, todos con pinta legítima, y
  // la revisión se vuelve imposible.
  const r = buscarCoincidencias(CLIENTES, [registro({ id: 'R1', nombre: 'Persona Ajena' })]);
  assert.equal(r.length, 0);
});

test('buscarCoincidencias: un registro puede coincidir por tres vías a la vez', () => {
  // Coincidir por RFC Y CURP Y nombre es una señal mucho más fuerte que
  // coincidir solo por nombre. Colapsarlas escondería la diferencia justo de
  // quien tiene que decidir si suspende operaciones.
  const r = buscarCoincidencias(CLIENTES, [
    registro({
      id: 'R1',
      nombre: 'Jose Perez Gomez',
      rfc: 'PEGJ800101AB1',
      curp: 'PEGJ800101HDFRMS01',
    }),
  ]);

  assert.equal(r.length, 3);
  assert.deepEqual(
    r.map((c) => c.tipo_match).sort(),
    ['curp_exacto', 'nombre_exacto', 'rfc_exacto']
  );
});

test('buscarCoincidencias: dos clientes homónimos generan dos coincidencias', () => {
  // El índice guarda arreglos, no un solo cliente por llave. Si guardara uno,
  // el segundo homónimo desaparecería del cotejo sin dejar rastro.
  const homonimos: ClienteCotejable[] = [
    { codigo_cliente: 'C001', nombre: 'Ana', apellido_paterno: 'López' },
    { codigo_cliente: 'C009', nombre: 'Ana', apellido_paterno: 'Lopez' },
  ];
  const r = buscarCoincidencias(homonimos, [registro({ id: 'R1', nombre: 'ANA LOPEZ' })]);

  assert.equal(r.length, 2);
  assert.deepEqual(r.map((c) => c.codigo_cliente).sort(), ['C001', 'C009']);
});

test('buscarCoincidencias: hueco conocido · «APELLIDO, NOMBRE» de OFAC no dispara', () => {
  // Documenta el límite de la decisión de cotejar solo exacto. OFAC publica
  // «PEREZ GOMEZ, JOSE» y el expediente guarda «José Pérez Gómez»: los tokens
  // son los mismos, el orden no. Si algún día se decide permutar, esta prueba
  // es la que debe cambiar, y con ella la conversación sobre metodología.
  const r = buscarCoincidencias(CLIENTES, [registro({ id: 'R1', nombre: 'PEREZ GOMEZ, JOSE' })]);
  assert.equal(r.length, 0);
});

test('buscarCoincidencias: se respeta el nombre_norm ya guardado', () => {
  // El cotejo usa lo que la lista dice, no lo que este proceso recalcularía.
  const r = buscarCoincidencias(CLIENTES, [
    registro({ id: 'R1', nombre: 'da igual', nombre_norm: 'JOSE PEREZ GOMEZ' }),
  ]);

  assert.equal(r.length, 1);
  assert.equal(r[0].tipo_match, 'nombre_exacto');
});

test('buscarCoincidencias: cartera vacía o lista vacía no truenan', () => {
  assert.deepEqual(buscarCoincidencias([], [registro({ id: 'R1', nombre: 'Ana López' })]), []);
  assert.deepEqual(buscarCoincidencias(CLIENTES, []), []);
});
