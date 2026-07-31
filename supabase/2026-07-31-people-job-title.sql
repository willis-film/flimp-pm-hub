-- Adds `job_title` to the `people` reference table.
--
-- `role` and `job_title` answer different questions and the kickoff PDF needs
-- both. `role` is a small controlled vocabulary — am / pm / designer / animator
-- / vo — that drives which dropdowns someone appears in and who is eligible for
-- the kickoff team block. It has a CHECK constraint precisely because the code
-- switches on it.
--
-- `job_title` is free text and is what actually PRINTS under someone's name in
-- the client-facing team block. Several account managers hold variations —
-- "Senior Account Manager", "Account Director" — that a controlled vocabulary
-- can't carry and shouldn't try to: adding each variant to `role` would mean a
-- constraint change and a code change every time somebody is promoted.
--
-- Nullable. A person with no title falls back to a generic label derived from
-- their role ("Account Manager", "Project Manager"), so an unfilled row still
-- prints something sensible rather than a blank line.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

alter table people
  add column if not exists job_title text;

-- Optional starting point: seed each row's title from its role, then edit the
-- ones that differ. Only touches rows with no title yet, so it's safe to re-run
-- and won't overwrite anything already entered.
--
--   update people set job_title = case role
--     when 'am'       then 'Account Manager'
--     when 'pm'       then 'Project Manager'
--     when 'designer' then 'Designer'
--     when 'animator' then 'Animator'
--     when 'vo'       then 'Voice Over Artist'
--   end
--   where job_title is null or job_title = '';
