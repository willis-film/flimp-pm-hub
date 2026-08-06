-- Adds a third section to kickoff_content: 'links'.
--
-- These are the Resources buttons along the foot of page 1 — Flimp Styles, VO
-- Options, Distribution Toolkit, How To Use ReviewStudio, How To Use Boords.
--
-- ── WHY A SECTION RATHER THAN A TABLE ───────────────────────────────────────
-- A link row needs exactly what a content row already has: a label, a URL, and
-- the product types it applies to. A separate table would duplicate that shape,
-- duplicate the loader, and duplicate the product-type matching the panel
-- already does — for no column it doesn't share. It also keeps all the kickoff
-- copy in one place to author.
--
-- ── HOW THE EXISTING COLUMNS ARE USED ───────────────────────────────────────
--   value          the button's label. KEEP IT SHORT — the button is a fixed
--                  150pt pill and the text does not wrap. "Flimp Styles" fits;
--                  "Benefit Guide & Companion Piece Style Options" does not.
--                  This is the whole reason links are their own section rather
--                  than being derived from the depth-1 lines under a process
--                  step, whose text is written to read as a sentence.
--   url            required in practice. A link row without one is a button
--                  that does nothing, so the panel should skip it.
--   product_types  which projects show the button. NULL or empty = every
--                  project, which is right for Distribution Toolkit. VO Options
--                  and Boords are Video; ReviewStudio is Traditional/Microsite.
--   sort_order     left-to-right order of the buttons.
--   active         false hides a button without deleting the row.
--
-- Unused by links, and left alone rather than constrained away: `depth` (there
-- are no sub-items in a row of buttons), `new_or_update`, and `type_label`
-- (grouping is a Process concern). They stay nullable/defaulted so this
-- migration doesn't have to touch rows in the other two sections.
--
-- ── THE LOADER MUST CHANGE IN THE SAME DEPLOY ───────────────────────────────
-- api/db.js buckets rows with
--
--     const bucket = r.section === 'first_steps' ? 'firstSteps' : 'process';
--
-- so ANY unrecognised section falls through to `process`. Run this migration
-- and add link rows without updating that line, and the five buttons print as
-- numbered process steps on every kickoff. Ship them together.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

-- The constraint is the only thing standing in the way — every column links
-- needs already exists. Dropped by its auto-generated name from the original
-- inline `check (section in (...))`; the `if exists` makes a re-run a no-op.
alter table kickoff_content
  drop constraint if exists kickoff_content_section_check;

alter table kickoff_content
  add constraint kickoff_content_section_check
  check (section in ('process', 'first_steps', 'links'));

-- Deliberately NOT seeded, for the same reason the other two sections aren't:
-- the copy is authored in the Supabase table editor, and hardcoding it here
-- would mean two places to change a URL. The expected shape, for reference:
--
--   insert into kickoff_content (section, value, url, product_types, sort_order)
--   values
--     ('links', 'Flimp Styles',            'https://flimp.live/styles',                        null,                                        1),
--     ('links', 'VO Options',              'https://flimp.live/vo-options',                    array['Video'],                              2),
--     ('links', 'Distribution Toolkit',    'https://flimp.live/Distribution-Resource-Center',  null,                                        3),
--     ('links', 'How To Use ReviewStudio', 'https://flimp.live/reviewstudio',                  array['Microsite','Benefit Guide','Companion Piece'], 4),
--     ('links', 'How To Use Boords',       'https://flimp.live/boords',                        array['Video'],                              5);
