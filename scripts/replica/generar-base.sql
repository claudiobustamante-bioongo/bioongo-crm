-- ===========================================================================
-- Genera scripts/replica/base.sql desde el catálogo de producción: SOLO ESQUEMA
-- de public (funciones, tablas, restricciones, índices, triggers, RLS, políticas
-- y grants). Ni una fila de datos.
--
-- Solo lectura. Se corre así (pide permiso por la regla ask de psql):
--   psql service=bioongo -X -A -t -v ON_ERROR_STOP=1 \
--        -v ultima="$(ls migraciones/*.sql | sort | tail -1 | xargs basename)" \
--        -f scripts/replica/generar-base.sql -o scripts/replica/base.sql
-- ===========================================================================
\set QUIET on
\if :{?ultima} \else
  DO $$ BEGIN RAISE EXCEPTION 'Falta -v ultima=<última migración archivada>'; END $$;
\endif
begin transaction read only;

with ddl(orden, sub, linea) as (
  -- 0 · Cabecera
  select 0, '0', '-- ============================================================================'
  union all select 0, '1', '-- base.sql · réplica PGlite · SOLO ESQUEMA de public, sin una fila de datos.'
  union all select 0, '2', '-- Última migración incluida: ' || :'ultima'
  union all select 0, '3', '-- Generado desde el catálogo de producción el ' || to_char(now() at time zone 'America/Mexico_City', 'YYYY-MM-DD HH24:MI') || ' (CDMX)'
  union all select 0, '4', '-- con scripts/replica/generar-base.sql. No se edita a mano: se regenera.'
  union all select 0, '5', '-- ============================================================================'
  union all select 0, '6', 'set check_function_bodies = off;'

  -- 1 · Funciones (antes que las tablas: los triggers y defaults las usan)
  union all
  select 1, p.proname || p.oid::text, pg_get_functiondef(p.oid) || ';'
    from pg_proc p where p.pronamespace = 'public'::regnamespace

  -- 2 · Tablas (columnas, tipos, defaults, NOT NULL)
  union all
  select 2, c.relname,
         'create table public.' || quote_ident(c.relname) || E' (\n' ||
         string_agg('  ' || quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod)
                    || coalesce(' default ' || pg_get_expr(d.adbin, d.adrelid), '')
                    || case when a.attnotnull then ' not null' else '' end, E',\n' order by a.attnum)
         || E'\n);'
    from pg_class c
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
   group by c.relname

  -- 3 · Restricciones que no son FK (PK, UNIQUE, CHECK, EXCLUDE)
  union all
  select 3, conrelid::regclass::text || conname,
         'alter table ' || conrelid::regclass::text || ' add constraint ' || quote_ident(conname) || ' '
         || pg_get_constraintdef(oid) || ';'
    from pg_constraint where connamespace = 'public'::regnamespace and contype in ('p', 'u', 'c', 'x')

  -- 4 · FK (después de todas las tablas)
  union all
  select 4, conrelid::regclass::text || conname,
         'alter table ' || conrelid::regclass::text || ' add constraint ' || quote_ident(conname) || ' '
         || pg_get_constraintdef(oid) || ';'
    from pg_constraint where connamespace = 'public'::regnamespace and contype = 'f'

  -- 5 · Índices que no respaldan una restricción
  union all
  select 5, i.indexrelid::regclass::text, pg_get_indexdef(i.indexrelid) || ';'
    from pg_index i join pg_class c on c.oid = i.indrelid
   where c.relnamespace = 'public'::regnamespace
     and not exists (select 1 from pg_constraint k where k.conindid = i.indexrelid)

  -- 6 · Triggers
  union all
  select 6, tgrelid::regclass::text || tgname, pg_get_triggerdef(oid) || ';'
    from pg_trigger where not tgisinternal
     and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)

  -- 7 · RLS
  union all
  select 7, c.relname, 'alter table public.' || quote_ident(c.relname) || ' enable row level security;'
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relrowsecurity
  union all
  select 7, c.relname || 'z', 'alter table public.' || quote_ident(c.relname) || ' force row level security;'
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relforcerowsecurity

  -- 8 · Políticas
  union all
  select 8, tablename || policyname,
         'create policy ' || quote_ident(policyname) || ' on public.' || quote_ident(tablename)
         || ' as ' || lower(permissive) || ' for ' || lower(cmd) || ' to ' || array_to_string(roles, ', ')
         || coalesce(' using (' || qual || ')', '') || coalesce(' with check (' || with_check || ')', '') || ';'
    from pg_policies where schemaname = 'public'

  -- 9 · Grants de tablas: primero se limpia, luego lo que tiene producción
  union all
  select 9, c.relname || '0',
         'revoke all on public.' || quote_ident(c.relname) || ' from public, anon, authenticated, service_role;'
    from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
  union all
  select 9, c.relname || '1' || x.privilege_type || x.grantee::text,
         'grant ' || x.privilege_type || ' on public.' || quote_ident(c.relname) || ' to '
         || case when x.grantee = 0 then 'public' else quote_ident(x.grantee::regrole::text) end || ';'
    from pg_class c, aclexplode(c.relacl) x
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and (x.grantee = 0 or x.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))

  -- 10 · Grants de funciones
  union all
  select 10, p.oid::regprocedure::text || '0',
         'revoke all on function ' || p.oid::regprocedure::text || ' from public, anon, authenticated, service_role;'
    from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 10, p.oid::regprocedure::text || '1' || x.grantee::text,
         'grant execute on function ' || p.oid::regprocedure::text || ' to '
         || case when x.grantee = 0 then 'public' else quote_ident(x.grantee::regrole::text) end || ';'
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
   where p.pronamespace = 'public'::regnamespace
     and (x.grantee = 0 or x.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))
)
select linea from ddl order by orden, sub;

rollback;
