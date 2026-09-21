-- Run BEFORE 20260917030000_secure_student_verification_workflow.sql.
-- The rejected/inconsistent counts should be zero and the bucket count one.
-- Fix legacy records deliberately; this script does not modify or delete history.

select
  count(*) filter (
    where status = 'rejected'
      and (
        rejection_reason is null
        or char_length(btrim(rejection_reason)) not between 5 and 500
      )
  ) as rejected_rows_with_noncompliant_reasons,
  count(*) filter (
    where status = 'pending'
      and (
        reviewed_by is not null
        or reviewed_at is not null
        or rejection_reason is not null
      )
  ) as inconsistent_pending_rows
from public.verifications;

select count(*) as verification_buckets_found
from storage.buckets
where id = 'student-verifications';
