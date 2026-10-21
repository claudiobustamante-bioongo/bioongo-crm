# Migraciones

Scripts de SQL que se corrieron **a mano** contra producción, en orden
cronológico por nombre de archivo. Hasta el 14-oct-2026, en el SQL Editor de
Supabase; desde el 15-oct-2026, con psql (ver «Correr un script con psql»).

Esto NO es una cadena de migraciones de la CLI de Supabase y no se aplica sola.
El acceso de la aplicación a la base es de solo lectura para DDL, y el MCP de
Supabase también: los cambios de esquema y las correcciones de datos se corren
con psql **solo después de que Claudio apruebe el comando exacto**. Esta carpeta
es el **archivo de lo ya ejecutado**, no una cola de lo pendiente.

Reglas de la carpeta:

- Un archivo por script, nombrado `AAAA-MM-DD-asunto.sql`.
- La cabecera dice qué hizo, cuándo se ejecutó y **qué quedó verificado después**
  de correrlo. Un script archivado sin su resultado no permite reconstruir nada.
- Se archiva lo que YA se corrió. Si un script se propuso y no se ejecutó, no va
  aquí: no habría cómo distinguir el estado real de la base del propuesto.
- Nunca llevan nombres, RFC, CURP ni correos. Los `codigo_cliente` sí: sin ellos
  el script deja de decir sobre qué expedientes actuó.
- El usuario tampoco va escrito en el script: se pasa como variable de psql
  (`-v usuario=…`, ver abajo). Precedente de por qué: el asiento manual de
  `2026-10-14-carta-CSPFU2963.sql` traía el correo como literal y hubo que
  sustituirlo para archivarlo.

## Correr un script con psql

Desde el 15-oct-2026 los scripts los corre Claude con psql 17, y cada comando lo
aprueba Claudio antes de correrlo. `~/.claude/settings.json` tiene `ask` para
`Bash(psql:*)`, así que psql siempre pide permiso. El MCP de Supabase sigue en
solo lectura.

### Conexión

Servicio de libpq, sin URI ni contraseña en el comando:

- `~/.pg_service.conf`, sección `[bioongo]`: Session pooler
  (`aws-0-us-east-1.pooler.supabase.com:5432`, usuario `postgres.<ref>`,
  `sslmode=require`, `application_name=bioongo-psql`). WSL no tiene IPv6, por eso
  el pooler y no la conexión directa; y el puerto 5432 (session), no el 6543
  (transaction), que no sirve para scripts con `BEGIN … COMMIT`.
- La contraseña vive **solo** en `~/.pgpass` (permisos 600), que Claude no lee.
  Es la contraseña de la base (Project Settings → Database), que no usan ni la app
  (llaves de API) ni el MCP (token). En `.pgpass`, `:` y `\` van como `\:` y `\\`.
- Nada de esto vive en `.env.local`: Next lo carga y la app no necesita la
  contraseña del rol `postgres`.
- **Los secretos (`~/.pgpass`, `.env.local`) se editan con `nano` en la
  terminal, nunca en el editor de Cursor**: lo que se selecciona en el IDE entra
  al contexto de Claude. Así se filtró una contraseña de la base el 15-oct-2026,
  y hubo que rotarla.
- `~/.claude/settings.json` tiene reglas `deny` para que Claude no lea
  `~/.pgpass`: `Read(~/.pgpass)`, `Edit(~/.pgpass)`, `Bash(*pgpass*)` y
  `Bash(*PGPASSFILE*)`. Son reglas sobre el texto del comando, no una barrera del
  sistema operativo: un comando que esconda la ruta no lo detienen. psql sigue
  funcionando porque libpq lee el archivo por su cuenta.

`application_name=bioongo-psql` no llega a la base: el pooler lo reemplaza y en
`pg_stat_activity` las conexiones salen como `Supavisor` (verificado el
15-oct-2026). Lo que distingue a un script de psql es `canal: psql` en los claims
y en el asiento manual.

### Plantilla del comando

```
psql service=bioongo -X -v ON_ERROR_STOP=1 \
     -v modo=ensayo -v usuario=<correo> \
     -f migraciones/AAAA-MM-DD-asunto.sql
