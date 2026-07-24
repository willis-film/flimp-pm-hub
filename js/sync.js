// sync.js — the two header sync buttons.
//
// Both syncs are server-side endpoints that write straight to Supabase; the
// browser's job is only to trigger them and then re-read. There is no cron:
// Vercel Hobby rejects a `crons` block in vercel.json outright, so these
// buttons ARE the schedule. That's also why they live in the page header
// rather than tucked in a rail — they're a routine action, not a setting.
//
// Deliberately no save() after either. Both endpoints own the columns they
// write (clickup_tasks, gmail_emails, gmail_label_defs), and api/db.js
// excludes those from the client's upsert for exactly this reason. Calling
// save() here would POST whatever the page loaded at boot back over a sync
// that just landed. Read-back only.

import { load } from './store.js';
import { A, register } from './bus.js';

// Shared button lifecycle: disable, show progress, show the outcome briefly,
// then restore. Both buttons behave identically, and a failed sync that
// silently restored its label would be indistinguishable from one that never
// ran — so the result is held on screen long enough to read.
async function runSync(btnId, url, label, onDone) {
  const btn = document.getElementById(btnId);
  const original = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  try {
    const res = await fetch(url, { method: 'POST' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `${url} -> ${res.status}`);

    // Re-read the whole db rather than merging the endpoint's response:
    // same path as boot, so there's no second code path to keep correct.
    await load();
    A.render();
    A.renderGmailSidebar();
    A.renderGmailBanner();
    A.renderClickUpSidebar();
    A.renderCuBanner();

    if (btn) btn.textContent = onDone ? onDone(json) : 'Synced';
  } catch (e) {
    console.error(`${label} sync failed:`, e);
    if (btn) btn.textContent = 'Sync failed';
  } finally {
    if (btn) setTimeout(() => { btn.disabled = false; btn.textContent = original; }, 2500);
  }
}

function syncClickUp() {
  return runSync('sync-cu-btn', '/api/sync-clickup', 'ClickUp',
    j => (typeof j.synced === 'number' ? `Synced ${j.synced}` : 'Synced'));
}

// One call covers both labels and threads: api/sync-gmail-threads.js refreshes
// gmail_label_defs as its first step before touching mail, so labels authored
// in Gmail arrive here without a separate trigger. The rail's Sync Labels
// button is now a labels-only fallback rather than a required step.
//
// Reports mode as well as count because the two paths differ enough to matter:
// "backfill" means it was rebuilding from scratch and may not have finished in
// one pass (the endpoint is resumable and continues on the next run), whereas
// "delta" is the cheap steady state.
function syncGmail() {
  return runSync('sync-gmail-btn', '/api/sync-gmail-threads', 'Gmail', j => {
    if (j.skipped) return 'No labels';
    if (j.mode === 'backfill' && j.complete === false) return 'Partial — run again';
    if (j.mode === 'history-expired') return 'Rebuilding';
    if (typeof j.threads === 'number') return `Synced ${j.threads}`;
    return 'Synced';
  });
}

register({ syncClickUp, syncGmail });
