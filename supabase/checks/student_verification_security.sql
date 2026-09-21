-- Read-only post-migration checks for Step 4. Expected values are described
-- in supabase/README.md. Run with the Supabase SQL Editor after applying the
-- Step 4 migration; these catalog checks do not replace two-account RLS tests.

select
  id,
  public as is_public,
  file_size_limit,
  allowed_mime_types
from storage.buckets
where id = 'student-verifications';

select
  count(*) filter (
    where role = 'admin' and account_status = 'active'
  ) as active_admin_count,
  count(*) filter (where role = 'admin') as total_admin_count
from public.profiles;

select user_id, count(*) as pending_count
from public.verifications
where status = 'pending'
group by user_id
having count(*) > 1;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'verifications'
  and indexname = 'one_pending_verification_per_user';

select relrowsecurity as verifications_rls_enabled
from pg_class
where oid = 'public.verifications'::regclass;

select
  policyname,
  permissive,
  roles,
  cmd
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname in (
    'Anonymous users cannot access verification objects',
    'Verification objects stay private',
    'Verification uploads stay owner scoped',
    'Verification objects cannot be replaced',
    'Submitted verification objects cannot be deleted',
    'Students can upload their verification document',
    'Students can read their verification documents',
    'Admins can read verification documents',
    'Students can delete unsubmitted verification documents'
  )
order by policyname;

select policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'verifications'
order by policyname;

select
  has_table_privilege('anon', 'public.verifications', 'SELECT')
    as anonymous_can_read_verifications,
  has_column_privilege(
    'authenticated', 'public.verifications', 'user_id', 'INSERT'
  ) as students_can_insert_verification_rows_directly,
  has_column_privilege(
    'authenticated', 'public.profiles', 'role', 'UPDATE'
  ) as students_can_update_role,
  has_column_privilege(
    'authenticated', 'public.profiles', 'verification_status', 'UPDATE'
  ) as students_can_update_verification_status,
  has_function_privilege(
    'authenticated', 'public.submit_verification(uuid,text)', 'EXECUTE'
  ) as students_can_call_submission_rpc,
  has_function_privilege(
    'anon', 'public.submit_verification(uuid,text)', 'EXECUTE'
  ) as anonymous_can_call_submission_rpc,
  has_function_privilege(
    'authenticated', 'public.review_verification(uuid,text,text)',
    'EXECUTE'
  ) as authenticated_can_call_review_rpc,
  has_function_privilege(
    'anon', 'public.review_verification(uuid,text,text)', 'EXECUTE'
  ) as anonymous_can_call_review_rpc;

-- The last EXECUTE check is expected to be true: the review RPC itself
-- checks active-admin status and refuses students at runtime.
