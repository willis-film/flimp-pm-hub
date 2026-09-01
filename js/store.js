// store.js — application state + persistence layer.
//
// NAME: this file was js/db.js until it collided once too often with
// api/db.js, the server-side Supabase proxy. Two files with the same basename
// in different directories are indistinguishable once downloaded or dragged
// between folders, and putting the serverless one here breaks the whole app
// in a way that looks unrelated: the browser tries to resolve
// '@supabase/supabase-js', fails on the bare specifier, and the entire module
// graph dies before render() ever runs — so the strips simply never draw.
// Renamed so that mistake is no longer possible to make.
//
// This wraps the single `db` state object and all read/write persistence.
// Persists via the /api/db Supabase proxy (see api/db.js) — every caller
// throughout the app still just calls save() and load() the same way; that
// contract hasn't changed, only what's behind it.

import { SEED_DB } from './data/seed.js';
import { applyReference } from './data/constants.js';
import { isDetached } from './utils.js';

const LAST_OPEN_KEY = 'flimp_last_open'; // per-device marker, not project data — stays local, see dailyIOReset() below.
const API = '/api/db';

// Live, mutable state singleton. Imported by every module; mutated in place,
// then persisted via save(). Deep-cloned from SEED_DB so the seed stays
// pristine — this clone now also serves as the offline/fetch-failure
// fallback (see load()).
export const db = structuredClone(SEED_DB);

// ── PERSISTENCE ──────────────────────────────────────────────────────────────
// save(): POSTs the whole `db` object to the Supabase proxy. All ~48 call
// sites across the app call this fire-and-forget (`save(); render();`) and
// none of them await it — that contract is preserved here on purpose, so
// none of those call sites needed to change.
//
// Debounced (400ms trailing): rapid edits — typing, drag-reordering,
// repeated toggles — would otherwise fire one full-table POST per keystroke.
//
// THE WRITE GATE — read this before touching anything below.
//
// On 2026-08-31 a week of work was destroyed by this file. A laptop had the
// board open in a tab last loaded on the 25th and suspended, not closed. The
// lid opened, the tab resumed from memory without reloading, one click fired
// save(), and the POST carried a week-old `db`. api/db.js treats the payload
// as the whole truth, so every row created after the 25th was deleted. The
// free Supabase tier has no backups, so none of it came back.
//
// Two rules came out of that, and both are enforced here rather than left to
// callers, because there are ~48 call sites and one that forgets is enough:
//
//   1. NEVER WRITE BEFORE READING. `loaded` gates every save. Until a GET has
//      succeeded, `db` still holds the SEED_DB demo clone, and posting that
//      would delete the real board and replace it with sample data. This is
//      not hypothetical: dailyIOReset() calls save() unprompted on the first
//      open of each day, so a single failed GET at breakfast was enough.
//
//   2. ONLY DELETE WHAT YOU'VE SEEN. `knownIds` travels with every save — the
//      ids present at the last successful load, plus anything created in this
//      tab since. api/db.js deletes only within that set, so a row created on
//      another machine after this tab loaded is invisible to us and cannot be
//      destroyed by our save. Deliberate deletions still work: a row we loaded
//      and then removed is in knownIds and absent from rows, which is exactly
//      the signal to delete it.
//
// Neither rule replaces the other. (1) stops us writing nonsense; (2) limits
// the blast radius of a stale but otherwise legitimate write.
let loaded = false;      // sticky: set by the first successful load(), never cleared
let knownIds = new Set(); // row ids this tab has seen — see rule 2 above
let saveTimer = null;
let retryTimer = null;
let retryDelay = 0;
let failedSave = false;

// The save state shown in the header. A silent failure is what let a whole
// week go missing without anyone noticing: the board renders from the
// in-memory `db`, so an unsaved edit looks identical to a saved one until the
// next reload. Anything other than 'ok' is on screen until it clears.
function setSaveState(state, detail) {
  const el = document.getElementById('save-status');
  if (!el) return;
  const MSG = {
    ok:      '',
    saving:  '',
    failed:  'Not saved — retrying…',
    offline: 'Not connected — changes are not being saved'
  };
  const text = MSG[state] || '';
  el.textContent = text;
  el.title = detail || '';
  el.classList.toggle('hidden', !text);
  el.classList.toggle('is-offline', state === 'offline');
}

