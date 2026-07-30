-- Adds contact details to the `people` reference table, for the kickoff PDF's
-- "Flimp Team" block.
--
-- That block prints four lines per person — Name / Title / Email / Phone — and
-- until now the rows could only supply the first two. Names come from the
-- project's own assignment fields (projectOwner, am, designer, animator,
-- voArtist, otherVendor1/2), and the Title line comes from WHICH of those fields
-- someone was found in, so "Account Manager" is a fact about the assignment
-- rather than about the person. That works, and is why no `title` column is
-- added here.
--
-- Email and phone are different: they are facts about the PERSON, identical on
-- every project they touch. Storing them per-assignment would mean retyping the
-- same address on every kickoff and having it drift. They belong on the person,
-- once, which is what this migration does.
--
-- Both are nullable on purpose. Plenty of rows are external vendors whose
-- contact details Flimp has no reason to publish in a client-facing document,
-- and the panel already renders a person with missing details rather than
-- dropping them from the team block.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

alter table people
  add column if not exists email text,
  add column if not exists phone text;

-- Optional sanity check on email shape. Deliberately loose — it rejects obvious
-- typos like a missing @ without trying to be a full RFC validator, and NULL
-- passes so unfilled rows are unaffected. Drop this statement if you would
-- rather the column accept anything at all.
alter table people
  drop constraint if exists people_email_shape;
alter table people
  add constraint people_email_shape
  check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- No backfill: there is no existing source for these values in the database, so
-- they get filled in by hand in the Supabase table editor. Until a row has them,
-- the kickoff panel shows that person with their contact lines blank rather than
-- omitting them — the gap stays visible instead of looking finished.
