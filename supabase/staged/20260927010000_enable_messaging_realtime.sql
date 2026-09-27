begin;

-- Apply only after the database-only two-account messaging flow passes. RLS on
-- public.messages remains the authorization boundary for Realtime subscribers.
do $$
declare
  v_pubinsert boolean;
  v_pubupdate boolean;
  v_pubdelete boolean;
  v_pubtruncate boolean;
  v_publish text;
begin
  select pubinsert, pubupdate, pubdelete, pubtruncate
  into v_pubinsert, v_pubupdate, v_pubdelete, v_pubtruncate
  from pg_publication
  where pubname = 'supabase_realtime';

  if not found then
    raise exception 'The supabase_realtime publication is missing.';
  end if;

  if not v_pubinsert or not v_pubupdate then
    v_publish := concat_ws(
      ', ',
      'insert',
      'update',
      case when v_pubdelete then 'delete' end,
      case when v_pubtruncate then 'truncate' end
    );

    execute format(
      'alter publication supabase_realtime set (publish = %L)',
      v_publish
    );
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end;
$$;

commit;
