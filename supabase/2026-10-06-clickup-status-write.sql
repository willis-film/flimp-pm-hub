-- The switch for status changes from the hub to ClickUp (api/clickup-status.js).
--   null / 'off'        — no writes; linked items' dot menus are view-only
--   'all'               — every linked task
--   '868ja4y38,...'     — only these ClickUp task ids (testing)
-- Takes effect on the next click — no deploy needed to change it.
--
-- Run once in the Supabase SQL editor. Safe to re-run. Starts with the test
-- task only.

alter table workspace
  add column if not exists clickup_status_write text;

update workspace set clickup_status_write = '868ja4y38' where id = 1;
