# Migraciones

Scripts de SQL que se corrieron **a mano** en el SQL Editor de Supabase, en
orden cronológico por nombre de archivo.

Esto NO es una cadena de migraciones de la CLI de Supabase y no se aplica sola.
El acceso de la aplicación a la base es de solo lectura para DDL: los cambios de
esquema y las correcciones de datos los ejecuta Claudio pegando el script. Esta
carpeta es el **archivo de lo ya ejecutado**, no una cola de lo pendiente.

Reglas de la carpeta:

- Un archivo por script, nombrado `AAAA-MM-DD-asunto.sql`.
- La cabecera dice qué hizo, cuándo se ejecutó y **qué quedó verificado después**
  de correrlo. Un script archivado sin su resultado no permite reconstruir nada.
- Se archiva lo que YA se corrió. Si un script se propuso y no se ejecutó, no va
  aquí: no habría cómo distinguir el estado real de la base del propuesto.
- Nunca llevan nombres, RFC, CURP ni correos. Los `codigo_cliente` sí: sin ellos
  el script deja de decir sobre qué expedientes actuó.

## Renombrar un `codigo_cliente`

Un código de cliente es el ID que se reporta a la CNBV. Renombrarlo es siempre
un script propio, ejecutado a mano, con un `UPDATE` explícito por tabla: nunca
efecto secundario de otro cambio. Por eso ninguna FK hacia `clientes` tiene
`ON UPDATE CASCADE`. El precedente es `2026-09-30-conciliacion-codigos-r03.sql`.

### Tablas que todo renombre debe tocar

Verificado por MCP el 5-oct-2026 contra el esquema de producción: son todas las
columnas de `public` que guardan un código de cliente.

**Con FK a `clientes(codigo_cliente)`, diferible.** Las diez se declararon
`DEFERRABLE INITIALLY IMMEDIATE` el 30-sep: el script del renombre las pospone con
`set constraints … deferred` y las vuelve a comprobar con
`set constraints all immediate` antes del `commit`.

| tabla | columna |
|---|---|
| `clientes` | `codigo_cliente` (la llave) y `codigo_cotitular` |
| `perfil_riesgo` | `codigo_cliente` |
| `ebr_evaluaciones` | `codigo_cliente` |
| `kyc_detalle` | `codigo_cliente` |
| `pep_listas` | `codigo_cliente` |
| `propietario_real` | `codigo_cliente` |
| `beneficiarios` | `codigo_cliente` |
| `transaccionalidad` | `codigo_cliente` |
| `portafolios` | `codigo_cliente` |
| `listas_coincidencias` | `codigo_cliente` |

**Sin FK: el renombre NO las alcanza solo, y ninguna restricción avisa si se
olvidan.**

| tabla | columna | qué pasa si se olvida |
|---|---|---|
| `cliente_bloqueos` | `codigo_cliente` | **El bloqueo desaparece en silencio.** El IPS, el portafolio, la ficha y la bandeja buscan el bloqueo abierto por el código vigente; con el código viejo en la fila, el cliente renombrado opera como si nunca lo hubieran bloqueado. Es la tabla que más importa no olvidar. |
| `firmas_cumplimiento` | `codigo_cliente` | Las firmas del cliente dejan de aparecer al buscarlas por su código. `entidad_id` apunta a ids (coincidencia o bloqueo), no al código: esa columna no se toca. |

Las dos nacieron sin FK a propósito (`2026-10-05-bloqueo-y-firma.sql`): son
evidencia de cumplimiento y no deben poder borrarse en cascada ni impedir el
manejo del expediente. El precio es este: se renombran a mano, en el mismo
script, junto con las diez de arriba. Sus triggers BEFORE UPDATE archivan la
versión con el código anterior en su espejo, igual que pasa con `perfil_riesgo`.

**No se renombran: son auditoría.** Conservan el código con el que se
escribieron, y así debe ser.

| tabla | columna |
|---|---|
| `bitacora` | `entidad_id` (y los códigos dentro de `metadata`) |
| `perfil_riesgo_historico` | `codigo_cliente` |
| `cliente_bloqueos_historico` | `codigo_cliente` |
| `firmas_cumplimiento_historico` | `codigo_cliente` |
| `ebr_evaluaciones.entrada`, `snapshot` de los espejos | el jsonb de la fotografía |

Si alguien agrega mañana una tabla con código de cliente, va en una de estas
tres listas en el mismo commit. Para encontrarlas todas:

```sql
select table_name, column_name
  from information_schema.columns
 where table_schema = 'public'
   and (column_name like 'codigo_%' or column_name = 'entidad_id')
   and column_name <> 'codigo_postal'
 order by 1, 2;
```

### `codigos_alias`: el puente entre el código viejo y el vigente

Como la auditoría conserva el código viejo, la historia de un cliente renombrado
queda partida: hasta el renombre bajo un código, desde ahí bajo el otro.
`codigos_alias` es lo que las une.

- **Una fila por renombre**, en el mismo script y la misma transacción:
  `codigo_anterior` (único), `codigo_actual`, `fecha`, `motivo` y `referencia`
  (p. ej. el R03 que lo motivó). `registrado_por` se llena solo.
- **Nunca se reescribe.** Si un código se renombra dos veces (A → B y luego
  B → C), se agrega la fila B → C; la fila A → B se queda como está. La cadena se
  sigue de alias en alias.
- **Sin FK a `clientes`**: el alias tiene que sobrevivir al expediente.

Para leer la historia completa de un cliente, se junta su código vigente con
todos los anteriores. Por ejemplo, el espejo del perfil de riesgo de CSPFU8085
(antes CSPFU8080):

```sql
with recursive codigos(codigo) as (
  select 'CSPFU8085'::text
  union
  select a.codigo_anterior from codigos_alias a join codigos c on a.codigo_actual = c.codigo
)
select h.codigo_cliente, h.version, h.archivado_en, h.campos_cambiados
  from perfil_riesgo_historico h
 where h.codigo_cliente in (select codigo from codigos)
 order by h.archivado_en;
```

La misma CTE sirve para `bitacora` (`entidad_id in (select codigo from codigos)`)
y para los otros dos espejos.

### Lista de comprobación del script de renombre

1. Guardas: el código nuevo no existe; el viejo sí, en `clientes`.
2. `set constraints … deferred` para las diez FK.
3. Un `UPDATE` por cada tabla de las dos primeras listas (doce tablas, trece
   columnas contando `codigo_cotitular`), **incluidas `cliente_bloqueos` y
   `firmas_cumplimiento`**.
4. Una fila en `codigos_alias`.
5. Un asiento manual en `bitacora` (`accion = 'renombre_codigo'`,
   `origen = 'migracion'`).
6. `set constraints all immediate` y una verificación dentro de la transacción:
   cero filas con el código viejo en las doce tablas.
7. `commit`. Después, verificación aparte (antes y después) y archivo aquí.
