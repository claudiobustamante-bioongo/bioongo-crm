---
name: migracion-segura
description: Escribir y correr un script SQL contra producción en Bioongo CRM (DDL o corrección de datos): réplica PGlite, ensayo y real por psql con aprobación, archivo en migraciones/ y commit «Día N». Úsalo siempre que haya que cambiar algo en la base.
---
# Migración segura
El detalle y las razones están en `migraciones/README.md`, que manda sobre este resumen.

## Reglas fijas
- El MCP se usa solo para leer. Toda escritura va por `psql service=bioongo`. Su `read_only=true` NO es una garantía (19-nov-2026: `set transaction read write` lo salta): nunca mandar por MCP nada que no sea lectura.
- Canon del 19-nov-2026: Claude corre la réplica, las mutaciones y el ENSAYO sin pedir permiso. El REAL solo con «apruebo el real de <nombre>» de Claudio, después de mostrarle el resumen del ensayo; al correrlo, Claude Code pide confirmación. El push también se aprueba.
- Forma fija de los comandos: `psql service=bioongo -X -v ON_ERROR_STOP=1 -v modo=ensayo|real -v usuario=<correo> -f <archivo>` (las reglas de permisos de .claude/settings.json dependen de ella).
- Sin nombres, RFC, CURP ni correos en scripts ni commits; el usuario va como `-v usuario=`.
- Ningún `\!` ni otra salida a shell desde psql. Nunca leer `~/.pgpass`.

## Pasos
1. Leer por MCP el estado actual de lo que se va a tocar.
2. Escribir el script con el esqueleto del README: guardas `\if` de modo y usuario, `BEGIN`, claims con `canal: psql`, el cuerpo entre `-- <<CUERPO` y `-- CUERPO>>`, verificación con RAISE y cierre `\if :es_real`. Las guardas deben impedir que se re-ejecute.
   - Nombre desde el 22-oct-2026: `AAAA-MM-DD-NN-asunto.sql`, con `NN` el orden de ejecución de ese día (`01`, `02`…), contando también los archivados ese día con el formato viejo. Se usa desde el principio, en el scratchpad, y no se renombran los ya archivados.
   - El asiento manual de bitácora lleva `metadata.script` = ese nombre: de ahí sale la última migración ejecutada.
3. Réplica: `npm run replica -- <script>`, con datos sintéticos en `scripts/replica/datos/<nombre del script>`. Incluir pruebas negativas: la verificación tiene que detener lo que debe.
4. Probar las guardas por MCP contra producción.
5. Correr el ensayo, mostrar la salida y confirmar por MCP que no quedó nada.
6. Copiar a `migraciones/AAAA-MM-DD-asunto.sql`, con una sección EJECUCIÓN en la cabecera (réplica y ensayo); `diff` de lo ejecutable contra lo ensayado; md5.
7. Tomar por MCP las huellas de lo que no debe cambiar. Pedir el real a Claudio con el resumen del ensayo (objetos, grants, réplica y mutaciones, md5, comando exacto); con su «apruebo el real de <nombre>», correrlo desde `migraciones/`, con `md5sum -c` antes.
8. Verificar por MCP de forma independiente, no solo con la salida del script.
9. No tocar el archivo después del real. Regenerar `scripts/replica/base.sql`. Suite completa ANTES del commit. Commit «Día N» con `-F` (salida, verificación y md5). Push solo con aprobación.

## Réplica en el repo
- `@electric-sql/pglite@0.3.7` como devDependency.
- `scripts/replica/base.sql`: el esquema real de `public` (tablas, CHECK, FK, índices, funciones, triggers, RLS, políticas y grants), sin una sola fila de datos. Su cabecera guarda la última migración que incluye, por **orden de ejecución real**, nunca por nombre: `generar-base.sql` la toma de la bitácora (el asiento manual más reciente con `metadata.script`) y, si no hay ninguno, del `-v ultima` que se le pasa.
- Antes de cada uso, si se archivaron migraciones después de esa, se regenera desde el catálogo: `scripts/replica/generar-base.sql` por psql en solo lectura (el comando está en su cabecera), y se verifican por MCP los conteos de tablas, funciones, triggers, políticas y restricciones. `correr.mjs` se niega a correr con una base atrasada; compara por el orden en que cada migración entró a git.
- `scripts/replica/preludio.sql` (escrito a mano): roles de Supabase, sus privilegios por defecto y un `storage` mínimo.
- `scripts/replica/correr.mjs`: carga preludio, base y datos sintéticos, y corre el cuerpo del script en ensayo (sin rastro), real (imprime el resultado para compararlo con el ensayo en producción) y re-ejecución (debe detenerse).
- Los datos de prueba son sintéticos y sin nombres.
