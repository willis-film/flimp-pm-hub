-- Adds the sync-state columns api/sync-gmail-threads.js needs on the
-- workspace singleton. Run once in the Supabase SQL editor before the first
-- cron tick.
--
-- gmail_history_id
--   Gmail's per-mailbox change marker. NULL means "no baseline yet" — the
--   endpoint takes the full-backfill path. Once a backfill completes it gets
--   stamped, and every run after that uses cheap history deltas. Text rather
--   than a numeric type: Gmail documents these as opaque and they exceed
--   what a plain integer column safely holds.
--
-- gmail_backfill_token / gmail_backfill_label_idx
--   Resume state for an interrupted backfill. Vercel Hobby caps function
--   execution at 10s and a 90-day pull across several client labels can run
--   past that, so the backfill fetches a bounded batch, saves its position,
--   and continues on the next tick. Both reset once the backfill finishes.

alter table workspace
  add column if not exists gmail_history_id         text,
  add column if not exists gmail_backfill_token     text,
  add column if not exists gmail_backfill_label_idx integer not null default 0;

-- gmail_emails already exists and is read by render.js; ensure it defaults to
-- an empty array rather than NULL so the client's `|| []` guards never see a
-- null that a JSON column would otherwise hand back.
alter table workspace
  alter column gmail_emails set default '[]'::jsonb;

update workspace set gmail_emails = '[]'::jsonb where gmail_emails is null;
