-- Adds sub-items and group labels to kickoff_content.
--
-- ── depth ───────────────────────────────────────────────────────────────────
-- The real Process copy has two levels. A numbered step can carry an indented
-- resource link beneath it:
--
--   2. Scripting - 1 minute = 150 words
--        Open Enrollment Example              <- depth 1, a link
--   ...
--   7. Distribution
--        Distribution Toolkit                 <- depth 1, a link
--
-- depth 0 is a numbered step; depth 1 is an indented line belonging to the step
-- above it. Numbering counts only depth 0, so sub-items don't consume step
-- numbers. This is where the `url` column finally does most of its work — nearly
-- every sub-item is a link to a resource.
--
-- Kept as a depth integer rather than a parent_id: the rows are already ordered
-- by sort_order and a sub-item always follows its parent, so a self-referencing
-- key would add a join and a class of orphan to guard against, for no gain.
--
-- ── type_label ──────────────────────────────────────────────────────────────
-- A display name for a GROUP of product types. Benefit Guide and Companion
-- Piece take the same steps throughout, and without this they render as two
-- identical headed blocks — doubling a section that is already the tightest part
-- of the page. Labelled "Traditional" they become one heading.
--
-- It also shortens First Steps tags, where listing types costs real space:
-- "(Traditional)" against "(Benefit Guide, Companion Piece)".
--
-- Optional. A row without one groups and tags under its plain product type.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

alter table kickoff_content
  add column if not exists depth      int  not null default 0,
  add column if not exists type_label text;

alter table kickoff_content
  drop constraint if exists kickoff_content_depth_check;
alter table kickoff_content
  add constraint kickoff_content_depth_check check (depth in (0, 1));

-- sort_order now has to order sub-items directly after their parent, so the
-- index leads with it within a section.
drop index if exists kickoff_content_lookup;
create index if not exists kickoff_content_lookup
  on kickoff_content (section, sort_order, id);
