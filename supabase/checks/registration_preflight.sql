-- Read-only checks to run before applying the Step 3 registration migration.
-- Each result should be zero before the new profile constraints are validated.
-- Resolve real student records deliberately; do not bulk-delete identity data.

select count(*) as profiles_with_incompatible_student_id
from public.profiles
where student_id_number is not null
  and (
    char_length(btrim(student_id_number)) not between 4 and 50
    or upper(btrim(student_id_number)) !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'
  );

select count(*) as profiles_with_incompatible_course
from public.profiles
where course is not null
  and upper(btrim(course)) <> all (array[
    'AB-EL', 'AB-LIT', 'BPA', 'AB-POLS', 'AB-PSYCH',
    'BSA', 'BSBA-FM', 'BSBA-HRM', 'BSBA-MM', 'BSBA-OM',
    'BSMA', 'BSOA', 'BSREM', 'BSCRIM', 'BSCA',
    'BEED', 'BPED', 'BSED-ENGLISH', 'BSED-FILIPINO',
    'BSED-MATH', 'BSED-SCIENCE', 'BSED-SOCSTUD', 'BSNED',
    'BSCE', 'BSCPE', 'BSECE', 'BSEE', 'BSIE', 'BSME',
    'BSHM', 'ACT', 'BSCS', 'BSCSAI', 'BSIT', 'BSN', 'BSSW',
    'OTHER'
  ]::text[]);

select count(*) as profiles_with_year_level_six
from public.profiles
where year_level = 6;

select count(*) as verifications_with_year_level_six
from public.verifications
where year_level_snapshot = 6;
