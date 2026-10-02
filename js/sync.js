// sync.js — the header Sync button (ClickUp + Gmail).
//
// Both syncs are server-side endpoints that write straight to Supabase; the
// browser's job is only to trigger them and then re-read. There is no cron:
// Vercel Hobby rejects a `crons` block in vercel.json outright, so this
// button IS the schedule. That's also why it lives in the page header
// rather than tucked in a rail — it's a routine action, not a setting.
//
// Deliberately no save() afterwards. Both endpoints own the columns they
// write (clickup_tasks, gmail_emails, gmail_label_defs), and api/db.js
// excludes those from the client's upsert for exactly this reason. Calling
// save() here would POST whatever the page loaded at boot back over a sync
// that just landed. Read-back only.

import { load } from './store.js';
import { A, register } from './bus.js';

// One button runs both syncs side by side. They were separate buttons, but in
// practice they were always pressed together. Run in parallel, then one
// read-back covers both — load() reads the whole db either way.
//
// Each sync can fail without the other: a half-success still re-reads (so
// whichever did land shows up) and the button names the one that failed. A
// failure that silently restored the label would look like a sync that never
// ran, so the outcome is held on screen long enough to read.
async function post(url) {
  const res = await fetch(url, { method: 'POST' });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `${url} -> ${res.status}`);
  return json;
}

async function syncAll() {
  const btn = document.getElementById('sync-btn');
  const original = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  try {
    const [cu, gm] = await Promise.allSettled([
      post('/api/sync-clickup'),
      // One call covers both labels and threads: api/sync-gmail-threads.js
      // refreshes gmail_label_defs as its first step before touching mail, so
      // labels authored in Gmail arrive without a separate trigger. The rail's
      // Sync Labels button is a labels-only fallback, not a required step.
      post('/api/sync-gmail-threads')
    ]);
    if (cu.status === 'rejected') console.error('ClickUp sync failed:', cu.reason);
    if (gm.status === 'rejected') console.error('Gmail sync failed:', gm.reason);

    // Re-read the whole db rather than merging the endpoints' responses:
    // same path as boot, so there's no second code path to keep correct.
    await load();
    A.render();
    A.renderGmailSidebar();
    A.renderGmailBanner();
    A.renderClickUpSidebar();
    A.renderCuBanner();
    // File any newly-synced 💰-labeled thread into its project's invoices
    // (see js/panels/invoices.js), then refresh the unassigned-invoice-email
    // banner either way — a thread that couldn't be auto-filed still needs to
    // show up there. A re-render is only needed when a row actually changed.
    if (A.attachMoneyLabelInvoices()) A.render();
    A.renderMoneyBanner();

    if (btn) btn.textContent = outcome(cu, gm);
  } catch (e) {
    console.error('Sync failed:', e);
    if (btn) btn.textContent = 'Sync failed';
  } finally {
    if (btn) setTimeout(() => { btn.disabled = false; btn.textContent = original; }, 2500);
  }
}

// What the button says afterwards. Gmail's states outrank a plain "Synced"
// because they ask for something: "backfill" means it was rebuilding from
// scratch and may not have finished in one pass (the endpoint is resumable and
// continues on the next run), whereas "delta" is the cheap steady state.
function outcome(cu, gm) {
  const cuOk = cu.status === 'fulfilled', gmOk = gm.status === 'fulfilled';
  if (!cuOk && !gmOk) return 'Sync failed';
  if (!cuOk) return 'ClickUp failed';
  if (!gmOk) return 'Gmail failed';
  const j = gm.value;
  if (j.skipped) return 'No Gmail labels';
  if (j.mode === 'backfill' && j.complete === false) return 'Partial — run again';
  if (j.mode === 'history-expired') return 'Rebuilding';
  return 'Synced';
}

register({ syncAll });
