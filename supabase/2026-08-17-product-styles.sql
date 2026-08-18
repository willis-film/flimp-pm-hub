-- Product Style: one list of twelve for all five types that have styles, and
-- styles extended to Benefit Guide and Companion Piece, which had none.
--
-- Five old options are renamed, one is retired:
--
--   Bold Lines              -> Bold Icons
--   Moving Images - Circles -> Photo Circles   } both collapse into
--   Moving Images - Organic -> Photo Circles   } the one new name
--   Moving Images - Grids   -> Grids
--   Moving Images - Square  -> Classic Photos
--   Moving Images - Original -> retired, no replacement
--
-- Microsite keeps Generic, sorted below the twelve.
--
-- Statement 1 is the one that matters. Renaming the OPTIONS without remapping
-- the PROJECTS already storing the old spelling is what breaks things: the
-- stored value stops matching any option, so the Style dropdown renders with
-- nothing selected and the cell goes blank with nothing to explain why. Same
-- failure the 2026-07-31 tier-spelling migration was written to undo.
--
-- Statement 2 rebuilds the catalog by wiping and re-inserting rather than
-- diffing. Nothing references these rows by id — api/db.js reads only
-- kind/product_type/value/sort_order/active, and rows match options by string
-- value — so a rebuild is safe, and it makes the file say plainly what the
-- result should be. It also means the file is safe to re-run: the rebuild is
-- declarative, and statement 1 matches only old spellings.
--
-- READ BEFORE RUNNING — the rebuild asserts the whole catalog, so any style
-- option in Supabase that isn't listed below is deleted. Run the two pre-flight
-- queries first.
--
-- NOT handled here, needs a human: ClickUp's own "Product Style" custom field
-- is a separate list that api/sync-clickup.js reads verbatim into
-- clickup_tasks. Until the five renames are made in ClickUp too, every sync
-- re-imports the old spellings. Statement 1 cleans what's in the table now; the
-- next sync overwrites it.


-- ── PRE-FLIGHT — run these two on their own, first ───────────────────────────
--
-- a. The current catalog. Anything here that isn't in statement 2's list will
--    be gone afterwards. Expect the eight-option Video / Presentation Video /
--    Microsite lists and nothing else.
--
--   select product_type, sort_order, value
--     from product_options
--    where kind = 'style' and active
--    order by product_type, sort_order;
--
-- b. Projects that lose their style when Moving Images - Original is retired.
--    They aren't touched by anything below, so they'll show a blank Style until
--    someone picks a replacement. Empty result means the removal is free.
--
--   select id, name, product_type, product_style
--     from rows
--    where product_style = 'Moving Images - Original';


-- 1. Remap the projects and synced tasks already storing a renamed style.
--    Keyed on the old value, so re-running is a no-op.
update rows
   set product_style = case product_style
     when 'Bold Lines'              then 'Bold Icons'
     when 'Moving Images - Circles' then 'Photo Circles'
     when 'Moving Images - Organic' then 'Photo Circles'
     when 'Moving Images - Grids'   then 'Grids'
     when 'Moving Images - Square'  then 'Classic Photos'
   end
 where product_style in ('Bold Lines', 'Moving Images - Circles',
                         'Moving Images - Organic', 'Moving Images - Grids',
                         'Moving Images - Square');

update clickup_tasks
   set product_style = case product_style
     when 'Bold Lines'              then 'Bold Icons'
     when 'Moving Images - Circles' then 'Photo Circles'
     when 'Moving Images - Organic' then 'Photo Circles'
     when 'Moving Images - Grids'   then 'Grids'
     when 'Moving Images - Square'  then 'Classic Photos'
   end
 where product_style in ('Bold Lines', 'Moving Images - Circles',
                         'Moving Images - Organic', 'Moving Images - Grids',
                         'Moving Images - Square');


-- 2. Rebuild the style catalog. sort_order is the dropdown order.
delete from product_options where kind = 'style';

insert into product_options (kind, product_type, value, sort_order, active)
select 'style', t.product_type, s.value, s.sort_order, true
  from (values
         ('Video'), ('Presentation Video'), ('Microsite'),
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

insert into product_options (kind, product_type, value, sort_order, active)
values ('style', 'Microsite', 'Generic', 90, true);


-- ── VERIFICATION ────────────────────────────────────────────────────────────
--
-- a. Expect the twelve in order for each of the five types, Generic last on
--    Microsite.
--
--   select product_type, sort_order, value
--     from product_options
--    where kind = 'style' and active
--    order by product_type, sort_order;
--
-- b. Any project whose stored style isn't an option for its own product type —
--    the blank-cell failure, from any cause. Expect ONLY the Moving Images -
--    Original rows from pre-flight (b); investigate anything else.
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
