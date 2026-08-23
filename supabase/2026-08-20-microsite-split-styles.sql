-- Extends Product Style to the two types Microsite was split into:
--
--   Microsite Single-Page
--   Microsite Multi-Page
--
-- Both get the same twelve as everything else, plus Generic below them —
-- identical to what plain Microsite carries. Plain Microsite stays in the
-- catalog alongside them, so no existing project changes type and no stored
-- style stops matching. Nothing is renamed or retired here; this migration only
-- adds, which is why it has none of the row-remapping the 2026-08-17 one needed.
--
-- Same rebuild-don't-diff approach as 2026-08-17: wipe the style options and
-- re-insert the whole catalog, so the file states the intended result outright.
-- Safe because nothing references these rows by id — api/db.js reads only
-- kind/product_type/value/sort_order/active, and projects match options by
-- string value. Safe to re-run for the same reason.
--
-- The rebuild asserts the WHOLE style catalog, so any style option not listed
-- below is deleted. Run the pre-flight first if the table may have drifted.
--
-- Tiers for the two new types are NOT touched here — they came with the split
-- and live in the same table under kind = 'tier', which every statement below
-- excludes.


-- ── PRE-FLIGHT ──────────────────────────────────────────────────────────────
--
-- The current style catalog. Anything here that isn't in the list below will be
-- gone afterwards. Expect the twelve for Video / Presentation Video / Benefit
-- Guide / Companion Piece, and the twelve plus Generic for Microsite.
--
--   select product_type, sort_order, value
--     from product_options
--    where kind = 'style' and active
--    order by product_type, sort_order;


-- 1. Rebuild the style catalog. sort_order is the dropdown order.
delete from product_options where kind = 'style';

insert into product_options (kind, product_type, value, sort_order, active)
select 'style', t.product_type, s.value, s.sort_order, true
  from (values
         ('Video'), ('Presentation Video'),
         ('Microsite'), ('Microsite Single-Page'), ('Microsite Multi-Page'),
         ('Benefit Guide'), ('Companion Piece')
       ) as t(product_type)
  cross join (values
         ('Photo Sketch',     1),
         ('Scrapbook',        2),
         ('Doodle',           3),
         ('Collage',          4),
         ('Classic Photos',   5),
         ('Bold Icons',       6),
         ('Photo Circles',    7),
         ('Grids',            8),
         ('Business Casual',  9),
         ('Perspective',     10),
         ('Retrosketch',     11),
         ('Custom',          12)
       ) as s(value, sort_order);

-- 2. Generic, on the three microsite types only, below the twelve.
insert into product_options (kind, product_type, value, sort_order, active)
select 'style', t.product_type, 'Generic', 90, true
  from (values
         ('Microsite'), ('Microsite Single-Page'), ('Microsite Multi-Page')
       ) as t(product_type);


-- ── VERIFICATION ────────────────────────────────────────────────────────────
--
-- a. Expect seven types: the twelve in order for each, and Generic last on the
--    three microsite ones.
--
--   select product_type, count(*) as options
--     from product_options
--    where kind = 'style' and active
--    group by product_type
--    order by product_type;
--
-- b. Any project whose stored style isn't an option for its own product type.
--    Expect only the Moving Images - Original rows left over from 2026-08-17,
--    if you haven't reassigned them yet.
--
--   select r.id, r.name, r.product_type, r.product_style
--     from rows r
--    where coalesce(r.product_style, '') <> ''
--      and not exists (
--        select 1 from product_options p
--         where p.kind = 'style' and p.active
--           and p.product_type = r.product_type
--           and p.value = r.product_style
--      );
--
-- c. Microsite projects that have a TIER but no style options resolving —
--    catches the case where a project was moved onto a new type whose styles
--    didn't come with it. Expect zero rows.
--
--   select r.product_type, count(*)
--     from rows r
--    where r.product_type ilike '%microsite%'
--      and not exists (
--        select 1 from product_options p
--         where p.kind = 'style' and p.active and p.product_type = r.product_type
--      )
--    group by 1;
