begin;

-- Step 4: reviewed promotion of the existing staged messaging configuration.
-- Only Postgres Changes on messages is used by the application. Notifications
-- use authorized refreshes; verification documents must never be published.
do $$
begin
  if not exists (select 1 from pg_class where oid='public.messages'::regclass and relrowsecurity)
    or has_table_privilege('anon','public.messages','SELECT,INSERT,UPDATE,DELETE')
    or has_table_privilege('authenticated','public.messages','INSERT,UPDATE,DELETE')
    or to_regprocedure('public.send_conversation_message(uuid,text)') is null
    or to_regprocedure('public.mark_conversation_read(uuid)') is null then
    raise exception 'Secure database messaging prerequisites have not passed.';
  end if;
  if not exists (select 1 from pg_publication where pubname='supabase_realtime' and not puballtables) then
    raise exception 'Expected scoped Supabase Realtime publication is missing.';
  end if;
  if exists (select 1 from pg_publication_tables where pubname='supabase_realtime'
    and (schemaname<>'public' or tablename<>'messages')) then
    raise exception 'Review unexpected Realtime publication tables before enabling messaging.';
  end if;
  -- Never publish DELETE/TRUNCATE: their payload authorization differs from
  -- INSERT/UPDATE and the client has no use for these events.
  alter publication supabase_realtime set (publish='insert,update');
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;

commit;
