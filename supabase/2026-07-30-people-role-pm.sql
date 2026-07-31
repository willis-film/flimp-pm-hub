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

-- `role` carries a CHECK constraint, `people_role_check`, which enumerates the
-- allowed values. It rejects 'pm' until it's rebuilt, so the constraint has to
-- be dropped, the rows updated, and the constraint re-added — in that order.
--
-- WRAPPED IN A TRANSACTION deliberately. If the re-added constraint rejects
-- anything — a role value not in the list below, which would mean the table
-- holds a role this codebase doesn't know about — the whole thing rolls back and
-- the table is left exactly as it was. That's much better than dropping the
-- constraint, updating, and then discovering the table can't be re-constrained.
--
-- Note 'owner' is NOT in the new list: after this runs, no row can hold it
-- again. api/db.js still accepts the spelling, which is now purely belt-and-
-- braces for the window where an old deploy meets a migrated table.

begin;

alter table people drop constraint people_role_check;

update people set role = 'pm' where role = 'owner';

alter table people add constraint people_role_check
  check (role in ('am', 'pm', 'designer', 'animator', 'vo'));

commit;

-- Verify: should show a 'pm' count and no 'owner' row.
--
--   select role, count(*) from people group by role order by role;
--
-- If the transaction aborted on the final statement, some role value in the
-- table isn't in the list above. Find it with the query on the line before and
-- add it to the constraint (and to ROLE_BUCKET in api/db.js, or those rows will
-- be dropped from the reference payload).
