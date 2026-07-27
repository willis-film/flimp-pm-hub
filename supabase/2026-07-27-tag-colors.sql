-- Moves tag colours out of the stylesheet and into the `tags` reference table,
-- so adding a tag is a row in Supabase rather than a code change + deploy.
--
-- Before this, a tag's colour lived in TWO places that had to agree:
--   * css/main.css  .tag-ev … .tag-vbs   — the chips on the strip and in the
--     subtask table, matched by class `tag-${value.toLowerCase()}`
--   * js/utils.js   tagColor()/tagTextColor() — the toggle buttons in the
--     detail panel, applied inline
-- They had drifted into two different palettes for the same tags, and a tag
-- added to this table with no matching CSS class rendered with no colour at all.
--
-- Matching what gmail_label_defs already does (bgColor/textColor per label,
-- applied inline), colour now travels with the row.
--
-- Run once in the Supabase SQL editor. Safe to re-run.

alter table tags
  add column if not exists bg_color     text,
  add column if not exists text_color   text,
  add column if not exists border_color text;

-- Backfill the ten existing tags with the exact chip colours from main.css, so
-- running this migration changes nothing visually. The saturated picker-button
-- palette in utils.js is deliberately NOT carried over — the chip colour is now
-- used in both places, so the picker previews what the strip will show.
update tags set bg_color = v.bg, text_color = v.txt, border_color = v.bdr
from (values
  ('EV',   '#FCEDE1', '#B25E20', '#F3D6BE'),
  ('DP',   '#E1F2F5', '#157A86', '#BFE4EA'),
  ('HRLV', '#F1ECE8', '#7C5E48', '#E0D3C8'),
  ('PPTV', '#F4EAF4', '#8A468A', '#E4CFE4'),
  ('TRAN', '#FBF1D9', '#8A6A12', '#EFDFA8'),
  ('FCV',  '#DFF0F2', '#136470', '#BCE0E6'),
  ('TV',   '#E8EFFB', '#3A5B9A', '#CBD9F4'),
  ('SUB',  '#EEF0EE', '#5A6359', '#D9DDD7'),
  ('RC',   '#DEF0F4', '#0B6E80', '#BBE2EA'),
  ('VBS',  '#E6EFF6', '#335B8A', '#C8DCEC')
) as v(value, bg, txt, bdr)
where tags.value = v.value;

-- Any tag left without a colour still renders: api/db.js only emits an entry
-- when at least one colour column is set, and js/data/constants.js keeps its
-- hardcoded TAG_COLORS defaults for anything the payload doesn't cover. A brand
-- new tag with all three columns NULL falls back to a neutral grey chip rather
-- than an invisible one.
