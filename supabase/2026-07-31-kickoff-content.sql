-- The kickoff PDF's Process and First Steps copy, keyed by product type.
--
-- Replaces the TYPE_CONTENT placeholder in js/panels/templates.js, which shipped
-- with empty arrays purely so the assembly logic could be built before the copy
-- existed. Putting it here is the same reasoning as the tag colours: this is
-- client-facing wording that gets revised by whoever owns how Flimp describes
-- its process, and revising it should be a row edit rather than a code change,
-- a commit and a deploy.
--
-- SHAPE. One row per line of copy. A project's selected deliverables are grouped
-- by product type, and each type present emits its own headed block — Process
-- numbered and restarting at 1 per type, First Steps bulleted. A type with no
-- rows here contributes nothing and is reported in the panel as unauthored, so a
-- silent gap is impossible.
--
-- `id` is load-bearing, not decoration. The panel stores per-project tweaks —
-- a line switched off, or its wording changed for one kickoff — keyed against
-- these rows. Keying on position instead would mean reordering or deleting a row
-- silently repointed somebody's saved tweak at a different line.
--
-- `url` makes the whole line a hyperlink in the generated PDF. Null or blank
-- means plain text. Note this is only possible because the generator DRAWS these
-- regions rather than filling AcroForm fields: a form field's value is plain
-- text with one appearance and cannot carry a link at all.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists kickoff_content (
  id           bigserial primary key,
  -- Matches product_types.value. Not a foreign key: product_types is itself a
  -- soft reference table whose rows get deactivated rather than deleted, and a
  -- hard FK would block renaming a type without a coordinated migration.
  product_type text    not null,
  section      text    not null check (section in ('process', 'first_steps')),
  value        text    not null,
  -- Optional. When set, the whole line becomes a link in the PDF.
  url          text,
  sort_order   int,
  active       boolean not null default true
);

-- Ordering within a type+section is the order the lines print, so it needs to be
-- cheap to read in that order.
create index if not exists kickoff_content_lookup
  on kickoff_content (product_type, section, sort_order);

-- Deliberately NOT seeded. The real copy hasn't been written, and inventing
-- steps that then read as approved is worse than an obviously empty table — the
-- panel names every unauthored product type, so gaps are visible rather than
-- silent.
--
-- Authoring notes, from the actual geometry of the template's regions:
--
--   * Both budgets are for the WHOLE document, not per type, and each type
--     costs one line for its heading plus a blank separator between blocks.
--   * Process holds ~11 lines at its design size and ~17 at the smallest size
--     worth printing. On a three-type project that is ~6 steps total, so aim
--     for 2-4 steps per type.
--   * First Steps holds ~5 lines, ~8 at the smallest. Three types spend all 5
--     on headings alone — so aim for ONE short bullet per type.
--   * Lines wrap past roughly 44 characters (Process) and 59 (First Steps), and
--     a wrapped line costs two. The numbering prefix counts.
--
-- The panel meters live against these as you type, so tune there rather than
-- guessing here.
