-- Definition-only inventory. Never selects student rows, paths or credentials.
-- Compare with a fresh migration replay; history checks alone cannot detect DDL.
with app_relations as (
  select c.*,n.nspname from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind in ('r','p','v','m','S')
  and not exists(select 1 from pg_catalog.pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')
), app_functions as (
  select p.*,n.nspname from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private')
  and not exists(select 1 from pg_catalog.pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')
), inventory as (
  select 'relation' as kind,c.nspname||'.'||c.relname as identity,
    jsonb_build_object('kind',c.relkind,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
      'replicaIdentity',c.relreplident,'options',coalesce(to_jsonb(c.reloptions),'[]'::jsonb),
      'view',case when c.relkind in ('v','m') then pg_catalog.pg_get_viewdef(c.oid,true) end) as definition
  from app_relations c
  union all
  select 'column',c.nspname||'.'||c.relname||'.'||a.attname,
    jsonb_build_object('type',pg_catalog.format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
      'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,
      'position',a.attnum,'collation',(select n.nspname||'.'||co.collname from pg_catalog.pg_collation co join pg_catalog.pg_namespace n on n.oid=co.collnamespace where co.oid=a.attcollation))
  from app_relations c join pg_catalog.pg_attribute a on a.attrelid=c.oid
  left join pg_catalog.pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
  where a.attnum>0 and not a.attisdropped
  union all
  select 'constraint',c.nspname||'.'||c.relname||'.'||k.conname,
    jsonb_build_object('sql',pg_catalog.pg_get_constraintdef(k.oid,true),'validated',k.convalidated)
  from app_relations c join pg_catalog.pg_constraint k on k.conrelid=c.oid
  where k.contype<>'n' -- PG18 represents NOT NULL here too; attnotnull above is portable.
  union all
  select 'index',c.nspname||'.'||c.relname||'.'||i.relname,
    jsonb_build_object('sql',pg_catalog.pg_get_indexdef(x.indexrelid),'valid',x.indisvalid,'ready',x.indisready)
  from app_relations c join pg_catalog.pg_index x on x.indrelid=c.oid
  join pg_catalog.pg_class i on i.oid=x.indexrelid
  union all
  select 'policy',n.nspname||'.'||c.relname||'.'||p.polname,
    jsonb_build_object('permissive',p.polpermissive,'command',p.polcmd,
      'roles',(select jsonb_agg(case when r=0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(r) end order by r) from unnest(p.polroles) r),
      'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid))
  from pg_catalog.pg_policy p join pg_catalog.pg_class c on c.oid=p.polrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') or (n.nspname='storage' and c.relname='objects')
  union all
  select 'function',p.nspname||'.'||p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||')',
    jsonb_build_object('body',p.prosrc,'language',l.lanname,'definer',p.prosecdef,
      'volatility',p.provolatile,'strict',p.proisstrict,'leakproof',p.proleakproof,'parallel',p.proparallel,
      'args',pg_catalog.pg_get_function_arguments(p.oid),'returns',pg_catalog.pg_get_function_result(p.oid),
      'config',coalesce(to_jsonb(p.proconfig),'[]'::jsonb))
  from app_functions p join pg_catalog.pg_language l on l.oid=p.prolang
  union all
  select 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,
    jsonb_build_object('sql',pg_catalog.pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled)
  from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid=t.tgrelid
  join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  join app_functions f on f.oid=t.tgfoid where not t.tgisinternal
  union all
  select 'table-grant',c.nspname||'.'||c.relname||':'||r.role||':'||v.privilege,
    to_jsonb(pg_catalog.has_table_privilege(r.role,c.oid,v.privilege))
  from app_relations c cross join (values ('anon'),('authenticated')) r(role)
  cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER')) v(privilege)
  where c.relkind<>'S'
  union all
  select 'column-grant',c.nspname||'.'||c.relname||'.'||a.attname||':'||r.role||':'||v.privilege,
    to_jsonb(pg_catalog.has_column_privilege(r.role,c.oid,a.attnum,v.privilege))
  from app_relations c join pg_catalog.pg_attribute a on a.attrelid=c.oid
  cross join (values ('anon'),('authenticated')) r(role)
  cross join (values ('SELECT'),('INSERT'),('UPDATE'),('REFERENCES')) v(privilege)
  where c.relkind<>'S' and a.attnum>0 and not a.attisdropped
  union all
  select 'function-grant',p.nspname||'.'||p.proname||'('||pg_catalog.pg_get_function_identity_arguments(p.oid)||'):'||r.role,
    to_jsonb(pg_catalog.has_function_privilege(r.role,p.oid,'EXECUTE'))
  from app_functions p cross join (values ('anon'),('authenticated')) r(role)
  union all
  select 'type',n.nspname||'.'||t.typname,
    jsonb_build_object('kind',t.typtype,'base',pg_catalog.format_type(t.typbasetype,t.typtypmod),
      'notNull',t.typnotnull,'default',t.typdefault,
      'enum',(select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_catalog.pg_enum e where e.enumtypid=t.oid))
  from pg_catalog.pg_type t join pg_catalog.pg_namespace n on n.oid=t.typnamespace
  where n.nspname in ('public','private') and t.typtype in ('e','d')
  and not exists(select 1 from pg_catalog.pg_depend d where d.classid='pg_type'::regclass and d.objid=t.oid and d.deptype='e')
  union all
  select 'sequence-grant',c.nspname||'.'||c.relname||':'||r.role||':'||v.privilege,
    to_jsonb(pg_catalog.has_sequence_privilege(r.role,c.oid,v.privilege))
  from app_relations c cross join (values ('anon'),('authenticated')) r(role)
  cross join (values ('SELECT'),('USAGE'),('UPDATE')) v(privilege) where c.relkind='S'
  union all
  select 'schema-grant',n.nspname||':'||r.role||':'||v.privilege,
    to_jsonb(pg_catalog.has_schema_privilege(r.role,n.oid,v.privilege))
  from pg_catalog.pg_namespace n cross join (values ('anon'),('authenticated')) r(role)
  cross join (values ('USAGE'),('CREATE')) v(privilege) where n.nspname in ('public','private')
  union all
  select 'bucket',b.id,jsonb_build_object('name',b.name,'public',b.public,'size',b.file_size_limit,'mimeTypes',b.allowed_mime_types)
  from storage.buckets b
)
select kind,identity,definition from inventory order by kind,identity;
