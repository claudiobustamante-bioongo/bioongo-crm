-- ============================================================================
-- Preludio de la réplica PGlite: lo que base.sql necesita y no está en public.
-- Escrito a mano (no sale del catálogo): roles de Supabase, sus privilegios por
-- defecto (pg_default_acl de producción, 14-oct-2026) y un storage mínimo para
-- los scripts que toquen el bucket. Sin datos.
-- ============================================================================
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;

-- Como en producción: lo que se cree después nace con todo para los tres roles;
-- cada migración revoca lo que no corresponde.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create type storage.buckettype as enum ('STANDARD', 'ANALYTICS');
create table storage.buckets (
  id text primary key, name text not null, owner uuid,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  public boolean default false, avif_autodetection boolean default false,
  file_size_limit bigint, allowed_mime_types text[], owner_id text,
  type storage.buckettype default 'STANDARD', versioning_status text default 'DISABLED',
  lifecycle_configuration jsonb, lifecycle_configuration_generation uuid
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz, metadata jsonb, path_tokens text[], version text, owner_id text,
  user_metadata jsonb
);
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expediente', 'expediente', false, 4194304, array['application/pdf']);