```

- `-X`: ignora `~/.psqlrc`.
- `-v ON_ERROR_STOP=1`: el primer error detiene psql; la transacción abierta se
  aborta sola y nada queda a medias.
- `-v modo=ensayo` corre todo (guardas, cambios y verificación) y termina en
  `ROLLBACK`; `-v modo=real`, en `COMMIT`. **Sin `modo`, el script no corre**:
  no hay valor por defecto que haga commit.
- **Siempre primero el ensayo.** Se le muestra la salida a Claudio, y el real se
  corre solo con su aprobación del comando.
- `-v usuario=<correo>` va en el comando, nunca en el archivo.
- **Ningún script ni comando de psql usa `\!`** (ni `\setenv`, `\o |`, `\copy …
  program` u otra forma de ejecutar shell desde psql). psql corre con acceso total
  y lee `~/.pgpass`; un `\!` saltaría las reglas `deny` de arriba. Antes de pedir
  aprobación, el script se revisa con `grep -nE '\\!|\\o *\||program'`.

### Esqueleto de un script nuevo

Los meta-comandos `\if` son de psql: un script con este esqueleto ya no corre en
el SQL Editor. Los archivados antes del 15-oct no cambian.

```
\if :{?modo} \else
  DO $$ BEGIN RAISE EXCEPTION 'Falta -v modo=ensayo o -v modo=real'; END $$;
\endif
\if :{?usuario} \else
  DO $$ BEGIN RAISE EXCEPTION 'Falta -v usuario=<correo>'; END $$;
\endif
SELECT :'modo' IN ('ensayo', 'real') AS modo_valido,
       :'modo' = 'real'               AS es_real,
       :'usuario' ~ '^[^@\s]+@[^@\s]+\.[a-z]+$' AS usuario_valido \gset
\if :modo_valido \else
  DO $$ BEGIN RAISE EXCEPTION 'modo debe ser ensayo o real'; END $$;
\endif
\if :usuario_valido \else
  DO $$ BEGIN RAISE EXCEPTION 'usuario no parece un correo'; END $$;
\endif

BEGIN;
-- El usuario de la sesión para toda la transacción: fn_bitacora, los espejos
-- (archivado_por) y fn_firmante_sesion lo leen de aquí, así que ningún asiento
-- sale como sql_directo. canal = psql lo distingue de una sesión de la app.
SELECT set_config('request.jwt.claims',
                  json_build_object('email', :'usuario', 'canal', 'psql')::text, true);

-- … guardas, cambios, asientos manuales (usuario = fn_firmante_sesion(),
--     origen 'migracion', metadata con "canal": "psql") y verificación con RAISE …

\if :es_real
  COMMIT;
  \echo '== REAL: COMMIT =='
\else
  ROLLBACK;
  \echo '== ENSAYO: ROLLBACK, no quedó nada =='
\endif
```

Probado contra producción el 15-oct-2026 con un script de solo lectura: sin
`modo`, se detiene en la primera guarda con código de salida 3 y sin abrir
transacción; con `modo=ensayo`, `fn_firmante_sesion()` devuelve el usuario
pasado, `canal` = `psql`, termina en `ROLLBACK` y, fuera de la transacción, los
claims quedan vacíos (`set_config` local).

Límite conocido: los asientos que escribe `trg_bitacora` no dicen si vinieron de
psql o de la app. Los liga el asiento manual del script (origen `migracion`,
`canal: psql`), que comparte el mismo `created_at` de la transacción.

### Réplica antes del ensayo

Desde el 21-oct-2026 la réplica PGlite vive en el repo (`scripts/replica/`), no en
el scratchpad: `npm run replica -- <script>`. `base.sql` es solo esquema de
`public`, sin filas, generado desde el catálogo con `generar-base.sql` (solo
lectura); su cabecera dice la última migración que incluye, y `correr.mjs` se niega
a correr si hay una archivada más nueva. Se regenera después de cada real. Los
datos de prueba van en `scripts/replica/datos/<nombre del script>`, sintéticos y
sin nombres. El flujo completo está en el skill `migracion-segura`.

### Lecturas

Las verificaciones de solo lectura van por MCP o por psql dentro de una
transacción `read only`:

```
psql service=bioongo -X -v ON_ERROR_STOP=1 -A \
  -c "begin transaction read only" -c "select …" -c "rollback"
