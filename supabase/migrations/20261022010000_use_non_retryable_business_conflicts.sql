begin;

-- PostgREST 14 retries SQLSTATE 40001 indefinitely. Application-level stale
-- forms and lifecycle conflicts must return HTTP 409, not impersonate native
-- serialization failures. Preserve every existing guard, lock, signature,
-- function setting, owner and grant; change only the explicit RAISE clause.
do $$
declare
  v_function record;
  v_definition text;
  v_names text[] := '{}'::text[];
  v_expected text[] := array[
    'accept_reservation','cancel_reservation','complete_sale','publish_listing',
    'start_reservation_conversation','update_owned_listing','upsert_meetup'
  ];
begin
  for v_function in
    select p.oid,p.proname from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prosrc like '%using errcode = ''40001''%'
    order by p.proname
  loop
    if not v_function.proname=any(v_expected) then
      raise exception 'Unexpected RPC serialization clause requires manual review.';
    end if;
    v_definition := pg_get_functiondef(v_function.oid);
    execute replace(v_definition,'using errcode = ''40001''','using errcode = ''PT409''');
    v_names := array_append(v_names,v_function.proname);
  end loop;
  if v_names <> v_expected then
    raise exception 'Expected seven versioned business-conflict RPCs; aborting without partial changes.';
  end if;
end;
$$;

commit;
