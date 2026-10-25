// TEST ONLY: sufficient SQL primitives to replay app migrations and exercise
// ordinary PostgreSQL grants, RLS, constraints, triggers, and RPCs. This is not
// GoTrue, PostgREST, the Storage HTTP service, or a production bootstrap.
export const DATABASE_BOOTSTRAP = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  -- Emulate the empty publication supplied by real Supabase. Only a reviewed
  -- app migration adds tables; this does not simulate Realtime delivery.
  create publication supabase_realtime;
  create schema auth;
  create schema storage;
  create schema extensions;
  grant usage on schema public, auth, storage, extensions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  create table auth.users (
    id uuid primary key,
    instance_id uuid,
    aud text,
    role text,
    email text,
    encrypted_password text,
    email_confirmed_at timestamptz,
    raw_app_meta_data jsonb default '{}',
    raw_user_meta_data jsonb default '{}',
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  create table storage.buckets (
    id text primary key,
    name text not null,
    public boolean default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id),
    name text not null,
    owner uuid,
    owner_id text,
    metadata jsonb,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    unique(bucket_id, name)
  );
  alter table storage.objects enable row level security;
  grant select on storage.buckets to anon, authenticated;
  grant all on storage.objects to anon, authenticated, service_role;
  create function storage.foldername(text) returns text[] language sql immutable as $$
    select (string_to_array($1, '/'))[1:greatest(array_length(string_to_array($1, '/'), 1) - 1, 0)]
  $$;
  create function storage.filename(text) returns text language sql immutable as $$
    select (string_to_array($1, '/'))[array_length(string_to_array($1, '/'), 1)]
  $$;
  create function storage.extension(text) returns text language sql immutable as $$
    select case when storage.filename($1) like '%.%' then regexp_replace(storage.filename($1), '^.*\\.', '') else '' end
  $$;
`;
