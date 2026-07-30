-- Renames the `people.role` value 'owner' to 'pm'.
--
-- The role has always meant "project manager"; 'owner' was named after the
-- field that consumes it rather than after the job. Now that the kickoff PDF
-- prints the role in a client-facing document, the value has to read as what it
-- is — "Project Manager", not "owner".
--
-- WHAT DOES NOT CHANGE: the Info panel's "Flimp project owner" and "Item owner"
-- fields keep their names, and the reference payload keeps its `ownerList` key.
-- Those label a project's owner — a fact about the project — which is a
-- different thing from the person's role. Only the role vocabulary moves.
--
-- ORDER OF OPERATIONS: api/db.js accepts BOTH spellings, so this migration and
-- the deploy don't have to be simultaneous and can run in either order.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

-- If `role` carries a CHECK constraint listing the allowed values, the update
-- below fails until the constraint knows about 'pm'. Run this first to see
-- whether one exists and what it's called:
--
--   select con.conname, pg_get_constraintdef(con.oid)
--   from pg_constraint con
--   join pg_class rel on rel.oid = con.conrelid
--   where rel.relname = 'people' and con.contype = 'c';
--
-- Then drop it, run the update, and re-add it with 'pm' in place of 'owner'.
-- If that query returns no rows, there's no constraint and the update just works.

update people set role = 'pm' where role = 'owner';

-- Verify: this should return the new counts, with no 'owner' row left.
--
--   select role, count(*) from people group by role order by role;