// The POST body: the whole db plus the knownIds set from rule 2. Union rather
// than the load-time snapshot alone, so a row created in this tab is covered
// too — it is in db.rows at send time, which is what makes a later deletion of
// it reach the database.
function buildPayload() {
  const ids = new Set(knownIds);
  for (const r of (db.rows || [])) ids.add(r.id);
  return JSON.stringify({ ...db, knownIds: [...ids] });
}

function flushSave() {
  saveTimer = null;
  if (!loaded) { setSaveState('offline'); return; }   // rule 1
  fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: buildPayload()
  })
    .then(async res => {
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `POST ${API} -> ${res.status}`);
      }
      failedSave = false;
      retryDelay = 0;
      setSaveState('ok');
    })
    .catch(e => {
      console.error('store.js save() failed:', e);
      failedSave = true;
      setSaveState('failed', String(e.message || e));
      // Retry with backoff. Each attempt re-serialises the CURRENT db rather
      // than replaying the payload that failed, so a retry can never resurrect
      // state the user has since changed.
      clearTimeout(retryTimer);
      retryDelay = retryDelay ? Math.min(retryDelay * 2, 30000) : 2000;
      retryTimer = setTimeout(() => { retryTimer = null; flushSave(); }, retryDelay);
    });
}

export function save() {
  if (!loaded) { setSaveState('offline'); return; }   // rule 1
  clearTimeout(retryTimer); retryTimer = null;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

// Flush a pending debounced save on the way out.
//
// `visibilitychange -> hidden` is the load-bearing one. beforeunload does NOT
// fire when a tab is discarded, backgrounded on a phone, or when a laptop lid
// closes — which is precisely how the last 400ms of an afternoon's work
// vanishes. pagehide and beforeunload stay as belt and braces; all three are
// idempotent because flushNow() no-ops unless a save is actually pending.
function flushNow() {
  if (!loaded || !saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  navigator.sendBeacon(API, new Blob([buildPayload()], { type: 'application/json' }));
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushNow();
});
window.addEventListener('pagehide', flushNow);
window.addEventListener('beforeunload', e => {
  flushNow();
  // A save that failed and is still retrying is unsaved work. Closing on top
  // of it loses it silently, so make the browser ask.
  if (failedSave) { e.preventDefault(); e.returnValue = ''; }
});

// ── INFO PANEL FIELD DEFAULTS ────────────────────────────────────────────────
// The Info panel introduced columns that predate no row in seed.js and exist in
// nobody's saved localStorage. Because load() does an Object.assign merge of the
// SAVED state over the seed, a saved db wholesale replaces `rows` — so seeding
// these keys in seed.js alone would not reach an existing user's data. They are
// backfilled here instead, after the merge, on every load.
//
// Item scope (subtask rows) and project scope (parent rows) take different sets.
// Missing keys are added; existing values are never overwritten.

const ITEM_FIELD_DEFAULTS = {
  itemOwner:'', startDate:'', distributionDate:'',
  previewLink:'', reportingLink:'', reviewStudioLink:'', boordsLink:'',
  roundsOfEdits:'', language:'', productTopic:'',
  totalRevenue:'',
  designerCost:'', animatorCost:'', voCost:'',
  otherVendor1:'', otherVendor1Cost:'',
  otherVendor2:'', otherVendor2Cost:''
};

const PROJECT_FIELD_DEFAULTS = {
  projectOwner:'', clientAccount:'', clientContact:'',
  // Which column set this project's subtask sheet shows — 'all' or 'plan'.
  // See data/subtask-columns.js. No dedicated Postgres column needed:
  // api/db.js files any unknown key under the `data` JSONB catch-all, and
  // backfillInfoFields() below adds it to every existing row on load, so no
  // migration is required.
  subtaskView:'all',
  // The generated project brief, pasted in from the detail panel. One plain
  // string, project scope only — subtasks inherit the project's brief rather
  // than carrying their own. No dedicated Postgres column: api/db.js files any
  // unknown key under the `data` JSONB catch-all, so this needs no migration.
  brief:'',
  brokerAccount:'', brokerContact:'',
  oeEnd:'', hubspotLink:'', estimateLink:'', invoiceRef:'',
  totalRevenue:'',
  // Pasted Timeline Tool export. Null until imported. Project scope only —
  // the plan is authored per project, not per item.
  timeline: null,
  // Closeout checklist state. Null until the Closeout panel is opened once —
  // closeout.js lazily creates { [itemIndex]: boolean } on first toggle.
  // Backfilled here so a Supabase row always has the key, even untouched.
  closeout: null,
  // Distribution panel draft state. Null until the Distro panel is opened —
  // distro.js lazily creates { template, subtaskIds, options, fields, step }.
  // Working state for the current draft, not a record of what was sent.
  distro: null,
  // Templates panel draft state. Null until the Templates panel is opened —
  // templates.js lazily creates
  // { kind, campaignOff, teamOff, lineOff, fields, step }. Unlike distro, this
  // has no dedicated Postgres column, so api/db.js files it under the `data`
  // catch-all JSONB — no migration needed.
  templates: null
};

function backfillInfoFields() {
  (db.rows || []).forEach(r => {
    // A task removed from its project keeps a null parentId but is still an
    // ITEM, not a project — without isDetached() here a parked task would be
    // backfilled with the project-scope keys (brief, timeline, closeout…) and
    // carry that junk back onto whatever project it's next assigned to.
    const defaults = (r.parentId || isDetached(r)) ? ITEM_FIELD_DEFAULTS : PROJECT_FIELD_DEFAULTS;
    for (const k in defaults) {
      if (!(k in r)) r[k] = defaults[k];
    }
  });
}

// load(): fetches the whole db shape from the Supabase proxy. Mirrors the
// original Object.assign merge, so a missing/unreachable server falls back
// to the SEED_DB clone already sitting in `db` rather than crashing —
// logged loudly, though, so a real outage is visible in the console instead
// of quietly looking like an empty board.
//
// NOTE — first call after cutover: an empty `rows` table is a valid, real
// response (shape-wise identical to "nothing saved yet"), so it WILL
// replace the seed demo rows with an empty board. That's expected, not data
// loss — the seed data was always just local demo content, and it's now
// only the offline fallback rather than the first-run default.
export async function load() {
  try {
    const res = await fetch(API);
    if (!res.ok) throw new Error(`GET ${API} -> ${res.status}`);
    const saved = await res.json();
    // Mutate the existing object in place so the exported reference stays valid.
    Object.assign(db, saved);
    // Overwrite the hardcoded option lists with the Supabase reference tables
    // (falls back to the hardcoded defaults if the reference block is absent).
    applyReference(saved.reference);
    // Baseline for the delete scoping in api/db.js — see rule 2 up top. Reset
    // on every successful read, including the re-read after a sync, so the set
    // always describes what this tab currently believes exists.
    knownIds = new Set((saved.rows || []).map(r => r.id));
    loaded = true;
    failedSave = false;
    retryDelay = 0;
    setSaveState('ok');
  } catch (e) {
    if (loaded) {
      // A failed RE-read (the one sync.js does after a sync). `db` is untouched
      // — Object.assign never ran — so what we hold is still real data and
      // still safe to save. Stale, but no worse than before the sync.
      console.error('store.js load() failed on re-read; keeping current data:', e);
    } else {
      // First read of the session failed, so `db` is still the SEED_DB demo
      // clone. Saving stays blocked (rule 1) — posting this would delete the
      // real board and replace it with sample rows.
      console.error('store.js load() failed — showing demo data, saving is DISABLED:', e);
      setSaveState('offline', String(e.message || e));
    }
  }
  // Runs unconditionally — covers both the fresh-seed and hydrated-load paths.
  backfillInfoFields();
}

// Resets every row's daily I/O flag the first time the app opens on a new day.
export function dailyIOReset() {
  // Rule 1, restated at the one call site that fires without anyone asking it
  // to. This runs on the first open of each day and ends in save(); if the
  // load failed, that save would post the seed demo rows over the real board.
  // save() would refuse anyway — this just stops us mutating rows nobody asked
  // to change and marking the day done when nothing was persisted.
  if (!loaded) return;
  const today = new Date().toDateString();
  const lastOpen = localStorage.getItem(LAST_OPEN_KEY);
  if (lastOpen !== today) {
    db.rows.forEach(r => { r.io = false; });
    localStorage.setItem(LAST_OPEN_KEY, today);
    save();
  }
}