```

Prueba de humo del 15-oct-2026 con ese comando: `postgres | 17.6 | on | 36`
(usuario, versión del servidor, transacción de solo lectura, clientes; los 36
cuadraron con el MCP).

### Archivar

**Regla desde el 19-oct-2026 (decisión de Claudio): el archivo de esta carpeta
es byte a byte el que corrió en modo `real`, cabecera incluida, y no se toca
después.**

- El script se copia aquí, con su cabecera, ANTES del modo real, y el real se
  corre desde aquí. La cabecera dice qué hace, cómo se probó (réplica, MCP) y la
  salida del **ensayo**.
- La salida del **real** y la verificación posterior por MCP van en el **mensaje
  del commit** que lo archiva, con el md5 del archivo ejecutado. Así el md5 que
  consta en el commit es el del archivo que está en el repo.
- Antes del real se comprueba el md5 contra el aprobado
  (`echo "<md5>  <archivo>" | md5sum -c -`).

Los scripts archivados hasta el 14-oct-2026 siguen la regla anterior: la cabecera
se reescribió después de correrlos con el resultado, y dicen el md5 de lo
ejecutado («solo cambió esta cabecera»).

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
| `personas` | `codigo_ficha`, `codigo_kyc`, `codigo_pep`, `codigo_ips`, `codigo_ebr` |
| `cuentas_ibkr` | `codigo_cliente` (el código de contrato de la cuenta) |

Las dos últimas nacieron el 19-oct-2026 (`2026-10-16-persona-cuenta-bloque1-expand.sql`),
también `DEFERRABLE INITIALLY IMMEDIATE`. Olvidar un puntero de `personas` en un
renombre no pasa en silencio: la FK falla al comprobar (probado en la réplica).

**Sin FK: el renombre NO las alcanza solo, y ninguna restricción avisa si se
olvidan.**

| tabla | columna | qué pasa si se olvida |
|---|---|---|
| `cliente_bloqueos` | `codigo_cliente` | **El bloqueo desaparece en silencio.** El IPS, el portafolio, la ficha y la bandeja buscan el bloqueo abierto por el código vigente; con el código viejo en la fila, el cliente renombrado opera como si nunca lo hubieran bloqueado. Es la tabla que más importa no olvidar. |
| `firmas_cumplimiento` | `codigo_cliente` | Las firmas del cliente dejan de aparecer al buscarlas por su código. `entidad_id` apunta a ids (coincidencia o bloqueo), no al código: esa columna no se toca. |
| `personas` | `codigo_reporte` | La persona sigue identificada con el código viejo, y la bitácora de `personas` (que se asienta por `codigo_reporte`) queda partida. Es el ID que la identifica: se renombra con el código individual. |

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
| `documentos_expediente_historico` | `codigo_cliente` |
| `documentos_expediente` | `codigo_cliente` (ver abajo) |
| `personas_historico` | `codigo_reporte`, `codigo_ficha`, `codigo_kyc`, `codigo_pep`, `codigo_ips`, `codigo_ebr` |
| `cuentas_ibkr_historico` | `codigo_cliente` |
| `ebr_evaluaciones.entrada`, `snapshot` de los espejos | el jsonb de la fotografía |

**`documentos_expediente` tampoco se renombra, y no puede.** El CHECK
`documentos_ruta_forma` ata `ruta_storage` al código (`tipo/codigo/fecha_hash.pdf`)
y la ruta del objeto en Storage no se renombra nunca: un `UPDATE` del código
falla en ese CHECK. El documento conserva el código con el que se archivó, igual
que la auditoría (`2026-10-14-documentos-expediente.sql`). **Qué pasa si se
olvida:** nada se rompe en la base, pero la ficha del cliente renombrado deja de
mostrar sus documentos si los busca solo por el código vigente; por eso la ficha
los busca por el código vigente **más sus `codigos_alias`**.

Si alguien agrega mañana una tabla con código de cliente, va en una de estas
listas en el mismo commit. Para encontrarlas todas:

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

## Cómo se forma un `codigo_cliente` nuevo

Decisión de Claudio, 6-oct-2026. Todo código que se asigne de aquí en adelante
sigue esta regla:

```
CSPF + U + <2 primeros dígitos de la cuenta IBKR> + <2 últimos dígitos del año de nacimiento>
```

Ejemplo de forma: cuenta `U29…` y año de nacimiento `19xx` → `CSPFU29xx`.

- **Siempre `CSPF`.** No se asignan códigos `CSPM` nuevos.
- **Los `CSPM` existentes NO se renombran**: ya están reportados a la CNBV en el
  R03 J-0315, y lo reportado manda. Renombrarlos abriría el mismo problema que
  resolvió `2026-09-30-conciliacion-codigos-r03.sql`.
- **Los dos insumos se leen del expediente, nunca se suponen.** Sin cuenta IBKR
  o sin fecha de nacimiento en la base, el código no se calcula: el cliente se
  queda con su código provisional hasta que los dos consten.
- **Antes de usarlo, se comprueba que no choque** con `clientes.codigo_cliente`,
  con `codigos_alias` (anterior y actual) ni con un ID ya reportado en el R03.
  La regla no garantiza unicidad: dos clientes con cuenta `U29…` nacidos el
  mismo año dan el mismo código. Si choca, se decide a mano; no se improvisa un
  sufijo.

**Los leads del formulario público** (`app/captura`) entran con un código
provisional `LEAD-#####` aleatorio, porque el formulario solo pide nombre,
correo y celular: no hay cuenta IBKR ni fecha de nacimiento con qué aplicar la
regla. El código definitivo se asigna al darlo de alta. Mientras el lead no
tenga filas hijas, ese cambio es un UPDATE de una sola fila; si ya las tiene, es
un renombre y sigue la lista de comprobación de arriba.
