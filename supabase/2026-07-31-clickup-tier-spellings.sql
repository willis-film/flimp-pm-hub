-- Aligns seven Product Tier spellings with ClickUp, which is the standard.
--
-- Each of these differed from ClickUp by case or punctuation alone — one
-- character apart, and identical to a human reading them side by side. The
-- Subtasks dropdown matches EXACTLY, so a tier that synced correctly from
-- ClickUp still rendered blank, with nothing on screen to suggest why. These
-- were the quiet failures; a tier missing from the list entirely at least
-- leaves an obviously empty column.
--
--   Lockton Turnkey 10-min            -> 10-Min
--   Lockton Turnkey 20-min            -> 20-Min
--   Premium Navigation Enhanced Guide -> Premium Navigation-Enhanced Guide
--   Topical-at-a-Glance (TAAG)        -> Topical At a Glance (TAAG)
--   Powerpoint (Full Presentation)    -> PowerPoint (Full Presentation)
--   Powerpoint (Template)             -> PowerPoint (Template)
--   Full-Day On-Site Shoots           -> Full-Day On-site Shoots
--
-- The matching js/data/constants.js fallback was updated in the same commit.
-- That list only applies before Supabase loads, but leaving the two spellings
-- disagreeing would mean the dropdown silently changes contents mid-boot.
--
-- Both statements are keyed on the OLD value, so re-running is a no-op once
-- there is nothing left to rename. Safe to re-run.

-- 1. The option lists themselves — what the dropdowns offer.
update product_options
   set value = case value
     when 'Lockton Turnkey 10-min'            then 'Lockton Turnkey 10-Min'
     when 'Lockton Turnkey 20-min'            then 'Lockton Turnkey 20-Min'
     when 'Premium Navigation Enhanced Guide' then 'Premium Navigation-Enhanced Guide'
     when 'Topical-at-a-Glance (TAAG)'        then 'Topical At a Glance (TAAG)'
     when 'Powerpoint (Full Presentation)'    then 'PowerPoint (Full Presentation)'
     when 'Powerpoint (Template)'             then 'PowerPoint (Template)'
     when 'Full-Day On-Site Shoots'           then 'Full-Day On-site Shoots'
   end
 where kind = 'tier'
   and value in (
     'Lockton Turnkey 10-min', 'Lockton Turnkey 20-min',
     'Premium Navigation Enhanced Guide', 'Topical-at-a-Glance (TAAG)',
     'Powerpoint (Full Presentation)', 'Powerpoint (Template)',
     'Full-Day On-Site Shoots'
   );

-- 2. Rows already carrying an old spelling. Without this, renaming the option
--    list is what BREAKS them: a subtask storing 'Powerpoint (Template)' would
--    no longer match any option and would blank out — the exact failure this
--    migration exists to remove, inflicted on rows that were displaying fine.
update rows
   set product_tier = case product_tier
     when 'Lockton Turnkey 10-min'            then 'Lockton Turnkey 10-Min'
     when 'Lockton Turnkey 20-min'            then 'Lockton Turnkey 20-Min'
     when 'Premium Navigation Enhanced Guide' then 'Premium Navigation-Enhanced Guide'
     when 'Topical-at-a-Glance (TAAG)'        then 'Topical At a Glance (TAAG)'
     when 'Powerpoint (Full Presentation)'    then 'PowerPoint (Full Presentation)'
     when 'Powerpoint (Template)'             then 'PowerPoint (Template)'
     when 'Full-Day On-Site Shoots'           then 'Full-Day On-site Shoots'
   end
 where product_tier in (
     'Lockton Turnkey 10-min', 'Lockton Turnkey 20-min',
     'Premium Navigation Enhanced Guide', 'Topical-at-a-Glance (TAAG)',
     'Powerpoint (Full Presentation)', 'Powerpoint (Template)',
     'Full-Day On-Site Shoots'
   );

-- Verification — expect zero rows from both.
--
--   select value from product_options
--    where kind = 'tier'
--      and value in ('Lockton Turnkey 10-min','Lockton Turnkey 20-min',
--                    'Premium Navigation Enhanced Guide','Topical-at-a-Glance (TAAG)',
--                    'Powerpoint (Full Presentation)','Powerpoint (Template)',
--                    'Full-Day On-Site Shoots');
--
--   select id, name, product_tier from rows
--    where product_tier in ('Lockton Turnkey 10-min','Lockton Turnkey 20-min',
--                           'Premium Navigation Enhanced Guide','Topical-at-a-Glance (TAAG)',
--                           'Powerpoint (Full Presentation)','Powerpoint (Template)',
--                           'Full-Day On-Site Shoots');
