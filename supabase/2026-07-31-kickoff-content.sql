-- The kickoff PDF's Process and First Steps copy.
--
-- Replaces the TYPE_CONTENT placeholder in js/panels/templates.js. Same
-- reasoning as the tag colours: this is client-facing wording that gets revised
-- by whoever owns how Flimp describes its process, and revising it should be a
-- row edit rather than a code change, a commit and a deploy.
--
-- ── ONE ROW PER DISTINCT LINE, NOT PER CATEGORY ─────────────────────────────
-- The obvious shape would be one row per product type, listing that type's
-- steps. The real content doesn't fit it. Across Video, Microsite and Benefit
-- Guide / Companion Piece, seven distinct First Steps lines cover six
-- category-and-variant combinations: "Logos & Branding" applies to all three,
-- "Intake Form" to two, and only a few are genuinely type-specific.
--
-- Keyed by category, shared lines get stored several times and drift apart —
-- which had already happened in the first draft of the copy, where the same step
-- was written "Intake Form" for one type and "Submit Intake Form" for another.
--
-- So a row describes a LINE and says where it APPLIES:
--
--   product_types  null or empty  -> every product type
--                  {Video}        -> only that type
--   new_or_update  null           -> both new and update projects
--                  'New'          -> only new
--
-- Rename a shared line once and it changes everywhere it appears.
--
-- ── HOW THE TWO SECTIONS RENDER ─────────────────────────────────────────────
-- They differ, because their content does:
--
--   process      Grouped by product type under a heading, numbered, restarting
--                at 1 per type. Different types have genuinely different
--                production stages, so the grouping carries information.
--
--   first_steps  ONE merged, deduplicated, bulleted list — no headings. A line
--                that doesn't apply to every type in the project is tagged with
--                the ones it does, e.g. "Style Selection (Video)". Grouping this
--                section by type printed "Logos & Branding" three times on a
--                three-type project and ran 12 lines into a region that holds
--                about 5.
--
-- `id` is load-bearing. The panel keys per-project tweaks — a line switched off,
-- reworded, or its link replaced — against it. Anything positional would
-- silently repoint a saved tweak the moment a row was reordered or deleted.
--
-- `url` makes the whole line a hyperlink in the generated PDF. Only possible
-- because the generator DRAWS these regions rather than filling AcroForm fields,
-- whose values are plain text with one appearance and cannot carry a link.
--
-- Run once in the Supabase SQL editor. Safe to re-run, and safe to run over the
-- earlier single-`product_type` version of this table — see the migration block
-- at the bottom, which is a no-op on a fresh install.

create table if not exists kickoff_content (
  id            bigserial primary key,
  section       text    not null check (section in ('process', 'first_steps')),
  value         text    not null,
  -- Optional. When set, the whole line becomes a link in the PDF. Needs the
  -- full address including https:// — the panel warns if it doesn't look like one.
  url           text,
  -- Which product types this line applies to. NULL or empty means every type.
  -- Not a foreign key to product_types: that's a soft reference table whose rows
  -- are deactivated rather than deleted, and a hard FK would block renaming a
  -- type without a coordinated migration.
  product_types text[],
  -- NULL means the line applies to both new and update work.
  new_or_update text    check (new_or_update in ('New', 'Update')),
  sort_order    int,
  active        boolean not null default true
);

create index if not exists kickoff_content_lookup
  on kickoff_content (section, sort_order);

-- ── UPGRADE FROM THE EARLIER SHAPE ──────────────────────────────────────────
-- The first version of this file had a singular `product_type text` column and
-- no variant axis. These statements convert it in place and are a no-op on a
-- fresh table. Non-destructive: the old column's values are carried into the new
-- array before it's dropped.

alter table kickoff_content add column if not exists product_types text[];
alter table kickoff_content add column if not exists new_or_update text;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'kickoff_content' and column_name = 'product_type'
  ) then
    execute $mig$
      update kickoff_content
         set product_types = array[product_type]
       where product_types is null and product_type is not null
    $mig$;
    execute 'alter table kickoff_content drop column product_type';
  end if;
end $$;

-- Deliberately NOT seeded. The copy is authored directly in the Supabase table
-- editor — that was the whole argument for putting it here. The panel names
-- every unauthored product type, so gaps stay visible rather than silent.
--
-- Authoring notes, from the actual geometry of the template's regions:
--
--   * Both budgets are for the WHOLE document, not per type.
--   * Process holds ~11 lines at its design size and ~17 at the smallest size
--     worth printing, and spends one line per type on headings plus a blank
--     between blocks. On a three-type project that leaves ~6 steps, so aim for
--     2-4 per type.
--   * First Steps holds ~5 lines, ~8 at the smallest, and spends nothing on
--     chrome now that it's one merged list. Deduplication means a shared line
--     costs one line however many types are in the project.
--   * Lines wrap past roughly 44 characters (Process) and 59 (First Steps), and
--     a wrapped line costs two. Numbering prefixes and "(Video)" tags count.
--
-- The panel meters live against these as you type, so tune there.
